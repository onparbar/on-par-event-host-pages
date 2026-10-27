import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { VipPrepClient, vipPrepKitchenEvents, type VipPrepPayload } from "@/lib/vip-prep/client";
import { floorPlanEventsWithSavedIdentity, getFloorPlanDay, loadLiveFloorPlanPublicationWindow, refreshFloorPlanSources } from "../service";
import { MemoryFloorPlanStorage } from "../storage";

const DATE = "2026-11-14";

function payload(): VipPrepPayload {
  const original = vipPrepPayload.reservations[0];
  return {
    ...vipPrepPayload, from: DATE, to: DATE, generatedAt: "2026-10-26T18:00:00.000Z",
    reservations: [{ ...original, id: "redacted-vip", operatingDate: DATE,
      eventName: "Redacted Future VIP", startAt: `${DATE}T22:00:00.000Z`, endAt: "2026-11-15T00:00:00.000Z" }],
  };
}

function configureSources() {
  setEventPlanStorageForTests(createMemoryEventPlanStorage());
  const entertainment = createMemoryEntertainmentStorage();
  setEntertainmentStorageForTests(entertainment);
  const adapter: TripleseatAdapter = {
    sourceMode: "live", fetchEventsForDate: async () => [],
    fetchEntertainmentEventsForDate: async () => { throw new Error("Unrelated Tripleseat outage"); },
    fetchEventDateById: async () => null,
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
  };
  setTripleseatAdapterForTests(adapter);
  return entertainment;
}

afterEach(() => {
  vi.restoreAllMocks();
  setEventPlanStorageForTests(null);
  setEntertainmentStorageForTests(null);
  setTripleseatAdapterForTests(null);
  setKitchenStorageForTests(null);
});

