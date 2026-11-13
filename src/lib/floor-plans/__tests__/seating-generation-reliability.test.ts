import { describe, expect, it } from "vitest";
import { detectFloorPlanConflicts } from "../conflicts";
import { floorPlanAreaBelongsToSection, getFloorPlanArea, seatingTablesForArea } from "../configuration/areas";
import { generateFloorPlanReservationProposal, generateFloorPlanReservations, reservedSeatingCapacity, reservationForCurrentFloorPlanEvent } from "../generator";
import { searchSeatingCombination } from "../seating-search";
import { summarizeEventSeating } from "../seating-summary";
import type { FloorPlanArea, FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "../types";

const START = "2026-10-26T21:00:00.000Z";
const END = "2026-10-26T23:00:00.000Z";

function event(id = "first", overrides: Partial<FloorPlanEvent> = {}): FloorPlanEvent {
  return { id, floorPlanId: "day", tripleseatEventId: id, name: id, status: "Definite", guestCount: 30,
    startAt: START, endAt: END, contractedAreaIds: ["main-dining"], unresolvedAreaNames: [], color: "#18332F",
    beoLastModifiedAt: null, fullBuyout: false,
    source: { rooms: ["Main Dining"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] }, ...overrides };
}

function row(owner: FloorPlanEvent, areaId: string, overrides: Partial<FloorPlanReservation> = {}): FloorPlanReservation {
  return { id: `${owner.id}:${areaId}`, floorPlanEventId: owner.id, areaId, reservationType: "seating", startAt: owner.startAt,
    endAt: owner.endAt, label: "", source: "manual", lockedByUser: true, timingSource: "event-default", placementOverride: true, ...overrides };
}

function plan(events: FloorPlanEvent[], reservations: FloorPlanReservation[] = []): FloorPlanDocument {
  return { id: "day", eventDate: "2026-10-26", status: "Draft", version: 1, ruleVersion: "test", lastTripleseatSyncAt: null,
    createdAt: START, updatedAt: START, approvedAt: null, approvedBy: null, events, reservations };
}

function table(index: number): FloorPlanArea {
  return { id: `test-${index}`, name: `Table ${index}`, shortLabel: "", type: "rectangle-table", capacity: 10,
    x: index * 25, y: 0, width: 20, height: 20, isAda: false, canBeFoodTable: false, isReservable: true, isMovable: false };
}

describe("bounded deterministic table selection", () => {
  it.each([32, 33, 48, 80])("finds sufficient seating above the former bitmask boundary: %i candidates", (count) => {
    const candidates = Array.from({ length: count }, (_, index) => table(index));
    const result = searchSeatingCombination(candidates, 20);
    expect(result.tables.reduce((sum, area) => sum + area.capacity, 0)).toBe(20);
    expect(result.tables.map((area) => area.id)).toEqual(searchSeatingCombination(candidates, 20).tables.map((area) => area.id));
    expect(result.explored).toBeLessThanOrEqual(50_000);
  });

  it("distinguishes an unfinished grouping search from a proven shortage or missing demand", () => {
    const candidates = Array.from({ length: 40 }, (_, index) => table(index));
    const incomplete = searchSeatingCombination(candidates, 200, [], [], 1);
    expect(incomplete.status).toBe("search-incomplete");
    expect(incomplete.tables).toHaveLength(20);
    expect(searchSeatingCombination(candidates, 401).status).toBe("no-valid-combination");
    expect(searchSeatingCombination(candidates, Number.NaN).status).toBe("missing-source");
  });
});

describe("event-scoped seating repair", () => {
  it("holds the lower VIP 1 conversation wall even for a small event without counting seats there", () => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 12 });
    const result = generateFloorPlanReservationProposal(plan([vip]), "fill-missing", vip.id);
    expect(result.reservations.filter((item) => item.reservationType === "room").map((item) => item.areaId)).toEqual(["vip-1", "vip1-extra-convo"]);
    expect(result.reservations.some((item) => item.reservationType === "seating" || item.areaId === "vip1-conversation-wall")).toBe(false);
    expect(summarizeEventSeating(vip, result.reservations).coveredCapacity).toBe(20);
    expect(result.complete).toBe(true);
  });

  it("keeps On Par VIP couch-only bookings in the booked room", () => {
    const vip = event("vip", { tripleseatEventId: "vip-onpar-booking", contractedAreaIds: ["vip-1"], guestCount: 12 });
    const result = generateFloorPlanReservationProposal(plan([vip]), "fill-missing", vip.id);
    expect(result.reservations.map((item) => item.areaId)).toEqual(["vip-1"]);
  });

  it("does not substitute the upper wall when the lower VIP 1 wall is occupied", () => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 35 });
    const other = event("other");
    const hold = row(other, "vip1-extra-convo", { reservationType: "room" });
    const result = generateFloorPlanReservationProposal(plan([vip, other], [hold]), "replace-generated", vip.id);
    expect(result.reservations.filter((item) => item.areaId.endsWith("convo") || item.areaId === "vip1-conversation-wall")).toEqual([hold]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "preferred-wall-unavailable", blocking: false, message: expect.stringContaining("lower VIP 1 conversation wall") }));
    expect(result.complete).toBe(true);
  });

  it("replaces an unlocked upper VIP 1 wall in a draft without deleting intentional or published assignments", () => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 12 });
    const upper = row(vip, "vip1-conversation-wall", { source: "generated", lockedByUser: false, placementOverride: false });
    const draft = generateFloorPlanReservationProposal(plan([vip], [upper]), "fill-missing", vip.id);
    expect(draft.reservations.some((item) => item.areaId === upper.areaId)).toBe(false);
    expect(draft.reservations.some((item) => item.areaId === "vip1-extra-convo")).toBe(true);
    const approved = generateFloorPlanReservationProposal({ ...plan([vip], [upper]), status: "Approved" }, "fill-missing", vip.id);
    expect(approved.reservations).toContainEqual(upper);
    expect(approved.reservations.some((item) => item.areaId === "vip1-extra-convo")).toBe(false);
    const manualUpper = { ...upper, source: "manual" as const, lockedByUser: true };
    const edited = generateFloorPlanReservationProposal(plan([vip], [manualUpper]), "replace-generated", vip.id);
    expect(edited.reservations).toContainEqual(manualUpper);
  });

  it("fills the 76-guest VIP 1 example from the Clubhouse end of Level Up before using one Clubhouse table", () => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 76 });
    const result = generateFloorPlanReservationProposal(plan([vip]), "replace-generated", vip.id);
    const overflow = (section: string) => result.reservations.filter((item) => floorPlanAreaBelongsToSection(item.areaId, section)).map((item) => item.areaId);
    expect(overflow("level-up-seating")).toEqual(["level-up-square-6", "wat-table-1", "wat-table-2", "wat-table-3"]);
    expect(overflow("clubhouse-seating")).toEqual(["level-up-square-5"]);
    expect(summarizeEventSeating(vip, result.reservations).coveredCapacity).toBe(78);
    expect(result.complete).toBe(true);
  });

  it.each([["vip-1", 41], ["level-up-seating", 1]] as const)("skips occupied Level Up tables in order and stops once it has enough seats (%s)", (area, guestCount) => {
    const vip = event("vip", { contractedAreaIds: [area], guestCount });
    const other = event("other");
    const holds = ["level-up-square-6", "wat-table-1"].map((areaId) => row(other, areaId));
    const result = generateFloorPlanReservationProposal(plan([vip, other], holds), "replace-generated", vip.id);
    expect(result.reservations.filter((item) => item.floorPlanEventId === other.id)).toEqual(holds);
    expect(result.reservations.filter((item) => item.floorPlanEventId === vip.id && floorPlanAreaBelongsToSection(item.areaId, "level-up-seating")).map((item) => item.areaId)).toEqual(["wat-table-2"]);
    expect(result.complete).toBe(true);
  });

  it.each([[40, false], [41, true], [50, true]])("uses VIP 1 overflow only above 40 guests (%i guests)", (guestCount, overflow) => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount });
    const result = generateFloorPlanReservationProposal(plan([vip]), "replace-generated", vip.id);
    const baseRows = result.reservations.filter((item) => floorPlanAreaBelongsToSection(item.areaId, "vip-1"));
    expect(reservedSeatingCapacity(baseRows)).toBe(40);
    expect(result.reservations.some((item) => floorPlanAreaBelongsToSection(item.areaId, "level-up-seating"))).toBe(overflow);
    expect(result.reservations.some((item) => floorPlanAreaBelongsToSection(item.areaId, "clubhouse-seating"))).toBe(false);
    expect(result.complete).toBe(true);
  });

  it("uses the remaining 4-seat Level Up table first, then verified Clubhouse seats for the shortfall", () => {
    const vip = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 50 });
    const other = event("other", { contractedAreaIds: ["level-up-seating"] });
    const holds = seatingTablesForArea("level-up-seating").filter((area) => area.capacity === 10).map((area) => row(other, area.id));
    const source = plan([vip, other], holds);
    const result = generateFloorPlanReservationProposal(source, "replace-generated", vip.id);
    const ours = result.reservations.filter((item) => item.floorPlanEventId === vip.id);
    const overflow = (section: string) => ours.filter((item) => floorPlanAreaBelongsToSection(item.areaId, section));
    expect(overflow("level-up-seating").map((item) => item.areaId)).toEqual(["level-up-square-6"]);
    expect(reservedSeatingCapacity(overflow("clubhouse-seating"))).toBe(8);
    expect(result.reservations.filter((item) => item.floorPlanEventId === other.id)).toEqual(holds);
    expect(detectFloorPlanConflicts({ ...source, reservations: result.reservations })).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("lets VIP 2 use the same conversation wall, without counting it again for overlapping VIP 1", () => {
    const first = event("first", { contractedAreaIds: ["vip-1"], guestCount: 40 });
    const second = event("second", { contractedAreaIds: ["vip-2"], guestCount: 35 });
    const other = event("other");
    const holds = [1, 2, 3].map((index) => row(other, `vip1-extra-front-${index}`));
    const secondPlan = generateFloorPlanReservationProposal(plan([first, second, other], holds), "replace-generated", second.id);
    expect(secondPlan.complete).toBe(true);
    expect(secondPlan.reservations).toContainEqual(expect.objectContaining({ floorPlanEventId: second.id, areaId: "vip1-conversation-wall" }));
    const firstPlan = generateFloorPlanReservationProposal(plan([first, second, other], secondPlan.reservations), "replace-generated", first.id);
    expect(firstPlan.reservations.filter((item) => item.areaId === "vip1-conversation-wall")).toHaveLength(1);
    expect(firstPlan.complete).toBe(false);
    expect(firstPlan.issues).toContainEqual(expect.objectContaining({ code: "no-valid-combination", blocking: true }));
  });

  it("keeps only the needed previously selected seats after a count drops below the VIP 1 overflow threshold", () => {
    const before = event("vip", { contractedAreaIds: ["vip-1"], guestCount: 50 });
    const original = generateFloorPlanReservations(plan([before]), "replace-generated", before.id);
    const after = { ...before, guestCount: 35 };
    const result = generateFloorPlanReservationProposal(plan([after], original), "replace-generated", after.id,
      new Set(original.map((item) => item.areaId)));
    expect(result.complete).toBe(true);
    expect(result.reservations.every((item) => floorPlanAreaBelongsToSection(item.areaId, "vip-1"))).toBe(true);
    expect(result.addedReservationIds).toEqual([]);
    expect(result.movedReservationIds).toEqual(original.filter((item) => !floorPlanAreaBelongsToSection(item.areaId, "vip-1")).map((item) => item.id));
  });

  it("keeps the unverified Main Dining annex and Big Show capacity out of automatic seat counts", () => {
    expect(getFloorPlanArea("darts-convo")).toMatchObject({ parentAreaId: "main-dining", capacity: 0 });
    expect(getFloorPlanArea("big-show-karaoke")).toMatchObject({ y: 0, capacity: 0 });
    expect(seatingTablesForArea("main-dining").some((item) => item.id === "darts-convo")).toBe(false);
    expect(seatingTablesForArea("geg-tables").map((item) => item.id)).toEqual(["ge-table-1", "ge-table-2", "ge-table-3"]);
  });

  it("detects and avoids booking Big Show over a private room in the revised footprint", () => {
    const bigShow = event("big-show", { contractedAreaIds: ["big-show-karaoke"] });
    const privateRoom = event("private-room", { contractedAreaIds: ["gem-room"] });
    const room = row(privateRoom, "gem-room", { reservationType: "room" });
    const conflicting = row(bigShow, "big-show-karaoke", { reservationType: "room" });
    const existing = plan([bigShow, privateRoom], [room, conflicting]);
    expect(detectFloorPlanConflicts(existing)).toContainEqual(expect.objectContaining({
      areaId: "big-show-karaoke", eventIds: [privateRoom.id, bigShow.id], blocking: true,
    }));
    const proposal = generateFloorPlanReservationProposal({ ...existing, reservations: [room] }, "replace-generated", bigShow.id);
    expect(proposal.reservations).toContainEqual(room);
    expect(proposal.reservations.some((item) => item.floorPlanEventId === bigShow.id && item.areaId === "big-show-karaoke")).toBe(false);
    expect(proposal.issues).toContainEqual(expect.objectContaining({ code: "placement-unavailable", blocking: true }));
    expect(proposal.complete).toBe(false);
  });

  it("fills 30 to 38 guests without replacing selected tables or another party", () => {
    const first = event("first", { guestCount: 38 });
    const second = event("second", { contractedAreaIds: ["vip-2"], guestCount: 16 });
    const existing = ["main-rect-left-1", "main-rect-left-2", "main-rect-left-3"].map((id) => row(first, id));
    const other = row(second, "vip-2", { reservationType: "room" });
    const food = row(first, "main-food-1", { reservationType: "food-table" });
    const source = plan([first, second], [...existing, food, other]);
    const result = generateFloorPlanReservationProposal(source, "fill-missing", first.id);
    expect(existing.every((saved) => result.reservations.some((next) => JSON.stringify(next) === JSON.stringify(saved)))).toBe(true);
    expect(result.reservations.filter((next) => next.floorPlanEventId === second.id)).toEqual([other]);
    expect(summarizeEventSeating(first, result.reservations).coveredCapacity).toBe(40);
    expect(result.addedReservationIds).toHaveLength(1);
    expect(result.complete).toBe(true);
  });

  it("reworks only the selected event’s unlocked generated placements", () => {
    const first = event("first", { guestCount: 10 });
    const second = event("second", { contractedAreaIds: ["vip-2"], guestCount: 16 });
    const original = row(first, "main-round-right", { source: "generated", lockedByUser: false, placementOverride: false });
    const other = row(second, "vip-2", { reservationType: "room" });
    const result = generateFloorPlanReservationProposal(plan([first, second], [original, other]), "replace-generated", first.id);
    expect(result.reservations.filter((next) => next.floorPlanEventId === second.id)).toEqual([other]);
    expect(result.reservations).not.toContainEqual(original);
    expect(result.reservations.some((next) => next.areaId === "main-rect-left-3")).toBe(true);
  });

  it("does not remove existing assignments when a replacement is insufficient", () => {
    const first = event("first", { contractedAreaIds: ["geg-tables"], guestCount: 40 });
    const existing = row(first, "ge-table-1", { source: "generated", lockedByUser: false, placementOverride: false });
    const result = generateFloorPlanReservationProposal(plan([first], [existing]), "replace-generated", first.id);
    expect(result.reservations).toContainEqual(existing);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "assignments-preserved", blocking: true }));
  });

  it("keeps locked placement but updates ordinary timing and preserves explicit time overrides", () => {
    const first = event();
    const selected = row(first, "main-rect-left-1");
    const updated = { ...first, startAt: "2026-10-26T22:00:00.000Z", endAt: "2026-10-27T00:00:00.000Z" };
    expect(reservationForCurrentFloorPlanEvent(updated, selected)).toEqual({ ...selected, startAt: updated.startAt, endAt: updated.endAt });
    const override = { ...selected, timingSource: "staff-override" as const };
    expect(reservationForCurrentFloorPlanEvent(updated, override)).toEqual(override);
  });

  it("does not duplicate physical assignments during repeated fill", () => {
    const first = event();
    const source = plan([first]);
    const once = generateFloorPlanReservations(source, "fill-missing", first.id);
    const twice = generateFloorPlanReservations({ ...source, reservations: once }, "fill-missing", first.id);
    expect(twice).toEqual(once);
  });

  it("does not replace usable VIP tables with another party’s unavailable couch capacity", () => {
    const first = event("first", { contractedAreaIds: ["vip-1"], guestCount: 10 });
    const second = event("second", { contractedAreaIds: ["vip-1"], guestCount: 20 });
    const oldTable = row(first, "vip1-extra-front-1", { source: "generated", lockedByUser: false, placementOverride: false });
    const firstFood = row(first, "vip1-food-table", { reservationType: "food-table" });
    const couch = row(second, "vip-1", { reservationType: "room" });
    const source = plan([first, second], [oldTable, firstFood, couch]);
    const result = generateFloorPlanReservationProposal(source, "replace-generated", first.id);
    expect(result.reservations.filter((next) => next.floorPlanEventId === second.id)).toEqual([couch]);
    expect(result.reservations.some((next) => next.floorPlanEventId === first.id && next.areaId === "vip-1")).toBe(false);
    expect(summarizeEventSeating(first, result.reservations, { allReservations: result.reservations }).coveredCapacity).toBe(10);
    expect(detectFloorPlanConflicts({ ...source, reservations: result.reservations })).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "placement-unavailable" }));
  });

  it("retains existing event assignments when a full-facility hold makes replacement invalid", () => {
    const first = event("first", { contractedAreaIds: ["vip-1"], guestCount: 10 });
    const second = event("second", { contractedAreaIds: ["facility"], fullBuyout: true, guestCount: 100 });
    const oldTable = row(first, "vip1-extra-front-1", { source: "generated", lockedByUser: false, placementOverride: false });
    const food = row(first, "vip1-food-table", { reservationType: "food-table" });
    const buyout = row(second, "facility", { reservationType: "room" });
    const result = generateFloorPlanReservationProposal(plan([first, second], [oldTable, food, buyout]), "replace-generated", first.id);
    expect(result.reservations.filter((next) => next.floorPlanEventId === first.id)).toEqual([oldTable, food]);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "assignments-preserved", blocking: true }));
  });
});

