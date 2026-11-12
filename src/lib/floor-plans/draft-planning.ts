import { VipPrepClient } from "@/lib/vip-prep/client";
import { sourceIsAtLeastAsNew } from "@/lib/confirmed-contract-events";
import { addCalendarDays, isValidEntertainmentDate, localDateForIso } from "@/lib/entertainment/time";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { StaleSaveError } from "@/lib/stale-save";
import { distinctFloorPlanEventColor } from "./configuration/colors";
import { detectFloorPlanConflicts } from "./conflicts";
import { generateFloorPlanReservationProposal } from "./generator";
import { isProtectedFloorPlanAssignment } from "./owner-holds";
import { sameReservationInterval } from "./reservation-state";
import { summarizeEventSeating } from "./seating-summary";
import { getFloorPlanDay } from "./service";
import { floorPlanStorageAtVersion, getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDayPayload, type FloorPlanDocument, type FloorPlanEvent, type FloorPlanReservation, type FloorPlanStatus } from "./types";
import { hasBlockingValidationFailures, validateFloorPlan } from "./validator";

type DraftPlanningDependencies = {
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  loadDay?: typeof getFloorPlanDay;
  fillMissingSeating?: boolean;
  refreshedTripleseatEventDates?: ReadonlyMap<string, string>;
};

type DraftPlanningResult = {
  date: string;
  status: "created" | "updated" | "needs-review" | "skipped" | "error";
  eventCount: number;
  planStatus?: FloorPlanStatus;
  needsSeatingReview?: boolean;
  message?: string;
};

function eventIdentity(event: FloorPlanEvent) {
  return [event.tripleseatEventId, ...(event.source.verifiedSourceEventIds ?? [])];
}

function hasSeating(row: FloorPlanReservation) {
  return row.reservationType === "seating" || row.reservationType === "room";
}

function sameSeatingSource(saved: FloorPlanEvent, current: FloorPlanEvent) {
  return saved.tripleseatEventId === current.tripleseatEventId && saved.guestCount === current.guestCount &&
    saved.fullBuyout === current.fullBuyout && saved.status.trim().toUpperCase() === current.status.trim().toUpperCase() &&
    sameReservationInterval(saved, current) && sourceIsAtLeastAsNew(current.beoLastModifiedAt, saved.beoLastModifiedAt) &&
    JSON.stringify([...saved.contractedAreaIds].sort()) === JSON.stringify([...current.contractedAreaIds].sort()) &&
    JSON.stringify([...(saved.source.onParBookingAreaIds ?? [])].sort()) === JSON.stringify([...(current.source.onParBookingAreaIds ?? [])].sort()) &&
    !saved.unresolvedAreaNames.length &&
    !current.source.floorPlanChanges?.some((change) => change.assignmentsReconciled === false);
}

