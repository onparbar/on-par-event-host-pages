import { describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { reconcileDecemberOwnerHoldDrafts } from "../december-owner-holds";
import * as generator from "../generator";
import { withoutDecemberOwnerHoldFloorPlanEvents } from "../owner-holds";
import { getFloorPlanDay } from "../service";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDayPayload, type FloorPlanDocument, type FloorPlanReservation } from "../types";

const DATE = "2026-12-05";
function document(date = DATE): FloorPlanDocument {
  const id = `floor-plan-${date}`;
  const real = { id: "real-event", floorPlanId: id, tripleseatEventId: "93000001", name: "Redacted December event", status: "DEFINITE", guestCount: 10,
    startAt: `${date}T22:30:00Z`, endAt: `${date}T23:30:00Z`, contractedAreaIds: ["main-dining"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: "2026-10-27T14:00:00Z", fullBuyout: false,
    source: { rooms: ["Main Dining"], food: ["1 × Wing Platter"], entertainment: [], operationalNotes: [], reviewReasons: [], seatingGenerationIssues: [{ code: "old-blocker", message: "Old blocked space", blocking: true }] } };
  const hold = { ...real, id: "owner-hold", tripleseatEventId: "vip-redacted-owner", name: "Owner hold VIP", guestCount: 1, contractedAreaIds: ["vip-1"], color: "#D40044",
    source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } };
  const row: FloorPlanReservation = { id: "real-seat", floorPlanEventId: real.id, areaId: "main-rect-left-3", reservationType: "seating", startAt: real.startAt, endAt: real.endAt,
    label: "Real seat", source: "generated", lockedByUser: false };
  return { id, eventDate: date, version: 0, status: "Conflict", ruleVersion: FLOOR_PLAN_RULE_VERSION, lastTripleseatSyncAt: "2026-10-27T15:00:00Z",
    createdAt: "2026-10-27T15:00:00Z", updatedAt: "2026-10-27T15:00:00Z", approvedAt: null, approvedBy: null, events: [real, hold],
    reservations: [row, { ...row, id: "owner-room", floorPlanEventId: hold.id, areaId: "vip-1", reservationType: "room", label: "VIP 1" }] };
}
function client() {
  return { configured: true, fetchRange: vi.fn(async (from: string, to: string) => ({ ...vipPrepPayload, from, to, reservations: [], reservationCount: 0 })) };
}
function reader() {
  return vi.fn<typeof getFloorPlanDay>().mockImplementation(async (date, storage, options) => {
    await options!.vipPrepClient!.fetchRange(date, date);
    return { date, plan: withoutDecemberOwnerHoldFloorPlanEvents((await storage!.get(date))!), entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [],
      validation: [], revisions: [], persistence: "memory", sourceMode: "live", warnings: [] } satisfies FloorPlanDayPayload;
  });
}

