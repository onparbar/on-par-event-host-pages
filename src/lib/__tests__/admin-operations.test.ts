import { describe, expect, it } from "vitest";
import {
  adminOperationsWindow,
  buildAdminConflictCenter,
  buildAdminContractEvidence,
  evaluateEventCompleteness,
} from "../admin-operations";
import type { EntertainmentReservation } from "../entertainment/types";
import type { EventPlan, TripleseatEventPlanSource } from "../event-plans/types";
import type { FloorPlanDocument } from "../floor-plans/types";
import type { KitchenChecklist } from "../kitchen/types";

function plan(overrides: Partial<EventPlan> = {}): EventPlan {
  return {
    id: 1001,
    name: "Example Event",
    date: "2026-08-06",
    day: "Thursday",
    time: "1:00 PM - 3:00 PM",
    guest_count: 40,
    rooms: ["VIP 1"],
    color: "#297025",
    food: ["Taco Bar"],
    drink_options: [],
    entertainment: [
      {
        name: "Duckpin Bowling",
        quantity: "2 lanes",
        time: "1:00 PM - 3:00 PM",
        duration: "2 hours",
      },
    ],
    verification_status: "Verified",
    ...overrides,
  };
}

function source(
  eventPlan = plan(),
  overrides: Partial<TripleseatEventPlanSource> = {},
): TripleseatEventPlanSource {
  return {
    eventId: String(eventPlan.id),
    bookingId: "booking-1",
    eventName: eventPlan.name,
    localDate: eventPlan.date,
    eventStartAt: `${eventPlan.date}T13:00:00-04:00`,
    eventEndAt: `${eventPlan.date}T15:00:00-04:00`,
    guestCount: eventPlan.guest_count,
    status: "DEFINITE",
    rooms: [...eventPlan.rooms],
    selections: [
      {
        name: "Taco Bar",
        quantity: 40,
        sourceId: "selection-1",
        sourceCategory: "Food",
        isFood: true,
      },
    ],
    documentItems: [
      {
        sourceId: "line-1",
        name: "Duckpin Bowling",
        description: "2 bowling lanes for 2 hours",
        categoryName: "Entertainment",
        quantity: 2,
        startAt: null,
        endAt: null,
      },
    ],
    operationalNotes: [],
    sourceUpdatedAt: "2026-08-03T14:00:00Z",
    ...overrides,
  };
}

function kitchen(
  eventPlan = plan(),
  overrides: Partial<KitchenChecklist> = {},
): KitchenChecklist {
  return {
    ruleVersion: "test",
    timezone: "America/New_York",
    event: {
      eventId: eventPlan.id,
      bookingId: "booking-1",
      name: eventPlan.name,
      localDate: eventPlan.date,
      startTime: "13:00",
      endTime: "15:00",
      guestCount: 40,
      guestCountSource: "event",
      status: "DEFINITE",
      room: "VIP 1",
      sourceUpdatedAt: null,
      specialNotes: [],
    },
    foodRunnerOrBwa: "Alexis Younker",
    classification: "bar-package",
    packageMarkers: ["the-full-course"],
    selectedBars: ["taco"],
    selectedCategories: ["taco"],
    normalizedSelections: [],
    timing: {
      startTime: `${eventPlan.date}T13:00`,
      foodReadyBy: `${eventPlan.date}T12:45`,
      earliestPrepTime: `${eventPlan.date}T11:45`,
    },
    sections: [
      {
        category: "taco",
        label: "Taco Bar",
        rows: [
          {
            key: "taco-beef",
            category: "taco",
            foodName: "Beef",
            description: "",
            quantity: 40,
            unit: "servings",
            numberOfPans: 2,
            panSize: "1/3",
            prepTiming: { kind: "minutes-before-food-ready", minutes: 30 },
          },
        ],
      },
    ],
    liveFoodAddOns: [],
    completedItemKeys: [],
    finalCompletedItemKeys: [],
    chafingDishes: { bars: 1, hotPlatters: 0, total: 1 },
    warnings: [],
    referenceConflicts: [],
    needsReview: false,
    ...overrides,
  };
}

