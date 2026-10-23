import { describe, expect, it } from "vitest";
import { detectFloorPlanConflicts, floorPlanAreaTimeOverlap, timeRangesOverlap } from "../conflicts";
import { generateFloorPlanReservations } from "../generator";
import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "../types";

const START = "2026-10-21T17:00:00-04:00";
const END = "2026-10-21T18:00:00-04:00";
function event(id: string, startAt = START, endAt = END, fullBuyout = false): FloorPlanEvent {
  return {
    id, floorPlanId: "buffer-test", tripleseatEventId: id, name: `Redacted ${id}`,
    status: "Definite", guestCount: 20, startAt, endAt,
    contractedAreaIds: fullBuyout ? ["facility"] : ["geg-tables"],
    unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: START, fullBuyout,
    source: { rooms: [], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
  };
}
function reservation(owner: FloorPlanEvent, areaId: string): FloorPlanReservation {
  return { id: `${owner.id}:${areaId}`, floorPlanEventId: owner.id, areaId,
    reservationType: areaId === "facility" ? "room" : "seating",
    startAt: owner.startAt, endAt: owner.endAt, label: "", source: "generated", lockedByUser: false };
}
function plan(events: FloorPlanEvent[], reservations: FloorPlanReservation[] = []): FloorPlanDocument {
  return { id: "buffer-test", eventDate: "2026-10-21", status: "Draft", version: 1,
    ruleVersion: "buffer-test", lastTripleseatSyncAt: START, createdAt: START, updatedAt: START,
    approvedAt: null, approvedBy: null, events, reservations };
}

describe("floor-plan seating and facility seating occupancy buffers", () => {
  it.each([[89, true], [90, false]])("protects tables and the whole facility at a %i-minute gap (conflict=%s)", (gap, conflicts) => {
    const first = event("first");
    const start = new Date(Date.parse(END) + gap * 60_000).toISOString();
    const last = new Date(Date.parse(start) + 60 * 60_000).toISOString();
    const next = event("next", start, last);
    expect(detectFloorPlanConflicts(plan([first, next], [reservation(first, "ge-table-1"), reservation(next, "ge-table-1")]))).toHaveLength(conflicts ? 1 : 0);
    const buyout = { ...first, fullBuyout: true, contractedAreaIds: ["facility"] };
    expect(detectFloorPlanConflicts(plan([buyout, next], [reservation(buyout, "facility"), reservation(next, "ge-table-2")]))
      .some((conflict) => conflict.areaId === "facility")).toBe(conflicts);
    const generated = generateFloorPlanReservations(plan([first, next]), "fill-missing");
    expect(generated.filter((item) => item.floorPlanEventId === "next" && item.reservationType === "seating")).toHaveLength(conflicts ? 0 : 2);
    expect(first).toMatchObject({ startAt: START, endAt: END });
    expect(next).toMatchObject({ startAt: start, endAt: last });
  });

  it("keeps distinct physical tables and raw identity overlap independent of setup buffers", () => {
    const first = event("first");
    const next = event("next", END, "2026-10-21T19:00:00-04:00");
    expect(detectFloorPlanConflicts(plan([first, next], [reservation(first, "ge-table-1"), reservation(next, "ge-table-2")]))).toEqual([]);
    expect(timeRangesOverlap(first.startAt, first.endAt, next.startAt, next.endAt)).toBe(false);
  });

  it.each(["vip-1", "vip-2", "big-show-karaoke", "ge-table-1", "main-rect-left-1"])("keeps seating protection for %s", (areaId) => {
    const first = event("first");
    const next = event("next", END, "2026-10-21T19:00:00-04:00");
    expect(detectFloorPlanConflicts(plan([first, next], [reservation(first, areaId), reservation(next, areaId)]))).toHaveLength(1);
  });

  it.each(["disco-room", "prime-room", "royal-room", "gem-room", "ocean-room", "bowling-1", "darts-1", "pool-1", "shuffleboard-1"])("allows back-to-back entertainment on the floor plan: %s", (areaId) => {
    const first = event("first");
    const next = event("next", END, "2026-10-21T19:00:00-04:00");
    expect(detectFloorPlanConflicts(plan([first, next], [reservation(first, areaId), reservation(next, areaId)]))).toEqual([]);
    expect(floorPlanAreaTimeOverlap(areaId, START, END, "2026-10-21T17:59:00-04:00", next.endAt)).toEqual({ startAt: "2026-10-21T21:59:00.000Z", endAt: "2026-10-21T22:00:00.000Z" });
  });

  it("does not extend a buyout's entertainment lock beyond contracted hours", () => {
    const buyout = event("buyout", START, END, true);
    const next = event("next", END, "2026-10-21T19:00:00-04:00");
    expect(detectFloorPlanConflicts(plan([buyout, next], [reservation(buyout, "facility"), reservation(next, "prime-room")]))).toEqual([]);
    expect(detectFloorPlanConflicts(plan([buyout, next], [reservation(buyout, "facility"), reservation(next, "prime-room"), reservation(next, "ge-table-1")]))).toContainEqual(expect.objectContaining({ areaId: "facility" }));
  });

  it.each([[END, START], ["2026-10-21T17:00:00", END], ["bad-time", END], [null, END]])("leaves invalid entertainment intervals unresolved (%s, %s)", (startAt, endAt) => {
    expect(floorPlanAreaTimeOverlap("prime-room", startAt, endAt, START, END)).toBeNull();
  });

  it("uses the event interval for the whole-building lock even if another reservation has narrower hours", () => {
    const buyout = event("buyout", START, END, true);
    const next = event("next", "2026-10-21T19:29:00-04:00", "2026-10-21T22:00:00-04:00");
    const narrow = { ...reservation(next, "ge-table-1"), startAt: "2026-10-21T21:00:00-04:00" };
    expect(detectFloorPlanConflicts(plan([buyout, next], [reservation(buyout, "facility"), narrow]))).toContainEqual(expect.objectContaining({
      areaId: "facility", startAt: "2026-10-21T22:29:00.000Z", endAt: "2026-10-21T22:30:00.000Z",
    }));
  });
});
