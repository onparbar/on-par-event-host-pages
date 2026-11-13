import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFloorPlanDraftWindow } from "../draft-planning";
import { getFloorPlanDay } from "../service";
import { MemoryFloorPlanStorage } from "../storage";
import { summarizeEventSeating } from "../seating-summary";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDayPayload, type FloorPlanDocument, type FloorPlanReservation } from "../types";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { setTripleseatAdapterForTests } from "@/lib/kitchen/tripleseat";

const DATE = "2026-12-05";
function document(date = DATE): FloorPlanDocument {
  const id = `floor-plan-${date}`;
  return { id, eventDate: date, version: 0, status: "Draft", ruleVersion: FLOOR_PLAN_RULE_VERSION, lastTripleseatSyncAt: "2026-10-27T15:00:00Z",
    createdAt: "2026-10-27T15:00:00Z", updatedAt: "2026-10-27T15:00:00Z", approvedAt: null, approvedBy: null, reservations: [],
    events: [{ id: "redacted-event", floorPlanId: id, tripleseatEventId: "redacted-source", name: "Redacted December event", status: "DEFINITE", guestCount: 10,
      startAt: `${date}T22:30:00Z`, endAt: `${date}T23:30:00Z`, contractedAreaIds: ["main-dining"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: "2026-10-27T14:00:00Z", fullBuyout: false,
      source: { rooms: ["Main Dining"], food: ["1 × Wing Platter"], entertainment: [], operationalNotes: [], reviewReasons: [] } }] };
}
function payload(date = DATE): FloorPlanDayPayload {
  return { date, plan: document(date), entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [], validation: [], revisions: [], persistence: "memory", sourceMode: "live", warnings: [] };
}
const noVip = { configured: false, fetchRange: vi.fn() };
function reader(value = payload()) { return vi.fn<typeof getFloorPlanDay>().mockResolvedValue(value); }

afterEach(() => { setEventPlanStorageForTests(null); setEntertainmentStorageForTests(null); setTripleseatAdapterForTests(null); });

describe("missing-only planning drafts", () => {
  it("uses the real read-only source path without synchronizing or changing entertainment bookings", async () => {
    const plans = createMemoryEventPlanStorage();
    const entertainment = createMemoryEntertainmentStorage();
    setEventPlanStorageForTests(plans); setEntertainmentStorageForTests(entertainment);
    const saveEvidence = vi.spyOn(entertainment, "saveContractEvidence");
    const fetch = vi.fn(async () => []);
    setTripleseatAdapterForTests({ sourceMode: "live", fetchEventsForDate: fetch, fetchEventPlansForRange: fetch, fetchEntertainmentEventsForDate: fetch,
      fetchEventDateById: async () => null, getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) });
    const source = { eventId: "93000001", bookingId: "redacted-booking", eventName: "Redacted December party", localDate: DATE,
      eventStartAt: `${DATE}T22:30:00Z`, eventEndAt: `${DATE}T23:30:00Z`, guestCount: 10, status: "DEFINITE", rooms: ["Main Dining"], selections: [], documentItems: [], operationalNotes: [], sourceUpdatedAt: "2026-10-27T14:00:00Z" };
    await plans.replaceWindow({ startDate: DATE, endDate: DATE }, [{ eventId: source.eventId, eventDate: DATE, plan: {}, sourceSnapshot: source, sourceUpdatedAt: source.sourceUpdatedAt }]);
    const before = await entertainment.getDay(DATE);
    const storage = new MemoryFloorPlanStorage();
    expect((await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip })).results[0].status).toBe("created");
    expect(await entertainment.getDay(DATE)).toEqual(before);
    expect(saveEvidence).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a reviewable draft with source provenance, suggestions and no fabricated approval", async () => {
    const storage = new MemoryFloorPlanStorage();
    const source = payload();
    const before = structuredClone(source);
    const loadDay = reader(source);
    const result = await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip, loadDay });
    expect(result.results[0]).toMatchObject({ date: DATE, status: "created", eventCount: 1 });
    const saved = (await storage.get(DATE))!;
    expect(saved.version).toBe(1);
    expect(["Draft", "Needs Review", "Conflict"]).toContain(saved.status);
    expect(saved.approvedAt).toBeNull(); expect(saved.approvedBy).toBeNull();
    expect(saved.events[0].beoLastModifiedAt).toBe(source.plan.events[0].beoLastModifiedAt);
    expect(saved.events[0].source.food).toEqual(source.plan.events[0].source.food);
    expect(saved.reservations.length).toBeGreaterThan(0);
    expect(loadDay.mock.calls[0][2]).toMatchObject({ readOnly: true });
    expect(source).toEqual(before);
    expect(await storage.revisions(saved.id)).toHaveLength(1);
  });

  it.each(["Draft", "Approved", "Updated After Approval", "Archived"] as const)("preserves every existing %s plan and its manual work without a source refresh", async (status) => {
    const storage = new MemoryFloorPlanStorage();
    const existing = await storage.save({ ...document(), status, reservations: [{ id: "staff", floorPlanEventId: "redacted-event", areaId: "main-table-1", reservationType: "seating", startAt: "2026-12-05T22:30:00Z", endAt: "2026-12-05T23:30:00Z", label: "Staff choice", source: "manual", lockedByUser: true }] }, "Staff saved plan.");
    const loadDay = reader();
    const result = await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip, loadDay });
    expect(result.results[0].status).toBe("skipped");
    expect(loadDay).not.toHaveBeenCalled();
    expect(await storage.get(DATE)).toEqual(existing);
    expect(await storage.revisions(existing.id)).toHaveLength(1);
  });

  it("is idempotent and never overwrites a staff plan created during preparation", async () => {
    const storage = new MemoryFloorPlanStorage();
    const loadDay = reader();
    loadDay.mockImplementationOnce(async () => { await storage.save({ ...document(), status: "Approved", approvedBy: "Staff", approvedAt: "2026-10-27T16:00:00Z" }, "Concurrent staff save."); return payload(); });
    const first = await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip, loadDay });
    expect(first.results[0]).toMatchObject({ status: "skipped", message: "A concurrent saved plan was preserved." });
    const saved = await storage.get(DATE);
    const again = await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip, loadDay });
    expect(again.results[0].status).toBe("skipped");
    expect(await storage.get(DATE)).toEqual(saved);
    expect(await storage.revisions(document().id)).toHaveLength(1);
  });

  it("reads a complete December VIP window once and skips dates without events", async () => {
    const storage = new MemoryFloorPlanStorage();
    const fetchRange = vi.fn(async (from: string, to: string) => ({ ...vipPrepPayload, from, to, reservations: [], reservationCount: 0 }));
    const loadDay = reader();
    loadDay.mockImplementation(async (date, _storage, options) => {
      await options!.vipPrepClient!.fetchRange(date, date);
      return { ...payload(date), plan: { ...document(date), events: [] } };
    });
    const result = await prepareFloorPlanDraftWindow("2026-12-01", "2026-12-31", storage, { vipPrepClient: { configured: true, fetchRange }, loadDay });
    expect(fetchRange).toHaveBeenCalledExactlyOnceWith("2026-12-01", "2026-12-31");
    expect(loadDay).toHaveBeenCalledTimes(31);
    expect(result.results).toHaveLength(31);
    expect(result.results.every((entry) => entry.status === "skipped")).toBe(true);
    expect(result.results[0].date).toBe("2026-12-01"); expect(result.results.at(-1)?.date).toBe("2026-12-31");
  });

  it("fails safely on unavailable sources or storage without creating a false saved draft", async () => {
    const storage = new MemoryFloorPlanStorage();
    const loadDay = reader(); loadDay.mockRejectedValue(new Error("Source unavailable"));
    const result = await prepareFloorPlanDraftWindow(DATE, DATE, storage, { vipPrepClient: noVip, loadDay });
    expect(result.results[0]).toMatchObject({ status: "error", message: "Source unavailable" });
    expect(await storage.get(DATE)).toBeNull();
    await expect(prepareFloorPlanDraftWindow("2026-12-01", "2027-01-01", storage, { vipPrepClient: noVip, loadDay })).rejects.toThrow("at most 31");
    await expect(prepareFloorPlanDraftWindow("2026-12-32", "2026-12-31", storage, { vipPrepClient: noVip, loadDay })).rejects.toThrow("at most 31");
  });
});

