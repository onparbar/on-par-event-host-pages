import { VipPrepClient } from "@/lib/vip-prep/client";
import { addCalendarDays } from "@/lib/entertainment/time";
import { StaleSaveError } from "@/lib/stale-save";
import { detectFloorPlanConflicts } from "./conflicts";
import { generateFloorPlanReservationProposal, type FloorPlanGenerationIssue } from "./generator";
import { isDecemberOwnerHoldFloorPlanEvent, isProtectedFloorPlanAssignment, withoutDecemberOwnerHoldFloorPlanEvents } from "./owner-holds";
import { getFloorPlanDay } from "./service";
import { floorPlanStorageAtVersion, getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import { type FloorPlanEvent, type FloorPlanStatus } from "./types";
import { hasBlockingValidationFailures, validateFloorPlan } from "./validator";

type Dependencies = {
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  loadDay?: typeof getFloorPlanDay;
};

function planningSourceSignature(events: FloorPlanEvent[]) {
  return JSON.stringify(events.map((event) => ({
    id: event.id, sourceId: event.tripleseatEventId, guests: event.guestCount,
    start: Date.parse(event.startAt ?? ""), end: Date.parse(event.endAt ?? ""),
    areas: [...event.contractedAreaIds].sort(), unresolved: event.unresolvedAreaNames,
    fullBuyout: event.fullBuyout, food: event.source.food, entertainment: event.source.entertainment,
    sourceUpdatedAt: Date.parse(event.beoLastModifiedAt ?? ""),
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

/** Remove December placeholders from generated drafts only; never synchronize external bookings. */
export async function reconcileDecemberOwnerHoldDrafts(storage: FloorPlanStorage = getFloorPlanStorage(), dependencies: Dependencies = {}) {
  const client = dependencies.vipPrepClient ?? new VipPrepClient();
  if (!client.configured) throw new Error("A live booking feed is required to release December owner holds.");
  const bookings = await client.fetchRange("2026-12-01", "2026-12-31");
  const cachedClient = { configured: true, async fetchRange(from: string, to: string) {
    if (from < "2026-12-01" || to > "2026-12-31") throw new Error("December planning only.");
    const reservations = bookings.reservations.filter((row) => row.operatingDate >= from && row.operatingDate <= to);
    return { ...bookings, from, to, reservations, reservationCount: reservations.length };
  } };
  const results: Array<{ date: string; status: "updated" | "skipped" | "error"; removedHolds: number; planStatus?: FloorPlanStatus; message?: string }> = [];
  for (let date = "2026-12-01"; date <= "2026-12-31"; date = addCalendarDays(date, 1)) {
    try {
      const saved = await storage.get(date);
      if (!saved || !saved.events.some((event) => isDecemberOwnerHoldFloorPlanEvent(event, date))) continue;
      if (!["Draft", "Needs Review", "Conflict"].includes(saved.status) || saved.approvedAt || saved.approvedBy || saved.reservations.some(isProtectedFloorPlanAssignment)) {
        results.push({ date, status: "skipped", removedHolds: 0, message: "Staff-edited or approved work was preserved." });
        continue;
      }
      const day = await (dependencies.loadDay ?? getFloorPlanDay)(date, storage, { readOnly: true, vipPrepClient: cachedClient });
      if (day.sourceMode !== "live") throw new Error("Live source data is required.");
      if (day.plan.version !== saved.version) throw new StaleSaveError();
      if (day.entertainmentReservations.some((row) => row.active && row.resourceCategory === "private-rooms" && (row.manualOverride || row.source === "manual"))) {
        results.push({ date, status: "skipped", removedHolds: 0, message: "An explicit staff room reservation was preserved for review." });
        continue;
      }
      // A renamed/converted live booking is not an owner hold, even when its old saved name was.
      if (saved.events.some((event) => isDecemberOwnerHoldFloorPlanEvent(event, date) && day.plan.events.some((current) => current.id === event.id))) {
        results.push({ date, status: "skipped", removedHolds: 0, message: "A booking changed or contains a staff assignment; review the current plan." });
        continue;
      }
      const filtered = withoutDecemberOwnerHoldFloorPlanEvents(saved);
      const removedHolds = saved.events.length - filtered.events.length;
      if (!removedHolds) continue;
      if (planningSourceSignature(filtered.events) !== planningSourceSignature(day.plan.events)) {
        results.push({ date, status: "skipped", removedHolds: 0, message: "Event or customer booking details changed; existing assignments were preserved for review." });
        continue;
      }
      // Keep every real event and existing assignment byte-for-byte; only fill missing seating.
      let reservations = filtered.reservations;
      const generationIssues: FloorPlanGenerationIssue[] = [];
      for (const event of filtered.events) {
        // Event-scoped fill has no joint-reallocation fallback that could move another party.
        const proposal = generateFloorPlanReservationProposal({ ...filtered, reservations }, "fill-missing", event.id);
        reservations = proposal.reservations;
        generationIssues.push(...proposal.issues);
      }
      if (filtered.reservations.some((existing) => !reservations.some((row) => row.id === existing.id && JSON.stringify(row) === JSON.stringify(existing)))) {
        throw new Error("Existing event assignments must not move during owner-hold reconciliation.");
      }
      const draft = { ...filtered, status: "Draft" as FloorPlanStatus, reservations,
        events: filtered.events.map((event) => {
          const { seatingGenerationIssues: _oldIssues, ...source } = event.source;
          const issues = generationIssues.filter((issue) => issue.blocking && (!issue.eventId || issue.eventId === event.id));
          return { ...event, source: { ...source, ...(issues.length ? { seatingGenerationIssues: issues } : {}) } };
        }) };
      const conflicts = detectFloorPlanConflicts(draft);
      const validation = validateFloorPlan(draft, day.entertainmentReservations, conflicts, day.entertainmentConflicts);
      const oldGenerationMessages = new Set(saved.events.flatMap((event) => event.source.seatingGenerationIssues?.map((issue) => issue.message) ?? []));
      const sourceWarnings = day.warnings.filter((warning) => !oldGenerationMessages.has(warning));
      draft.status = conflicts.length || day.entertainmentConflicts.length ? "Conflict" : sourceWarnings.length || hasBlockingValidationFailures(validation) ? "Needs Review" : "Draft";
      const updated = await floorPlanStorageAtVersion(storage, saved.version).save(draft,
        "Released internal December VIP owner holds for event planning; preserved real bookings and existing assignments. External booking records and entertainment were not changed.");
      results.push({ date, status: "updated", removedHolds, planStatus: updated.status });
    } catch (error) {
      results.push({ date, status: error instanceof StaleSaveError ? "skipped" : "error", removedHolds: 0,
        message: error instanceof StaleSaveError ? "A concurrent staff save was preserved." : "This date could not be reconciled; its saved plan was preserved." });
    }
  }
  return { month: "2026-12", results };
}
