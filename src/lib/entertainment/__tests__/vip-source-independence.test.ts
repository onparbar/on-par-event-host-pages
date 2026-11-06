import { afterEach, describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipPrepEntertainmentEvents, vipPrepKitchenEvents, type VipPrepPayload } from "@/lib/vip-prep/client";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { buildEntertainmentSchedule } from "../domain";
import { MemoryEntertainmentStorage } from "../storage";
import { EntertainmentConflictError, getEntertainmentDay, syncEntertainmentDay, updateEntertainmentReservation } from "../sync";
import type { EntertainmentSourceEvent } from "../types";

const DATE = "2026-11-14";
function vip(): VipPrepPayload {
  return { ...vipPrepPayload, from: DATE, to: DATE,
    reservations: [{ ...vipPrepPayload.reservations[0], id: "redacted-vip", operatingDate: DATE,
      eventName: "Redacted Shared Name", startAt: `${DATE}T22:00:00.000Z`, endAt: "2026-11-15T00:00:00.000Z" }],
  };
}
function source(): EntertainmentSourceEvent {
  return { tripleseatEventId: "redacted-corporate", tripleseatBookingId: "redacted-booking", eventName: "Redacted Shared Name",
    localDate: DATE, eventStartAt: `${DATE}T22:00:00.000Z`, eventEndAt: "2026-11-15T00:00:00.000Z",
    status: "DEFINITE", rooms: [], items: [{ sourceId: "redacted-bowling", name: "Bowling Lane 1", description: null, categoryName: "Bowling",
      quantity: 1, startAt: `${DATE}T22:00:00.000Z`, endAt: `${DATE}T23:00:00.000Z` }],
    categoryNames: ["Bowling"], sourceUpdatedAt: "2026-10-26T18:00:00Z", noteCount: 0 };
}
function adapter(events: EntertainmentSourceEvent[] | Error): TripleseatAdapter {
  return { sourceMode: "live", fetchEventsForDate: async () => [], fetchEventDateById: async () => null,
    fetchEntertainmentEventsForDate: async () => { if (events instanceof Error) throw events; return events; },
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }) };
}

afterEach(() => { vi.restoreAllMocks(); setKitchenStorageForTests(null); });

