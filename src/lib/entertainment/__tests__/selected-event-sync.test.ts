import { describe, expect, it, vi } from "vitest";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { MemoryEntertainmentStorage } from "../storage";
import { syncEntertainmentDay, updateEntertainmentReservation } from "../sync";
import type { EntertainmentReservation, EntertainmentSourceEvent } from "../types";

const DATE = "2026-11-24";
const START = `${DATE}T22:30:00.000Z`;
const END = "2026-11-25T01:30:00.000Z";

function source(id: string, room: string, name = "2 bowling lanes for 2 hours"): EntertainmentSourceEvent {
  return { tripleseatEventId: id, tripleseatBookingId: null, eventName: `Redacted ${id}`, localDate: DATE,
    eventStartAt: START, eventEndAt: END, status: "DEFINITE", rooms: [{ id: room, name: room }],
    categoryNames: ["Bowling"], sourceUpdatedAt: `${DATE}T13:00:00.000Z`, noteCount: 0,
    items: [{ sourceId: "bowling-line", name, description: null, categoryName: "Bowling", quantity: null, startAt: null, endAt: null }] };
}

function fixture(initial: EntertainmentSourceEvent[]) {
  const storage = new MemoryEntertainmentStorage();
  const fetchEntertainmentEventsForDate = vi.fn<NonNullable<TripleseatAdapter["fetchEntertainmentEventsForDate"]>>().mockResolvedValue(initial);
  const adapter: TripleseatAdapter = { sourceMode: "live", fetchEventsForDate: async () => [], fetchEventDateById: async () => null,
    fetchEntertainmentEventsForDate, getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) };
  const vipPrepClient = { configured: false, fetchRange: vi.fn(async () => { throw new Error("Unexpected VIP refresh"); }) };
  return { storage, fetchEntertainmentEventsForDate, options: { storage, adapter, vipPrepClient, localEvents: [], floorPlanStorage: { get: async () => null } } };
}

function lanes(rows: EntertainmentReservation[], id: string) {
  return rows.filter((row) => row.active && row.resourceCategory === "bowling" && row.tripleseatEventId === id).map((row) => row.resourceId).sort();
}