function floorPlan(events = [plan()]): FloorPlanDocument {
  return {
    id: "floor-plan-2026-08-06",
    eventDate: "2026-08-06",
    status: "Approved",
    version: 2,
    ruleVersion: "test",
    lastTripleseatSyncAt: null,
    createdAt: "2026-08-03T12:00:00Z",
    updatedAt: "2026-08-03T12:30:00Z",
    approvedAt: "2026-08-03T12:30:00Z",
    approvedBy: "admin",
    events: events.map((eventPlan) => ({
      id: `floor-plan-event-${eventPlan.id}`,
      floorPlanId: "floor-plan-2026-08-06",
      tripleseatEventId: String(eventPlan.id),
      name: eventPlan.name,
      status: "DEFINITE",
      guestCount: eventPlan.guest_count,
      startAt: `${eventPlan.date}T13:00:00-04:00`,
      endAt: `${eventPlan.date}T15:00:00-04:00`,
      contractedAreaIds: ["vip-1"],
      unresolvedAreaNames: [],
      color: eventPlan.color,
      beoLastModifiedAt: null,
      fullBuyout: false,
      source: {
        rooms: ["VIP 1"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    })),
    reservations: events.map((eventPlan, index) => ({
      id: `reservation-${eventPlan.id}`,
      floorPlanEventId: `floor-plan-event-${eventPlan.id}`,
      areaId: "vip-1",
      reservationType: "room",
      startAt: index === 0 ? `${eventPlan.date}T13:00:00-04:00` : `${eventPlan.date}T14:00:00-04:00`,
      endAt: index === 0 ? `${eventPlan.date}T15:00:00-04:00` : `${eventPlan.date}T16:00:00-04:00`,
      label: eventPlan.name,
      source: "manual",
      lockedByUser: true,
    })),
  };
}

function entertainmentReservation(
  id: string,
  eventPlan: EventPlan,
  startAt: string,
  endAt: string,
  resourceId = "private-room-vip-1",
): EntertainmentReservation {
  return {
    id,
    syncKey: id,
    localEventId: String(eventPlan.id),
    tripleseatEventId: String(eventPlan.id),
    tripleseatBookingId: null,
    eventName: eventPlan.name,
    operatingDate: eventPlan.date,
    resourceId,
    resourceCategory: resourceId.startsWith("mini-golf") ? "mini-golf" : "private-rooms",
    resourceName: resourceId,
    startAt,
    endAt,
    sourceStartAt: startAt,
    sourceEndAt: endAt,
    sourceResourceId: resourceId,
    eventColor: eventPlan.color,
    colorSource: "event-plan",
    source: "tripleseat",
    sourceReference: null,
    manualOverride: false,
    hasSourceUpdate: false,
    needsReview: false,
    reviewIssues: [],
    autoAssigned: false,
    notes: "",
    sourceUpdatedAt: null,
    lastTripleseatSyncAt: null,
    active: true,
    createdAt: "2026-08-03T12:00:00Z",
    updatedAt: "2026-08-03T12:00:00Z",
    updatedBy: "sync",
  };
}

describe("admin operations review window", () => {
  it("uses venue dates for a seven-day lookahead", () => {
    expect(
      adminOperationsWindow(new Date("2026-08-04T03:00:00.000Z")),
    ).toEqual({ startDate: "2026-08-03", endDate: "2026-08-10" });
  });
});

describe("event completeness", () => {
  it("keeps derived service time and legacy staff fields reviewable", () => {
    const eventPlan = plan();
    const result = evaluateEventCompleteness({
      plan: eventPlan,
      source: source(eventPlan),
      kitchen: kitchen(eventPlan),
      floorPlan: floorPlan([eventPlan]),
    });

    expect(result.checks.find((item) => item.key === "end-time")?.status).toBe("complete");
    expect(result.checks.find((item) => item.key === "food-service-time")?.status).toBe("needs-review");
    expect(result.checks.find((item) => item.key === "staff-assignments")?.status).toBe("needs-review");
    expect(result.checks.find((item) => item.key === "floor-plan")?.status).toBe("complete");
    expect(result.issueCount).toBe(2);
  });

  it("flags every unavailable critical source without guessing", () => {
    const eventPlan = plan({
      guest_count: 0,
      rooms: [],
      food: [],
      entertainment: [],
      time: "Time needs review",
    });
    const result = evaluateEventCompleteness({
      plan: eventPlan,
      source: source(eventPlan, {
        eventStartAt: null,
        eventEndAt: null,
        guestCount: null,
        rooms: [],
        selections: [],
      }),
      kitchen: null,
      floorPlan: null,
    });

    expect(result.checks.filter((item) => item.status === "missing").map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "end-time",
        "reserved-section",
        "food-service-time",
        "guest-count",
        "food-quantities",
        "floor-plan",
        "staff-assignments",
      ]),
    );
    expect(result.checks.find((item) => item.key === "entertainment-duration")?.status).toBe("not-applicable");
  });

  it("keeps a normalized entertainment duration reviewable without retained source proof", () => {
    const eventPlan = plan();
    const result = evaluateEventCompleteness({
      plan: eventPlan,
      source: null,
      kitchen: kitchen(eventPlan),
      floorPlan: floorPlan([eventPlan]),
    });

    expect(result.checks.find((item) => item.key === "entertainment-duration")?.status).toBe("needs-review");
  });
});

