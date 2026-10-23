import { describe, expect, it } from "vitest";
import type {
  EntertainmentDayPayload,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import type { EventPlan } from "@/lib/event-plans/types";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import {
  applyEntertainmentDayToItinerary,
  itineraryEntertainmentFromReservations,
  itineraryIdentityScope,
  itineraryReservationMatchesPlan,
  itinerarySnapshotMatchesPlan,
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
        quantity: "2 lanes · Bowling Lanes 1–2",
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
        quantity: "1 table · Pool Table 1",
        time: "6:30 PM – 8:30 PM",
        duration: "2 hours",
      },
    ]);
  });

  it("clears itinerary entertainment when the matched schedule has no reservations", () => {
    expect(applyEntertainmentDayToItinerary(plan, day([])).entertainment).toEqual([]);
  });

  it("keeps the contracted Mini Golf quantity without adding a time", () => {
    const current = applyEntertainmentDayToItinerary(
      {
        ...plan,
        entertainment: [
          ...plan.entertainment,
          { name: "Mini Golf", quantity: "20 guests", time: "", duration: "" },
        ],
      },
      day([
        reservation({
          resourceId: "bowling-1",
          resourceName: "Bowling Lane 1",
        }),
      ]),
    );

    expect(current.entertainment).toEqual([
      {
        name: "Duckpin Bowling",
        quantity: "1 lane · Bowling Lane 1",
        time: "6:30 PM – 8:30 PM",
        duration: "2 hours",
      },
      { name: "Mini Golf", quantity: "20 guests", time: "", duration: "" },
    ]);
  });

  it("preserves the event plan when no schedule event matches", () => {
    expect(applyEntertainmentDayToItinerary(plan, { ...day([]), events: [] })).toBe(plan);
  });

  it("reconnects an older VIP ID only through an explicitly saved floor-plan source link", () => {
    const oemPlan: EventPlan = {
      ...plan,
      id: 62223662,
      name: "OEM Sales",
      date: "2026-09-15",
      day: "Tuesday",
      time: "6:00 PM - 8:00 PM",
    };
    const staleVipReservation = reservation({
      id: "stale-vip-bowling-1",
      tripleseatEventId: null,
      localEventId: "vip-older-local-id",
      eventName: "OEM Sales VIP",
      operatingDate: "2026-09-15",
      startAt: "2026-09-15T22:30:00.000Z",
      endAt: "2026-09-16T00:30:00.000Z",
    });

    const savedLink = {
      eventDate: oemPlan.date,
      events: [{ tripleseatEventId: String(oemPlan.id), source: { sourceEventIds: ["vip-older-local-id"] } }],
    } as FloorPlanDocument;
    const schedule = { ...day([staleVipReservation]), date: "2026-09-15", events: [] };
    expect(applyEntertainmentDayToItinerary(oemPlan, schedule)).toBe(oemPlan);
    expect(applyEntertainmentDayToItinerary(oemPlan, schedule, itineraryIdentityScope(oemPlan, savedLink, false))).toBe(oemPlan);
    expect(
      applyEntertainmentDayToItinerary(
        oemPlan,
        schedule,
        itineraryIdentityScope(oemPlan, savedLink, true),
      ).entertainment,
    ).toEqual([
      {
        name: "Duckpin Bowling",
        quantity: "1 lane · Bowling Lane 1",
        time: "6:30 PM – 8:30 PM",
        duration: "2 hours",
      },
    ]);
  });

  it("never borrows entertainment from a distinct overlapping same-name event", () => {
    const otherReservation = reservation({ localEventId: "88", tripleseatEventId: "88" });
    const otherSnapshot = { ...eventSnapshot(), eventId: "88", localEventId: "88", tripleseatEventId: "88", eventStartAt: otherReservation.startAt, eventEndAt: otherReservation.endAt };
    const scope = itineraryIdentityScope(plan, null, false, [plan, { ...plan, id: 88 }]);
    expect(itineraryReservationMatchesPlan(otherReservation, plan, scope)).toBe(false);
    expect(itinerarySnapshotMatchesPlan(otherSnapshot, plan, scope)).toBe(false);
    expect(applyEntertainmentDayToItinerary(plan, { ...day([otherReservation]), events: [otherSnapshot] }, scope)).toBe(plan);
  });

  it("permits legacy no-ID exact names only with a unique overlapping source event", () => {
    const legacy = reservation({ localEventId: null, tripleseatEventId: null });
    expect(itineraryReservationMatchesPlan(legacy, plan)).toBe(false);
    expect(itineraryReservationMatchesPlan(legacy, plan, itineraryIdentityScope(plan, null, false, [plan]))).toBe(true);
    expect(itineraryReservationMatchesPlan(legacy, plan, itineraryIdentityScope(plan, null, false, [plan, { ...plan, id: 88 }]))).toBe(false);
    expect(itineraryReservationMatchesPlan({ ...legacy, eventName: `${plan.name} VIP` }, plan, itineraryIdentityScope(plan, null, false, [plan]))).toBe(false);
    expect(itineraryReservationMatchesPlan({ ...legacy, startAt: "2026-08-08T02:00:00.000Z", endAt: "2026-08-08T03:00:00.000Z" }, plan, itineraryIdentityScope(plan, null, false, [plan]))).toBe(false);
  });

  it("rejects ambiguous saved source links rather than picking a floor-plan event", () => {
    const linkedEvent = { tripleseatEventId: String(plan.id), source: { sourceEventIds: ["older-source"] } };
    const savedLink = { eventDate: plan.date, events: [linkedEvent, linkedEvent] } as FloorPlanDocument;
    expect(itineraryIdentityScope(plan, savedLink, true).sourceEventIds).toEqual([]);
  });

  it("does not attach a same-name stale reservation outside the itinerary time", () => {
    const oemPlan: EventPlan = {
      ...plan,
      id: 62223662,
      name: "OEM Sales",
      date: "2026-09-15",
      day: "Tuesday",
      time: "6:00 PM - 8:00 PM",
    };
    const laterReservation = reservation({
      tripleseatEventId: null,
      localEventId: "vip-older-local-id",
      eventName: "OEM Sales VIP",
      operatingDate: "2026-09-15",
      startAt: "2026-09-16T00:30:00.000Z",
      endAt: "2026-09-16T01:30:00.000Z",
    });

    expect(
      applyEntertainmentDayToItinerary(
        oemPlan,
        {
          ...day([laterReservation]),
          date: "2026-09-15",
          events: [],
        },
      ),
    ).toBe(oemPlan);
  });
});
