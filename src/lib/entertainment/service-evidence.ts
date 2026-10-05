import type { EntertainmentDayPayload } from "./types";

const MAX_AGE_MS = 120_000;
function instant(value: string | null | undefined) {
  return value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value)
    : NaN;
}

/** Diagnostic evidence, not permission to reserve. Saved date slices do not prove overlap coverage. */
export function entertainmentServiceEvidence(
  days: EntertainmentDayPayload[],
  now = new Date(),
) {
  const generatedAt = now.toISOString();
  const evidenceDays = days.map((day) => {
    const sync = day.sync;
    const successfulAt = instant(sync?.lastSuccessfulSyncAt);
    const completedAt = instant(sync?.completedAt);
    const startedAt = instant(sync?.startedAt);
    const age = now.getTime() - successfulAt;
    const issues = new Set<string>();
    if (day.sourceMode !== "live") issues.add("non_live_source");
    if (day.missingEnvironmentVariables.length)
      issues.add("source_configuration_incomplete");
    if (day.warnings.length) issues.add("source_warning");
    if (!sync) issues.add("sync_missing");
    else if (sync.status !== "success") issues.add(`sync_${sync.status}`);
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS)
      issues.add("upstream_stale_or_unverified");
    if (
      sync &&
      (!Number.isFinite(startedAt) ||
        !Number.isFinite(completedAt) ||
        startedAt > completedAt ||
        completedAt !== successfulAt ||
        completedAt > now.getTime())
    ) {
      issues.add("sync_timestamps_unverified");
    }
    if (day.conflicts.length) issues.add("reservation_conflicts");
    const events = day.events.map((event) => {
      const status = event.sourceSnapshot.status?.trim().toUpperCase() ?? null;
      const reviewCodes = [
        ...new Set(event.reviewIssues.map((issue) => issue.code)),
      ];
      const start = instant(event.eventStartAt),
        end = instant(event.eventEndAt);
      if (event.needsReview || reviewCodes.length)
        issues.add("event_needs_review");
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        issues.add("event_time_unverified");
      return {
        eventId: event.tripleseatEventId || event.localEventId || event.eventId,
        operatingDate: event.operatingDate,
        status,
        fullBuyout:
          status === "TENTATIVE" || event.sourceSnapshot.fullBuyout === true,
        startAt: event.eventStartAt,
        endAt: event.eventEndAt,
        syncedAt: event.syncedAt,
        sourceUpdatedAt: event.sourceUpdatedAt,
        needsReview: event.needsReview,
        reviewCodes,
        allocationIds: day.reservations
          .filter((reservation) =>
            [reservation.tripleseatEventId, reservation.localEventId].some(
              (id) =>
                Boolean(id) &&
                [
                  event.eventId,
                  event.tripleseatEventId,
                  event.localEventId,
                ].includes(id),
            ),
          )
          .map((reservation) => reservation.id),
      };
    });
    const unresolvedAllocationIds = day.reservations
      .filter(
        (r) => r.needsReview || r.hasSourceUpdate || r.reviewIssues.length > 0,
      )
      .map((r) => r.id);
    if (unresolvedAllocationIds.length) issues.add("allocation_needs_review");
    const syncFresh =
      day.sourceMode === "live" &&
      sync?.status === "success" &&
      age >= 0 &&
      age <= MAX_AGE_MS &&
      startedAt <= completedAt &&
      completedAt === successfulAt;
    return {
      date: day.date,
      sourceMode: day.sourceMode,
      sync: sync
        ? {
            status: sync.status,
            startedAt: sync.startedAt,
            completedAt: sync.completedAt,
            lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
            eventsProcessed: sync.eventsProcessed,
          }
        : null,
      syncFresh,
      issues: [...issues],
      events,
      unresolvedAllocationIds,
      conflictCount: day.conflicts.length,
    };
  });
  return {
    version: 1,
    generatedAt,
    maxSyncAgeSeconds: MAX_AGE_MS / 1000,
    // Historical syncs used a start-date search and can omit spanning events or buyouts.
    // Never relabel those saved snapshots as an overlap-complete inventory ledger.
    coverage: {
      kind: "saved-operating-dates",
      dates: days.map((day) => day.date),
      overlapComplete: false,
      buyoutsComplete: false,
    },
    allSyncsFresh:
      evidenceDays.length > 0 && evidenceDays.every((day) => day.syncFresh),
    days: evidenceDays,
  };
}
