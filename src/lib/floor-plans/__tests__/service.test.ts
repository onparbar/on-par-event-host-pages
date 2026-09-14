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
  floorPlanEventsWithSavedIdentity,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanSources,
  reservationsForReconciledFloorPlanEvents,
} from "../service";
import { floorPlanEventColorsAreDistinct } from "../configuration/colors";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION } from "../types";
import type {
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanReservation,
} from "../types";

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
  it("migrates three saved source highlights onto one merged floor-plan event", () => {
    const event = (
      id: string,
      sourceEventId: string,
      contractedAreaIds: string[],
    ): FloorPlanEvent => ({
      id,
      floorPlanId: "floor-plan-2026-09-14",
      tripleseatEventId: sourceEventId,
      name: "No Host Social VIP",
      status: "DEFINITE",
      guestCount: 60,
      startAt: "2026-09-14T18:00:00-04:00",
      endAt: "2026-09-14T22:00:00-04:00",
      contractedAreaIds,
      unresolvedAreaNames: [],
      color: "#7C3AED",
      beoLastModifiedAt: "2026-09-14T14:40:10Z",
      fullBuyout: false,
      source: {
        rooms: [],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    });
    const tripleseat = event("event-tripleseat", "60526047", ["main-dining"]);
    const vip1 = event("event-vip-1", "vip-60cd18c0", ["vip-1"]);
    const vip2 = event("event-vip-2", "vip-af28fe8f", ["vip-2"]);
    const reservation = (
      floorPlanEventId: string,
      areaId: string,
      reservationType: FloorPlanReservation["reservationType"],
    ): FloorPlanReservation => ({
      id: `${floorPlanEventId}:${areaId}`,
      floorPlanEventId,
      areaId,
      reservationType,
      startAt: tripleseat.startAt,
      endAt: tripleseat.endAt,
      label: reservationType === "room" ? areaId.toUpperCase() : "",
      source: "generated",
      lockedByUser: false,
    });
    const saved: FloorPlanDocument = {
      id: "floor-plan-2026-09-14",
      eventDate: "2026-09-14",
      status: "Needs Review",
      version: 33,
      ruleVersion: "floor-plan-v1.3.2",
      lastTripleseatSyncAt: "2026-09-14T14:45:00Z",
      createdAt: "2026-09-14T14:00:00Z",
      updatedAt: "2026-09-14T14:45:00Z",
      approvedAt: null,
      approvedBy: null,
      events: [tripleseat, vip1, vip2],
      reservations: [
        reservation(tripleseat.id, "main-rect-left-1", "seating"),
        reservation(vip1.id, "vip-1", "room"),
        reservation(vip2.id, "vip-2", "room"),
      ],
    };
    const merged = event(vip1.id, vip1.tripleseatEventId, [
      "main-dining",
      "vip-1",
      "vip-2",
    ]);
    merged.source.sourceEventIds = [
      tripleseat.tripleseatEventId,
      vip1.tripleseatEventId,
      vip2.tripleseatEventId,
    ];
    merged.source.onParBookingAreaIds = ["vip-1", "vip-2"];

    const reconciled = reservationsForReconciledFloorPlanEvents(saved, [merged]);

    expect(
      reconciled.every(
        (item) => item.floorPlanEventId === merged.id,
      ),
    ).toBe(true);
    expect(reconciled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ areaId: "vip-1", reservationType: "room" }),
        expect.objectContaining({ areaId: "vip-2", reservationType: "room" }),
        expect.objectContaining({
          areaId: "main-rect-left-1",
          reservationType: "seating",
        }),
      ]),
    );
    expect(
      reconciled.some(
        (item) =>
          item.reservationType === "seating" &&
          item.areaId.startsWith("vip1-extra"),
      ),
    ).toBe(false);

    const oldPrimary = event(
      "event-old-primary",
      "vip-old-primary",
      ["vip-1"],
    );
    oldPrimary.source.sourceEventIds = [
      "vip-old-primary",
      "vip-still-current",
      "60526047",
    ];
    const savedWithChangedPrimary: FloorPlanDocument = {
      ...saved,
      events: [oldPrimary],
      reservations: [
        {
          id: "manual-vip-1",
          floorPlanEventId: oldPrimary.id,
          areaId: "vip-1",
          reservationType: "room",
          startAt: oldPrimary.startAt,
          endAt: oldPrimary.endAt,
          label: "VIP 1",
          source: "manual",
          lockedByUser: true,
        },
      ],
    };
    const newPrimary = event(
      "event-new-primary",
      "vip-still-current",
      ["vip-1", "vip-2"],
    );
    newPrimary.source.sourceEventIds = ["vip-still-current", "60526047"];

    expect(
      reservationsForReconciledFloorPlanEvents(savedWithChangedPrimary, [
        newPrimary,
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "manual-vip-1",
        floorPlanEventId: newPrimary.id,
        areaId: "vip-1",
        lockedByUser: true,
      }),
    ]);

    const legacyVip = event("legacy-vip", "vip-legacy", ["vip-1"]);
    const mergedAfterLegacy = event("merged-after-legacy", "vip-legacy", [
      "main-dining",
      "vip-1",
    ]);
    mergedAfterLegacy.source.sourceEventIds = ["60526047", "vip-legacy"];
    mergedAfterLegacy.source.onParBookingAreaIds = ["vip-1"];
    const legacyVipSaved: FloorPlanDocument = {
      ...saved,
      events: [legacyVip],
      reservations: [
        reservation(legacyVip.id, "vip-1", "room"),
        reservation(legacyVip.id, "vip1-extra-table-1", "seating"),
      ],
    };
    expect(
      reservationsForReconciledFloorPlanEvents(legacyVipSaved, [
        mergedAfterLegacy,
      ]).map((item) => item.areaId),
    ).toEqual(["vip-1"]);

    const customEvent = event("custom-event", "custom-source", [
      "main-dining",
    ]);
    const customSaved: FloorPlanDocument = {
      ...saved,
      events: [customEvent],
      reservations: [
        {
          ...reservation(customEvent.id, "main-dining", "custom"),
          id: "custom-note-1",
          source: "manual",
        },
        {
          ...reservation(customEvent.id, "main-dining", "custom"),
          id: "custom-note-2",
          source: "manual",
        },
      ],
    };
    expect(
      reservationsForReconciledFloorPlanEvents(customSaved, [customEvent]).map(
        (item) => item.id,
      ),
    ).toEqual(["custom-note-1", "custom-note-2"]);

    const savedMerged = event("saved-merged", "vip-split-1", [
      "vip-1",
      "vip-2",
    ]);
    savedMerged.source.sourceEventIds = ["vip-split-1", "vip-split-2"];
    const currentVip2 = event("current-vip-2", "vip-split-2", ["vip-2"]);
    const currentVip1 = event("current-vip-1", "vip-split-1", ["vip-1"]);
    const split = floorPlanEventsWithSavedIdentity(
      [currentVip2, currentVip1],
      [savedMerged],
    );
    expect(split.map((item) => item.id)).toEqual([
      "current-vip-2",
      "saved-merged",
    ]);
    expect(new Set(split.map((item) => item.id)).size).toBe(2);
    const savedSplitPlan: FloorPlanDocument = {
      ...saved,
      events: [savedMerged],
      reservations: [
        reservation(savedMerged.id, "vip-1", "room"),
        reservation(savedMerged.id, "vip-2", "room"),
      ],
    };
    expect(
      reservationsForReconciledFloorPlanEvents(savedSplitPlan, split).map(
        (item) => [item.areaId, item.floorPlanEventId],
      ),
    ).toEqual([
      ["vip-1", "saved-merged"],
      ["vip-2", "current-vip-2"],
    ]);

    const savedMixed = event("saved-mixed", "60526047", [
      "main-dining",
      "vip-1",
      "vip-2",
    ]);
    savedMixed.source.sourceEventIds = [
      "60526047",
      "vip-mixed-1",
      "vip-mixed-2",
    ];
    const splitMixed = floorPlanEventsWithSavedIdentity(
      [
        event("current-tripleseat", "60526047", ["main-dining"]),
        event("current-vip-1", "vip-mixed-1", ["vip-1"]),
        event("current-vip-2", "vip-mixed-2", ["vip-2"]),
      ],
      [savedMixed],
    );
    const mixedReservations = reservationsForReconciledFloorPlanEvents(
      {
        ...saved,
        events: [savedMixed],
        reservations: [
          reservation(savedMixed.id, "main-rect-left-1", "seating"),
          reservation(savedMixed.id, "vip-1", "room"),
          reservation(savedMixed.id, "vip-2", "room"),
        ],
      },
      splitMixed,
    );
    expect(
      mixedReservations.map((item) => [item.areaId, item.floorPlanEventId]),
    ).toEqual([
      ["main-rect-left-1", "saved-mixed"],
      ["vip-1", "current-vip-1"],
      ["vip-2", "current-vip-2"],
    ]);

    const staleTimeEvent = event("stale-time-event", "60526047", [
      "main-dining",
    ]);
    staleTimeEvent.startAt = "2026-09-14T17:00:00-04:00";
    staleTimeEvent.endAt = "2026-09-14T21:00:00-04:00";
    const authoritativeEvent = event(
      staleTimeEvent.id,
      "vip-authoritative",
      ["main-dining", "vip-1"],
    );
    authoritativeEvent.source.sourceEventIds = [
      "60526047",
      "vip-authoritative",
    ];
    authoritativeEvent.source.onParBookingAreaIds = ["vip-1"];
    const generatedStale = {
      ...reservation(
        staleTimeEvent.id,
        "main-rect-left-1",
        "seating",
      ),
      startAt: staleTimeEvent.startAt,
      endAt: staleTimeEvent.endAt,
    };
    const manualStale = {
      ...generatedStale,
      id: "manual-stale-time",
      areaId: "main-rect-left-2",
      source: "manual" as const,
      lockedByUser: true,
    };
    const reconciledTimes = reservationsForReconciledFloorPlanEvents(
      {
        ...saved,
        events: [staleTimeEvent],
        reservations: [generatedStale, manualStale],
      },
      [authoritativeEvent],
    );
    expect(reconciledTimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: generatedStale.id,
          startAt: authoritativeEvent.startAt,
          endAt: authoritativeEvent.endAt,
        }),
        expect.objectContaining({
          id: manualStale.id,
          startAt: staleTimeEvent.startAt,
          endAt: staleTimeEvent.endAt,
        }),
      ]),
    );
  });

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
        name: "Amazon 08/21/2026",
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
          reservation.eventName === "Amazon 08/21/2026" &&
          reservation.resourceCategory === "bowling",
      ),
    ).toHaveLength(5);
    expect(
      payload.entertainmentReservations.filter(
        (reservation) =>
          reservation.eventName === "Amazon 08/21/2026" &&
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
        food: ["1 × Tater Keg Platter"],
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