describe("pre-arrival On Par Bookings floor-plan visibility", () => {
  it("loads the entire planning month with one batched VIP read and no saved-data writes", async () => {
    configureSources();
    const storage = new MemoryFloorPlanStorage();
    const save = vi.spyOn(storage, "save");
    const dates = ["2026-12-01", "2026-12-16", "2026-12-31"];
    const booked = payload();
    booked.reservations = dates.map((date, index) => ({ ...booked.reservations[0], id: `redacted-december-${index}`, operatingDate: date, startAt: `${date}T22:00:00Z`, endAt: `${date}T23:00:00Z` }));
    const fetchRange = vi.fn(async (from: string, to: string) => ({ ...booked, from, to, reservations: booked.reservations.filter((entry) => entry.operatingDate >= from && entry.operatingDate <= to) }));
    const result = await loadLiveFloorPlanPublicationWindow("2026-10-27", storage, "2026-12-16", { configured: true, fetchRange }, "2026-12");
    expect(result.map((entry) => entry.plan.eventDate)).toEqual(dates);
    expect(fetchRange.mock.calls).toEqual([["2026-10-27", "2026-11-10"], ["2026-12-01", "2026-12-31"]]);
    expect(save).not.toHaveBeenCalled();
  });

  it("projects only the exact booked room and interval before arrival without saving", async () => {
    const entertainment = configureSources();
    const storage = new MemoryFloorPlanStorage();
    const save = vi.spyOn(storage, "save");
    const evidenceSave = vi.spyOn(entertainment, "saveContractEvidence");
    const booked = payload();
    const day = await getFloorPlanDay(DATE, storage, {
      vipPrepClient: { configured: true, fetchRange: async () => booked }, readOnly: true,
    });

    expect(day.plan.events).toHaveLength(1);
    expect(day.plan.events[0]).toMatchObject({ tripleseatEventId: "vip-redacted-vip", guestCount: 16,
      contractedAreaIds: ["vip-2"], source: { onParBooking: { reservationId: "redacted-vip", refreshedAt: booked.generatedAt } } });
    expect(day.plan.reservations).toEqual([expect.objectContaining({ areaId: "vip-2", reservationType: "room",
      startAt: booked.reservations[0].startAt, endAt: booked.reservations[0].endAt })]);
    expect(day.entertainmentReservations).toEqual([expect.objectContaining({ tripleseatEventId: "vip-redacted-vip",
      resourceId: "private-room-vip-2", startAt: booked.reservations[0].startAt, endAt: booked.reservations[0].endAt })]);
    expect(save).not.toHaveBeenCalled();
    expect(evidenceSave).not.toHaveBeenCalled();
    expect(await storage.get(DATE)).toBeNull();
  });

  it("publishes an exact VIP-only requested date beyond the overview using two source reads", async () => {
    configureSources();
    const plans = createMemoryEventPlanStorage();
    setEventPlanStorageForTests(plans);
    const sourceRead = vi.spyOn(plans, "plansForWindow");
    const storage = new MemoryFloorPlanStorage();
    const fetchRange = vi.fn(async (from: string, to: string) => ({ ...payload(), from, to,
      reservations: DATE >= from && DATE <= to ? payload().reservations : [],
      reservationCount: DATE >= from && DATE <= to ? 1 : 0,
    }));
    const publications = await loadLiveFloorPlanPublicationWindow("2026-10-26", storage, DATE, { configured: true, fetchRange });

    expect(publications.map((entry) => entry.plan.eventDate)).toEqual([DATE]);
    expect(publications[0].plan.reservations).toHaveLength(1);
    expect(fetchRange.mock.calls).toEqual([["2026-10-26", "2026-11-09"], [DATE, DATE]]);
    expect(await storage.get(DATE)).toBeNull();
    expect(sourceRead).toHaveBeenCalledTimes(1);
  });

  it("keeps colliding legacy hashes as distinct canonical floor events and refuses ambiguous saved identity reuse", async () => {
    configureSources();
    const booked = payload();
    booked.reservations = [
      { ...booked.reservations[0], id: "test-h4l720-hfbtsa" },
      { ...booked.reservations[0], id: "test-1k212gj-1rfricb", resource: { code: "VIPS", name: "VIP 1" } },
    ];
    const day = await getFloorPlanDay(DATE, new MemoryFloorPlanStorage(), { vipPrepClient: { configured: true, fetchRange: async () => booked }, readOnly: true });
    expect(new Set(day.plan.events.map((event) => event.id)).size).toBe(2);
    expect(day.plan.events.map((event) => event.id).sort()).toEqual([
      "floor-plan-event-vip-test-1k212gj-1rfricb", "floor-plan-event-vip-test-h4l720-hfbtsa",
    ]);
    expect(day.plan.reservations).toHaveLength(2);
    const corruptSaved = day.plan.events.map((event) => ({ ...event, id: "floor-plan-event-527983760" }));
    expect(floorPlanEventsWithSavedIdentity(day.plan.events, corruptSaved).map((event) => event.id)).toEqual(day.plan.events.map((event) => event.id));
    const current = day.plan.events[0];
    const legacy = { ...current, id: "saved-unrelated", tripleseatEventId: "vip-other", source: { ...current.source,
      sourceEventIds: [current.tripleseatEventId], verifiedSourceEventIds: [] } };
    expect(floorPlanEventsWithSavedIdentity([current], [legacy])[0].id).toBe(current.id);
    expect(floorPlanEventsWithSavedIdentity([current], [{ ...legacy, source: { ...legacy.source, verifiedSourceEventIds: [current.tripleseatEventId] } }])[0].id).toBe("saved-unrelated");
  });

  it("does not revive a missed cancellation during an outage when durable Kitchen membership marks it inactive", async () => {
    configureSources();
    const storage = new MemoryFloorPlanStorage();
    const booked = payload();
    booked.reservations.push({ ...booked.reservations[0], id: "unrelated-vip", resource: { code: "VIPS", name: "VIP 1" } });
    const initial = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true, fetchRange: async () => booked }, readOnly: true });
    await storage.save(initial.plan, "Seed earlier active booking holds.");
    const kitchen = createMemoryKitchenStorage();
    setKitchenStorageForTests(kitchen);
    const original = vipPrepKitchenEvents([booked.reservations[0]])[0];
    const source = { ...original, vipBooking: { ...original.vipBooking!, activeInSource: false, lastRefreshedAt: "2026-10-26T19:00:00Z" } };
    await kitchen.saveEvent({ sourceEvent: source, checklist: generateKitchenChecklist(source) });
    const cached = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("Unavailable"); } }, readOnly: true });
    expect(cached.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-unrelated-vip"]);
    expect(cached.plan.reservations.map((row) => row.areaId)).toEqual(["vip-1"]);
    expect(cached.warnings.join(" ")).toContain("Known inactive VIP bookings are not projected");
    expect((await storage.get(DATE))?.events).toHaveLength(2);
    expect((await storage.get(DATE))?.reservations).toHaveLength(2);
    const saved = (await storage.get(DATE))!;
    await storage.save({ ...saved, events: saved.events.map((event) => event.tripleseatEventId === "vip-redacted-vip"
      ? { ...event, source: { ...event.source, onParBooking: { ...event.source.onParBooking!, refreshedAt: "2026-10-26T20:00:00Z" } } }
      : event) }, "Seed a later verified active booking observation.");
    const reactivated = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("Unavailable"); } }, readOnly: true });
    expect(reactivated.plan.events).toHaveLength(2);
    expect(reactivated.warnings.join(" ")).not.toContain("Known inactive VIP bookings are not projected");
  });

  it("retains the saved VIP hold on a source failure and clears it only after authoritative cancellation", async () => {
    configureSources();
    const storage = new MemoryFloorPlanStorage();
    const live = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true, fetchRange: async () => payload() }, readOnly: true });
    await storage.save(live.plan, "Seed a redacted saved booking hold.");
    const failed = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true,
      fetchRange: async () => { throw new Error("Unavailable"); } }, readOnly: true });
    expect(failed.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-vip"]);
    expect(failed.plan.reservations).toHaveLength(1);
    expect(failed.warnings.join(" ")).toContain("last saved VIP");

    const cancelled = payload();
    cancelled.reservations[0].status = "cancelled";
    const refreshed = await getFloorPlanDay(DATE, storage, { vipPrepClient: { configured: true, fetchRange: async () => cancelled }, readOnly: true });
    expect(refreshed.plan.events).toEqual([]);
    expect(refreshed.plan.reservations).toEqual([]);
    // Reading a cancellation changes the projection, not saved history.
    expect((await storage.get(DATE))?.events).toHaveLength(1);
  });

  it("refreshes a changed VIP room and interval despite an unrelated Tripleseat sync failure", async () => {
    configureSources();
    const storage = new MemoryFloorPlanStorage();
    const booked = payload();
    vi.spyOn(VipPrepClient.prototype, "configured", "get").mockReturnValue(true);
    vi.spyOn(VipPrepClient.prototype, "fetchRange").mockImplementation(async () => structuredClone(booked));
    const initial = await refreshFloorPlanSources(DATE, storage);
    expect(initial.plan.reservations.map((row) => row.areaId)).toEqual(["vip-2"]);

    booked.reservations[0] = { ...booked.reservations[0], resource: { code: "VIPS", name: "VIP 1" },
      startAt: `${DATE}T23:00:00.000Z`, endAt: "2026-11-15T01:00:00.000Z", updatedAt: "2026-10-26T19:00:00.000Z" };
    const updated = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    expect(updated.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-vip"]);
    expect(updated.plan.reservations).toEqual([expect.objectContaining({ areaId: "vip-1",
      startAt: booked.reservations[0].startAt, endAt: booked.reservations[0].endAt })]);
    expect(updated.warnings.join(" ")).toContain("Tripleseat could not be refreshed");
    expect((await storage.get(DATE))?.reservations).toEqual(updated.plan.reservations);
    expect(updated.plan.lastTripleseatSyncAt).toBeNull();
  });
});
