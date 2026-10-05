import { describe, expect, it } from "vitest";
import { entertainmentServiceEvidence } from "../service-evidence";
import { buildEntertainmentSchedule } from "../domain";
import type { EntertainmentDayPayload } from "../types";

const now = new Date("2026-10-05T21:00:00Z");
function day(): EntertainmentDayPayload {
  return {
    date: "2026-10-12",
    events: [],
    reservations: [],
    conflicts: [],
    sourceMode: "live",
    warnings: [],
    missingEnvironmentVariables: [],
    canEdit: true,
    sync: {
      operatingDate: "2026-10-12",
      status: "success",
      startedAt: "2026-10-05T20:59:20Z",
      completedAt: "2026-10-05T20:59:30Z",
      lastSuccessfulSyncAt: "2026-10-05T20:59:30Z",
      eventsProcessed: 0,
      reservationsCreated: 0,
      reservationsUpdated: 0,
      warningsCreated: 0,
      conflictsFound: 0,
      errorSummary: null,
    },
  };
}
describe("entertainment service evidence", () => {
  it("separates a fresh sync from unproven overlap and historical buyout coverage", () => {
    const result = entertainmentServiceEvidence([day()], now);
    expect(result.allSyncsFresh).toBe(true);
    expect(result.days[0].issues).toEqual([]);
    expect(result.coverage).toMatchObject({
      overlapComplete: false,
      buyoutsComplete: false,
    });
  });
  it.each(["running", "error", "partial"] as const)(
    "does not mask a %s sync with a recent success",
    (status) => {
      const input = day();
      input.sync!.status = status;
      input.sync!.errorSummary = "private upstream detail";
      const result = entertainmentServiceEvidence([input], now);
      expect(result.allSyncsFresh).toBe(false);
      expect(result.days[0].issues).toContain(`sync_${status}`);
      expect(JSON.stringify(result)).not.toContain("private upstream detail");
    },
  );
  it("does not turn a recent download into a recent upstream sync", () => {
    const input = day();
    input.sync!.lastSuccessfulSyncAt = "2026-10-05T15:49:00Z";
    const result = entertainmentServiceEvidence([input], now);
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.allSyncsFresh).toBe(false);
    expect(result.days[0].issues).toContain("upstream_stale_or_unverified");
  });
  it.each([null, "2026-10-05T22:00:00Z", "2026-10-05T21:00:00"])(
    "rejects invalid/future sync evidence %s",
    (value) => {
      const input = day();
      input.sync!.lastSuccessfulSyncAt = value;
      expect(entertainmentServiceEvidence([input], now).allSyncsFresh).toBe(
        false,
      );
    },
  );
  it("marks mock data, absent sync and source warnings without exposing secrets", () => {
    const input = day();
    input.sync = null;
    input.sourceMode = "mock";
    input.warnings = ["sensitive diagnostics"];
    input.missingEnvironmentVariables = ["PRIVATE_KEY"];
    const result = entertainmentServiceEvidence([input], now);
    expect(result.days[0].issues).toEqual(
      expect.arrayContaining([
        "sync_missing",
        "non_live_source",
        "source_warning",
        "source_configuration_incomplete",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(/sensitive|PRIVATE_KEY/);
  });
  it("includes Tentative buyouts without allocations and exposes review codes, not private source data", () => {
    const built = buildEntertainmentSchedule({
      sourceEvents: [
        {
          tripleseatEventId: "buyout",
          tripleseatBookingId: "private-booking",
          eventName: "Private Event",
          localDate: "2026-10-12",
          eventStartAt: "2026-10-12T21:00:00Z",
          eventEndAt: "2026-10-13T01:00:00Z",
          status: "TENTATIVE",
          rooms: [],
          items: [],
          categoryNames: [],
          sourceUpdatedAt: null,
          noteCount: 0,
        },
      ],
      localEvents: [],
      now: now.toISOString(),
    });
    const result = entertainmentServiceEvidence(
      [{ ...day(), events: built.events }],
      now,
    );
    expect(result.days[0].events).toEqual([
      expect.objectContaining({
        eventId: "buyout",
        fullBuyout: true,
        allocationIds: [],
      }),
    ]);
    expect(result.days[0].issues).toContain("event_needs_review");
    expect(JSON.stringify(result)).not.toMatch(
      /Private Event|private-booking|sourceSnapshot/,
    );
  });
});
