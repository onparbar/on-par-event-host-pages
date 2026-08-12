import { describe, expect, it } from "vitest";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import {
  resolveAreaAlias,
  resolveEntertainmentAlias,
} from "../configuration/aliases";
import {
  getFloorPlanArea,
  seatingTablesForArea,
} from "../configuration/areas";
import { selectEntertainmentResources } from "../configuration/adjacency";
import { detectFloorPlanConflicts } from "../conflicts";
import { buildFloorPlanExportModel } from "../export";
import {
  generateFloorPlanReservations,
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
  it("counts venue rectangle tables as 8 seats", () => {
    expect(getFloorPlanArea("main-rect-left-1")?.capacity).toBe(8);
  });

  it("counts square tables as 4 seats", () => {
    expect(getFloorPlanArea("level-up-square-1")?.capacity).toBe(4);
  });

  it("selects the smallest contiguous combination that meets the guest count", () => {
    const selected = selectSmallestTableCombination(
      [table("r1", "rectangle-table", 0), table("r2", "rectangle-table", 30), table("s1", "square-table", 60)],
      24,
    );
    expect(seatingCapacity(selected)).toBe(24);
    expect(selected.map((item) => item.id)).toEqual(["r1", "r2", "s1"]);
  });

  it("highlights every available table when the mapped inventory is short", () => {
    const selected = selectSmallestTableCombination(
      [
        { ...table("r1", "rectangle-table", 0), capacity: 8 },
        { ...table("r2", "rectangle-table", 30), capacity: 8 },
      ],
      20,
    );

    expect(selected.map((item) => item.id)).toEqual(["r1", "r2"]);
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
    expect(seatingCapacity(tables)).toBeGreaterThanOrEqual(40);
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
      expect.objectContaining({ areaId: "vip-1", reservationType: "room" }),
    ]);
  });

  it("assigns exactly one designated ADA food table per event", () => {
    const generated = generateFloorPlanReservations(plan(), "fill-missing");
    const food = generated.filter((item) => item.reservationType === "food-table");
    expect(food).toHaveLength(1);
    expect(getFloorPlanArea(food[0].areaId)).toMatchObject({ isAda: true, canBeFoodTable: true });
  });

  it("fills the missing August 6 VIP 1 table and fixed conversation highlights", () => {
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

    expect(seatingIds).toEqual(expect.arrayContaining([
      "vip1-extra-front-4",
      "vip1-conversation-wall",
      "vip1-extra-convo",
    ]));
  });

  it("highlights the VIP 2 extra table even when it cannot seat every guest", () => {
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

    expect(generated).toEqual(expect.arrayContaining([
      expect.objectContaining({
        areaId: "vip2-extra-bowling-table",
        reservationType: "seating",
      }),
    ]));
  });

  it("fills the fourth Main Dining table for a 30-guest event", () => {
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

    expect(generated).toEqual(expect.arrayContaining([
      expect.objectContaining({ areaId: "main-rect-left-4" }),
    ]));
  });

  it("does not add a second food table for more than 100 guests", () => {
    const source = plan([floorPlanEvent({ guestCount: 140 })]);
    const food = generateFloorPlanReservations(source, "fill-missing").filter(
      (item) => item.reservationType === "food-table",
    );
    expect(food).toHaveLength(1);
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
      "bowling-9",
      "bowling-10",
    ]);
    expect(selectEntertainmentResources("vip-1", "bowling", 2)).toEqual([
      "bowling-3",
      "bowling-4",
    ]);
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

  it("reports only the interval where the reservations overlap", () => {
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
      startAt: "2026-08-06T23:00:00.000Z",
      endAt: "2026-08-07T00:00:00.000Z",
    });
  });

  it("allows non-overlapping events to reuse the same object", () => {
    const first = floorPlanEvent();
    const second = floorPlanEvent({ id: "floor-plan-event-2", tripleseatEventId: "2", name: "Second", color: "#1D4ED8", startAt: "2026-08-07T01:00:00.000Z", endAt: "2026-08-07T03:00:00.000Z" });
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
