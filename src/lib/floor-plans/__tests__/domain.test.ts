import { describe, expect, it } from "vitest";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import {
  resolveAreaAlias,
  resolveEntertainmentAlias,
} from "../configuration/aliases";
import {
  getFloorPlanArea,
  getPhysicalFloorPlanAreaId,
  DISPLAY_AREAS,
  seatingTablesForArea,
} from "../configuration/areas";
import { selectEntertainmentResources } from "../configuration/adjacency";
import { detectFloorPlanConflicts } from "../conflicts";
import { buildFloorPlanExportModel } from "../export";
import {
  generateFloorPlanReservations,
  reservedSeatingCapacity,
  seatingCapacity,
  selectSmallestTableCombination,
} from "../generator";
import { floorPlanStatusAfterSourceChange } from "../lifecycle";
import type {
  FloorPlanArea,
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanReservation,
} from "../types";
import {
  hasBlockingValidationFailures,
  validateFloorPlan,
} from "../validator";

const START = "2026-08-06T22:00:00.000Z";
const END = "2026-08-07T01:00:00.000Z";

function floorPlanEvent(
  overrides: Partial<FloorPlanEvent> = {},
): FloorPlanEvent {
  return {
    id: "floor-plan-event-1",
    floorPlanId: "floor-plan-2026-08-06",
    tripleseatEventId: "1",
    name: "Test Event",
    status: "Definite",
    guestCount: 20,
    startAt: START,
    endAt: END,
    contractedAreaIds: ["main-dining"],
    unresolvedAreaNames: [],
    color: "#0F766E",
    beoLastModifiedAt: "2026-08-01T12:00:00.000Z",
    fullBuyout: false,
    source: {
      rooms: ["Main Dining Room"],
      food: [],
      entertainment: [],
      operationalNotes: [],
      reviewReasons: [],
    },
    ...overrides,
  };
}

function plan(
  events: FloorPlanEvent[] = [floorPlanEvent()],
  reservations: FloorPlanReservation[] = [],
): FloorPlanDocument {
  return {
    id: "floor-plan-2026-08-06",
    eventDate: "2026-08-06",
    status: "Draft",
    version: 1,
    ruleVersion: "floor-plan-v1.0.0",
    lastTripleseatSyncAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    events,
    reservations,
  };
}

function table(
  id: string,
  type: "rectangle-table" | "square-table",
  x: number,
): FloorPlanArea {
  return {
    id,
    name: id,
    shortLabel: "",
    type,
    capacity: type === "rectangle-table" ? 10 : 4,
    parentAreaId: "test",
    x,
    y: 0,
    width: 20,
    height: 20,
    isAda: false,
    canBeFoodTable: false,
    isReservable: true,
    isMovable: false,
  };
}

function reservation(
  event: FloorPlanEvent,
  areaId: string,
  startAt = event.startAt,
  endAt = event.endAt,
): FloorPlanReservation {
  return {
    id: `${event.id}:${areaId}`,
    floorPlanEventId: event.id,
    areaId,
    reservationType: "seating",
    startAt,
    endAt,
    label: "",
    source: "manual",
    lockedByUser: true,
  };
}

function entertainmentReservation(
  overrides: Partial<EntertainmentReservation> = {},
): EntertainmentReservation {
  return {
    id: "ent-1",
    syncKey: null,
    localEventId: "1",
    tripleseatEventId: "1",
    tripleseatBookingId: null,
    eventName: "Test Event",
    operatingDate: "2026-08-06",
    resourceId: "mini-golf-level-up",
    resourceCategory: "mini-golf",
    resourceName: "Level Up Mini Golf",
    startAt: START,
    endAt: END,
    sourceStartAt: START,
    sourceEndAt: END,
    sourceResourceId: "mini-golf-level-up",
    eventColor: "#0F766E",
    colorSource: "manual",
    source: "manual",
    sourceReference: null,
    manualOverride: true,
    hasSourceUpdate: false,
    needsReview: false,
    reviewIssues: [],
    autoAssigned: false,
    notes: "",
    sourceUpdatedAt: null,
    lastTripleseatSyncAt: null,
    active: true,
    createdAt: START,
    updatedAt: START,
    updatedBy: "test",
    ...overrides,
  };
}