describe("scoped Tripleseat entertainment refresh", () => {
  it("moves only the selected event to the correct side and reserves against other saved lanes", async () => {
    const selected = source("100", "Main Dining");
    const other = { ...source("200", "VIP 2"), eventName: selected.eventName };
    const { storage, options, fetchEntertainmentEventsForDate } = fixture([selected, other]);
    await syncEntertainmentDay(DATE, options);
    const before = await storage.getDay(DATE);
    expect(lanes(before.reservations, "100")).toEqual(["bowling-11", "bowling-12"]);
    expect(lanes(before.reservations, "200")).toEqual(["bowling-1", "bowling-2"]);
    // Tripleseat reports a separate room change for the other party too; don't apply it here.
    fetchEntertainmentEventsForDate.mockResolvedValue([source("100", "VIP 1"), source("200", "Main Dining")]);
    const refresh = { ...options, selectedTripleseatEventId: "100" };
    const result = await syncEntertainmentDay(DATE, refresh);
    expect(lanes(result.reservations, "100")).toEqual(["bowling-3", "bowling-4"]);
    expect(result.conflicts).toEqual([]);
    expect(result.sync).toEqual(before.sync);
    const after = await storage.getDay(DATE);
    expect(after.sync).toEqual(before.sync);
    expect(after.events.find((event) => event.tripleseatEventId === "200")).toEqual(before.events.find((event) => event.tripleseatEventId === "200"));
    expect(after.reservations.filter((row) => row.tripleseatEventId === "200")).toEqual(before.reservations.filter((row) => row.tripleseatEventId === "200"));
    await syncEntertainmentDay(DATE, refresh);
    expect(lanes((await storage.getDay(DATE)).reservations, "100")).toEqual(["bowling-3", "bowling-4"]);
    expect(options.vipPrepClient.fetchRange).not.toHaveBeenCalled();
  });

  it("rejects a new overlap for a named lane without changing either party", async () => {
    const { storage, options, fetchEntertainmentEventsForDate } = fixture([source("100", "Main Dining"), source("200", "VIP 2")]);
    await syncEntertainmentDay(DATE, options);
    const before = await storage.getDay(DATE);
    fetchEntertainmentEventsForDate.mockResolvedValue([source("100", "Main Dining", "Bowling Lane 1 for 2 hours")]);
    await expect(syncEntertainmentDay(DATE, { ...options, selectedTripleseatEventId: "100" })).rejects.toThrow(/overlaps a saved entertainment reservation/);
    expect(await storage.getDay(DATE)).toEqual(before);
  });

  it("leaves changed rows untouched if occupancy changes while Tripleseat is being read", async () => {
    const selected = source("100", "Main Dining");
    const { storage, options, fetchEntertainmentEventsForDate } = fixture([selected]);
    await syncEntertainmentDay(DATE, options);
    const before = await storage.getDay(DATE);
    const row = before.reservations[0];
    fetchEntertainmentEventsForDate.mockImplementation(async () => {
      const changed = { ...row, resourceId: "bowling-7", updatedAt: "2026-11-24T17:00:00.000Z" };
      await storage.saveContractEvidence({ events: [], reservations: [changed] });
      return [source("100", "VIP 1")];
    });
    await expect(syncEntertainmentDay(DATE, { ...options, selectedTripleseatEventId: "100" })).rejects.toThrow(/Saved edits were retained/);
    expect(await storage.getReservation(row.id)).toMatchObject({ resourceId: "bowling-7" });
    expect((await storage.getDay(DATE)).sync).toEqual(before.sync);
  });

  it.each([true, false])("retains a staff override on an active event even after its source line disappears (scoped=%s)", async (scoped) => {
    const selected = source("100", "Main Dining");
    const { storage, options, fetchEntertainmentEventsForDate } = fixture([selected]);
    const initial = await syncEntertainmentDay(DATE, options);
    const row = initial.reservations[0];
    const manual = await updateEntertainmentReservation(row.id, { operatingDate: DATE, eventId: "100", eventName: row.eventName,
      resourceId: "bowling-7", startAt: row.startAt, endAt: row.endAt, eventColor: row.eventColor, needsReview: false }, { storage });
    fetchEntertainmentEventsForDate.mockResolvedValue([{ ...selected, items: [], categoryNames: [] }]);
    const result = await syncEntertainmentDay(DATE, { ...options, ...(scoped ? { selectedTripleseatEventId: "100" } : {}) });
    expect(await storage.getReservation(row.id)).toEqual(manual);
    expect(lanes(result.reservations, "100")).toEqual(["bowling-7"]);
    expect(result.warnings.some((warning) => warning.includes("no longer lists"))).toBe(scoped);
    if (!scoped) {
      fetchEntertainmentEventsForDate.mockResolvedValue([]);
      await syncEntertainmentDay(DATE, options);
      expect((await storage.getReservation(row.id))?.active).toBe(false);
    }
  });

  it("recalculates both automatic lane groups when a full-day refresh swaps their rooms", async () => {
    const { storage, options, fetchEntertainmentEventsForDate } = fixture([source("100", "Main Dining"), source("200", "VIP 2")]);
    await syncEntertainmentDay(DATE, options);
    fetchEntertainmentEventsForDate.mockResolvedValue([source("100", "VIP 1"), source("200", "Main Dining")]);
    const result = await syncEntertainmentDay(DATE, options);
    expect(lanes(result.reservations, "100")).toEqual(["bowling-1", "bowling-2"]);
    expect(lanes(result.reservations, "200")).toEqual(["bowling-11", "bowling-12"]);
    expect(result.conflicts).toEqual([]);
    expect(lanes((await storage.getDay(DATE)).reservations, "100")).toEqual(["bowling-1", "bowling-2"]);
  });
});