describe("overlapping-party allocation alternatives", () => {
  it("finds a valid joint allocation instead of letting the flexible party strand GEG", () => {
    const flexible = event("flexible", { guestCount: 10, contractedAreaIds: ["geg-tables", "main-dining"] });
    const restricted = event("restricted", { guestCount: 20, contractedAreaIds: ["geg-tables"] });
    const source = plan([flexible, restricted]);
    const result = generateFloorPlanReservationProposal(source, "fill-missing");
    expect(result.complete).toBe(true);
    expect(summarizeEventSeating(restricted, result.reservations).coveredCapacity).toBeGreaterThanOrEqual(20);
    expect(summarizeEventSeating(flexible, result.reservations).coveredCapacity).toBeGreaterThanOrEqual(10);
    expect(detectFloorPlanConflicts({ ...source, reservations: result.reservations })).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "joint-reallocation" }));
    expect(generateFloorPlanReservationProposal(source, "fill-missing")).toEqual(result);
  });

  it("does not move approved, staff-selected or locked choices to satisfy another party", () => {
    const first = event("first", { guestCount: 20, contractedAreaIds: ["geg-tables"] });
    const second = event("second", { guestCount: 20, contractedAreaIds: ["geg-tables"] });
    const fixed = [row(first, "ge-table-1"), row(first, "ge-table-2")];
    const source = { ...plan([first, second], fixed), status: "Approved" as const };
    const result = generateFloorPlanReservationProposal(source, "replace-generated");
    expect(result.reservations).toEqual(expect.arrayContaining(fixed));
    expect(reservedSeatingCapacity(result.reservations.filter((next) => next.floorPlanEventId === first.id))).toBe(20);
    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.code === "joint-reallocation")).toBe(false);
  });
});
