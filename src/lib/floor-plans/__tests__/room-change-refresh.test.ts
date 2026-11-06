import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import type { TripleseatEventPlanSource } from "@/lib/event-plans/types";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { setTripleseatAdapterForTests } from "@/lib/kitchen/tripleseat";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { VipPrepClient } from "@/lib/vip-prep/client";
import { getFloorPlanArea } from "../configuration/areas";
import { floorPlanAreaTimeOverlap } from "../conflicts";
import { generateFloorPlan, refreshFloorPlanSources, saveFloorPlanEdits } from "../service";
import { summarizeEventSeating } from "../seating-summary";
import * as floorPlanStorage from "../storage";
import type { FloorPlanDocument } from "../types";

const DATE = "2026-11-24";
const START = `${DATE}T17:00:00-05:00`;
const END = `${DATE}T19:00:00-05:00`;
const EVENT_ID = "94010001";
const OTHER_ID = "94010002";

function source(id = EVENT_ID, overrides: Partial<TripleseatEventPlanSource> = {}): TripleseatEventPlanSource {
  return {
    eventId: id, bookingId: `${id}-booking`, eventName: `Redacted room-change event ${id}`,
    localDate: DATE, eventStartAt: START, eventEndAt: END, guestCount: 30,
    status: "DEFINITE", rooms: ["Main Dining"], selections: [], documentItems: [],
    operationalNotes: [], sourceUpdatedAt: `${DATE}T12:00:00Z`, ...overrides,
  };
}

function setup(initial: TripleseatEventPlanSource[]) {
  let sources = initial;
  const storage = new floorPlanStorage.MemoryFloorPlanStorage();
  vi.spyOn(floorPlanStorage, "getFloorPlanStorage").mockReturnValue(storage);
  setTripleseatAdapterForTests({
    sourceMode: "live",
    fetchEventsForDate: async () => [],
    fetchEventPlansForRange: async () => structuredClone(sources),
    fetchEntertainmentEventsForDate: async () => [],
    fetchEventDateById: async () => DATE,
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
  });
  return { storage, update: (next: TripleseatEventPlanSource[]) => { sources = next; } };
}

function reservationsFor(plan: FloorPlanDocument, tripleseatEventId = EVENT_ID) {
  const event = plan.events.find((candidate) => candidate.tripleseatEventId === tripleseatEventId)!;
  return plan.reservations.filter((row) => row.floorPlanEventId === event.id);
}

