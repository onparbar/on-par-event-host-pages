import { VipPrepClient } from "@/lib/vip-prep/client";
import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import { StaleSaveError } from "@/lib/stale-save";
import { detectFloorPlanConflicts } from "./conflicts";
import { generateFloorPlanReservationProposal } from "./generator";
import { getFloorPlanDay } from "./service";
import { floorPlanStorageAtVersion, getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanStatus } from "./types";
import { hasBlockingValidationFailures, validateFloorPlan } from "./validator";

type DraftPlanningDependencies = {
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  loadDay?: typeof getFloorPlanDay;
};

/** Create missing draft documents only. Never approve plans, replace staff work, or book entertainment. */
export async function prepareFloorPlanDraftWindow(
  startDate: string,
  endDate: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  dependencies: DraftPlanningDependencies = {},
) {
  const count = (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000 + 1;
  if (!isValidEntertainmentDate(startDate) || !isValidEntertainmentDate(endDate) || !Number.isInteger(count) || count < 1 || count > 31) throw new Error("Draft planning requires an ordered window of at most 31 calendar dates.");
  const client = dependencies.vipPrepClient ?? new VipPrepClient();
  const bookings = client.configured ? await client.fetchRange(startDate, endDate) : null;
  const cachedClient: Pick<VipPrepClient, "configured" | "fetchRange"> = {
    configured: client.configured,
    async fetchRange(from, to) {
      if (!bookings || from < startDate || to > endDate) throw new Error("The planning booking window is unavailable.");
      const reservations = bookings.reservations.filter((entry) => entry.operatingDate >= from && entry.operatingDate <= to);
      return { ...bookings, from, to, reservations, reservationCount: reservations.length };
    },
  };
  const results: Array<{ date: string; status: "created" | "skipped" | "error"; eventCount: number; planStatus?: FloorPlanStatus; message?: string }> = [];
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) {
    try {
      const existing = await storage.get(date);
      if (existing) {
        results.push({ date, status: "skipped", eventCount: existing.events.length, planStatus: existing.status, message: "An existing saved plan was preserved." });
        continue;
      }
      const payload = await (dependencies.loadDay ?? getFloorPlanDay)(date, storage, { readOnly: true, vipPrepClient: cachedClient });
      if (payload.sourceMode !== "live") throw new Error("Live source data is required to prepare a floor-plan draft.");
      if (!payload.plan.events.length) {
        results.push({ date, status: "skipped", eventCount: 0, message: "No active event sources are available for this date." });
        continue;
      }
      const proposal = generateFloorPlanReservationProposal(payload.plan, "fill-missing");
      const draft = { ...payload.plan, status: "Draft" as FloorPlanStatus, version: 0, approvedAt: null, approvedBy: null, ruleVersion: FLOOR_PLAN_RULE_VERSION,
        reservations: proposal.reservations, events: payload.plan.events.map((event) => {
          const issues = proposal.issues.filter((issue) => issue.blocking && (!issue.eventId || issue.eventId === event.id));
          return { ...event, source: { ...event.source, ...(issues.length ? { seatingGenerationIssues: issues } : {}) } };
        }) };
      const conflicts = detectFloorPlanConflicts(draft);
      const validation = validateFloorPlan(draft, payload.entertainmentReservations, conflicts, payload.entertainmentConflicts);
      draft.status = conflicts.length || payload.entertainmentConflicts.length ? "Conflict" : payload.warnings.length || hasBlockingValidationFailures(validation) ? "Needs Review" : "Draft";
      // A checked zero-version save refuses a plan created by another staff member during preparation.
      const saved = await floorPlanStorageAtVersion(storage, 0).save(draft, "Prepared a missing planning draft; existing plans and entertainment reservations were not changed.");
      results.push({ date, status: "created", eventCount: saved.events.length, planStatus: saved.status });
    } catch (error) {
      results.push({ date, status: error instanceof StaleSaveError ? "skipped" : "error", eventCount: 0,
        message: error instanceof StaleSaveError ? "A concurrent saved plan was preserved." : error instanceof Error ? error.message : "Unable to prepare this floor-plan draft." });
    }
  }
  return { startDate, endDate, results };
}
