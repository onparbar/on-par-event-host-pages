import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { setTripleseatAdapterForTests } from "@/lib/kitchen/tripleseat";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { VipPrepPayload } from "@/lib/vip-prep/types";
import { isDecemberOwnerHoldFloorPlanEvent, withoutDecemberOwnerHoldFloorPlanEvents } from "../owner-holds";
import { getFloorPlanDay, loadLiveFloorPlanPublicationWindow } from "../service";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument, type FloorPlanReservation } from "../types";

const DATE = "2026-12-02";
function document(date = DATE): FloorPlanDocument {
  const id = `floor-plan-${date}`;
  const event = (sourceId: string, name: string, areaId: string) => ({
    id: `floor-plan-event-${sourceId}`, floorPlanId: id, tripleseatEventId: sourceId, name,
    status: "DEFINITE", guestCount: 1, startAt: `${date}T22:00:00Z`, endAt: `${date}T23:00:00Z`,
    contractedAreaIds: [areaId], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: "2026-10-27T15:00:00Z", fullBuyout: false,
    source: { rooms: [areaId === "vip-1" ? "VIP 1" : "VIP 2"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
  });
  const events = [event("vip-redacted-hold", "Owner hold VIP", "vip-1"), event("vip-redacted-customer", "Redacted customer VIP", "vip-2")];
  return { id, eventDate: date, version: 0, status: "Conflict", ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: "2026-10-27T15:00:00Z", createdAt: "2026-10-27T15:00:00Z", updatedAt: "2026-10-27T15:00:00Z", approvedAt: null, approvedBy: null, events,
    reservations: events.map((entry) => ({ id: `${entry.id}:room`, floorPlanEventId: entry.id, areaId: entry.contractedAreaIds[0], reservationType: "room", startAt: entry.startAt,
      endAt: entry.endAt, label: entry.name, source: "generated", lockedByUser: false, timingSource: "event-default" })) };
}
function bookings(date = DATE): VipPrepPayload {
  return { ...vipPrepPayload, from: date, to: date, reservations: document(date).events.map((event) => ({
    ...vipPrepPayload.reservations[0], id: event.tripleseatEventId.slice(4), operatingDate: date, eventName: event.name,
    foodPrep: [], extras: [], startAt: event.startAt!, endAt: event.endAt!, resource: event.contractedAreaIds[0] === "vip-1" ? { code: "VIPS", name: "VIP 1" } : { code: "VIPL", name: "VIP 2" },
  })) };
}
function sources() {
  setEventPlanStorageForTests(createMemoryEventPlanStorage());
  setKitchenStorageForTests(createMemoryKitchenStorage());
  const entertainment = createMemoryEntertainmentStorage(); setEntertainmentStorageForTests(entertainment);
  setTripleseatAdapterForTests({ sourceMode: "live", fetchEventsForDate: async () => [], fetchEntertainmentEventsForDate: async () => [],
    fetchEventDateById: async () => null, getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) });
  return entertainment;
}
afterEach(() => { vi.restoreAllMocks(); setEventPlanStorageForTests(null); setEntertainmentStorageForTests(null); setKitchenStorageForTests(null); setTripleseatAdapterForTests(null); });

describe("December internal VIP hold floor-plan policy", () => {
  it("removes only automatic hold highlights without mutating source history or customer assignments", () => {
    const plan = document(); const before = structuredClone(plan);
    const projected = withoutDecemberOwnerHoldFloorPlanEvents(plan);
    expect(projected.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(projected.reservations).toEqual([plan.reservations[1]]);
    expect(plan).toEqual(before);
    expect(withoutDecemberOwnerHoldFloorPlanEvents(projected)).toBe(projected);
  });

  it.each(["2026-11-30", "2027-01-01", "2027-12-02"])("preserves owner holds outside December 2026: %s", (date) => {
    const plan = document(date); expect(withoutDecemberOwnerHoldFloorPlanEvents(plan)).toBe(plan);
  });

  it.each(["2026-12-01", "2026-12-31"])("covers both December boundaries: %s", (date) => {
    expect(withoutDecemberOwnerHoldFloorPlanEvents(document(date)).events).toHaveLength(1);
  });

  it.each(["Owner hold VIP", "VIP unavailable", "VIP unavailable VIP", "  VIP   Unavailable VIP  "])("recognizes the explicitly confirmed internal label %s", (name) => {
    const plan = document(); plan.events[0].name = name;
    expect(isDecemberOwnerHoldFloorPlanEvent(plan.events[0], DATE)).toBe(true);
  });

  it.each<Partial<FloorPlanReservation>>([{ source: "manual" }, { lockedByUser: true }, { placementOverride: true }, { timingSource: "staff-override" }])("preserves explicit staff work %j", (protection) => {
    const plan = document(); plan.reservations[0] = { ...plan.reservations[0], ...protection };
    expect(withoutDecemberOwnerHoldFloorPlanEvents(plan)).toBe(plan);
  });

  it("does not classify a corporate BEO, linked corporate event, similarly named customer, or purchased food as an internal placeholder", () => {
    const hold = document().events[0];
    const protectedEvents = [
      { ...hold, tripleseatEventId: "93000001" },
      { ...hold, source: { ...hold.source, sourceEventIds: [hold.tripleseatEventId, "93000001"] } },
      { ...hold, source: { ...hold.source, verifiedSourceEventIds: ["93000001"] } },
      { ...hold, source: { ...hold.source, onParBooking: { reservationId: "redacted", confirmationCode: "redacted", sourceUpdatedAt: "2026-10-27T15:00:00Z", refreshedAt: null, linkedTripleseatEventIds: ["93000001"] } } },
      { ...hold, name: "Owner hold VIP celebration" },
      { ...hold, source: { ...hold.source, food: ["1 × Wing Platter"] } },
      { ...hold, source: { ...hold.source, entertainment: [{ name: "Mini Golf", quantity: "10", time: "", duration: "" }] } },
    ];
    expect(protectedEvents.map((event) => isDecemberOwnerHoldFloorPlanEvent(event, DATE))).toEqual(protectedEvents.map(() => false));
  });

  it("changes the projection's approved status rather than claiming the changed highlights remain approved", () => {
    const plan = { ...document(), status: "Approved" as const, approvedAt: "2026-10-27T16:00:00Z", approvedBy: "Staff" };
    expect(withoutDecemberOwnerHoldFloorPlanEvents(plan).status).toBe("Updated After Approval");
    expect(plan.status).toBe("Approved");
  });

  it("filters live internal holds before source resolution and does not save floor plans or entertainment", async () => {
    const entertainment = sources(); const storage = new MemoryFloorPlanStorage();
    const save = vi.spyOn(storage, "save"); const saveEvidence = vi.spyOn(entertainment, "saveContractEvidence");
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => bookings() } });
    expect(day.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(day.plan.reservations.map((row) => row.areaId)).toEqual(["vip-2"]);
    expect(day.entertainmentReservations.map((row) => row.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(save).not.toHaveBeenCalled(); expect(saveEvidence).not.toHaveBeenCalled();
  });

  it("does not resurrect cached internal holds during feed failure, while preserving the saved document and real VIP", async () => {
    const entertainment = sources(); const storage = new MemoryFloorPlanStorage();
    const saved = await storage.save(document(), "Seed historical internal hold and real booking.");
    const save = vi.spyOn(storage, "save"); const saveEvidence = vi.spyOn(entertainment, "saveContractEvidence");
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("Unavailable"); } } });
    expect(day.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(day.plan.reservations.map((row) => row.areaId)).toEqual(["vip-2"]);
    expect(await storage.get(DATE)).toEqual(saved);
    expect(save).not.toHaveBeenCalled(); expect(saveEvidence).not.toHaveBeenCalled();
  });

  it("preserves an explicit saved staff assignment even when the live feed still calls it an internal hold", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(); plan.reservations[0].lockedByUser = true;
    await storage.save(plan, "Staff locked a room assignment.");
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => bookings() } });
    expect(day.plan.events).toHaveLength(2);
    expect(day.plan.reservations).toContainEqual(expect.objectContaining({ areaId: "vip-1", lockedByUser: true }));
  });

  it("sanitizes the publication fallback when the detailed day cannot be read", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); await storage.save(document(), "Seed saved draft.");
    const get = storage.get.bind(storage); let reads = 0;
    vi.spyOn(storage, "get").mockImplementation(async (date) => { if (date === DATE && ++reads > 1) throw new Error("Detailed read unavailable"); return get(date); });
    const publications = await loadLiveFloorPlanPublicationWindow(DATE, storage, DATE, { configured: false, fetchRange: vi.fn() });
    expect(publications).toHaveLength(1);
    expect(publications[0].payload).toBeNull();
    expect(publications[0].plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
  });
});
