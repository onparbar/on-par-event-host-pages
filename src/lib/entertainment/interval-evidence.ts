import { createHash, randomUUID } from "node:crypto";
import { getTripleseatAdapter, type TripleseatAdapter } from "../kitchen/tripleseat";
import { SupabaseEntertainmentStorage } from "./storage";
import { addCalendarDays, isValidEntertainmentDate, zonedDateTimeToIso } from "./time";
import { detectEntertainmentConflicts } from "./domain";
import { getEntertainmentResource } from "./resources";
import type { EntertainmentEventSnapshot, EntertainmentReservation } from "./types";

type IntervalStorage = {
  getInterval(start: string, end: string): Promise<{
    readAt: string;
    events: EntertainmentEventSnapshot[];
    reservations: EntertainmentReservation[];
  }>;
  recordIntervalEvidence(id: string, payload: unknown): Promise<void>;
};

export function intervalCoverage(from: string, to: string) {
  if (!isValidEntertainmentDate(from) || !isValidEntertainmentDate(to) || from > to ||
    Date.parse(to) - Date.parse(from) > 30 * 86_400_000) {
    throw new Error("Invalid entertainment coverage range.");
  }
  const startAt = zonedDateTimeToIso(from, 0, 0);
  const endAt = zonedDateTimeToIso(addCalendarDays(to, 1), 0, 0);
  return {
    kind: "interval-overlap" as const,
    startAt,
    endAt,
    // Includes room cleanup before the interval and event pre-protection after it.
    protectedStartAt: new Date(Date.parse(startAt) - 60 * 60_000).toISOString(),
    protectedEndAt: new Date(Date.parse(endAt) + 60 * 60_000).toISOString(),
    searchFrom: addCalendarDays(from, -1),
    searchTo: addCalendarDays(to, 1),
  };
}