describe("independent On Par Bookings entertainment synchronization", () => {
  it("shows the exact VIP hold without inheriting same-name corporate activities", () => {
    const schedule = buildEntertainmentSchedule({ sourceEvents: vipPrepEntertainmentEvents(vip().reservations),
      localEvents: [{ id: "redacted-corporate", bookingId: "VIPL-1234567", name: "Redacted Shared Name", date: DATE,
        color: "#297025", rooms: ["VIP 1"], entertainment: [{ name: "Bowling Lane 1", quantity: "1", time: "5 PM - 7 PM", duration: "2 hours" }] }] });
    expect(schedule.reservations).toHaveLength(1);
    expect(schedule.reservations[0]).toMatchObject({ tripleseatEventId: "vip-redacted-vip", resourceId: "private-room-vip-2",
      startAt: vip().reservations[0].startAt, endAt: vip().reservations[0].endAt });
  });

  it("updates VIP holds through a Tripleseat failure, retains unrelated holds, and is idempotent", async () => {
    const storage = new MemoryEntertainmentStorage();
    const emptyVip = { configured: true, fetchRange: async () => ({ ...vip(), reservations: [], reservationCount: 0 }) };
    const initial = await syncEntertainmentDay(DATE, { storage, adapter: adapter([source()]), localEvents: [], vipPrepClient: emptyVip });
    const corporateId = initial.reservations[0].id;
    const booked = vip();
    const options = { storage, adapter: adapter(new Error("Upstream failure")), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => booked } };
    const first = await syncEntertainmentDay(DATE, options);
    expect(first.reservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: corporateId, tripleseatEventId: "redacted-corporate", active: true }),
      expect.objectContaining({ tripleseatEventId: "vip-redacted-vip", resourceId: "private-room-vip-2", active: true }),
    ]));
    expect(first.sync?.status).toBe("error");
    expect(first.sync?.lastSuccessfulSyncAt).toBe(initial.sync?.lastSuccessfulSyncAt);
    expect(first.warnings.join(" ")).toContain("On Par Bookings refreshed independently");
    const second = await syncEntertainmentDay(DATE, options);
    expect(second.reservations.map((row) => row.id).sort()).toEqual(first.reservations.map((row) => row.id).sort());
    expect((await storage.getDay(DATE)).reservations.filter((row) => row.active)).toHaveLength(2);

    booked.reservations[0].status = "cancelled";
    const cancelled = await syncEntertainmentDay(DATE, options);
    expect(cancelled.reservations.filter((row) => row.source === "vip-prep")).toEqual([]);
    expect(cancelled.reservations.map((row) => row.id)).toEqual([corporateId]);
    expect((await storage.getDay(DATE)).reservations.find((row) => row.source === "vip-prep")?.active).toBe(false);
  });

  it("retains saved VIP source snapshots and holds if only On Par Bookings fails", async () => {
    const storage = new MemoryEntertainmentStorage();
    await syncEntertainmentDay(DATE, { storage, adapter: adapter([source()]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => vip() } });
    const brokenVip = { configured: true, fetchRange: async (): Promise<VipPrepPayload> => { throw new Error("Unavailable"); } };
    const result = await syncEntertainmentDay(DATE, { storage, adapter: adapter([source()]), localEvents: [], vipPrepClient: brokenVip });
    expect(result.events.map((event) => event.tripleseatEventId).sort()).toEqual(["redacted-corporate", "vip-redacted-vip"]);
    expect(result.reservations).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("last saved VIP schedule");
  });

  it("uses durable inactive membership during an outage without changing saved schedule or unrelated holds", async () => {
    const storage = new MemoryEntertainmentStorage();
    await syncEntertainmentDay(DATE, { storage, adapter: adapter([source()]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => vip() } });
    const kitchen = createMemoryKitchenStorage();
    setKitchenStorageForTests(kitchen);
    const original = vipPrepKitchenEvents(vip().reservations)[0];
    const inactive = { ...original, vipBooking: { ...original.vipBooking!, activeInSource: false, lastRefreshedAt: "2026-10-26T19:00:00Z" } };
    await kitchen.saveEvent({ sourceEvent: inactive, checklist: generateKitchenChecklist(inactive) });
    const failedVip = { configured: true, fetchRange: async (): Promise<VipPrepPayload> => { throw new Error("Unavailable"); } };
    const day = await getEntertainmentDay(DATE, { storage, adapter: adapter([]), localEvents: [], vipPrepClient: failedVip, readOnly: true });
    expect(day.events.map((event) => event.tripleseatEventId)).toEqual(["redacted-corporate"]);
    expect(day.reservations.map((row) => row.tripleseatEventId)).toEqual(["redacted-corporate"]);
    expect(day.warnings.join(" ")).toContain("Known inactive VIP bookings are not projected");
    expect((await storage.getDay(DATE)).events).toHaveLength(2);
    expect((await storage.getDay(DATE)).reservations.filter((row) => row.active)).toHaveLength(2);

    const activeSnapshot = (await storage.getDay(DATE)).events.find((event) => event.tripleseatEventId === "vip-redacted-vip")!;
    await storage.saveEventSnapshot({ ...activeSnapshot, sourceSnapshot: { ...activeSnapshot.sourceSnapshot, sourceObservedAt: "2026-10-26T20:00:00Z" } });
    const reactivated = await getEntertainmentDay(DATE, { storage, adapter: adapter([]), localEvents: [], vipPrepClient: failedVip, readOnly: true });
    expect(reactivated.events).toHaveLength(2);
    expect(reactivated.warnings.join(" ")).not.toContain("Known inactive VIP bookings are not projected");

    vi.spyOn(kitchen, "getDay").mockRejectedValue(new Error("Cache unavailable"));
    const unverified = await getEntertainmentDay(DATE, { storage, adapter: adapter([]), localEvents: [], vipPrepClient: failedVip, readOnly: true });
    expect(unverified.events).toHaveLength(2);
    expect(unverified.warnings.join(" ")).toContain("Saved VIP fallback is unverified");
  });

  it("does not mistake a disabled booking integration for an authoritative empty source", async () => {
    const storage = new MemoryEntertainmentStorage();
    await syncEntertainmentDay(DATE, { storage, adapter: adapter([]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => vip() } });
    const result = await syncEntertainmentDay(DATE, { storage, adapter: adapter([]), localEvents: [],
      vipPrepClient: { configured: false, fetchRange: async () => { throw new Error("Must not be called"); } } });
    expect(result.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-vip"]);
    expect(result.reservations).toHaveLength(1);
    expect((await storage.getDay(DATE)).reservations[0].active).toBe(true);
  });

  it("represents a verified linked physical room once while preserving its purchased activities and source records", async () => {
    const storage = new MemoryEntertainmentStorage();
    const booked = vip();
    booked.reservations[0].linkedTripleseatEventIds = ["redacted-corporate"];
    const linked = { ...source(), rooms: [{ id: "VIPL", name: "VIP 2" }] };
    const day = await syncEntertainmentDay(DATE, { storage, adapter: adapter([linked]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => booked } });
    expect(day.reservations.filter((row) => row.resourceCategory === "private-rooms")).toEqual([
      expect.objectContaining({ tripleseatEventId: "vip-redacted-vip", resourceId: "private-room-vip-2" }),
    ]);
    expect(day.reservations.filter((row) => row.resourceCategory === "bowling")).toHaveLength(1);
    expect(day.conflicts).toEqual([]);
    expect((await storage.getDay(DATE)).reservations).toHaveLength(3);
    expect((await storage.getDay(DATE)).events).toHaveLength(2);

    const vipRoom = day.reservations.find((row) => row.source === "vip-prep")!;
    const edit = { operatingDate: DATE, eventId: vipRoom.tripleseatEventId, eventName: vipRoom.eventName,
      resourceId: vipRoom.resourceId, startAt: vipRoom.startAt, endAt: vipRoom.endAt, eventColor: vipRoom.eventColor,
      notes: "Redacted staff note", reason: "Retain the same physical booking" };
    await expect(updateEntertainmentReservation(vipRoom.id, edit, { storage })).resolves.toMatchObject({ notes: "Redacted staff note" });
    await expect(updateEntertainmentReservation(vipRoom.id, { ...edit, endAt: "2026-11-15T01:00:00.000Z" }, { storage })).rejects.toBeInstanceOf(EntertainmentConflictError);
  });

  it.each([false, true])("keeps distinct physical holds and conflicts when no exact verified equivalence exists (different interval: %s)", async (differentInterval) => {
    const storage = new MemoryEntertainmentStorage();
    const booked = vip();
    if (differentInterval) booked.reservations[0].linkedTripleseatEventIds = ["redacted-corporate"];
    const corporate = { ...source(), rooms: [{ id: "VIPL", name: "VIP 2" }],
      ...(differentInterval ? { eventEndAt: "2026-11-15T01:00:00.000Z" } : {}) };
    const day = await syncEntertainmentDay(DATE, { storage, adapter: adapter([corporate]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => booked } });
    expect(day.reservations.filter((row) => row.resourceCategory === "private-rooms")).toHaveLength(2);
    expect(day.reservations.filter((row) => row.resourceCategory === "bowling")).toHaveLength(1);
    expect(day.conflicts).toHaveLength(1);
  });

  it("read-only projections cannot persist confirmed evidence or booking holds", async () => {
    const storage = new MemoryEntertainmentStorage();
    const save = vi.spyOn(storage, "saveContractEvidence");
    const start = vi.spyOn(storage, "startSync");
    await getEntertainmentDay("2026-08-21", { storage, adapter: adapter([]), localEvents: [], readOnly: true,
      vipPrepClient: { configured: false, fetchRange: async () => vip() } });
    expect(save).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
});