describe("bounded December owner-hold draft reconciliation", () => {
  it("removes only internal holds, fills missing event seating/food, and recomputes stale status/issues", async () => {
    const storage = new MemoryFloorPlanStorage();
    const saved = await storage.save(document(), "Existing generated draft.");
    const loadDay = reader(); const vipPrepClient = client();
    const result = await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient });
    expect(result.results).toEqual([{ date: DATE, status: "updated", removedHolds: 1, planStatus: "Draft" }]);
    const updated = (await storage.get(DATE))!;
    expect(updated.events.map((event) => event.id)).toEqual(["real-event"]);
    expect(updated.events[0].source.seatingGenerationIssues).toBeUndefined();
    expect(updated.events[0].beoLastModifiedAt).toBe(saved.events[0].beoLastModifiedAt);
    expect(updated.events[0].source.food).toEqual(saved.events[0].source.food);
    expect(updated.reservations).toContainEqual(saved.reservations[0]);
    expect(updated.reservations.some((row) => row.reservationType === "food-table")).toBe(true);
    expect(updated.reservations.some((row) => row.floorPlanEventId === "owner-hold")).toBe(false);
    expect(updated.version).toBe(saved.version + 1);
    expect(updated.approvedAt).toBeNull(); expect(updated.approvedBy).toBeNull();
    expect(loadDay.mock.calls[0][2]).toMatchObject({ readOnly: true });
    expect(vipPrepClient.fetchRange).toHaveBeenCalledExactlyOnceWith("2026-12-01", "2026-12-31");
    const revisions = await storage.revisions(updated.id);
    expect(revisions).toHaveLength(2); expect(revisions[0].previousValue).toEqual(saved);
  });

  it.each(["manual", "locked", "placement", "staff-time", "approved", "updated-approved", "completed", "archived"])("preserves %s work and does not load sources for its draft", async (protection) => {
    const storage = new MemoryFloorPlanStorage(); const doc = document();
    if (protection === "manual") doc.reservations[0].source = "manual";
    if (protection === "locked") doc.reservations[0].lockedByUser = true;
    if (protection === "placement") doc.reservations[0].placementOverride = true;
    if (protection === "staff-time") doc.reservations[0].timingSource = "staff-override";
    if (protection === "approved") { doc.status = "Approved"; doc.approvedAt = "2026-10-27T17:00:00Z"; doc.approvedBy = "Staff"; }
    if (protection === "updated-approved") doc.status = "Updated After Approval";
    if (protection === "completed") doc.status = "Completed";
    if (protection === "archived") doc.status = "Archived";
    const saved = await storage.save(doc, "Protected work."); const loadDay = reader();
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results[0]).toMatchObject({ status: "skipped", removedHolds: 0 });
    expect(await storage.get(DATE)).toEqual(saved); expect(loadDay).not.toHaveBeenCalled();
    expect(await storage.revisions(saved.id)).toHaveLength(1);
  });

  it("does not touch other months and is idempotent after a successful update", async () => {
    const storage = new MemoryFloorPlanStorage();
    const november = await storage.save(document("2026-11-30"), "November preserved.");
    const january = await storage.save(document("2027-01-01"), "January preserved.");
    await storage.save(document(), "December draft.");
    const loadDay = reader();
    await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() });
    const updated = await storage.get(DATE);
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results).toEqual([]);
    expect(await storage.get(DATE)).toEqual(updated);
    expect(await storage.get("2026-11-30")).toEqual(november); expect(await storage.get("2027-01-01")).toEqual(january);
    expect(loadDay).toHaveBeenCalledOnce();
  });

  it("fills each remaining party separately without allowing joint reallocation of real reservations", async () => {
    const storage = new MemoryFloorPlanStorage(); const doc = document();
    doc.events.push({ ...doc.events[0], id: "second-real-event", tripleseatEventId: "93000002", name: "Redacted second party", guestCount: 20,
      color: "#274FEF", contractedAreaIds: ["vip-1"], source: { ...doc.events[0].source, rooms: ["VIP 1"] } });
    const saved = await storage.save(doc, "Two real parties and an internal placeholder.");
    const generation = vi.spyOn(generator, "generateFloorPlanReservationProposal");
    try {
      expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay: reader(), vipPrepClient: client() })).results[0].status).toBe("updated");
      expect(generation.mock.calls.map((call) => call[2])).toEqual(["real-event", "second-real-event"]);
      const updated = (await storage.get(DATE))!;
      expect(updated.reservations).toContainEqual(saved.reservations[0]);
      expect(updated.reservations.some((row) => row.floorPlanEventId === "second-real-event" && row.areaId === "vip-1")).toBe(true);
      expect(updated.events.map((event) => event.tripleseatEventId)).toEqual(["93000001", "93000002"]);
    } finally { generation.mockRestore(); }
  });

  it("refuses a proposal that changes even one existing real assignment", async () => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Existing work.");
    const original = generator.generateFloorPlanReservationProposal;
    const generation = vi.spyOn(generator, "generateFloorPlanReservationProposal").mockImplementation((...args) => {
      const proposal = original(...args);
      return { ...proposal, reservations: proposal.reservations.map((row) => row.id === "real-seat" ? { ...row, label: "Unexpectedly changed" } : row) };
    });
    try {
      expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay: reader(), vipPrepClient: client() })).results[0]).toMatchObject({ status: "error", removedHolds: 0 });
      expect(await storage.get(DATE)).toEqual(saved); expect(await storage.revisions(saved.id)).toHaveLength(1);
    } finally { generation.mockRestore(); }
  });

  it("refuses to remove an old placeholder that now appears as a real customer booking", async () => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Old placeholder.");
    const loadDay = reader();
    loadDay.mockImplementation(async (date) => ({ date, plan: { ...saved, events: saved.events.map((event) => event.id === "owner-hold" ? { ...event, name: "Redacted real VIP" } : event) },
      entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [], validation: [], revisions: [], persistence: "memory", sourceMode: "live", warnings: [] }));
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results[0]).toMatchObject({ status: "skipped", removedHolds: 0 });
    expect(await storage.get(DATE)).toEqual(saved);
  });

  it("preserves real manual VIP room reservations even in a different space from the internal hold", async () => {
    for (const manualOverride of [false, true]) {
      const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Owner hold in VIP 1.");
      const room: EntertainmentReservation = {
        id: "staff-real-vip-room", syncKey: null, localEventId: "staff-real-vip", tripleseatEventId: null, tripleseatBookingId: null,
        eventName: "Redacted real VIP reservation", operatingDate: DATE, resourceId: "private-room-vip-2", resourceCategory: "private-rooms", resourceName: "VIP 2",
        startAt: `${DATE}T22:30:00Z`, endAt: `${DATE}T23:30:00Z`, sourceStartAt: null, sourceEndAt: null, sourceResourceId: null,
        eventColor: "#274FEF", colorSource: "manual", source: manualOverride ? "vip-prep" : "manual", sourceReference: null,
        manualOverride, hasSourceUpdate: false, needsReview: false, reviewIssues: [], autoAssigned: false, notes: "Staff reservation",
        sourceUpdatedAt: null, lastTripleseatSyncAt: null, active: true, createdAt: "2026-10-27T16:00:00Z", updatedAt: "2026-10-27T16:00:00Z", updatedBy: "Staff",
      };
      const before = structuredClone(room); const loadDay = reader();
      loadDay.mockImplementation(async (...args) => ({ ...await reader()(...args), entertainmentReservations: [room] }));
      const generation = vi.spyOn(generator, "generateFloorPlanReservationProposal");
      try {
        expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results).toEqual([
          { date: DATE, status: "skipped", removedHolds: 0, message: "An explicit staff room reservation was preserved for review." },
        ]);
        expect(generation).not.toHaveBeenCalled(); expect(await storage.get(DATE)).toEqual(saved);
        expect(await storage.revisions(saved.id)).toHaveLength(1); expect(room).toEqual(before);
      } finally { generation.mockRestore(); }
    }
  });

  it.each(["new-customer", "area", "start", "end", "food", "guests", "source-id", "source-updated", "entertainment", "removed-event"])("preserves the saved draft when live %s evidence changed", async (change) => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Source baseline.");
    const loadDay = reader();
    loadDay.mockImplementation(async (...args) => {
      const day = await reader()(...args); const event = day.plan.events[0];
      if (change === "new-customer") day.plan.events.push({ ...event, id: "new-vip", tripleseatEventId: "vip-real-customer", name: "Redacted new customer", contractedAreaIds: ["vip-1"] });
      if (change === "area") event.contractedAreaIds = ["vip-1"];
      if (change === "start") event.startAt = `${DATE}T23:00:00Z`;
      if (change === "end") event.endAt = `${DATE}T23:45:00Z`;
      if (change === "food") event.source.food = ["2 × Wing Platter"];
      if (change === "guests") event.guestCount = 25;
      if (change === "source-id") event.tripleseatEventId = "93000099";
      if (change === "source-updated") event.beoLastModifiedAt = "2026-10-27T19:00:00Z";
      if (change === "entertainment") event.source.entertainment = [{ name: "Bowling", quantity: "1 lane", time: "5:30 PM", duration: "1 hour" }];
      if (change === "removed-event") day.plan.events = [];
      return day;
    });
    const generation = vi.spyOn(generator, "generateFloorPlanReservationProposal");
    try {
      expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results).toEqual([
        { date: DATE, status: "skipped", removedHolds: 0, message: "Event or customer booking details changed; existing assignments were preserved for review." },
      ]);
      expect(generation).not.toHaveBeenCalled(); expect(await storage.get(DATE)).toEqual(saved); expect(await storage.revisions(saved.id)).toHaveLength(1);
    } finally { generation.mockRestore(); }
  });

  it("treats equivalent exact instants as unchanged source evidence", async () => {
    const storage = new MemoryFloorPlanStorage(); await storage.save(document(), "Source baseline.");
    const loadDay = reader();
    loadDay.mockImplementation(async (...args) => {
      const day = await reader()(...args); const event = day.plan.events[0];
      event.startAt = `${DATE}T17:30:00-05:00`; event.endAt = `${DATE}T18:30:00-05:00`;
      event.beoLastModifiedAt = "2026-10-27T10:00:00-04:00";
      return day;
    });
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results[0]).toMatchObject({ status: "updated", planStatus: "Draft" });
  });

  it.each([false, true])("recomputes stale generation warnings while retaining genuine source warnings: %s", async (hasSourceWarning) => {
    const storage = new MemoryFloorPlanStorage(); await storage.save(document(), "Old blocker.");
    const loadDay = reader();
    loadDay.mockImplementation(async (...args) => ({ ...await reader()(...args), warnings: ["Old blocked space", ...(hasSourceWarning ? ["Current contract warning."] : [])] }));
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results[0]).toMatchObject({ status: "updated", planStatus: hasSourceWarning ? "Needs Review" : "Draft" });
    expect((await storage.get(DATE))!.events[0].source.seatingGenerationIssues).toBeUndefined();
  });

  it("preserves a newer staff save through version checking instead of retrying", async () => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Initial.");
    const loadDay = reader(); let concurrent: FloorPlanDocument | null = null;
    loadDay.mockImplementation(async (date) => {
      concurrent = await storage.save({ ...saved, status: "Approved", approvedBy: "Staff", approvedAt: "2026-10-27T18:00:00Z" }, "Concurrent approval.");
      return { date, plan: withoutDecemberOwnerHoldFloorPlanEvents(saved), entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [], validation: [], revisions: [], persistence: "memory", sourceMode: "live", warnings: [] };
    });
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() })).results[0]).toMatchObject({ status: "skipped", removedHolds: 0, message: "A concurrent staff save was preserved." });
    expect(await storage.get(DATE)).toEqual(concurrent); expect(await storage.revisions(saved.id)).toHaveLength(2);
  });

  it("aborts an unavailable booking feed before any saved-data writes", async () => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Initial.");
    const save = vi.spyOn(storage, "save"); const loadDay = reader();
    await expect(reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: { configured: false, fetchRange: vi.fn() } })).rejects.toThrow("live booking feed");
    await expect(reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: { configured: true, fetchRange: vi.fn().mockRejectedValue(new Error("Feed unavailable")) } })).rejects.toThrow("Feed unavailable");
    expect(save).not.toHaveBeenCalled(); expect(loadDay).not.toHaveBeenCalled(); expect(await storage.get(DATE)).toEqual(saved);
  });

  it("retains a draft on source failure without leaking private details and keeps warning status", async () => {
    const storage = new MemoryFloorPlanStorage(); const saved = await storage.save(document(), "Initial.");
    const loadDay = reader().mockRejectedValueOnce(new Error("PRIVATE source diagnostic"));
    const failed = await reconcileDecemberOwnerHoldDrafts(storage, { loadDay, vipPrepClient: client() });
    expect(failed.results[0].status).toBe("error"); expect(JSON.stringify(failed)).not.toContain("PRIVATE"); expect(await storage.get(DATE)).toEqual(saved);
    const warningReader = reader(); warningReader.mockImplementationOnce(async (...args) => ({ ...await reader()(...args), warnings: ["Contract requires staff review."] }));
    expect((await reconcileDecemberOwnerHoldDrafts(storage, { loadDay: warningReader, vipPrepClient: client() })).results[0]).toMatchObject({ status: "updated", planStatus: "Needs Review" });
  });
});
