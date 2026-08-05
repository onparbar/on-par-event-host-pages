import { describe, expect, it } from "vitest";
import type {
  EntertainmentDayPayload,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import type { EventPlan } from "@/lib/event-plans/types";
import {
  applyEntertainmentDayToItinerary,
  itineraryEntertainmentFromReservations,
} from "../entertainment";

const plan: EventPlan = {
  id: 77,
  name: "Current Event",
  date: "2026-08-07",
  day: "Friday",
  time: "6:00 PM - 9:00 PM",
  guest_count: 30,
  rooms: ["Main Dining"],
  color: "#0F766E",
  food: [],
  drink_options: [],
  entertainment: [
    { name: "Old Bowling", quantity: "1 lane", time: "6:00 PM", duration: "1 hour" },
  ],
  verification_status: "Verified",
};

function reservation(
  overrides: Partial<EntertainmentReservation> = {},
): EntertainmentReservation {
  return {
    id: "reservation-1",
    syncKey: null,
    localEventId: "77",
    tripleseatEventId: "77",
    tripleseatBookingId: null,
    eventName: "Current Event",
    operatingDate: "2026-08-07",
    resourceId: "bowling-1",
    resourceCategory: "bowling",
    resourceName: "Bowling Lane 1",
    startAt: "2026-08-07T22:30:00.000Z",
    endAt: "2026-08-08T00:30:00.000Z",
    sourceStartAt: null,
    sourceEndAt: null,
    sourceResourceId: null,
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
    createdAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    updatedBy: "test",
    ...overrides,
  };
}

function eventSnapshot(): EntertainmentEventSnapshot {
  return {
    eventId: "77",
    localEventId: "77",
    tripleseatEventId: "77",
    tripleseatBookingId: null,
    eventName: "Current Event",
    operatingDate: "2026-08-07",
    eventStartAt: null,
    eventEndAt: null,
    eventColor: "#0F766E",
    colorSource: "event-plan",
    floorPlanAssetKey: null,
    sourceUpdatedAt: null,
    needsReview: false,
    reviewIssues: [],
    sourceSnapshot: {
      tripleseatEventId: "77",
      tripleseatBookingId: null,
      eventName: "Current Event",
      localDate: "2026-08-07",
      eventStartAt: null,
      eventEndAt: null,
      status: "DEFINITE",
      rooms: [],
      items: [],
      categoryNames: [],
      sourceUpdatedAt: null,
      noteCount: 0,
    },
    active: true,
    syncedAt: "2026-08-05T12:00:00.000Z",
  };
}

function day(reservations: EntertainmentReservation[]): EntertainmentDayPayload {
  return {
    date: "2026-08-07",
    events: [eventSnapshot()],
    reservations,
    conflicts: [],
    sync: null,
    sourceMode: "live",
    warnings: [],
    missingEnvironmentVariables: [],
    canEdit: true,
  };
}

describe("itinerary entertainment projection", () => {
  it("groups physical reservations into the current itinerary time and quantity", () => {
    const items = itineraryEntertainmentFromReservations([
      reservation(),
      reservation({ id: "reservation-2", resourceId: "bowling-2", resourceName: "Bowling Lane 2" }),
    ]);

    expect(items).toEqual([
      {
        name: "Duckpin Bowling",
        quantity: "2 lanes",
        time: "6:30 PM – 8:30 PM",
        duration: "2 hours",
      },
    ]);
  });

  it("replaces stale contract entertainment with the saved schedule", () => {
    const current = applyEntertainmentDayToItinerary(plan, day([
      reservation({ resourceId: "pool-1", resourceCategory: "pool", resourceName: "Pool Table 1" }),
    ]));

    expect(current.entertainment).toEqual([
      {
        name: "Pool",
        quantity: "1 table",
        time: "6:30 PM – 8:30 PM",
        duration: "2 hours",
      },
    ]);
  });

  it("clears itinerary entertainment when the matched schedule has no reservations", () => {
    expect(applyEntertainmentDayToItinerary(plan, day([])).entertainment).toEqual([]);
  });

  it("preserves the event plan when no schedule event matches", () => {
    expect(applyEntertainmentDayToItinerary(plan, { ...day([]), events: [] })).toBe(plan);
  });
});
