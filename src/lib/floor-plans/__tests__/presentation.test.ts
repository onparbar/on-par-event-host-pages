import { describe, expect, it } from "vitest";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { detectFloorPlanConflicts } from "../conflicts";
import {
  displayEventForFloorPlanArea,
  entertainmentMultipleReservationOutlines,
  localHighlightIdsForDeletion,
  visibleEntertainmentReservations,
} from "../presentation";
import type { FloorPlanDocument, FloorPlanEvent } from "../types";

const plan = {
  id: "floor-plan-redacted",
  eventDate: "2026-08-05",
  status: "Needs Review",
  version: 1,
  ruleVersion: "floor-plan-v1.2.0",
  lastTripleseatSyncAt: null,
  createdAt: "2026-08-04T16:00:00.000Z",
  updatedAt: "2026-08-04T16:00:00.000Z",
  approvedAt: null,
  approvedBy: null,
  events: [],
  reservations: [
    {
      id: "room-highlight",
      floorPlanEventId: "event-1",
      areaId: "vip-1",
      reservationType: "room",
      startAt: null,
      endAt: null,
      label: "VIP 1",
      source: "manual",
      lockedByUser: true,
    },
    {
      id: "custom-highlight",
      floorPlanEventId: "event-1",
      areaId: "vip-1",
      reservationType: "custom",
      startAt: null,
      endAt: null,
      label: "Welcome table",
      source: "manual",
      lockedByUser: true,
      customGeometry: { x: 10, y: 10, width: 100, height: 40 },
    },
  ],
} satisfies FloorPlanDocument;

describe("floor-plan highlight editing", () => {
  it("deletes the exact selected custom highlight without deleting the room", () => {
    expect(
      localHighlightIdsForDeletion(
        plan,
        "event-1",
        ["vip-1"],
        "custom-highlight",
      ),
    ).toEqual(["custom-highlight"]);
  });

  it("deletes permanent-area highlights when no custom highlight is selected", () => {
    expect(
      localHighlightIdsForDeletion(plan, "event-1", ["vip-1"], ""),
    ).toEqual(["room-highlight"]);
  });
});

function floorPlanEvent(
  id: string,
  tripleseatEventId: string,
  name: string,
  color: string,
): FloorPlanEvent {
  return {
    id,
    floorPlanId: plan.id,
    tripleseatEventId,
    name,
    status: "Definite",
    guestCount: 20,
    startAt: "2026-08-07T16:00:00.000Z",
    endAt: "2026-08-07T19:00:00.000Z",
    contractedAreaIds: [],
    unresolvedAreaNames: [],
    color,
    beoLastModifiedAt: null,
    fullBuyout: false,
    source: {
      rooms: [],
      food: [],
      entertainment: [],
      operationalNotes: [],
      reviewReasons: [],
    },
  };
}

function entertainmentReservation(
  id: string,
  event: FloorPlanEvent,
  resourceId: string,
  startAt: string,
  endAt: string,
): EntertainmentReservation {
  return {
    id,
    syncKey: null,
    localEventId: event.id,
    tripleseatEventId: event.tripleseatEventId,
    tripleseatBookingId: null,
    eventName: event.name,
    operatingDate: "2026-08-07",
    resourceId,
    resourceCategory: "bowling",
    resourceName: `Bowling Lane ${resourceId.replace("bowling-", "")}`,
    startAt,
    endAt,
    sourceStartAt: startAt,
    sourceEndAt: endAt,
    sourceResourceId: resourceId,
    eventColor: event.color,
    colorSource: "floor-plan-assignment",
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
    createdAt: startAt,
    updatedAt: startAt,
    updatedBy: "test",
  };
}

