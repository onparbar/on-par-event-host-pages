import { describe, expect, it } from "vitest";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import {
  entertainmentOverlapOutlines,
  localHighlightIdsForDeletion,
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

describe("overlapping entertainment group outlines", () => {
  const firstEvent = floorPlanEvent("event-1", "101", "First Party", "#D97706");
  const secondEvent = floorPlanEvent("event-2", "202", "Second Party", "#C026D3");
  const floorPlan = { ...plan, events: [firstEvent, secondEvent] };

  it("wraps each party's contiguous lanes when their bowling times overlap", () => {
    const reservations = [
      entertainmentReservation("first-1", firstEvent, "bowling-1", "2026-08-07T17:30:00.000Z", "2026-08-07T19:30:00.000Z"),
      entertainmentReservation("first-2", firstEvent, "bowling-2", "2026-08-07T17:30:00.000Z", "2026-08-07T19:30:00.000Z"),
      entertainmentReservation("second-3", secondEvent, "bowling-3", "2026-08-07T16:30:00.000Z", "2026-08-07T18:30:00.000Z"),
      entertainmentReservation("second-4", secondEvent, "bowling-4", "2026-08-07T16:30:00.000Z", "2026-08-07T18:30:00.000Z"),
    ];

    expect(entertainmentOverlapOutlines(floorPlan, reservations)).toEqual([
      expect.objectContaining({
        eventName: "First Party",
        color: "#D97706",
        resourceNames: ["Bowling Lane 1", "Bowling Lane 2"],
        x: 1464,
        y: 422,
        width: 107,
        height: 66,
      }),
      expect.objectContaining({
        eventName: "Second Party",
        color: "#C026D3",
        resourceNames: ["Bowling Lane 3", "Bowling Lane 4"],
        x: 1464,
        y: 495,
        width: 107,
        height: 66,
      }),
    ]);
  });

  it("does not add group borders when entertainment times only touch", () => {
    const reservations = [
      entertainmentReservation("first-1", firstEvent, "bowling-1", "2026-08-07T16:00:00.000Z", "2026-08-07T17:00:00.000Z"),
      entertainmentReservation("second-2", secondEvent, "bowling-2", "2026-08-07T17:00:00.000Z", "2026-08-07T18:00:00.000Z"),
    ];

    expect(entertainmentOverlapOutlines(floorPlan, reservations)).toEqual([]);
  });

  it("splits non-contiguous lanes into separate borders", () => {
    const reservations = [
      entertainmentReservation("first-1", firstEvent, "bowling-1", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("first-3", firstEvent, "bowling-3", "2026-08-07T16:00:00.000Z", "2026-08-07T18:00:00.000Z"),
      entertainmentReservation("second-4", secondEvent, "bowling-4", "2026-08-07T17:00:00.000Z", "2026-08-07T19:00:00.000Z"),
    ];

    const outlines = entertainmentOverlapOutlines(floorPlan, reservations);
    expect(outlines.filter((outline) => outline.eventId === firstEvent.id)).toHaveLength(2);
    expect(outlines.filter((outline) => outline.eventId === secondEvent.id)).toHaveLength(1);
  });
});