describe("opt-in add-only seating for existing planning drafts", () => {
  const date = "2026-12-08";
  const sourceId = "93000090";
  const blank = document(date);
  const corporate = { ...blank.events[0], id: "redacted-new-event", tripleseatEventId: sourceId, guestCount: 90, color: "#BE123C" };
  const staffEvent = { ...blank.events[0], color: "#15803D" };
  const manual: FloorPlanReservation = { id: "staff-table", floorPlanEventId: staffEvent.id, areaId: "main-rect-left-1", reservationType: "seating", startAt: staffEvent.startAt, endAt: staffEvent.endAt, label: "Staff choice", source: "manual", lockedByUser: true };
  const mixed = { ...blank, ruleVersion: "prior-rules", events: [staffEvent], reservations: [manual] };
  const opts = (plan: FloorPlanDocument) => ({ vipPrepClient: noVip, fillMissingSeating: true,
    refreshedTripleseatEventDates: new Map([[sourceId, date]]), loadDay: reader({ ...payload(date), plan }) });

  it("adds complete red-party seating beside the existing green party without changing any saved rows or events", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save(mixed, "Staff draft.");
    const dependencies = opts({ ...before, events: [...before.events, corporate] });
    const result = await prepareFloorPlanDraftWindow(date, date, storage, dependencies);
    expect(result.results[0]).toMatchObject({ status: "updated", eventCount: 2 });
    expect(dependencies.loadDay.mock.calls[0][2]).toMatchObject({ readOnly: true });
    const after = (await storage.get(date))!;
    expect(after.events[0]).toEqual(before.events[0]);
    expect(after.reservations[0]).toEqual(manual);
    expect(after.ruleVersion).toBe(before.ruleVersion);
    expect(after.lastTripleseatSyncAt).toBe(before.lastTripleseatSyncAt);
    const added = after.reservations.slice(1);
    expect(added.every((row) => row.floorPlanEventId === corporate.id && row.source === "generated" && row.areaId !== manual.areaId)).toBe(true);
    expect(summarizeEventSeating(corporate, after.reservations, { allReservations: after.reservations })).toMatchObject({ fullEventCoverage: true, foodAssigned: 1, foodRequired: 1 });
    expect((await prepareFloorPlanDraftWindow(date, date, storage, opts(after))).results[0].status).toBe("skipped");
    expect(await storage.get(date)).toEqual(after);
  });

  it("fills a verified, unchanged saved event with no current or historic seating without replacing the event", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save({ ...mixed, events: [...mixed.events, corporate] }, "Staff draft.");
    const result = await prepareFloorPlanDraftWindow(date, date, storage, opts(before));
    expect(result.results[0]).toMatchObject({ status: "updated", eventCount: 2 });
    const after = (await storage.get(date))!;
    expect(after.events).toEqual(before.events);
    expect(summarizeEventSeating(corporate, after.reservations)).toMatchObject({ fullEventCoverage: true, foodAssigned: 1 });
  });

  it("does not restore intentionally cleared seating or move a previously saved party after a source change", async () => {
    const storage = new MemoryFloorPlanStorage();
    const existing = await storage.save({ ...mixed, events: [...mixed.events, corporate], reservations: [manual, { ...manual, id: "removed", floorPlanEventId: corporate.id }] }, "Existing placements.");
    const cleared = await storage.save({ ...existing, reservations: [manual] }, "Staff cleared seating.");
    expect((await prepareFloorPlanDraftWindow(date, date, storage, opts(cleared))).results[0].status).toBe("skipped");
    const changed = { ...cleared, events: [staffEvent, { ...corporate, guestCount: 91 }] };
    expect((await prepareFloorPlanDraftWindow(date, date, storage, opts(changed))).results[0]).toMatchObject({ status: "needs-review", needsSeatingReview: true });
    expect(await storage.get(date)).toEqual(cleared);
  });

  it("uses a projected VIP room hold as a placement constraint without saving that projection or partial seating", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save(mixed, "Staff draft.");
    const red = { ...corporate, contractedAreaIds: ["vip-2"], source: { ...corporate.source, rooms: ["VIP 2"] }, guestCount: 30 };
    const vip = { ...red, id: "projected-vip", tripleseatEventId: "vip-source", guestCount: 20 };
    const held: FloorPlanReservation = { ...manual, id: "vip-room", floorPlanEventId: vip.id, areaId: "vip-2", reservationType: "room", source: "generated", lockedByUser: false };
    const result = await prepareFloorPlanDraftWindow(date, date, storage, opts({ ...before, events: [...before.events, red, vip], reservations: [...before.reservations, held] }));
    expect(result.results[0]).toMatchObject({ status: "needs-review", needsSeatingReview: true });
    expect(await storage.get(date)).toEqual(before);
  });

  it.each(["VIP Unavailable", "Event Block", "Owner Hold"])("ignores a saved %s while preserving its stored row", async (name) => {
    const storage = new MemoryFloorPlanStorage();
    const red = { ...corporate, contractedAreaIds: ["vip-2"], source: { ...corporate.source, rooms: ["VIP 2"] }, guestCount: 20 };
    const hold = { ...red, id: "saved-hold", tripleseatEventId: "vip-placeholder", name, source: { ...red.source, food: [] } };
    const held: FloorPlanReservation = { ...manual, id: "vip-room", floorPlanEventId: hold.id, areaId: "vip-2", reservationType: "room" };
    const before = await storage.save({ ...mixed, events: [...mixed.events, hold], reservations: [...mixed.reservations, held] }, "Staff draft.");
    // The live read projection hides the placeholder, but the durable plan retains it.
    const result = await prepareFloorPlanDraftWindow(date, date, storage, opts({ ...before, events: [staffEvent, red], reservations: [manual] }));
    expect(result.results[0]).toMatchObject({ status: "updated" });
    const after = (await storage.get(date))!;
    expect(after.events).toContainEqual(hold);
    expect(after.reservations).toContainEqual(held);
    expect(after.reservations).toContainEqual(expect.objectContaining({ floorPlanEventId: red.id, areaId: "vip-2", reservationType: "room" }));
  });

  it("preserves occupancy if a cached placeholder is now a real VIP booking", async () => {
    const storage = new MemoryFloorPlanStorage();
    const red = { ...corporate, contractedAreaIds: ["vip-2"], source: { ...corporate.source, rooms: ["VIP 2"] }, guestCount: 20 };
    const hold = { ...red, id: "saved-hold", tripleseatEventId: "vip-placeholder", name: "Event Block", source: { ...red.source, food: [] } };
    const held: FloorPlanReservation = { ...manual, id: "vip-room", floorPlanEventId: hold.id, areaId: "vip-2", reservationType: "room" };
    const before = await storage.save({ ...mixed, events: [...mixed.events, hold], reservations: [...mixed.reservations, held] }, "Staff draft.");
    const actual = { ...hold, name: "Redacted real VIP" };
    const result = await prepareFloorPlanDraftWindow(date, date, storage, opts({ ...before, events: [staffEvent, actual, red] }));
    expect(result.results[0]).toMatchObject({ status: "needs-review" });
    expect(await storage.get(date)).toEqual(before);
  });

  it("does not infer placement from unresolved current rooms", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save(mixed, "Staff draft.");
    const result = await prepareFloorPlanDraftWindow(date, date, storage, opts({ ...before, events: [...before.events, { ...corporate, unresolvedAreaNames: ["Unmapped area"] }] }));
    expect(result.results[0]).toMatchObject({ status: "needs-review", needsSeatingReview: true });
    expect(await storage.get(date)).toEqual(before);
  });

  it("reports a separate unverified party while saving a complete verified addition", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save(mixed, "Staff draft.");
    const unverifiedId = "93000091";
    const unverified = { ...corporate, id: "unverified", tripleseatEventId: unverifiedId, source: {
      ...corporate.source, reviewReasons: ["Guest count was filled from the exact structured Tripleseat package selection quantity because the event-level guest count is missing."],
    } };
    const dependencies = opts({ ...before, events: [...before.events, corporate, unverified] });
    dependencies.refreshedTripleseatEventDates.set(unverifiedId, date);
    const result = await prepareFloorPlanDraftWindow(date, date, storage, dependencies);
    expect(result.results[0]).toMatchObject({ status: "updated", needsSeatingReview: true, eventCount: 2, planStatus: "Needs Review" });
    expect((await storage.get(date))!.events.some((event) => event.id === unverified.id)).toBe(false);
  });

  it("does not fill an old saved date when the verified source moved to another date", async () => {
    const storage = new MemoryFloorPlanStorage();
    const before = await storage.save({ ...mixed, events: [...mixed.events, corporate] }, "Staff draft.");
    const dependencies = opts(before);
    dependencies.refreshedTripleseatEventDates.set(sourceId, "2026-12-09");
    expect((await prepareFloorPlanDraftWindow(date, date, storage, dependencies)).results[0].status).toBe("skipped");
    expect(await storage.get(date)).toEqual(before);
  });

  it("preserves previously approved work and concurrent staff saves", async () => {
    const storage = new MemoryFloorPlanStorage();
    const approved = await storage.save({ ...mixed, status: "Updated After Approval", approvedAt: mixed.updatedAt }, "Previously approved.");
    const approvedDeps = opts(approved);
    expect((await prepareFloorPlanDraftWindow(date, date, storage, approvedDeps)).results[0].status).toBe("skipped");
    expect(approvedDeps.loadDay).not.toHaveBeenCalled();
    const separate = new MemoryFloorPlanStorage();
    const before = await separate.save(mixed, "Staff draft.");
    const concurrentDeps = opts({ ...before, events: [...before.events, corporate] });
    concurrentDeps.loadDay.mockImplementationOnce(async () => {
      await separate.save({ ...before, reservations: [{ ...manual, label: "New staff choice" }] }, "Concurrent staff save.");
      return { ...payload(date), plan: { ...before, events: [...before.events, corporate] } };
    });
    expect((await prepareFloorPlanDraftWindow(date, date, separate, concurrentDeps)).results[0]).toMatchObject({ status: "skipped", message: "A concurrent saved plan was preserved." });
    expect((await separate.get(date))!.reservations).toEqual([{ ...manual, label: "New staff choice" }]);
  });
});