describe("multiple entertainment reservation outlines", () => {
  const firstEvent = floorPlanEvent("event-1", "101", "First Party", "#D97706");
  const secondEvent = floorPlanEvent("event-2", "202", "Second Party", "#C026D3");
  const floorPlan = { ...plan, events: [firstEvent, secondEvent] };

  it("keeps the earliest reservation as the fill and wraps shared contiguous lanes in the additional party's color", () => {
    const reservations = [
      entertainmentReservation("first-5", firstEvent, "bowling-5", "2026-08-07T16:30:00.000Z", "2026-08-07T18:30:00.000Z"),
      entertainmentReservation("first-6", firstEvent, "bowling-6", "2026-08-07T16:30:00.000Z", "2026-08-07T18:30:00.000Z"),
      entertainmentReservation("second-5", secondEvent, "bowling-5", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
      entertainmentReservation("second-6", secondEvent, "bowling-6", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
      entertainmentReservation("second-7", secondEvent, "bowling-7", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
      entertainmentReservation("second-8", secondEvent, "bowling-8", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
    ];

    expect(
      visibleEntertainmentReservations(floorPlan, reservations).map(
        (reservation) => reservation.id,
      ),
    ).toEqual(["first-5", "first-6", "second-7", "second-8"]);
    expect(entertainmentMultipleReservationOutlines(floorPlan, reservations)).toEqual([
      expect.objectContaining({
        eventName: "Second Party",
        color: "#C026D3",
        resourceNames: ["Bowling Lane 5", "Bowling Lane 6"],
        x: 1462,
        y: 571,
        width: 111,
        height: 71,
      }),
    ]);
  });

  it("does not add a border when parties reserve different resources", () => {
    const reservations = [
      entertainmentReservation("first-1", firstEvent, "bowling-1", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("second-2", secondEvent, "bowling-2", "2026-08-07T17:00:00.000Z", "2026-08-07T19:00:00.000Z"),
    ];

    expect(entertainmentMultipleReservationOutlines(floorPlan, reservations)).toEqual([]);
  });

  it("splits non-contiguous shared lanes into separate borders", () => {
    const reservations = [
      entertainmentReservation("first-1", firstEvent, "bowling-1", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("first-3", firstEvent, "bowling-3", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("second-1", secondEvent, "bowling-1", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
      entertainmentReservation("second-3", secondEvent, "bowling-3", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
    ];

    const outlines = entertainmentMultipleReservationOutlines(floorPlan, reservations);
    expect(outlines.filter((outline) => outline.eventId === secondEvent.id)).toHaveLength(2);
  });

  it("shows the selected Admin event as the fill and outlines the other party", () => {
    const reservations = [
      entertainmentReservation("first-5", firstEvent, "bowling-5", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("second-5", secondEvent, "bowling-5", "2026-08-07T21:00:00.000Z", "2026-08-07T23:00:00.000Z"),
    ];

    expect(
      visibleEntertainmentReservations(floorPlan, reservations, secondEvent.id)[0]?.id,
    ).toBe("second-5");
    expect(
      entertainmentMultipleReservationOutlines(
        floorPlan,
        reservations,
        secondEvent.id,
      )[0],
    ).toEqual(expect.objectContaining({ eventId: firstEvent.id }));
  });

  it("keeps the earlier VIP room orange and labels the later VIP booking's blue border with its own time", () => {
    const adfEvent = {
      ...floorPlanEvent("event-adf", "adf", "ADF", "#B45309"),
      startAt: "2026-08-15T17:00:00.000Z",
      endAt: "2026-08-15T19:00:00.000Z",
    };
    const cassieEvent = {
      ...floorPlanEvent(
        "event-cassie",
        "vip-cassie",
        "Cassie Perks VIP",
        "#1D4ED8",
      ),
      startAt: "2026-08-16T01:00:00.000Z",
      endAt: "2026-08-16T03:00:00.000Z",
    };
    const vipPlan: FloorPlanDocument = {
      ...plan,
      eventDate: "2026-08-15",
      events: [adfEvent, cassieEvent],
      reservations: [
        {
          id: "cassie-vip-1",
          floorPlanEventId: cassieEvent.id,
          areaId: "vip-1",
          reservationType: "room",
          startAt: cassieEvent.startAt,
          endAt: cassieEvent.endAt,
          label: "VIP 1",
          source: "generated",
          lockedByUser: false,
        },
        {
          id: "adf-vip-1",
          floorPlanEventId: adfEvent.id,
          areaId: "vip-1",
          reservationType: "room",
          startAt: adfEvent.startAt,
          endAt: adfEvent.endAt,
          label: "VIP 1",
          source: "generated",
          lockedByUser: false,
        },
      ],
    };
    const reservations: EntertainmentReservation[] = [
      {
        ...entertainmentReservation(
          "cassie-shared-vip-1",
          cassieEvent,
          "private-room-vip-1",
          cassieEvent.startAt!,
          cassieEvent.endAt!,
        ),
        operatingDate: "2026-08-15",
        resourceCategory: "private-rooms",
        resourceName: "VIP 1",
      },
      {
        ...entertainmentReservation(
          "adf-shared-vip-1",
          adfEvent,
          "private-room-vip-1",
          adfEvent.startAt!,
          adfEvent.endAt!,
        ),
        operatingDate: "2026-08-15",
        resourceCategory: "private-rooms",
        resourceName: "VIP 1",
      },
    ];

    const primary = visibleEntertainmentReservations(vipPlan, reservations)[0];
    const local = vipPlan.reservations[0];

    expect(primary.id).toBe("adf-shared-vip-1");
    expect(displayEventForFloorPlanArea(vipPlan, local, primary)).toBe(adfEvent);
    expect(entertainmentMultipleReservationOutlines(vipPlan, reservations)).toEqual([
      expect.objectContaining({
        eventName: "Cassie Perks VIP",
        color: "#1D4ED8",
        resourceNames: ["VIP 1"],
        timeLabel: "9:00 PM – 11:00 PM",
        x: 1068,
        y: 540,
        width: 128,
        height: 88,
      }),
    ]);
    expect(detectFloorPlanConflicts(vipPlan)).toEqual([]);
  });
});
