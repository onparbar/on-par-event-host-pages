import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryEntertainmentStorage,
  setEntertainmentStorageForTests,
} from "@/lib/entertainment/storage";
import {
  createMemoryEventPlanStorage,
  setEventPlanStorageForTests,
} from "@/lib/event-plans/storage";
import type { TripleseatEventPlanSource } from "@/lib/event-plans/types";
import {
  setTripleseatAdapterForTests,
  type TripleseatAdapter,
} from "@/lib/kitchen/tripleseat";

import {
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanSources,
} from "../service";
import { MemoryFloorPlanStorage } from "../storage";

function source(): TripleseatEventPlanSource {
  return {
    eventId: "62001001",
    bookingId: "71001001",
    eventName: "Redacted Direct Tripleseat Event",
    localDate: "2026-08-06",
    eventStartAt: "2026-08-06T16:30:00-04:00",
    eventEndAt: "2026-08-06T19:30:00-04:00",
    guestCount: 12,
    status: "DEFINITE",
    rooms: ["VIP 1"],
    selections: [
      {
        sourceId: "food-1",
        name: "Tater Keg Platter",
        quantity: 1,
        sourceCategory: "Food Platters",
        isFood: true,
      },
    ],
    documentItems: [
      {
        sourceId: "activity-1",
        name: "Duckpin Bowling",
        description: "1 bowling lane from 5 PM - 7 PM",
        categoryName: "Entertainment",
        quantity: 1,
        startAt: "2026-08-06T17:00:00-04:00",
        endAt: "2026-08-06T19:00:00-04:00",
      },
    ],
    operationalNotes: [
      {
        source: "event-note",
        sourceId: "note-1",
        sourceCreatedAt: "2026-08-03T14:00:00Z",
        sourceUpdatedAt: "2026-08-03T15:00:00Z",
        text: "Set up the food table beside VIP 1.",
      },
    ],
    sourceUpdatedAt: "2026-08-03T15:00:00Z",
  };
}

function adapter(
  onRange: (startDate: string, endDate: string) => Promise<TripleseatEventPlanSource[]>,
): TripleseatAdapter {
  return {
    sourceMode: "live",
    fetchEventsForDate: async () => [],
    fetchEventPlansForRange: onRange,
    fetchEntertainmentEventsForDate: async () => [],
    fetchEventDateById: async () => null,
    getDiagnostics: () => ({
      sourceMode: "live",
      missingEnvironmentVariables: [],
      warnings: [],
      locationId: "26059",
    }),
  };
}

afterEach(() => {
  setEventPlanStorageForTests(null);
  setEntertainmentStorageForTests(null);
  setTripleseatAdapterForTests(null);
});

describe("Floor Plan Tripleseat source enforcement", () => {
  it("rebuilds the floor-plan event from the safe Tripleseat snapshot instead of legacy plan fields", async () => {
    const eventPlanStorage = createMemoryEventPlanStorage();
    const directSource = source();
    await eventPlanStorage.replaceWindow(
      { startDate: directSource.localDate, endDate: directSource.localDate },
      [
        {
          eventId: directSource.eventId,
          eventDate: directSource.localDate,
          plan: {
            id: Number(directSource.eventId),
            name: "Legacy Local Event",
            date: directSource.localDate,
            day: "Thursday",
            time: "1:00 PM - 2:00 PM",
            guest_count: 99,
            rooms: ["Main Dining Room"],
            color: "#000000",
            food: ["Legacy Food"],
            drink_options: [],
            entertainment: [],
            verification_status: "Legacy local data",
          },
          sourceSnapshot: directSource as unknown as Record<string, unknown>,
          sourceUpdatedAt: directSource.sourceUpdatedAt,
        },
      ],
    );
    setEventPlanStorageForTests(eventPlanStorage);
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(adapter(async () => []));

    const payload = await getFloorPlanDay(
      directSource.localDate,
      new MemoryFloorPlanStorage(),
    );

    expect(payload.plan.events).toHaveLength(1);
    expect(payload.plan.events[0]).toMatchObject({
      name: directSource.eventName,
      guestCount: 12,
      contractedAreaIds: ["vip-1"],
      source: {
        rooms: ["VIP 1"],
        food: ["Tater Keg Platter"],
        operationalNotes: [
          expect.objectContaining({
            sourceId: "note-1",
            text: "Set up the food table beside VIP 1.",
          }),
        ],
      },
    });
    expect(JSON.stringify(payload.plan.events[0])).not.toContain("Legacy");
  });

  it("refreshes the selected date from Tripleseat before generating reservations", async () => {
    const requestedRanges: string[][] = [];
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(
      adapter(async (startDate, endDate) => {
        requestedRanges.push([startDate, endDate]);
        return [source()];
      }),
    );

    const payload = await generateFloorPlan(
      "2026-08-06",
      "fill-missing",
      new MemoryFloorPlanStorage(),
    );

    expect(requestedRanges).toEqual([["2026-08-06", "2026-08-06"]]);
    expect(payload.plan.events.map((event) => event.name)).toEqual([
      "Redacted Direct Tripleseat Event",
    ]);
    expect(payload.plan.reservations.length).toBeGreaterThan(0);
  });

  it("persists a newly live-synced date before any floor-plan generation", async () => {
    const requestedRanges: string[][] = [];
    const floorPlanStorage = new MemoryFloorPlanStorage();
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(
      adapter(async (startDate, endDate) => {
        requestedRanges.push([startDate, endDate]);
        return [source()];
      }),
    );

    const payload = await refreshFloorPlanSources(
      "2026-08-06",
      floorPlanStorage,
    );

    expect(requestedRanges).toEqual([["2026-08-06", "2026-08-06"]]);
    expect(payload.plan.events.map((event) => event.name)).toEqual([
      "Redacted Direct Tripleseat Event",
    ]);
    expect(payload.plan.lastTripleseatSyncAt).not.toBeNull();
    expect(await floorPlanStorage.get("2026-08-06")).toMatchObject({
      eventDate: "2026-08-06",
      lastTripleseatSyncAt: payload.plan.lastTripleseatSyncAt,
    });
  });
});
