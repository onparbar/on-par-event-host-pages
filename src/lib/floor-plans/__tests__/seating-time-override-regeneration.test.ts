import { describe, expect, it } from "vitest";
import { generateFloorPlanReservationProposal } from "../generator";
import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "../types";

const START = "2026-10-26T21:00:00.000Z";
const END = "2026-10-26T23:00:00.000Z";
const event = (id: string, contractedAreaIds = ["main-dining"], guestCount = 10): FloorPlanEvent => ({
  id, floorPlanId: "day", tripleseatEventId: id, name: id, status: "Definite", guestCount,
  startAt: START, endAt: END, contractedAreaIds, unresolvedAreaNames: [], color: "#18332F",
  beoLastModifiedAt: null, fullBuyout: false,
  source: { rooms: contractedAreaIds, food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
});
const row = (owner: FloorPlanEvent, areaId: string): FloorPlanReservation => ({
  id: `${owner.id}:${areaId}`, floorPlanEventId: owner.id, areaId, reservationType: "seating",
  startAt: "2026-10-26T20:00:00.000Z", endAt: "2026-10-27T00:00:00.000Z", label: "",
  source: "generated", lockedByUser: false, timingSource: "staff-override",
});
const plan = (events: FloorPlanEvent[], reservations: FloorPlanReservation[]): FloorPlanDocument => ({
  id: "day", eventDate: "2026-10-26", status: "Draft", version: 1, ruleVersion: "test",
  lastTripleseatSyncAt: null, createdAt: START, updatedAt: START, approvedAt: null, approvedBy: null,
  events, reservations,
});

describe("explicit seating timing is a regeneration constraint", () => {
  it("preserves an unlocked generated table after staff explicitly changed only its time", () => {
    const first = event("first");
    const explicit = row(first, "main-rect-left-1");
    const result = generateFloorPlanReservationProposal(plan([first], [explicit]), "replace-generated", first.id);
    expect(result.reservations).toContainEqual(explicit);
    expect(result.complete).toBe(true);
  });

  it("keeps the explicit hold fixed while trying a joint overlapping-party allocation", () => {
    const flexible = event("flexible", ["geg-tables", "main-dining"]);
    const restricted = event("restricted", ["geg-tables"], 20);
    const explicit = row(flexible, "ge-table-1");
    const result = generateFloorPlanReservationProposal(plan([flexible, restricted], [explicit]), "fill-missing");
    expect(result.reservations).toContainEqual(explicit);
    expect(result.complete).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "joint-reallocation" }));
  });

  it("retains the explicitly labeled reset workflow rather than preventing a requested reset", () => {
    const first = event("first");
    const explicit = row(first, "main-rect-left-1");
    const result = generateFloorPlanReservationProposal(plan([first], [explicit]), "reset-event", first.id);
    expect(result.reservations).not.toContainEqual(explicit);
    expect(result.complete).toBe(true);
  });
});
