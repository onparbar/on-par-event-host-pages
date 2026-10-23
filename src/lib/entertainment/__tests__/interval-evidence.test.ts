import { describe, expect, it, vi } from "vitest";
import { intervalCoverage, readEntertainmentInterval } from "../interval-evidence";
import type { EntertainmentSourceEvent } from "../types";

const now = new Date("2026-10-13T18:00:00Z");
const source: EntertainmentSourceEvent = {
  tripleseatEventId: "buyout", tripleseatBookingId: "private-booking", eventName: "Private guest name",
  localDate: "2026-10-10", eventStartAt: "2026-10-10T21:00:00Z", eventEndAt: "2026-10-15T01:00:00Z",
  status: "TENTATIVE", fullBuyout: true, rooms: [], items: [], categoryNames: [], sourceUpdatedAt: now.toISOString(), noteCount: 0,
};
function dependencies(sources: EntertainmentSourceEvent[] = [source]) {
  return {
    now: () => now,
    adapter: {
      sourceMode: "live" as const,
      fetchEventsForDate: vi.fn(async () => []), fetchEventDateById: vi.fn(async () => null),
      fetchEntertainmentEventsOverlappingRange: vi.fn(async () => sources),
      getDiagnostics: () => ({ sourceMode: "live" as const, missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
    },
    storage: {
      getInterval: vi.fn(async () => ({ readAt: now.toISOString(), events: [], reservations: [] })),
      recordIntervalEvidence: vi.fn(async () => {}),
    },
  };
}
describe("interval coverage evidence", () => {
  it("preserves spanning buyouts and persists a private-data-free coverage receipt", async () => {
    const deps = dependencies();
    const result = await readEntertainmentInterval("2026-10-13", "2026-10-13", deps);
    expect(result.evidence.events[0]).toMatchObject({ eventId: "buyout", fullBuyout: true, allocationIds: [] });
    expect(result.evidence.issues).toEqual([]);
    expect(result.evidence.coverage).toMatchObject({ overlapComplete: true, buyoutsComplete: true,
      protectedStartAt: "2026-10-13T03:00:00.000Z", protectedEndAt: "2026-10-14T05:00:00.000Z" });
    expect(result.evidence.availability).toBe("unknown");
    expect(deps.adapter.fetchEntertainmentEventsOverlappingRange).toHaveBeenCalledWith("2026-10-12", "2026-10-14");
    expect(deps.storage.recordIntervalEvidence).toHaveBeenCalledWith(result.evidence.receiptId, result);
    expect(JSON.stringify(result)).not.toMatch(/Private guest|private-booking/);
  });
  it("proves an empty interval only after both upstream and saved snapshot reads succeed", async () => {
    const result = await readEntertainmentInterval("2026-10-13", "2026-10-13", dependencies([]));
    expect(result.evidence.events).toEqual([]);
    expect(result.evidence.issues).toEqual([]);
  });
  it("does not hide buyouts with missing times or claim ordinary events are allocated", async () => {
    const result = await readEntertainmentInterval("2026-10-13", "2026-10-13", dependencies([
      { ...source, eventStartAt: null }, { ...source, tripleseatEventId: "ordinary", status: "DEFINITE", fullBuyout: false },
    ]));
    expect(result.evidence.events).toHaveLength(2);
    expect(result.evidence.issues).toContain("event_interval_unverified");
    expect(result.evidence.issues).toContain("event_allocations_unverified");
  });
  it.each(["upstream", "database", "receipt"])("fails closed on %s failure without serving cached evidence", async (stage) => {
    const deps = dependencies();
    if (stage === "upstream") deps.adapter.fetchEntertainmentEventsOverlappingRange.mockRejectedValue(new Error("private detail"));
    if (stage === "database") deps.storage.getInterval.mockRejectedValue(new Error("private detail"));
    if (stage === "receipt") deps.storage.recordIntervalEvidence.mockRejectedValue(new Error("private detail"));
    await expect(readEntertainmentInterval("2026-10-13", "2026-10-13", deps)).rejects.toThrow();
  });
  it("includes a next-day event whose setup protection crosses midnight", async () => {
    const result = await readEntertainmentInterval("2026-10-13", "2026-10-13", dependencies([
      { ...source, eventStartAt: "2026-10-14T04:30:00Z", eventEndAt: "2026-10-14T06:00:00Z" },
    ]));
    expect(result.evidence.events).toHaveLength(1);
  });
  it.each([["2026-03-08", 23], ["2026-11-01", 25]] as const)("handles the %s Eastern clock change", (date, hours) => {
    const coverage = intervalCoverage(date, date);
    expect(Date.parse(coverage.endAt) - Date.parse(coverage.startAt)).toBe(hours * 3600000);
  });
  it("bounds invalid or oversized requests", () => {
    expect(() => intervalCoverage("2026-02-30", "2026-03-01")).toThrow();
    expect(() => intervalCoverage("2026-01-01", "2026-02-01")).toThrow();
  });
});