describe("floor-plan capacities and generation", () => {
  it("keeps corrected highlights on tabletop bounds and renders food aliases once", () => {
    expect(getFloorPlanArea("wat-table-1")).toMatchObject({ x: 919, y: 423, width: 56, height: 22 });
    expect(getFloorPlanArea("vip1-extra-front-3")).toMatchObject({ x: 1050, y: 454, width: 19, height: 48 });
    for (const [alias, canonical] of [["main-food-1", "main-rect-left-4"], ["main-food-2", "main-rect-right-3"], ["ge-food-table", "ge-table-3"]]) {
      const surface = getFloorPlanArea(canonical)!;
      expect(getPhysicalFloorPlanAreaId(alias)).toBe(canonical);
      expect(getFloorPlanArea(alias)).toMatchObject({ x: surface.x, y: surface.y, width: surface.width, height: surface.height });
      expect(DISPLAY_AREAS.some((area) => area.id === canonical)).toBe(true);
      expect(DISPLAY_AREAS.some((area) => area.id === alias)).toBe(false);
    }
  });

  it.each(["ge-table-1", "ge-table-2", "ge-table-3"])("allows %s to serve food without counting it as guest seating", (areaId) => {
    expect(getFloorPlanArea(areaId)).toMatchObject({ capacity: 10, canBeFoodTable: true, isAda: false });
    const event = floorPlanEvent({ contractedAreaIds: ["geg-tables"], guestCount: 20 });
    const food: FloorPlanReservation = { ...reservation(event, areaId), reservationType: "food-table", label: "F" };
    const document = plan([event], [food]);
    document.reservations = generateFloorPlanReservations(document, "replace-generated");

    expect(document.reservations).toContainEqual(food);
    expect(document.reservations.filter((item) => item.reservationType === "food-table")).toEqual([food]);
    expect(document.reservations.filter((item) => item.reservationType === "seating")).toHaveLength(2);
    expect(document.reservations.some((item) => item.areaId === areaId && item.reservationType === "seating")).toBe(false);
    expect(reservedSeatingCapacity(document.reservations)).toBe(20);
    expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({ code: "FOOD_TABLE", status: "Passed" }));
    expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({ code: "FOOD_TABLE_ADA", status: "Warning", blocking: false }));
  });

  it("does not count one physical table as both food and seating", () => {
    const event = floorPlanEvent({ guestCount: 10 });
    const document = plan([event], [
      reservation(event, "main-rect-left-4"),
      { ...reservation(event, "main-food-1"), reservationType: "food-table", label: "F" },
    ]);

    expect(reservedSeatingCapacity(document.reservations)).toBe(0);
    expect(detectFloorPlanConflicts(document)).toContainEqual(expect.objectContaining({ areaId: "main-rect-left-4", blocking: true }));
    expect(validateFloorPlan(document, [], detectFloorPlanConflicts(document), [])).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Failed" }));
  });

  it("does not use aliases of the same food table to satisfy a mirrored setup", () => {
    const event = floorPlanEvent({ guestCount: 150 });
    const document = plan([event], ["main-food-1", "main-rect-left-4"].map((areaId) => ({
      ...reservation(event, areaId), reservationType: "food-table" as const, label: "F",
    })));

    expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({ code: "FOOD_TABLE", status: "Failed", message: expect.stringContaining("1 assigned") }));
  });

  it.each([true, false])("checks physical food/seating aliases across parties with overlap=%s", (overlap) => {
    const first = floorPlanEvent({ guestCount: 10 });
    const second = floorPlanEvent({ id: "second", tripleseatEventId: "second", guestCount: 10,
      startAt: overlap ? START : "2026-08-07T02:30:00.000Z", endAt: "2026-08-07T04:00:00.000Z" });
    const document = plan([first, second], [
      { ...reservation(first, "main-food-1"), reservationType: "food-table", label: "F" },
      reservation(second, "main-rect-left-4"),
    ]);

    expect(detectFloorPlanConflicts(document)).toHaveLength(overlap ? 1 : 0);
  });

  it("keeps a saved seating assignment and chooses a different physical food table", () => {
    const event = floorPlanEvent({ guestCount: 10 });
    const seat = reservation(event, "main-rect-left-4");
    const generated = generateFloorPlanReservations(plan([event], [seat]), "replace-generated");

    expect(generated).toContainEqual(seat);
    expect(generated.filter((item) => item.reservationType === "food-table").map((item) => item.areaId)).toEqual(["main-food-2"]);
    expect(reservedSeatingCapacity(generated)).toBe(10);
  });

  it("counts venue rectangle tables as 10 seats", () => {
    expect(getFloorPlanArea("main-rect-left-1")?.capacity).toBe(10);
  });

  it("counts square tables as 4 seats", () => {
    expect(getFloorPlanArea("level-up-square-1")?.capacity).toBe(4);
  });

  it("counts only documented VIP and conversation capacities, not unknown furniture", () => {
    expect(getFloorPlanArea("vip-1")?.capacity).toBe(20);
    expect(getFloorPlanArea("vip-2")?.capacity).toBe(20);
    expect(getFloorPlanArea("vip1-conversation-wall")?.capacity).toBe(10);
    expect(getFloorPlanArea("main-convo-1")?.capacity).toBe(10);
    expect(getFloorPlanArea("main-convo-2")?.capacity).toBe(10);
    expect(getFloorPlanArea("vip1-extra-convo")?.capacity).toBe(0);
    expect(getFloorPlanArea("big-show-karaoke")?.capacity).toBe(0);
  });

  it.each([[0, 0], [1, 1], [10, 1], [11, 2], [20, 2], [21, 3], [30, 3], [31, 0]])(
    "selects the minimum GEG table group for %i guests",
    (guestCount, count) => {
      const selected = selectSmallestTableCombination(seatingTablesForArea("geg-tables"), guestCount);
      expect(selected).toHaveLength(count);
      if (count > 0) expect(seatingCapacity(selected)).toBeGreaterThanOrEqual(guestCount);
    },
  );

  it.each([[4, 1], [5, 2], [24, 6], [25, 0]])(
    "applies four-seat square-table boundaries for %i guests",
    (guestCount, count) => {
      expect(selectSmallestTableCombination(seatingTablesForArea("level-up-seating"), guestCount)).toHaveLength(count);
    },
  );

  it("selects the smallest contiguous combination that meets the guest count", () => {
    const selected = selectSmallestTableCombination(
      [table("r1", "rectangle-table", 0), table("r2", "rectangle-table", 30), table("s1", "square-table", 60)],
      24,
    );
    expect(seatingCapacity(selected)).toBe(24);
    expect(selected.map((item) => item.id)).toEqual(["r1", "r2", "s1"]);
  });

  it("prioritizes food access over a farther exact-capacity table", () => {
    const food = table("food", "rectangle-table", 0);
    const nearest = table("nearby-rectangle", "rectangle-table", 20);
    const exact = table("distant-square", "square-table", 200);

    expect(selectSmallestTableCombination([exact, nearest], 4, [], [food])).toEqual([nearest]);
    expect(selectSmallestTableCombination([exact, nearest], 4)).toEqual([exact]);
  });

  it("keeps the entire required seating group close to food", () => {
    const near = [table("square-1", "square-table", 0), table("square-2", "square-table", 20)];
    const distant = table("rectangle", "rectangle-table", 100);

    expect(selectSmallestTableCombination([...near, distant], 8, [], [table("food", "rectangle-table", 0)])).toEqual(near);
  });

  it("uses the nearest of multiple food tables regardless of their order", () => {
    const food = [table("food-1", "rectangle-table", 0), table("food-2", "rectangle-table", 300)];
    const nearest = table("beside-food-2", "rectangle-table", 310);
    const middle = table("between-food-tables", "rectangle-table", 150);

    expect(selectSmallestTableCombination([middle, nearest], 10, [], food)).toEqual([nearest]);
    expect(selectSmallestTableCombination([middle, nearest], 10, [], [...food].reverse())).toEqual([nearest]);
  });

  it.each([1, 4, 5, 9, 10])("seats a Main Dining party of %i beside its food table", (guestCount) => {
    const generated = generateFloorPlanReservations(plan([floorPlanEvent({ guestCount })]), "fill-missing");

    expect(generated.filter((item) => item.reservationType === "seating").map((item) => item.areaId)).toEqual(["main-rect-left-3"]);
    expect(generated.filter((item) => item.reservationType === "food-table").map((item) => item.areaId)).toEqual(["main-food-1"]);
    expect(reservedSeatingCapacity(generated)).toBe(10);
  });

  it("anchors new seats to the staff-selected food table", () => {
    const event = floorPlanEvent({ guestCount: 10 });
    const food: FloorPlanReservation = { ...reservation(event, "main-food-2"), reservationType: "food-table", label: "F" };
    const generated = generateFloorPlanReservations(plan([event], [food]), "replace-generated");

    expect(generated).toContainEqual(food);
    expect(generated.filter((item) => item.reservationType === "seating").map((item) => item.areaId)).toEqual(["main-rect-right-2"]);
  });

  it.each([true, false])("uses the nearest available food-side table when another party overlaps=%s", (overlap) => {
    const first = floorPlanEvent({ guestCount: 10 });
    const second = floorPlanEvent({
      id: "second", tripleseatEventId: "second", guestCount: 10,
      startAt: overlap ? START : "2026-08-07T02:30:00.000Z", endAt: "2026-08-07T04:00:00.000Z",
    });
    const manualSeat = reservation(first, "main-rect-left-3");
    const manualFood: FloorPlanReservation = { ...reservation(first, "main-food-2"), reservationType: "food-table", label: "F" };
    const generated = generateFloorPlanReservations(plan([first, second], [manualSeat, manualFood]), "replace-generated");

    expect(generated).toContainEqual(manualSeat);
    expect(generated).toContainEqual(manualFood);
    expect(generated.filter((item) => item.floorPlanEventId === second.id && item.reservationType === "seating")
      .map((item) => item.areaId)).toEqual([overlap ? "main-rect-left-2" : "main-rect-left-3"]);
  });

  it("reserves no insufficient substitute when the mapped inventory is short", () => {
    const selected = selectSmallestTableCombination(
      [
        { ...table("r1", "rectangle-table", 0), capacity: 8 },
        { ...table("r2", "rectangle-table", 30), capacity: 8 },
      ],
      20,
    );

    expect(selected).toEqual([]);
  });

  it("generates seating that meets or exceeds the guest count", () => {
    const source = plan();
    const generated = generateFloorPlanReservations(source, "fill-missing");
    const tables = generated
      .filter((item) => item.reservationType === "seating")
      .map((item) => getFloorPlanArea(item.areaId)!)
      .filter(Boolean);
    expect(seatingCapacity(tables)).toBeGreaterThanOrEqual(20);
  });

  it("blocks a contracted capacity shortage without highlighting insufficient substitute tables", () => {
    const event = floorPlanEvent({ contractedAreaIds: ["geg-tables"], guestCount: 31 });
    const document = plan([event]);
    document.reservations = generateFloorPlanReservations(document, "fill-missing");
    expect(document.reservations.filter((item) => item.reservationType === "seating")).toEqual([]);
    expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({
      code: "SEATING_CAPACITY", eventId: event.id, status: "Failed", blocking: true,
    }));
  });

  it("does not invent dining tables for The Big Show or borrow Main Dining", () => {
    const document = plan([floorPlanEvent({ contractedAreaIds: ["big-show-karaoke"], guestCount: 50 })]);
    document.reservations = generateFloorPlanReservations(document, "fill-missing");
    expect(document.reservations).toContainEqual(expect.objectContaining({ areaId: "big-show-karaoke", reservationType: "room" }));
    expect(document.reservations.some((item) => item.areaId.startsWith("main-"))).toBe(false);
    expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Failed" }));
  });

  it("never counts the same saved seating object twice", () => {
    const event = floorPlanEvent();
    const saved = reservation(event, "main-rect-left-1");
    expect(reservedSeatingCapacity([saved, { ...saved, id: "duplicate" }])).toBe(10);
  });

  it.each([true, false])("checks time overlap when allocating tables (overlap=%s)", (overlap) => {
    const first = floorPlanEvent({ contractedAreaIds: ["geg-tables"] });
    const second = floorPlanEvent({
      id: "second", tripleseatEventId: "second", contractedAreaIds: ["geg-tables"],
      startAt: overlap ? START : "2026-08-07T02:30:00.000Z", endAt: "2026-08-07T04:00:00.000Z",
    });
    const generated = generateFloorPlanReservations(plan([first, second]), "fill-missing");
    const secondTables = generated.filter((item) => item.floorPlanEventId === second.id && item.reservationType === "seating");
    expect(secondTables).toHaveLength(overlap ? 0 : 2);
  });

  it("keeps generated seating inside the contracted area", () => {
    const generated = generateFloorPlanReservations(plan(), "fill-missing");
    expect(
      generated
        .filter((item) => item.reservationType === "seating")
        .every((item) => getFloorPlanArea(item.areaId)?.parentAreaId === "main-dining"),
    ).toBe(true);
  });

  it("highlights every contracted room and combines their seating inventory", () => {
    const source = plan([
      floorPlanEvent({
        contractedAreaIds: ["vip-1", "vip-2"],
        guestCount: 40,
        source: {
          rooms: ["VIP 1", "VIP 2"],
          food: [],
          entertainment: [],
          operationalNotes: [],
          reviewReasons: [],
        },
      }),
    ]);
    const generated = generateFloorPlanReservations(source, "fill-missing");
    const rooms = generated
      .filter((item) => item.reservationType === "room")
      .map((item) => item.areaId);
    const tables = generated
      .filter((item) => item.reservationType === "seating")
      .map((item) => getFloorPlanArea(item.areaId)!)
      .filter(Boolean);

    expect(rooms).toEqual(["vip-1", "vip-2"]);
    expect(reservedSeatingCapacity(generated)).toBe(40);
    expect(tables).toHaveLength(0);
    expect(
      tables.every((item) => ["vip-1", "vip-2"].includes(item.parentAreaId ?? "")),
    ).toBe(true);
  });

  it("reserves only the booked room for paid VIP reservations", () => {
    const generated = generateFloorPlanReservations(
      plan([
        floorPlanEvent({
          tripleseatEventId: "vip-reservation-uuid",
          contractedAreaIds: ["vip-2"],
          guestCount: 16,
          source: {
            rooms: ["VIP 2"],
            food: [],
            entertainment: [],
            operationalNotes: [],
            reviewReasons: [],
          },
        }),
      ]),
      "fill-missing",
    );

    expect(generated).toEqual([
      expect.objectContaining({ areaId: "vip-2", reservationType: "room" }),
    ]);
  });

  it.each([[20, "Passed"], [21, "Failed"]])("validates the VIP-only couch limit for %i guests", (guestCount, status) => {
    const document = plan([floorPlanEvent({ tripleseatEventId: "vip-test", contractedAreaIds: ["vip-1"], guestCount })]);
    document.reservations = generateFloorPlanReservations(document, "fill-missing");
    const validation = validateFloorPlan(document, [], [], []);
    expect(document.reservations).toHaveLength(1);
    expect(validation).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status }));
    expect(validation).toContainEqual(expect.objectContaining({ code: "FOOD_TABLE", status: "Not Applicable", blocking: false }));
  });

  it("keeps an inferred package guest count in review instead of certifying the BEO", () => {
    const event = floorPlanEvent();
    event.source.reviewReasons = ["Guest count was filled from the food package quantity."];
    expect(validateFloorPlan(plan([event]), [], [], [])).toContainEqual(expect.objectContaining({ code: "EVENT_DETAILS", status: "Failed" }));
  });

  it("uses OnPar for VIP rooms while keeping a matching Tripleseat event's seating", () => {
    const generated = generateFloorPlanReservations(
      plan([
        floorPlanEvent({
          tripleseatEventId: "vip-primary-reservation",
          contractedAreaIds: ["main-dining", "vip-1", "vip-2"],
          guestCount: 60,
          source: {
            rooms: ["Main Dining Room", "VIP 1", "VIP 2"],
            sourceEventIds: [
              "tripleseat-event",
              "vip-primary-reservation",
              "vip-secondary-reservation",
            ],
            onParBookingAreaIds: ["vip-1", "vip-2"],
            food: [],
            entertainment: [],
            operationalNotes: [],
            reviewReasons: [],
          },
        }),
      ]),
      "fill-missing",
    );

    expect(
      generated
        .filter((item) => item.reservationType === "room")
        .map((item) => item.areaId),
    ).toEqual(["vip-1", "vip-2"]);
    expect(
      generated
        .filter((item) => item.reservationType === "seating")
        .every(
          (item) =>
            getFloorPlanArea(item.areaId)?.parentAreaId === "main-dining",
        ),
    ).toBe(true);
    expect(
      generated.some((item) => item.areaId.startsWith("vip1-extra")),
    ).toBe(false);
  });

  it("removes surrounding VIP 1 tables and custom highlights from paid VIP bookings", () => {
    const vipEvent = floorPlanEvent({
      tripleseatEventId: "vip-reservation-uuid",
      contractedAreaIds: ["vip-1"],
      guestCount: 16,
      source: {
        rooms: ["VIP 1"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    });
    const document = plan([vipEvent]);
    document.reservations = [
      {
        id: "legacy-vip-room",
        floorPlanEventId: vipEvent.id,
        areaId: "vip-1",
        reservationType: "room",
        startAt: "2026-08-15T13:00:00-04:00",
        endAt: "2026-08-15T15:00:00-04:00",
        label: "VIP 1",
        source: "generated",
        lockedByUser: false,
      },
      {
        id: "legacy-vip-table",
        floorPlanEventId: vipEvent.id,
        areaId: "vip1-extra-front-1",
        reservationType: "seating",
        startAt: vipEvent.startAt,
        endAt: vipEvent.endAt,
        label: "VIP table",
        source: "manual",
        lockedByUser: true,
      },
      {
        id: "legacy-vip-custom",
        floorPlanEventId: vipEvent.id,
        areaId: "vip-1",
        reservationType: "custom",
        startAt: vipEvent.startAt,
        endAt: vipEvent.endAt,
        label: "Surrounding tables",
        source: "manual",
        lockedByUser: true,
        customGeometry: { x: 1000, y: 390, width: 200, height: 120 },
      },
    ];

    const generated = generateFloorPlanReservations(document, "fill-missing");

    expect(generated).toEqual([
      expect.objectContaining({
        areaId: "vip-1",
        reservationType: "room",
        startAt: vipEvent.startAt,
        endAt: vipEvent.endAt,
      }),
    ]);
  });

  it("assigns exactly one designated ADA food table per event", () => {
    const generated = generateFloorPlanReservations(plan(), "fill-missing");
    const food = generated.filter((item) => item.reservationType === "food-table");
    expect(food).toHaveLength(1);
    expect(getFloorPlanArea(food[0].areaId)).toMatchObject({ isAda: true, canBeFoodTable: true });
  });

  it("preserves sufficient saved VIP tables without adding more highlights", () => {
    const event = floorPlanEvent({
      guestCount: 30,
      contractedAreaIds: ["vip-1"],
      source: {
        rooms: ["VIP 1"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    });
    const existing = [
      reservation(event, "vip1-extra-front-1"),
      reservation(event, "vip1-extra-front-2"),
      reservation(event, "vip1-extra-front-3"),
    ];

    const generated = generateFloorPlanReservations(
      plan([event], existing),
      "fill-missing",
    );
    const seatingIds = generated
      .filter((item) => item.reservationType === "seating")
      .map((item) => item.areaId);

    expect(seatingIds).toEqual(existing.map((item) => item.areaId));
  });

  it("uses the verified VIP 2 couch capacity without unnecessary extra tables", () => {
    const event = floorPlanEvent({
      guestCount: 11,
      contractedAreaIds: ["vip-2"],
      source: {
        rooms: ["VIP 2"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    });

    const generated = generateFloorPlanReservations(plan([event]), "fill-missing");

    expect(generated.some((item) => item.areaId === "vip2-extra-bowling-table")).toBe(false);
    expect(reservedSeatingCapacity(generated)).toBe(20);
  });

  it.each([[20, 0, 20], [21, 1, 30], [30, 1, 30], [31, 2, 40], [70, 5, 70], [71, 0, 20]])(
    "uses VIP 1 couches and the nearest additional food-side seating for %i guests",
    (guestCount, extraCount, expectedCapacity) => {
      const document = plan([floorPlanEvent({ contractedAreaIds: ["vip-1"], guestCount })]);
      document.reservations = generateFloorPlanReservations(document, "fill-missing");
      const seating = document.reservations.filter((item) => item.reservationType === "seating");
      expect(seating).toHaveLength(extraCount);
      expect(reservedSeatingCapacity(document.reservations)).toBe(expectedCapacity);
      if (guestCount === 21 || guestCount === 30) expect(seating.map((item) => item.areaId)).toEqual(["vip1-extra-front-4"]);
      if (guestCount === 31) expect(seating.map((item) => item.areaId)).toEqual(["vip1-extra-front-3", "vip1-extra-front-4"]);
      expect(seating.some((item) => item.areaId === "vip1-extra-convo")).toBe(false);
      if (guestCount === 71) expect(validateFloorPlan(document, [], [], [])).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Failed", blocking: true }));
    },
  );

  it("matches the redacted August 21 BEO: 50 guests in VIP 1 with five bowling lanes", () => {
    // Staff supplied this contract's area, attendance, and lane quantity;
    // customer identity and source identifiers are deliberately omitted.
    const event = floorPlanEvent({ guestCount: 50, contractedAreaIds: ["vip-1"] });
    const generated = generateFloorPlanReservations(plan([event]), "replace-generated");
    const seating = generated.filter((item) => item.reservationType === "seating");

    expect(reservedSeatingCapacity(generated)).toBe(50);
    expect(seating.filter((item) => item.areaId === "vip1-conversation-wall")).toHaveLength(1);
    expect(seating.filter((item) => getFloorPlanArea(item.areaId)?.type === "rectangle-table")).toHaveLength(2);
    expect(generated.every((item) => getFloorPlanArea(item.areaId)?.id === "vip-1" ||
      getFloorPlanArea(item.areaId)?.parentAreaId === "vip-1")).toBe(true);
    expect(selectEntertainmentResources(event.contractedAreaIds, "bowling", 5)).toEqual([
      "bowling-3", "bowling-4", "bowling-5", "bowling-6", "bowling-7",
    ]);
  });

  it.each([[10, 1, 10], [11, 2, 20], [90, 9, 90], [91, 10, 94], [102, 12, 102], [103, 0, 0], [110, 0, 0], [122, 0, 0], [123, 0, 0]])(
    "uses sufficient Main Dining seating nearest food for %i guests",
    (guestCount, count, expectedCapacity) => {
      const generated = generateFloorPlanReservations(plan([floorPlanEvent({ guestCount })]), "fill-missing");
      const seating = generated.filter((item) => item.reservationType === "seating");
      expect(seating).toHaveLength(count);
      expect(reservedSeatingCapacity(generated)).toBe(expectedCapacity);
      if (guestCount === 11) expect(seating.map((item) => item.areaId)).toEqual(["main-rect-left-2", "main-rect-left-3"]);
    },
  );

  it("keeps square capacities verified while choosing the closer food-side group for 24 guests", () => {
    const squares = ["main-round-left", "main-round-center", "main-round-right"].map((id) => getFloorPlanArea(id)!);
    expect(squares.every((area) => area.type === "square-table" && area.capacity === 4 && area.isReservable)).toBe(true);
    const generated = generateFloorPlanReservations(plan([floorPlanEvent({ guestCount: 24 })]), "fill-missing");
    expect(reservedSeatingCapacity(generated)).toBe(30);
    expect(generated.filter((item) => item.reservationType === "seating")).toHaveLength(3);
    expect(generated.filter((item) => item.reservationType === "seating").map((item) => item.areaId))
      .toEqual(["main-rect-left-2", "main-rect-left-3", "main-convo-2"]);
  });

  it("keeps three saved Main Dining rectangle tables for 30 guests", () => {
    const event = floorPlanEvent({ guestCount: 30 });
    const existing = [
      reservation(event, "main-rect-left-1"),
      reservation(event, "main-rect-left-2"),
      reservation(event, "main-rect-left-3"),
    ];

    const generated = generateFloorPlanReservations(
      plan([event], existing),
      "fill-missing",
    );

    expect(generated.filter((item) => item.reservationType === "seating")).toEqual(existing);
  });

  it.each([
    [100, 1],
    [101, 2],
    [150, 2],
  ])("assigns %i guests the required food-table count", (guestCount, expected) => {
    const source = plan([floorPlanEvent({ guestCount })]);
    const food = generateFloorPlanReservations(source, "fill-missing").filter(
      (item) => item.reservationType === "food-table",
    );
    expect(food).toHaveLength(expected);
  });

  it("adds the missing mirrored food table without replacing a saved table", () => {
    const event = floorPlanEvent({ guestCount: 150 });
    const savedFoodTable: FloorPlanReservation = {
      ...reservation(event, "main-food-1"),
      id: "saved-food-table",
      reservationType: "food-table",
      label: "F",
      source: "manual",
      lockedByUser: true,
    };

    const generated = generateFloorPlanReservations(
      plan([event], [savedFoodTable]),
      "fill-missing",
    );
    const food = generated.filter(
      (item) => item.reservationType === "food-table",
    );

    expect(food).toHaveLength(2);
    expect(food).toContainEqual(savedFoodTable);
    expect(food).toEqual(expect.arrayContaining([
      expect.objectContaining({ areaId: "main-food-2" }),
    ]));
  });

  it("preserves manual locked assignments during partial regeneration", () => {
    const event = floorPlanEvent();
    const locked = { ...reservation(event, "main-rect-left-4"), id: "locked" };
    const generated = generateFloorPlanReservations(plan([event], [locked]), "replace-generated");
    expect(generated).toContainEqual(locked);
  });
});

describe("aliases and entertainment allocation", () => {
  it("normalizes verified room and entertainment aliases", () => {
    expect(resolveAreaAlias("VIP Section 1")).toBe("vip-1");
    expect(resolveAreaAlias("GEG")).toBe("geg-tables");
    expect(resolveEntertainmentAlias("Putt Putt")).toBe("mini-golf");
  });

  it("leaves unknown BEO room names unresolved", () => {
    expect(resolveAreaAlias("Mystery Atrium")).toBeNull();
  });

  it("selects consecutive entertainment resources when possible", () => {
    expect(
      selectEntertainmentResources(
        "main-dining",
        "bowling",
        2,
        new Set(["bowling-10"]),
      ),
    ).toEqual(["bowling-11", "bowling-12"]);
  });

  it("selects entertainment using the configured seating proximity", () => {
    expect(selectEntertainmentResources("main-dining", "bowling", 2)).toEqual([
      "bowling-11",
      "bowling-12",
    ]);
    expect(selectEntertainmentResources("vip-1", "bowling", 2)).toEqual([
      "bowling-4",
      "bowling-5",
    ]);
  });

  it("evaluates consecutive windows that cross the old preference-list boundary", () => {
    expect(selectEntertainmentResources("vip-1", "bowling", 5)).toEqual([
      "bowling-3", "bowling-4", "bowling-5", "bowling-6", "bowling-7",
    ]);
  });

  it("selects the closest complete group for each contracted section", () => {
    expect(selectEntertainmentResources("big-show-karaoke", "bowling", 2)).toEqual(["bowling-1", "bowling-2"]);
    expect(selectEntertainmentResources("geg-tables", "bowling", 2)).toEqual(["bowling-11", "bowling-12"]);
    expect(selectEntertainmentResources(["vip-1", "vip-2"], "bowling", 2)).toEqual(["bowling-4", "bowling-5"]);
  });

  it("uses nearest separated lanes only when no consecutive group is available", () => {
    const unavailable = new Set([2, 4, 6, 8, 10, 12].map((number) => `bowling-${number}`));
    expect(selectEntertainmentResources("main-dining", "bowling", 2, unavailable)).toEqual(["bowling-11", "bowling-9"]);
  });

  it("does not claim a closest lane for unknown seating or return insufficient inventory", () => {
    expect(selectEntertainmentResources("unknown", "bowling", 2)).toEqual([]);
    expect(selectEntertainmentResources("facility", "bowling", 2)).toEqual([]);
    expect(selectEntertainmentResources("vip-1", "bowling", 13)).toEqual([]);
    expect(selectEntertainmentResources("vip-1", "bowling", 2, new Set(Array.from({ length: 11 }, (_, index) => `bowling-${index + 1}`)))).toEqual([]);
  });
});

describe("time and buyout conflicts", () => {
  it("blocks overlapping events on the same object", () => {
    const first = floorPlanEvent();
    const second = floorPlanEvent({ id: "floor-plan-event-2", tripleseatEventId: "2", name: "Second", color: "#1D4ED8" });
    const conflicts = detectFloorPlanConflicts(
      plan([first, second], [reservation(first, "main-rect-left-1"), reservation(second, "main-rect-left-1")]),
    );
    expect(conflicts).toHaveLength(1);
  });

  it("reports only the interval where setup/event/cleanup occupancy overlaps", () => {
    const first = floorPlanEvent();
    const second = floorPlanEvent({ id: "floor-plan-event-2", tripleseatEventId: "2", name: "Second", color: "#1D4ED8" });
    const conflicts = detectFloorPlanConflicts(
      plan(
        [first, second],
        [
          reservation(first, "main-rect-left-1", "2026-08-06T22:00:00.000Z", "2026-08-07T00:00:00.000Z"),
          reservation(second, "main-rect-left-1", "2026-08-06T23:00:00.000Z", "2026-08-07T01:00:00.000Z"),
        ],
      ),
    );
    expect(conflicts[0]).toMatchObject({
      startAt: "2026-08-06T22:00:00.000Z",
      endAt: "2026-08-07T00:30:00.000Z",
    });
  });

  it("allows non-overlapping events to reuse the same object", () => {
    const first = floorPlanEvent();
    const second = floorPlanEvent({ id: "floor-plan-event-2", tripleseatEventId: "2", name: "Second", color: "#1D4ED8", startAt: "2026-08-07T02:30:00.000Z", endAt: "2026-08-07T03:00:00.000Z" });
    expect(
      detectFloorPlanConflicts(
        plan([first, second], [reservation(first, "main-rect-left-1"), reservation(second, "main-rect-left-1")]),
      ),
    ).toHaveLength(0);
  });

  it("makes a full buyout conflict with every overlapping event", () => {
    const buyout = floorPlanEvent({ fullBuyout: true, contractedAreaIds: ["facility"] });
    const other = floorPlanEvent({ id: "floor-plan-event-2", tripleseatEventId: "2", name: "Second", color: "#1D4ED8" });
    const facility = { ...reservation(buyout, "facility"), reservationType: "room" as const };
    expect(
      detectFloorPlanConflicts(
        plan([buyout, other], [facility, reservation(other, "main-rect-left-1")]),
      ).some((conflict) => conflict.areaId === "facility"),
    ).toBe(true);
  });
});

describe("validation, lifecycle, and shared records", () => {
  it("blocks approval when an event over 100 guests has only one food table", () => {
    const event = floorPlanEvent({ guestCount: 150 });
    const food = (areaId: string): FloorPlanReservation => ({
      ...reservation(event, areaId),
      reservationType: "food-table",
      label: "F",
    });

    const oneTableValidation = validateFloorPlan(
      plan([event], [food("main-food-1")]),
      [],
      [],
      [],
    );
    const twoTableValidation = validateFloorPlan(
      plan([event], [food("main-food-1"), food("main-food-2")]),
      [],
      [],
      [],
    );

    expect(
      oneTableValidation.find((item) => item.code === "FOOD_TABLE")?.status,
    ).toBe("Failed");
    expect(
      oneTableValidation.find((item) => item.code === "FOOD_TABLE_ADA")?.status,
    ).toBe("Failed");
    expect(
      twoTableValidation.find((item) => item.code === "FOOD_TABLE")?.status,
    ).toBe("Passed");
    expect(
      twoTableValidation.find((item) => item.code === "FOOD_TABLE_ADA")?.status,
    ).toBe("Passed");
  });

  it("does not require an Entertainment Schedule reservation for mini golf", () => {
    const event = floorPlanEvent({
      source: {
        rooms: ["Main Dining Room"],
        food: [],
        entertainment: [{ name: "Mini Golf", quantity: "100 guests", time: "Untimed", duration: "9 holes" }],
        operationalNotes: [],
        reviewReasons: [],
      },
    });
    const validation = validateFloorPlan(
      plan([event]),
      [],
      [],
      [],
    );
    expect(validation.find((item) => item.code === "ENTERTAINMENT_QUANTITY")?.status).toBe("Passed");
    expect(validation.find((item) => item.code === "ENTERTAINMENT_TIME")?.status).toBe("Passed");
  });

  it("creates a warning when non-mini-golf entertainment time is missing", () => {
    const event = floorPlanEvent({
      source: {
        rooms: ["Main Dining Room"],
        food: [],
        entertainment: [{ name: "Duckpin Bowling", quantity: "1 lane", time: "Time not listed on BEO", duration: "2 hours" }],
        operationalNotes: [],
        reviewReasons: [],
      },
    });
    const validation = validateFloorPlan(
      plan([event]),
      [entertainmentReservation({ resourceId: "bowling-1", resourceCategory: "bowling", resourceName: "Bowling Lane 1" })],
      [],
      [],
    );
    expect(validation.find((item) => item.code === "ENTERTAINMENT_TIME")?.status).toBe("Warning");
  });

  it("marks approved plans Updated After Approval after a relevant BEO change", () => {
    expect(floorPlanStatusAfterSourceChange("Approved", true)).toBe("Updated After Approval");
    expect(floorPlanStatusAfterSourceChange("Draft", true)).toBe("Draft");
  });

  it("builds exports only from the saved plan and shared reservation data", () => {
    const saved = { ...plan(), status: "Approved" as const, version: 7 };
    const shared = entertainmentReservation();
    const model = buildFloorPlanExportModel(saved, [shared]);
    expect(model).toMatchObject({ status: "Approved", version: 7 });
    expect(model.entertainment[0].reservationId).toBe(shared.id);
  });

  it("uses the Entertainment Schedule reservation itself rather than a floor-plan copy", () => {
    const shared = entertainmentReservation({ id: "shared-reservation" });
    const model = buildFloorPlanExportModel(plan(), [shared]);
    expect(model.entertainment).toHaveLength(1);
    expect(model.entertainment[0].reservationId).toBe("shared-reservation");
  });

  it("blocks approval when reserved seating is below the guest count", () => {
    const event = floorPlanEvent({ guestCount: 20 });
    const oneTable = reservation(event, "main-rect-left-1");
    const food: FloorPlanReservation = {
      ...reservation(event, "main-food-1"),
      id: "food",
      reservationType: "food-table",
      label: "F",
    };
    const source = plan([event], [oneTable, food]);
    const validation = validateFloorPlan(source, [], [], []);
    expect(validation.find((item) => item.code === "SEATING_CAPACITY")?.status).toBe("Failed");
    expect(hasBlockingValidationFailures(validation)).toBe(true);
  });

  it("keeps the single area registry deterministic for generator inputs", () => {
    expect(seatingTablesForArea("geg-tables").map((item) => item.id)).toEqual([
      "ge-table-1",
      "ge-table-2",
      "ge-table-3",
    ]);
  });
});
