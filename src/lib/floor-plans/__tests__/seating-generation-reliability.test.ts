import { describe, expect, it } from "vitest";
import { detectFloorPlanConflicts } from "../conflicts";
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