describe("admin conflict center", () => {
  it("deduplicates the same room overlap across contract, floor plan, and entertainment", () => {
    const first = plan();
    const second = plan({ id: 1002, name: "Second Event", color: "#526D52" });
    const saved = floorPlan([first, second]);
    saved.reservations[0].startAt = "2026-08-06T17:00:00Z";
    saved.reservations[0].endAt = "2026-08-06T19:00:00Z";
    saved.reservations[1].startAt = "2026-08-06T18:00:00Z";
    saved.reservations[1].endAt = "2026-08-06T20:00:00Z";
    const reservations = [
      entertainmentReservation("ent-1", first, "2026-08-06T17:00:00Z", "2026-08-06T19:00:00Z"),
      entertainmentReservation("ent-2", second, "2026-08-06T18:00:00Z", "2026-08-06T20:00:00Z"),
    ];

    const conflicts = buildAdminConflictCenter({
      date: "2026-08-06",
      plans: [
        { plan: first, source: source(first) },
        {
          plan: second,
          source: source(second, {
            eventStartAt: "2026-08-06T14:00:00-04:00",
            eventEndAt: "2026-08-06T16:00:00-04:00",
          }),
        },
      ],
      floorPlan: saved,
      entertainmentReservations: reservations,
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "combined",
      resourceId: "vip-1",
      startAt: "2026-08-06T14:00:00-04:00",
      endAt: "2026-08-06T15:00:00-04:00",
    });
  });

  it("treats a full-facility buyout as a conflict with every overlapping reserved room", () => {
    const buyout = plan({ id: 2001, name: "Full Buyout", rooms: ["Full Facility Buyout"] });
    const vipEvent = plan({ id: 2002, name: "VIP Event", rooms: ["VIP 1"] });
    const conflicts = buildAdminConflictCenter({
      date: "2026-08-06",
      plans: [
        { plan: buyout, source: source(buyout, { rooms: ["Full Facility Buyout"] }) },
        { plan: vipEvent, source: source(vipEvent, { rooms: ["VIP 1"] }) },
      ],
      floorPlan: null,
      entertainmentReservations: [],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "contracted-room",
      resourceId: "facility",
      eventIds: ["2001", "2002"],
    });
  });

  it("keeps distinct same-name event pairs separate by source ID", () => {
    const first = plan({ id: 3001, name: "Team Outing" });
    const second = plan({ id: 3002, name: "Team Outing" });
    const third = plan({ id: 3003, name: "Team Outing" });
    const conflicts = buildAdminConflictCenter({
      date: "2026-08-06",
      plans: [first, second, third].map((eventPlan) => ({
        plan: eventPlan,
        source: source(eventPlan),
      })),
      floorPlan: null,
      entertainmentReservations: [],
    });

    expect(conflicts).toHaveLength(3);
    expect(conflicts.map((item) => [...item.eventIds].sort())).toEqual(
      expect.arrayContaining([
        ["3001", "3002"],
        ["3001", "3003"],
        ["3002", "3003"],
      ]),
    );
  });

  it("does not create conflict-center entries for mini golf", () => {
    const first = plan();
    const second = plan({ id: 1002, name: "Second Event" });
    const reservations = [
      entertainmentReservation("golf-1", first, "2026-08-06T13:00:00-04:00", "2026-08-06T15:00:00-04:00", "mini-golf-level-up"),
      entertainmentReservation("golf-2", second, "2026-08-06T14:00:00-04:00", "2026-08-06T16:00:00-04:00", "mini-golf-level-up"),
    ];

    expect(
      buildAdminConflictCenter({
        date: "2026-08-06",
        plans: [],
        floorPlan: null,
        entertainmentReservations: reservations,
      }),
    ).toEqual([]);
  });
});

describe("contract evidence", () => {
  it("labels derived defaults and redacts contact details", () => {
    const eventPlan = plan({ food: ["Contact chef@example.com about Taco Bar"] });
    const evidence = buildAdminContractEvidence(
      eventPlan,
      source(eventPlan, {
        selections: [
          {
            name: "Contact chef@example.com about Taco Bar",
            quantity: 40,
            sourceId: "selection-1",
          },
        ],
      }),
      kitchen(eventPlan),
    );

    expect(evidence.rows.find((row) => row.key === "food-service-time")?.sourceKind).toBe("Derived default");
    expect(JSON.stringify(evidence)).not.toContain("chef@example.com");
    expect(JSON.stringify(evidence)).toContain("[email redacted]");
  });

  it("ties each entertainment value to its retained Tripleseat line item", () => {
    const eventPlan = plan();
    const evidence = buildAdminContractEvidence(
      eventPlan,
      source(eventPlan),
      kitchen(eventPlan),
    );

    const quantity = evidence.rows.find((row) => row.key === "entertainment-0-quantity");
    const duration = evidence.rows.find((row) => row.key === "entertainment-0-duration");
    expect(quantity).toMatchObject({
      importedValue: "2 lanes",
      sourceKind: "Contract line item",
      sourceText: "2 bowling lanes for 2 hours",
      sourceReference: "line-1",
    });
    expect(duration).toMatchObject({
      importedValue: "2 hours",
      sourceReference: "line-1",
    });
  });

  it("does not label an absent individual field as structured evidence", () => {
    const eventPlan = plan();
    const evidence = buildAdminContractEvidence(
      eventPlan,
      source(eventPlan, { guestCount: null, rooms: [] }),
      null,
    );

    expect(evidence.rows.find((row) => row.key === "guest-count")?.sourceKind).toBe("Evidence unavailable");
    expect(evidence.rows.find((row) => row.key === "reserved-sections")?.sourceKind).toBe("Evidence unavailable");
  });
});