async function addMissingDraftSeating(
  existing: FloorPlanDocument,
  payload: FloorPlanDayPayload,
  storage: FloorPlanStorage,
  refreshedEventDates: ReadonlyMap<string, string>,
): Promise<DraftPlanningResult> {
  const date = existing.eventDate;
  if (payload.plan.version !== existing.version || payload.plan.id !== existing.id || payload.plan.eventDate !== date) throw new StaleSaveError();
  const preserved = { date, eventCount: existing.events.length, planStatus: existing.status };
  const review = { ...preserved, status: "needs-review", needsSeatingReview: true, message: "Some missing seating could not be verified or placed; existing assignments were preserved." } as const;
  const candidates = payload.plan.events.filter((event) => eventIdentity(event).some((id) => /^\d+$/.test(id) && refreshedEventDates.get(id) === date));
  const unavailableSources = payload.sourceMode !== "live" || payload.warnings.some((warning) => /^(?:Tripleseat source could not be loaded|On Par Bookings is unavailable|The shared Entertainment Schedule could not be loaded)/.test(warning));
  const events = [...existing.events];
  const reservations = [...existing.reservations];
  // The current projection can contain real VIP bookings or moved source intervals
  // not in the durable draft. Treat both versions as constraints, not new writes.
  const projected = payload.plan.reservations.filter((row) => !existing.reservations.some((saved) =>
    saved.id === row.id && saved.floorPlanEventId === row.floorPlanEventId && saved.areaId === row.areaId &&
    saved.reservationType === row.reservationType && sameReservationInterval(saved, row)));
  let needsSeatingReview = false;
  let history: Awaited<ReturnType<FloorPlanStorage["revisions"]>> | undefined;
  for (const current of candidates) {
    const currentIds = eventIdentity(current);
    const matches = events.filter((saved) => saved.id === current.id || eventIdentity(saved).some((id) => currentIds.includes(id)));
    const previous = matches.length === 1 ? matches[0] : null;
    const ownRows = previous ? reservations.filter((row) => row.floorPlanEventId === previous.id) : [];
    if (ownRows.some((row) => hasSeating(row) || isProtectedFloorPlanAssignment(row))) continue;
    const status = current.status.trim().toUpperCase();
    if (unavailableSources || matches.length > 1 || current.floorPlanId !== existing.id ||
        (status !== "DEFINITE" && !(current.fullBuyout && !/^(?:CANCELLED|CANCELED|LOST|PROSPECT)$/.test(status))) ||
        !Number.isInteger(current.guestCount) || current.guestCount <= 0 || !current.contractedAreaIds.length ||
        !current.source.rooms.length || current.unresolvedAreaNames.length || !Number.isFinite(Date.parse(current.beoLastModifiedAt ?? "")) ||
        current.source.reviewReasons.some((reason) => /Guest count is missing or invalid|Guest count was filled from .*package/i.test(reason)) ||
        !reservationOccupancy(current.startAt, current.endAt) || localDateForIso(current.startAt!) !== date ||
        (previous && !sameSeatingSource(previous, current))) {
      needsSeatingReview = true;
      continue;
    }
    if (previous) {
      history ??= payload.revisions.some((revision) => revision.version === existing.version) ? payload.revisions : await storage.revisions(existing.id);
      // A deliberate removal must not be treated as missing generation.
      if (history.some((revision) => [revision.previousValue, revision.newValue].some((plan) => {
        const historicalIds = plan?.events.filter((item) => item.id === previous.id || eventIdentity(item).some((id) => currentIds.includes(id))).map((item) => item.id) ?? [];
        return plan?.reservations.some((row) => historicalIds.includes(row.floorPlanEventId) && hasSeating(row));
      }))) continue;
      if (!history.some((revision) => revision.version === existing.version)) { needsSeatingReview = true; continue; }
    }
    const event = previous ?? { ...current, color: distinctFloorPlanEventColor(current.color, events.length, events.map((item) => item.color)) };
    const trialEvents = [...events, ...(!previous ? [event] : [])];
    const contextEvents = [...trialEvents, ...payload.plan.events.filter((item) => !trialEvents.some((other) => other.id === item.id))];
    const contextReservations = [...reservations, ...projected];
    const proposal = generateFloorPlanReservationProposal({ ...existing, events: contextEvents, reservations: contextReservations }, "fill-missing", event.id);
    const added = proposal.reservations.filter((row) => row.floorPlanEventId === event.id && proposal.addedReservationIds.includes(row.id));
    const trialReservations = [...contextReservations, ...added];
    const coverage = summarizeEventSeating(event, trialReservations, { allReservations: trialReservations });
    if (!proposal.complete || proposal.issues.some((issue) => issue.code === "placement-unavailable") ||
        !added.length || !coverage.fullEventCoverage || coverage.foodAssigned < coverage.foodRequired ||
        detectFloorPlanConflicts({ ...existing, events: contextEvents, reservations: trialReservations }).some((conflict) => conflict.eventIds.includes(event.id))) {
      needsSeatingReview = true;
      continue;
    }
    if (!previous) events.push(event);
    reservations.push(...added);
  }
  if (reservations.length === existing.reservations.length) return needsSeatingReview ? review : { ...preserved, status: "skipped", message: "An existing saved plan was preserved." };

  const draft = { ...existing, events, reservations };
  const conflicts = detectFloorPlanConflicts(draft);
  const validation = validateFloorPlan(draft, payload.entertainmentReservations, conflicts, payload.entertainmentConflicts);
  draft.status = existing.status === "Conflict" || conflicts.length || payload.entertainmentConflicts.length ? "Conflict"
    : existing.status === "Needs Review" || needsSeatingReview || payload.warnings.length || hasBlockingValidationFailures(validation) ? "Needs Review" : "Draft";
  const saved = await floorPlanStorageAtVersion(storage, existing.version).save(draft, "Added complete seating and food-table suggestions to an unapproved draft; existing assignments and entertainment were preserved.");
  return { date, status: "updated", eventCount: saved.events.length, planStatus: saved.status, ...(needsSeatingReview ? { needsSeatingReview: true, message: review.message } : {}) };
}

/** Create missing drafts and optionally fill missing seating without replacing saved work or booking entertainment. */
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
  const results: DraftPlanningResult[] = [];
  for (let date = startDate; date <= endDate; date = addCalendarDays(date, 1)) {
    try {
      const existing = await storage.get(date);
      if (existing) {
        if (dependencies.fillMissingSeating && dependencies.refreshedTripleseatEventDates?.size &&
            ["Draft", "Needs Review", "Conflict"].includes(existing.status) && !existing.approvedAt && !existing.approvedBy) {
          const payload = await (dependencies.loadDay ?? getFloorPlanDay)(date, storage, { readOnly: true, vipPrepClient: cachedClient });
          results.push(await addMissingDraftSeating(existing, payload, storage, dependencies.refreshedTripleseatEventDates));
          continue;
        }
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