beforeEach(() => {
  setEventPlanStorageForTests(createMemoryEventPlanStorage());
  setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
  setKitchenStorageForTests(createMemoryKitchenStorage());
  vi.spyOn(VipPrepClient.prototype, "configured", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network call in room-change regression.")));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setEventPlanStorageForTests(null);
  setEntertainmentStorageForTests(null);
  setKitchenStorageForTests(null);
  setTripleseatAdapterForTests(null);
});

describe("Tripleseat contracted-room changes during Refresh", () => {
  it.each([30, 44])("moves generated seating and food to VIP 1 for %i guests without another Generate action", async (guestCount) => {
    const other = source(OTHER_ID, { rooms: ["VIP 2"], guestCount: 16 });
    const { storage, update } = setup([source(undefined, { guestCount }), other]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const oldAssignments = reservationsFor(initial.plan);
    const untouchedParty = structuredClone(reservationsFor(initial.plan, OTHER_ID));
    expect(oldAssignments.some((row) => row.reservationType === "seating")).toBe(true);
    expect(oldAssignments.some((row) => row.reservationType === "food-table")).toBe(true);

    update([source(undefined, { rooms: ["VIP 1"], guestCount, sourceUpdatedAt: `${DATE}T13:00:00Z` }), other]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    const event = refreshed.plan.events.find((candidate) => candidate.tripleseatEventId === EVENT_ID)!;
    const assignments = reservationsFor(refreshed.plan);

    expect(event.contractedAreaIds).toEqual(["vip-1"]);
    expect(assignments).toContainEqual(expect.objectContaining({ areaId: "vip-1", reservationType: "room" }));
    expect(assignments).toContainEqual(expect.objectContaining({ areaId: "vip1-food-table", reservationType: "food-table", label: "F" }));
    expect(assignments.every((row) => {
      const area = getFloorPlanArea(row.areaId);
      return area?.id === "vip-1" || area?.parentAreaId === "vip-1";
    })).toBe(true);
    expect(oldAssignments.every((old) => !assignments.some((row) => row.id === old.id))).toBe(true);
    expect(summarizeEventSeating(event, assignments, { allReservations: refreshed.plan.reservations })).toMatchObject({
      fullEventCoverage: true, seatsNeeded: 0, foodAssigned: 1, foodRequired: 1,
    });
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ eventId: event.id, code: "SEATING_CAPACITY", status: "Passed" }));
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ eventId: event.id, code: "FOOD_TABLE", status: "Passed" }));
    expect(reservationsFor(refreshed.plan, OTHER_ID)).toEqual(untouchedParty);
    expect((await storage.get(DATE))?.reservations).toEqual(refreshed.plan.reservations);
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ eventId: event.id, field: "contractedArea" }));

    const repeated = await refreshFloorPlanSources(DATE, storage, refreshed.plan.version);
    expect(repeated.plan.reservations).toEqual(refreshed.plan.reservations);
    expect(new Set(repeated.plan.reservations.map((row) => row.id)).size).toBe(repeated.plan.reservations.length);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the other party's occupied VIP room and marks an impossible room move for review", async () => {
    const other = source(OTHER_ID, { rooms: ["VIP 1"], guestCount: 20 });
    const { storage, update } = setup([source(undefined, { guestCount: 70 }), other]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const occupied = structuredClone(reservationsFor(initial.plan, OTHER_ID));
    expect(occupied).toContainEqual(expect.objectContaining({ areaId: "vip-1", reservationType: "room" }));

    update([source(undefined, { rooms: ["VIP 1"], guestCount: 70, sourceUpdatedAt: `${DATE}T13:00:00Z` }), other]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    const event = refreshed.plan.events.find((candidate) => candidate.tripleseatEventId === EVENT_ID)!;

    expect(reservationsFor(refreshed.plan, OTHER_ID)).toEqual(occupied);
    expect(reservationsFor(refreshed.plan).some((row) => row.areaId === "vip-1")).toBe(false);
    expect(refreshed.plan.status).toBe("Needs Review");
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ eventId: event.id, code: "SEATING_CAPACITY", status: "Failed", blocking: true }));
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ eventId: event.id, field: "assignments" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["manual", "locked"] as const)("preserves a %s staff placement outside the new room and flags it", async (choice) => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const selected = reservationsFor(initial.plan).find((row) => row.reservationType === "seating")!;
    const saved = await saveFloorPlanEdits(DATE, {
      ...initial.plan,
      reservations: initial.plan.reservations.map((row) => row.id !== selected.id ? row : choice === "manual"
        ? { ...row, areaId: "main-round-right" }
        : { ...row, lockedByUser: true }),
    }, storage);
    const protectedAssignment = saved.plan.reservations.find((row) => row.id === selected.id)!;
    expect(protectedAssignment).toMatchObject(choice === "manual" ? { source: "manual", placementOverride: true } : { lockedByUser: true });

    update([source(undefined, { rooms: ["VIP 1"], sourceUpdatedAt: `${DATE}T13:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, saved.plan.version);
    const event = refreshed.plan.events.find((candidate) => candidate.tripleseatEventId === EVENT_ID)!;

    expect(refreshed.plan.reservations).toContainEqual(protectedAssignment);
    expect(refreshed.plan.status).toBe("Needs Review");
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ eventId: event.id, code: "SEATING_LOCATION", status: "Failed", blocking: true }));
    expect(reservationsFor(refreshed.plan)).toContainEqual(expect.objectContaining({ areaId: "vip1-food-table", reservationType: "food-table" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps raw contract times while applying one-hour setup and thirty-minute cleanup only to seating", async () => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    update([source(undefined, { rooms: ["VIP 1"], sourceUpdatedAt: `${DATE}T13:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    const couch = reservationsFor(refreshed.plan).find((row) => row.areaId === "vip-1")!;

    expect(couch).toMatchObject({ startAt: START, endAt: END, timingSource: "event-default" });
    expect(reservationOccupancy(couch.startAt, couch.endAt)).toEqual({
      startAt: `${DATE}T21:00:00.000Z`, endAt: "2026-11-25T00:30:00.000Z",
    });
    expect(floorPlanAreaTimeOverlap("vip-1", couch.startAt, couch.endAt, `${DATE}T20:29:00-05:00`, `${DATE}T21:29:00-05:00`)).not.toBeNull();
    expect(floorPlanAreaTimeOverlap("vip-1", couch.startAt, couch.endAt, `${DATE}T20:30:00-05:00`, `${DATE}T21:30:00-05:00`)).toBeNull();
    expect(floorPlanAreaTimeOverlap("bowling-1", START, END, END, `${DATE}T20:00:00-05:00`)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates approval after replacing generated room assignments without changing staff approval evidence", async () => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const approved = await storage.save({ ...initial.plan, status: "Approved", approvedAt: `${DATE}T13:00:00Z`, approvedBy: "Redacted staff" }, "Approved fixture.");
    update([source(undefined, { rooms: ["VIP 1"], sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, approved.version);
    expect(refreshed.plan).toMatchObject({ status: "Updated After Approval", approvedAt: approved.approvedAt, approvedBy: approved.approvedBy });
    expect(reservationsFor(refreshed.plan)).toContainEqual(expect.objectContaining({ areaId: "vip1-food-table", reservationType: "food-table" }));
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: true }));
  });

  it.each(["Main Dining", "VIP 1"])("repairs an already-refreshed stale %s setup on the next successful refresh", async (oldRoom) => {
    const { storage, update } = setup([source(undefined, { rooms: [oldRoom] })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const target = initial.plan.events[0];
    const stale = await storage.save({ ...initial.plan, events: [{ ...target, contractedAreaIds: ["vip-2"], source: {
      ...target.source, rooms: ["VIP 2"], floorPlanChanges: [{ eventId: target.id, field: "contractedArea", previousValue: oldRoom,
        currentValue: "VIP 2", message: "Historical refresh kept the old generated assignments." }],
    } }], reservations: [...initial.plan.reservations, ...(oldRoom === "Main Dining" ? [{ id: "legacy-old-section", floorPlanEventId: target.id,
      areaId: "main-dining", reservationType: "room" as const, startAt: START, endAt: END, label: "MAIN DINING", source: "generated" as const, lockedByUser: false }] : [])] }, "Seed old refresh behavior.");
    update([source(undefined, { rooms: ["VIP 2"], sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, stale.version);
    const assignments = reservationsFor(refreshed.plan);
    expect(assignments).toContainEqual(expect.objectContaining({ areaId: "vip-2", reservationType: "room" }));
    expect(assignments).toContainEqual(expect.objectContaining({ areaId: "vip2-food-table", reservationType: "food-table" }));
    expect(assignments.every((row) => getFloorPlanArea(row.areaId)?.id === "vip-2" || getFloorPlanArea(row.areaId)?.parentAreaId === "vip-2")).toBe(true);
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: true }));
    const repeated = await refreshFloorPlanSources(DATE, storage, refreshed.plan.version);
    expect(repeated.plan.reservations).toEqual(assignments);
  });

  it("retries an unresolved move after the new room becomes available", async () => {
    const other = source(OTHER_ID, { rooms: ["VIP 1"], guestCount: 20 });
    const { storage, update } = setup([source(undefined, { guestCount: 70 }), other]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    update([source(undefined, { rooms: ["VIP 1"], guestCount: 70, sourceUpdatedAt: `${DATE}T13:00:00Z` }), other]);
    const blocked = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    expect(reservationsFor(blocked.plan)).toEqual(reservationsFor(initial.plan));
    expect(blocked.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: false }));
    update([source(undefined, { rooms: ["VIP 1"], guestCount: 44, sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    const repaired = await refreshFloorPlanSources(DATE, storage, blocked.plan.version);
    const event = repaired.plan.events.find((entry) => entry.tripleseatEventId === EVENT_ID)!;
    expect(summarizeEventSeating(event, repaired.plan.reservations)).toMatchObject({ fullEventCoverage: true, foodAssigned: 1 });
    expect(repaired.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: true }));
    expect(repaired.plan.reservations.some((row) => getFloorPlanArea(row.areaId)?.parentAreaId === "main-dining")).toBe(false);
  });

  it("does not guess an allocation for an unmapped room or replace saved assignments", async () => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    update([source(undefined, { rooms: ["Unmapped venue section"], sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    expect(reservationsFor(refreshed.plan)).toEqual(reservationsFor(initial.plan));
    expect(refreshed.plan.status).toBe("Needs Review");
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ code: "CONTRACTED_AREA", status: "Failed", blocking: true }));
  });

  it("rejects a stale refresh version without overwriting the newer saved layout", async () => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const newer = await storage.save({ ...initial.plan, reservations: initial.plan.reservations.map((row, index) => index === 0 ? { ...row, label: "Newer staff change" } : row) }, "Another tablet saved.");
    update([source(undefined, { rooms: ["VIP 1"], sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    await expect(refreshFloorPlanSources(DATE, storage, initial.plan.version)).rejects.toMatchObject({ status: 409 });
    expect(await storage.get(DATE)).toEqual(newer);
  });

  it("keeps an ambiguous room change unresolved even when a generated couch and protected food table could satisfy the counts", async () => {
    const { storage, update } = setup([source(undefined, { guestCount: 10 })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const saved = await saveFloorPlanEdits(DATE, { ...initial.plan, reservations: initial.plan.reservations.map((row) =>
      row.reservationType === "food-table" ? { ...row, areaId: "vip1-food-table", lockedByUser: true } : row) }, storage);
    update([source(undefined, { guestCount: 10, rooms: ["VIP 1", "Unmapped venue section"], sourceUpdatedAt: `${DATE}T14:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, saved.plan.version);
    expect(reservationsFor(refreshed.plan)).toEqual(reservationsFor(saved.plan));
    expect(refreshed.plan.status).toBe("Needs Review");
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: false }));
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ code: "CONTRACTED_AREA", status: "Failed", blocking: true }));
  });

  it.each([["Main Dining", "main-dining"], ["VIP 2", "vip-2"]])("reallocates a fresh VIP 1 contract move to %s", async (room, areaId) => {
    const { storage, update } = setup([source(undefined, { rooms: ["VIP 1"] })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const previousAssignments = reservationsFor(initial.plan);
    expect(previousAssignments).toContainEqual(expect.objectContaining({ areaId: "vip-1", reservationType: "room" }));

    update([source(undefined, { rooms: [room], sourceUpdatedAt: `${DATE}T13:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);
    const event = refreshed.plan.events.find((candidate) => candidate.tripleseatEventId === EVENT_ID)!;
    const assignments = reservationsFor(refreshed.plan);

    expect(event.contractedAreaIds).toEqual([areaId]);
    expect(assignments.every((row) => {
      const area = getFloorPlanArea(row.areaId);
      return area?.id === areaId || area?.parentAreaId === areaId;
    })).toBe(true);
    expect(assignments.some((row) => row.reservationType === "food-table" && row.label === "F")).toBe(true);
    expect(previousAssignments.every((old) => !assignments.some((row) => row.id === old.id))).toBe(true);
    expect(summarizeEventSeating(event, assignments, { allReservations: refreshed.plan.reservations })).toMatchObject({
      fullEventCoverage: true, seatsNeeded: 0, foodAssigned: 1, foodRequired: 1,
    });
    expect(refreshed.sourceChanges).toContainEqual(expect.objectContaining({ field: "contractedArea", assignmentsReconciled: true }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { label: "equivalent room aliases", before: ["VIP 1"], after: ["VIP Section 1"] },
    { label: "room-order-only updates", before: ["VIP 1", "Main Dining"], after: ["Main Dining", "VIP 1"] },
  ])("does not reflow generated assignments for $label", async ({ before, after }) => {
    const { storage, update } = setup([source(undefined, { rooms: before })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const previousAssignments = structuredClone(initial.plan.reservations);

    update([source(undefined, { rooms: after, sourceUpdatedAt: `${DATE}T13:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, initial.plan.version);

    expect(refreshed.plan.reservations).toEqual(previousAssignments);
    expect(refreshed.plan.events[0].source.rooms).toEqual(after);
    expect(refreshed.sourceChanges?.some((change) => change.field === "contractedArea" || change.field === "assignments")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves explicit timing, placement overrides and custom geometry while changing generated room setup", async () => {
    const { storage, update } = setup([source()]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const seats = reservationsFor(initial.plan).filter((row) => row.reservationType === "seating");
    const timing = { ...seats[0], timingSource: "staff-override" as const,
      startAt: `${DATE}T16:30:00-05:00`, endAt: `${DATE}T19:30:00-05:00` };
    const placement = { ...seats[1], placementOverride: true };
    const overlay = { ...seats[2], id: "staff-custom-overlay", reservationType: "custom" as const,
      customGeometry: { x: 1085, y: 745, width: 140, height: 45 }, label: "Staff setup note" };
    const saved = await storage.save({ ...initial.plan, reservations: [
      ...initial.plan.reservations.filter((row) => row.id !== timing.id && row.id !== placement.id), timing, placement, overlay,
    ] }, "Seed independent timing, placement and custom overlay evidence.");

    update([source(undefined, { rooms: ["VIP 1"], sourceUpdatedAt: `${DATE}T13:00:00Z` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage, saved.version);

    expect(refreshed.plan.reservations).toEqual(expect.arrayContaining([timing, placement, overlay]));
    expect(reservationsFor(refreshed.plan)).toContainEqual(expect.objectContaining({ areaId: "vip-1", reservationType: "room" }));
    expect(reservationsFor(refreshed.plan)).toContainEqual(expect.objectContaining({ areaId: "vip1-food-table", reservationType: "food-table" }));
    expect(refreshed.plan.status).toBe("Needs Review");
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ code: "SEATING_LOCATION", status: "Failed", blocking: true }));
    expect(fetch).not.toHaveBeenCalled();
  });
});
