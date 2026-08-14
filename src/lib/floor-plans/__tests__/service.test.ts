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
  ensureConfirmedContractFloorPlanWindow,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanSources,
} from "../service";
import { floorPlanEventColorsAreDistinct } from "../configuration/colors";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION } from "../types";

function source(
  overrides: Partial<TripleseatEventPlanSource> = {},
): TripleseatEventPlanSource {
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
    ...overrides,
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
  it("creates the confirmed August 21 floor plan with VIP 1 and entertainment", async () => {
    const floorPlanStorage = new MemoryFloorPlanStorage();
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests({
      ...adapter(async () => []),
      sourceMode: "mock",
      getDiagnostics: () => ({
        sourceMode: "mock",
        missingEnvironmentVariables: [],
        warnings: [],
        locationId: "26059",
      }),
    });

    await ensureConfirmedContractFloorPlanWindow(
      "2026-08-14",
      floorPlanStorage,
    );
    const payload = await getFloorPlanDay(
      "2026-08-21",
      floorPlanStorage,
    );

    expect(payload.plan.events).toEqual([
      expect.objectContaining({
        name: "Manager Outing",
        guestCount: 50,
        contractedAreaIds: ["vip-1"],
      }),
    ]);
    expect(payload.plan.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ areaId: "vip-1", reservationType: "room" }),
        expect.objectContaining({ reservationType: "food-table" }),
      ]),
    );
    expect(
      payload.entertainmentReservations.filter(
        (reservation) =>
          reservation.eventName === "Manager Outing" &&
          reservation.resourceCategory === "bowling",
      ),
    ).toHaveLength(5);
    expect(
      payload.entertainmentReservations.filter(
        (reservation) =>
          reservation.eventName === "Manager Outing" &&
          reservation.resourceCategory === "darts",
      ),
    ).toHaveLength(4);

    await floorPlanStorage.save(
      {
        ...payload.plan,
        reservations: payload.plan.reservations.filter(
          (reservation) => reservation.reservationType !== "food-table",
        ),
      },
      "Test incomplete saved plan",
    );
    const repaired = await ensureConfirmedContractFloorPlanWindow(
      "2026-08-14",
      floorPlanStorage,
    );
    expect(repaired.results).toEqual([
      expect.objectContaining({ date: "2026-08-21", status: "generated" }),
    ]);
    const repairedPlan = await floorPlanStorage.get("2026-08-21");
    expect(
      repairedPlan?.reservations.some(
        (reservation) => reservation.reservationType === "food-table",
      ),
    ).toBe(true);
  });

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

  it("excludes PROSPECT and LOST events from operational floor plans", async () => {
    const floorPlanStorage = new MemoryFloorPlanStorage();
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(
      adapter(async () => [
        source(),
        source({
          eventId: "62001002",
          eventName: "Redacted Prospect Event",
          status: "PROSPECT",
        }),
        source({
          eventId: "62001003",
          eventName: "Redacted Lost Event",
          status: "LOST",
        }),
      ]),
    );

    const payload = await refreshFloorPlanSources(
      "2026-08-06",
      floorPlanStorage,
    );

    expect(payload.plan.events.map((event) => event.name)).toEqual([
      "Redacted Direct Tripleseat Event",
    ]);
  });

  it("removes saved holds when the Tripleseat event is no longer DEFINITE", async () => {
    const floorPlanStorage = new MemoryFloorPlanStorage();
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(adapter(async () => [source()]));
    await generateFloorPlan("2026-08-06", "fill-missing", floorPlanStorage);

    setTripleseatAdapterForTests(
      adapter(async () => [source({ status: "LOST" })]),
    );

    await expect(
      refreshFloorPlanSources("2026-08-06", floorPlanStorage),
    ).rejects.toThrow("No Tripleseat event plan is available for this date.");
    expect(await floorPlanStorage.get("2026-08-06")).toMatchObject({
      events: [],
      reservations: [],
    });
  });

  it("repairs visually similar saved event colors during live sync", async () => {
    const floorPlanStorage = new MemoryFloorPlanStorage();
    const sources = [
      source(),
      source({
        eventId: "62001002",
        bookingId: "71001002",
        eventName: "Second Redacted Tripleseat Event",
        eventStartAt: "2026-08-06T20:00:00-04:00",
        eventEndAt: "2026-08-06T22:00:00-04:00",
      }),
    ];
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
    setTripleseatAdapterForTests(adapter(async () => sources));

    const initial = await refreshFloorPlanSources(
      "2026-08-06",
      floorPlanStorage,
    );
    await floorPlanStorage.save(
      {
        ...initial.plan,
        events: initial.plan.events.map((event, index) => ({
          ...event,
          color: index === 0 ? "#0F766E" : "#047857",
        })),
      },
      "Test fixture with visually similar event colors.",
    );

    const refreshed = await refreshFloorPlanSources(
      "2026-08-06",
      floorPlanStorage,
    );
    const colors = refreshed.plan.events.map((event) => event.color);

    expect(colors).toHaveLength(2);
    expect(floorPlanEventColorsAreDistinct(colors[0], colors[1])).toBe(true);
    expect(refreshed.plan.ruleVersion).toBe(FLOOR_PLAN_RULE_VERSION);
  });
});
