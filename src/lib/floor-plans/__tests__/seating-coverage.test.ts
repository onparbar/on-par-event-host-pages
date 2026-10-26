import { describe, expect, it } from "vitest";
import { detectFloorPlanConflicts } from "../conflicts";
import { distinctPhysicalSeatingCapacity, seatingCoverageMessage, summarizeEventSeating } from "../seating-summary";
import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "../types";
import { hasBlockingValidationFailures, validateFloorPlan } from "../validator";
import type { EntertainmentReservation } from "@/lib/entertainment/types";

const START = "2026-10-26T21:00:00.000Z";
const END = "2026-10-27T00:00:00.000Z";
const EARLY = "2026-10-26T23:00:00.000Z";
const event: FloorPlanEvent = {
  id: "event-1", floorPlanId: "plan-1", tripleseatEventId: "1", name: "Redacted party", status: "Definite",
  guestCount: 30, startAt: START, endAt: END, contractedAreaIds: ["main-dining"], unresolvedAreaNames: [],
  color: "#18332F", beoLastModifiedAt: null, fullBuyout: false,
  source: { rooms: ["Main Dining"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
};
const row = (areaId: string, overrides: Partial<FloorPlanReservation> = {}): FloorPlanReservation => ({
  id: `${event.id}:${areaId}`, floorPlanEventId: event.id, areaId, reservationType: "seating",
  startAt: START, endAt: END, label: "", source: "generated", lockedByUser: false, ...overrides,
});
const seats = () => [row("main-rect-left-1"), row("main-rect-left-2"), row("main-rect-left-3")];
const plan = (reservations: FloorPlanReservation[]): FloorPlanDocument => ({
  id: "plan-1", eventDate: "2026-10-26", status: "Draft", version: 1, ruleVersion: "test",
  lastTripleseatSyncAt: null, createdAt: START, updatedAt: START, approvedAt: null, approvedBy: null,
  events: [event], reservations,
});

describe("full-event seating coverage", () => {
  it("fails sufficient head-count when the reserved tables end early, with the uncovered clocks", () => {
    const reservations = seats().map((seat) => ({ ...seat, endAt: EARLY }));
    const summary = summarizeEventSeating(event, reservations);
    expect(summary).toMatchObject({ assignedCapacity: 30, coveredCapacity: 0, seatsNeeded: 30, fullEventCoverage: false });
    expect(summary.gaps).toEqual([{ startAt: EARLY, endAt: END, availableSeats: 0, missingSeats: 30 }]);
    expect(seatingCoverageMessage(event, summary)).toContain("7:00 PM–8:00 PM");
    const validation = validateFloorPlan(plan(reservations), [], [], []);
    expect(validation).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Failed", blocking: true }));
    expect(hasBlockingValidationFailures(validation)).toBe(true);
  });

  it("keeps complete seating independent of an earlier-ending entertainment activity", () => {
    const summary = summarizeEventSeating(event, seats());
    expect(summary).toMatchObject({ assignedCapacity: 30, coveredCapacity: 30, fullEventCoverage: true, seatsNeeded: 0, spareSeats: 0 });
    const activity: EntertainmentReservation = {
      id: "short-activity", syncKey: null, localEventId: event.id, tripleseatEventId: event.tripleseatEventId, tripleseatBookingId: null,
      eventName: event.name, operatingDate: "2026-10-26", resourceId: "pool-1", resourceCategory: "pool", resourceName: "Pool Table 1",
      startAt: START, endAt: EARLY, sourceStartAt: START, sourceEndAt: EARLY, sourceResourceId: "pool-1",
      eventColor: event.color, colorSource: "event-plan", source: "tripleseat", sourceReference: null, manualOverride: false,
      hasSourceUpdate: false, needsReview: false, reviewIssues: [], autoAssigned: false, notes: "", sourceUpdatedAt: null,
      lastTripleseatSyncAt: null, active: true, createdAt: START, updatedAt: START, updatedBy: "redacted-staff",
    };
    const document = plan(seats());
    expect(validateFloorPlan(document, [activity], [], [])).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Passed" }));
    expect(document.reservations.every((reservation) => reservation.endAt === END)).toBe(true);
  });

  it("does not satisfy coverage by moving guests from one physical table to another", () => {
    const oneTable = { ...event, guestCount: 10 };
    const reservations = [row("main-rect-left-1", { endAt: EARLY }), row("main-rect-left-2", { startAt: EARLY })];
    const summary = summarizeEventSeating(oneTable, reservations);
    expect(summary).toMatchObject({ coveredCapacity: 0, fullEventCoverage: false });
    expect(summary.issues.join(" ")).toContain("Automatic guest reseating");
  });

  it("counts repeated same-physical records only once and permits continuous same-table coverage", () => {
    const reservations = [row("main-rect-left-1", { endAt: EARLY }), row("main-rect-left-1", { id: "continuation", startAt: EARLY }), row("main-rect-left-1", { id: "duplicate" })];
    const summary = summarizeEventSeating({ ...event, guestCount: 10 }, reservations);
    expect(summary).toMatchObject({ assignedCapacity: 10, coveredCapacity: 10, fullEventCoverage: true });
    expect(distinctPhysicalSeatingCapacity(reservations)).toBe(10);
  });

  it("removes only dining capacity actually assigned to the same physical food table", () => {
    const ownFood = row("main-food-1", { reservationType: "food-table", label: "F" });
    const dedicatedFood = row("vip1-food-table", { reservationType: "food-table", label: "F" });
    expect(summarizeEventSeating(event, [...seats(), ownFood])).toMatchObject({ coveredCapacity: 30, assignedCapacity: 30 });
    expect(summarizeEventSeating(event, [...seats(), dedicatedFood])).toMatchObject({ coveredCapacity: 30, assignedCapacity: 30 });
    const dining = [...seats(), row("main-rect-left-4"), ownFood];
    expect(summarizeEventSeating(event, dining)).toMatchObject({ assignedCapacity: 30, coveredCapacity: 30 });
    expect(summarizeEventSeating({ ...event, guestCount: 40 }, dining)).toMatchObject({ seatsNeeded: 10, fullEventCoverage: false });
    expect(distinctPhysicalSeatingCapacity(dining)).toBe(30);
    expect(detectFloorPlanConflicts(plan(dining))).toContainEqual(expect.objectContaining({ areaId: "main-rect-left-4" }));
  });

  it("uses setup/cleanup occupancy to exclude an otherwise timed overlapping-party table", () => {
    const reservations = seats();
    const other = row("main-rect-left-1", { id: "other", floorPlanEventId: "event-2", startAt: "2026-10-27T01:00:00.000Z", endAt: "2026-10-27T02:00:00.000Z" });
    expect(summarizeEventSeating(event, reservations, { allReservations: [...reservations, other] })).toMatchObject({ assignedCapacity: 30, coveredCapacity: 20, fullEventCoverage: false });
    expect(summarizeEventSeating(event, reservations, { allReservations: [...reservations, { ...other, startAt: "2026-10-27T01:30:00.000Z" }] })).toMatchObject({ coveredCapacity: 30, fullEventCoverage: true });
    expect(summarizeEventSeating(event, reservations, { allReservations: [...reservations, { ...other, startAt: null, endAt: null }] })).toMatchObject({ coveredCapacity: 20, fullEventCoverage: false });
  });

  it("does not remove seats for food use outside the event and its occupied interval", () => {
    const reservations = [row("main-rect-left-4", { startAt: "2026-10-26T12:00:00.000Z" }),
      row("main-food-1", { reservationType: "food-table", label: "F", startAt: "2026-10-26T13:00:00.000Z", endAt: "2026-10-26T14:00:00.000Z" })];
    expect(summarizeEventSeating({ ...event, guestCount: 10 }, reservations)).toMatchObject({ assignedCapacity: 10, coveredCapacity: 10, fullEventCoverage: true });
  });

  it("requires unique authorized food-table coverage for the full event", () => {
    const earlyFood = row("main-food-1", { reservationType: "food-table", label: "F", endAt: EARLY });
    expect(summarizeEventSeating(event, [...seats(), earlyFood])).toMatchObject({ foodRequired: 1, foodAssigned: 0 });
    const fullFood = { ...earlyFood, endAt: END };
    expect(summarizeEventSeating(event, [...seats(), fullFood, { ...fullFood, id: "alias", areaId: "main-rect-left-4" }])).toMatchObject({ foodAssigned: 1 });
    expect(validateFloorPlan(plan([...seats(), earlyFood]), [], [], [])).toContainEqual(expect.objectContaining({ code: "FOOD_TABLE", status: "Failed", blocking: true }));
  });

  it("rejects unverified capacity, wrong purpose, food-use aliases and out-of-contract seats", () => {
    const reservations = [row("not-a-table"), row("main-food-1"), row("vip-1"), row("main-rect-left-1", { reservationType: "room" }), row("ge-table-1")];
    expect(summarizeEventSeating(event, reservations)).toMatchObject({ assignedCapacity: 0, coveredCapacity: 0 });
  });

  it("does not claim complete coverage when the guest count is unknown", () => {
    const summary = summarizeEventSeating({ ...event, guestCount: 0 }, []);
    expect(summary.fullEventCoverage).toBe(false);
    expect(summary.issues.join(" ")).toContain("verified positive guest count");
  });

  it("preserves verified VIP couch capacity and the VIP-only food exception", () => {
    const vip = { ...event, tripleseatEventId: "vip-booking-1", guestCount: 20, contractedAreaIds: ["vip-1"] };
    expect(summarizeEventSeating(vip, [row("vip-1", { reservationType: "room" })])).toMatchObject({ coveredCapacity: 20, fullEventCoverage: true, foodRequired: 0 });
    expect(summarizeEventSeating(vip, [row("vip-1")])).toMatchObject({ coveredCapacity: 20, fullEventCoverage: true });
  });

  it("shows the correct New York date for a coverage gap crossing midnight", () => {
    const lateEvent = { ...event, startAt: "2026-10-27T03:00:00.000Z", endAt: "2026-10-27T05:00:00.000Z", guestCount: 10 };
    const reservations = [row("main-rect-left-1", { startAt: lateEvent.startAt, endAt: "2026-10-27T04:00:00.000Z" })];
    const summary = summarizeEventSeating(lateEvent, reservations);
    expect(seatingCoverageMessage(lateEvent, summary)).toContain("2026-10-27, 12:00 AM–2026-10-27, 1:00 AM");
  });

  it("keeps fall-back elapsed coverage exact and labels repeated clock hours with their offset", () => {
    const fallback = { ...event, guestCount: 10, startAt: "2026-11-01T05:00:00Z", endAt: "2026-11-01T06:30:00Z" };
    const full = row("main-rect-left-1", { startAt: fallback.startAt, endAt: fallback.endAt });
    expect(summarizeEventSeating(fallback, [full]).fullEventCoverage).toBe(true);
    const shortened = { ...full, endAt: "2026-11-01T05:30:00Z" };
    const summary = summarizeEventSeating(fallback, [shortened]);
    expect(summary.gaps).toEqual([{ startAt: "2026-11-01T05:30:00.000Z", endAt: "2026-11-01T06:30:00.000Z", availableSeats: 0, missingSeats: 10 }]);
    expect(seatingCoverageMessage(fallback, summary)).toContain("1:30 AM EDT–1:30 AM EST");
  });
});
