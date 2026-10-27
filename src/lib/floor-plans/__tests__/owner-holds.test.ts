import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { setTripleseatAdapterForTests } from "@/lib/kitchen/tripleseat";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { VipPrepPayload } from "@/lib/vip-prep/types";
import { isDecemberOwnerHoldFloorPlanEvent, projectDecemberOwnerHoldFloorPlanVisibility, withoutDecemberOwnerHoldFloorPlanEvents } from "../owner-holds";
import { approveFloorPlan, generateFloorPlan, getFloorPlanDay, loadLiveFloorPlanPublicationWindow, saveFloorPlanEdits, validateAndSaveFloorPlan } from "../service";
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
      { ...hold, source: { ...hold.source, vipExtraCount: 1 } },
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

  it("hides a protected internal hold while preserving its saved assignment and history", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(); plan.reservations[0].lockedByUser = true;
    const saved = await storage.save(plan, "Staff locked a room assignment.");
    const save = vi.spyOn(storage, "save");
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => bookings() } });
    expect(day.plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(day.plan.reservations.map((row) => row.areaId)).toEqual(["vip-2"]);
    expect(await storage.get(DATE)).toEqual(saved);
    expect(save).not.toHaveBeenCalled();
  });

  it.each<Partial<FloorPlanReservation>>([{ source: "manual" }, { lockedByUser: true }, { placementOverride: true }, { timingSource: "staff-override" }])("hides protected placeholders only in the read projection %j", (protection) => {
    const plan = document(); plan.reservations[0] = { ...plan.reservations[0], ...protection };
    const before = structuredClone(plan);
    expect(withoutDecemberOwnerHoldFloorPlanEvents(plan)).toBe(plan);
    const visible = projectDecemberOwnerHoldFloorPlanVisibility(plan);
    expect(visible.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
    expect(visible.reservations).toEqual([plan.reservations[1]]);
    expect(plan).toEqual(before);
  });

  it.each(["2026-11-30", "2027-01-01", "2027-12-02"])("does not project away staff holds outside December 2026: %s", (date) => {
    const plan = document(date); plan.reservations[0].source = "manual";
    expect(projectDecemberOwnerHoldFloorPlanVisibility(plan)).toBe(plan);
  });

  it("prefers fresh genuine booking evidence over an old protected hold with the same identity", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(); plan.reservations[0].source = "manual";
    const before = await storage.save(plan, "Seed cached internal label.");
    const live = bookings(); live.reservations[0].eventName = "Redacted genuine booking";
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => live } });
    expect(day.plan.events).toHaveLength(2);
    expect(day.plan.events.find((event) => event.tripleseatEventId === "vip-redacted-hold")?.name).toBe("Redacted genuine booking");
    expect(day.plan.reservations).toContainEqual(expect.objectContaining({ areaId: "vip-1", source: "manual" }));
    expect(await storage.get(DATE)).toEqual(before);
  });

  it("recomputes visible conflicts without a cached manual placeholder during an outage", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document();
    plan.reservations[0] = { ...plan.reservations[0], source: "manual", areaId: "vip-2" };
    const before = await storage.save(plan, "Seed overlapping internal room hold.");
    const day = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: false, fetchRange: vi.fn() } });
    expect(day.floorPlanConflicts).toEqual([]);
    expect(day.plan.events).toHaveLength(1);
    expect(await storage.get(DATE)).toEqual(before);
  });

  it("does not delete hidden staff assignments on a visible editor save, validation or approval", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(); plan.reservations[0].source = "manual";
    const before = await storage.save(plan, "Seed protected internal hold.");
    const visible = await getFloorPlanDay(DATE, storage);
    await saveFloorPlanEdits(DATE, visible.plan, storage);
    await validateAndSaveFloorPlan(DATE, storage);
    await approveFloorPlan(DATE, true, storage);
    const after = await storage.get(DATE);
    expect(after?.events.find((event) => event.id === before.events[0].id)).toEqual(expect.objectContaining({ name: "Owner hold VIP" }));
    expect(after?.reservations.find((row) => row.id === before.reservations[0].id)).toEqual(before.reservations[0]);
    expect((await getFloorPlanDay(DATE, storage)).plan.events).toHaveLength(1);
  });

  it.each<Partial<FloorPlanReservation>>([{ source: "manual" }, { lockedByUser: true }])("allocates the corporate VIP despite a protected December placeholder, retaining the original row and revision history %j", async (protection) => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document();
    const corporate = { ...plan.events[1], tripleseatEventId: "93000001", name: "Redacted corporate event", guestCount: 10,
      contractedAreaIds: ["vip-1"], color: "#0033FF", source: { ...plan.events[1].source, rooms: ["VIP 1"] } };
    plan.events[1] = corporate;
    plan.reservations = [{ ...plan.reservations[0], ...protection }];
    const before = await storage.save(plan, "Seed protected December placeholder and contracted corporate VIP.");
    const result = await generateFloorPlan(DATE, "fill-missing", storage, undefined, corporate.id);
    expect(result.plan.events.map((event) => event.name)).toEqual([corporate.name]);
    expect(result.plan.reservations).toContainEqual(expect.objectContaining({ floorPlanEventId: corporate.id, areaId: "vip-1", reservationType: "room" }));
    expect(result.floorPlanConflicts).toEqual([]);
    const after = await storage.get(DATE);
    expect(after?.reservations.find((row) => row.id === before.reservations[0].id)).toEqual(before.reservations[0]);
    expect(after?.events.find((event) => event.id === before.events[0].id)).toEqual(before.events[0]);
    expect((await storage.revisions(before.id))[0].previousValue).toEqual(before);
  });

  it.each(["2026-11-30", "2027-01-01"])("keeps protected non-December holds unavailable to corporate generation: %s", async (date) => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(date);
    const corporate = { ...plan.events[1], tripleseatEventId: "93000001", name: "Redacted corporate event", guestCount: 10,
      contractedAreaIds: ["vip-1"], color: "#0033FF", source: { ...plan.events[1].source, rooms: ["VIP 1"] } };
    plan.events[1] = corporate; plan.reservations = [{ ...plan.reservations[0], source: "manual" }];
    const before = await storage.save(plan, "Preserved non-December occupancy.");
    const result = await generateFloorPlan(date, "fill-missing", storage, undefined, corporate.id);
    expect(result.plan.reservations.some((row) => row.floorPlanEventId === corporate.id && row.areaId === "vip-1")).toBe(false);
    expect((await storage.get(date))?.reservations).toContainEqual(before.reservations[0]);
  });

  it("keeps an exact internal label with a purchased non-golf extra visible, cached, and unavailable to another event", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const live = bookings();
    live.reservations = [live.reservations[0]]; live.reservations[0].extras = [{ code: "purchased-extra", label: "Purchased extra", quantity: 1 }];
    const before = structuredClone(live);
    const payload = await getFloorPlanDay(DATE, storage, { readOnly: true, vipPrepClient: { configured: true, fetchRange: async () => live } });
    expect(payload.plan.events).toHaveLength(1);
    expect(payload.plan.events[0].source).toMatchObject({ vipExtraCount: 1, entertainment: [] });
    expect(isDecemberOwnerHoldFloorPlanEvent(payload.plan.events[0], DATE)).toBe(false);
    expect(live).toEqual(before);
    const purchased = payload.plan.events[0];
    const corporate = { ...purchased, id: "corporate-event", tripleseatEventId: "93000001", name: "Redacted corporate event", guestCount: 10, color: "#0033FF",
      source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } };
    const saved = await storage.save({ ...payload.plan, events: [purchased, corporate] }, "Seed purchased customer occupancy.");
    const result = await generateFloorPlan(DATE, "fill-missing", storage, undefined, corporate.id);
    expect(result.plan.events.map((event) => event.id)).toContain(purchased.id);
    expect(result.plan.reservations.some((row) => row.floorPlanEventId === corporate.id && row.areaId === "vip-1")).toBe(false);
    expect((await storage.get(DATE))?.reservations).toContainEqual(saved.reservations[0]);
  });

  it("sanitizes the publication fallback when the detailed day cannot be read", async () => {
    sources(); const storage = new MemoryFloorPlanStorage(); const plan = document(); plan.reservations[0].source = "manual";
    await storage.save(plan, "Seed saved draft.");
    const get = storage.get.bind(storage); let reads = 0;
    vi.spyOn(storage, "get").mockImplementation(async (date) => { if (date === DATE && ++reads > 1) throw new Error("Detailed read unavailable"); return get(date); });
    const publications = await loadLiveFloorPlanPublicationWindow(DATE, storage, DATE, { configured: false, fetchRange: vi.fn() });
    expect(publications).toHaveLength(1);
    expect(publications[0].payload).toBeNull();
    expect(publications[0].plan.events.map((event) => event.tripleseatEventId)).toEqual(["vip-redacted-customer"]);
  });
});