function validInstant(value: string | null) {
  return value != null && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/** Live overlap read + consistent saved allocation snapshot; never writes reservations. */
export async function readEntertainmentInterval(
  from: string,
  to: string,
  options: { adapter?: TripleseatAdapter; storage?: IntervalStorage; now?: () => Date } = {},
) {
  const coverage = intervalCoverage(from, to);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? new SupabaseEntertainmentStorage();
  const now = options.now ?? (() => new Date());
  if (adapter.sourceMode !== "live" || !adapter.fetchEntertainmentEventsOverlappingRange) {
    throw new Error("Live overlap evidence is unavailable.");
  }
  const startedAt = now().toISOString();
  const sources = await adapter.fetchEntertainmentEventsOverlappingRange(coverage.searchFrom, coverage.searchTo);
  const completedAt = now().toISOString();
  const saved = await storage.getInterval(coverage.protectedStartAt, coverage.protectedEndAt);
  const issues = new Set<string>();
  const diagnostics = adapter.getDiagnostics();
  if (diagnostics.warnings.length || diagnostics.missingEnvironmentVariables.length) {
    issues.add("source_configuration_or_warning");
  }
  if (sources.length > 10_000 || new Set(sources.map((event) => event.tripleseatEventId)).size !== sources.length) {
    throw new Error("Upstream event identities are incomplete.");
  }
  const overlaps = (start: string | null, end: string | null) => {
    if (!validInstant(start) || !validInstant(end) || Date.parse(end!) <= Date.parse(start!)) {
      issues.add("event_interval_unverified");
      return true; // Keep uncertain events visible; never silently filter them out.
    }
    return Date.parse(start!) < Date.parse(coverage.protectedEndAt) &&
      Date.parse(end!) > Date.parse(coverage.protectedStartAt);
  };
  const relevant = sources.filter((event) => overlaps(event.eventStartAt, event.eventEndAt));
  const sourceIds = new Set(relevant.map((event) => event.tripleseatEventId));
  const reservations = saved.reservations.map((row) => {
    if (!getEntertainmentResource(row.resourceId) || !validInstant(row.startAt) ||
      !validInstant(row.endAt) || Date.parse(row.endAt) <= Date.parse(row.startAt)) {
      issues.add("allocation_invalid");
    }
    if (row.needsReview || row.hasSourceUpdate || row.reviewIssues.length) issues.add("allocation_needs_review");
    if (row.source === "tripleseat" && (!row.tripleseatEventId || !sourceIds.has(row.tripleseatEventId))) {
      issues.add("saved_allocation_without_current_event");
    }
    return {
      id: row.id,
      operatingDate: row.operatingDate,
      eventId: row.tripleseatEventId ?? row.localEventId,
      eventName: "Reserved event",
      resourceId: row.resourceId,
      resourceName: getEntertainmentResource(row.resourceId)?.canonicalName ?? row.resourceId,
      resourceCategory: row.resourceCategory,
      eventColor: row.eventColor,
      startAt: row.startAt,
      endAt: row.endAt,
      source: row.source,
      manualOverride: row.manualOverride,
      needsReview: row.needsReview || row.hasSourceUpdate || row.reviewIssues.length > 0,
      updatedAt: row.updatedAt,
    };
  });
  if (new Set(reservations.map((row) => row.id)).size !== reservations.length) {
    throw new Error("Saved allocation identities are incomplete.");
  }
  const events = relevant.map((source) => {
    const fullBuyout = source.status?.trim().toUpperCase() === "TENTATIVE" || source.fullBuyout === true;
    const matches = saved.events.filter((event) => event.tripleseatEventId === source.tripleseatEventId);
    const stored = matches.length === 1 ? matches[0] : null;
    const allocations = reservations.filter((row) => row.eventId === source.tripleseatEventId);
    // A new buyout is authoritative without any saved resource rows. Ordinary events need
    // an actual reviewed allocation record; a hypothetical auto-assignment is not a booking.
    if (!fullBuyout && !stored) issues.add("event_allocations_unverified");
    if (stored && (!validInstant(source.sourceUpdatedAt) ||
      Date.parse(stored.sourceUpdatedAt ?? "") !== Date.parse(source.sourceUpdatedAt!) ||
      stored.eventStartAt !== source.eventStartAt || stored.eventEndAt !== source.eventEndAt ||
      stored.sourceSnapshot.status !== source.status)) issues.add("saved_event_requires_resync");
    if (stored && JSON.stringify({ items: stored.sourceSnapshot.items, rooms: stored.sourceSnapshot.rooms }) !==
      JSON.stringify({ items: source.items, rooms: source.rooms })) issues.add("saved_event_requires_resync");
    if (!fullBuyout && (stored?.needsReview || stored?.reviewIssues.length)) issues.add("event_needs_review");
    return {
      eventId: source.tripleseatEventId,
      operatingDate: source.localDate,
      status: source.status,
      fullBuyout,
      startAt: source.eventStartAt,
      endAt: source.eventEndAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
      allocationIds: allocations.map((row) => row.id),
    };
  });
  for (const event of saved.events) {
    if (!validInstant(event.eventStartAt) || !validInstant(event.eventEndAt)) issues.add("saved_event_interval_unverified");
    if (event.sourceSnapshot.sourceSystem !== "vip-prep" && event.sourceSnapshot.sourceSystem !== "contract-evidence" &&
      !sourceIds.has(event.tripleseatEventId)) issues.add("saved_event_without_current_source");
  }
  const conflicts = detectEntertainmentConflicts(saved.reservations);
  if (conflicts.length) issues.add("reservation_conflicts");
  const generatedAt = now().toISOString();
  if ([startedAt, completedAt, saved.readAt].some((time) =>
    !validInstant(time) || Date.parse(generatedAt) - Date.parse(time) < 0 ||
    Date.parse(generatedAt) - Date.parse(time) > 120_000) ||
    Date.parse(startedAt) > Date.parse(completedAt) || Date.parse(completedAt) > Date.parse(saved.readAt)) {
    issues.add("source_read_stale_or_invalid");
  }
  const revision = createHash("sha256").update(JSON.stringify({ coverage, events, reservations })).digest("hex");
  const receiptId = randomUUID();
  const payload = {
    from, to, timeZone: "America/New_York" as const,
    reservationCount: reservations.length,
    reservations,
    evidence: {
      version: 2 as const,
      sourceMode: "live" as const,
      generatedAt,
      sourceReadStartedAt: startedAt,
      sourceReadCompletedAt: completedAt,
      savedReadAt: saved.readAt,
      receiptId,
      revision,
      coverage: { ...coverage, overlapComplete: true, buyoutsComplete: true, savedSnapshotComplete: true },
      events,
      issues: [...issues],
      availability: "unknown" as const, // Shared protection and other sources remain separate gates.
    },
  };
  // An unavailable receipt store fails the request; old evidence is never relabeled as fresh.
  await storage.recordIntervalEvidence(receiptId, payload);
  return payload;
}
