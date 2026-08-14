import { describe, expect, it } from "vitest";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";

import { createMemoryEventPlanStorage } from "../storage";
import {
  findEventPlanById,
  loadEventPlanWindow,
  syncEventPlanWindow,
  syncRollingEventPlans,
} from "../sync";
import type { EventPlan, TripleseatEventPlanSource } from "../types";
import { confirmedContractEventPlans } from "../../confirmed-contract-events";

function source(
  overrides: Partial<TripleseatEventPlanSource> = {},
): TripleseatEventPlanSource {
  return {
    eventId: "62000001",
    bookingId: "71000001",
    eventName: "Redacted Live Event",
    localDate: "2026-08-15",
    eventStartAt: "2026-08-15T21:00:00.000Z",
    eventEndAt: "2026-08-15T23:00:00.000Z",
    guestCount: 40,
    status: "DEFINITE",
    rooms: ["VIP 1"],
    selections: [
      {
        name: "Tater Keg Platter",
        quantity: 1,
        sourceCategory: "Food Platters",
        isFood: true,
      },
      {
        name: "Hosted Bar",
        quantity: 1,
        sourceCategory: "Beverages",
        isFood: false,
      },
    ],
    documentItems: [
      {
        sourceId: "activity-1",
        name: "Bowling lanes 3-4",
        description: "Bowling lanes 3-4 from 6 PM - 8 PM",
        categoryName: "Entertainment",
        quantity: 2,
        startAt: "2026-08-15T22:00:00.000Z",
        endAt: "2026-08-16T00:00:00.000Z",
      },
    ],
    operationalNotes: [
      {
        source: "event-note",
        sourceId: "note-1",
        sourceCreatedAt: "2026-07-30T13:00:00.000Z",
        sourceUpdatedAt: "2026-07-30T14:00:00.000Z",
        text: "Set up the awards table by the TV.",
      },
    ],
    sourceUpdatedAt: "2026-07-30T14:00:00.000Z",
    ...overrides,
  };
}

function liveAdapter(
  handler: (
    startDate: string,
    endDate: string,
  ) => Promise<TripleseatEventPlanSource[]>,
): TripleseatAdapter {
  return {
    sourceMode: "live",
    fetchEventPlansForRange: handler,
    fetchEventsForDate: async () => [],
    fetchEventDateById: async () => null,
    getDiagnostics: () => ({
      sourceMode: "live",
      missingEnvironmentVariables: [],
      warnings: [],
      locationId: "26059",
    }),
  };
}

const legacyPlan: EventPlan = {
  id: 62000002,
  name: "Redacted Legacy Event",
  date: "2026-08-20",
  day: "Thursday",
  time: "5:00 PM - 7:00 PM",
  guest_count: 30,
  rooms: ["Main Dining Room"],
  color: "#18332F",
  food: ["Veggie Tray"],
  drink_options: ["Soft drinks included"],
  entertainment: [],
  verification_status: "Redacted legacy fallback.",
};

describe("rolling Event Host plan synchronization", () => {
  it("uses contract evidence until a newer successful live sync covers its date", async () => {
    let storageNow = new Date("2026-08-14T21:00:00.000Z");
    const storage = createMemoryEventPlanStorage({
      now: () => storageNow,
    });
    const window = {
      startDate: "2026-08-14",
      endDate: "2026-09-14",
    };

    await storage.start(window);
    await storage.replaceWindow(window, []);
    await storage.finish(0);
    const beforeNewerSync = await loadEventPlanWindow({
      now: new Date("2026-08-14T16:00:00.000Z"),
      storage,
      legacyPlans: confirmedContractEventPlans,
    });
    expect(beforeNewerSync.plans).toEqual([
      expect.objectContaining({
        id: 2026082101,
        name: "Manager Outing",
      }),
    ]);

    storageNow = new Date("2026-08-14T21:30:00.000Z");
    await storage.start(window);
    await storage.replaceWindow(window, []);
    await storage.finish(0);
    const afterNewerSync = await loadEventPlanWindow({
      now: new Date("2026-08-14T16:00:00.000Z"),
      storage,
      legacyPlans: confirmedContractEventPlans,
    });
    expect(afterNewerSync.plans).toEqual([]);
    await expect(
      findEventPlanById(2026082101, {
        storage,
        legacyPlans: confirmedContractEventPlans,
      }),
    ).resolves.toBeNull();
  });

  it("excludes LOST and PROSPECT events from synchronized operational views", async () => {
    const storage = createMemoryEventPlanStorage();
    const result = await syncEventPlanWindow(
      { startDate: "2026-08-15", endDate: "2026-08-15" },
      {
        storage,
        legacyPlans: [],
        adapter: liveAdapter(async () => [
          source(),
          source({ eventId: "62000003", status: " lost " }),
          source({ eventId: "62000004", status: "Prospect" }),
        ]),
      },
    );

    expect(result.plans.map((plan) => plan.id)).toEqual([62000001]);
    expect(result.sync?.eventCount).toBe(1);
  });

  it("hides a previously stored event after its source status becomes LOST", async () => {
    const storage = createMemoryEventPlanStorage();
    await storage.replaceWindow(
      { startDate: "2026-08-11", endDate: "2026-09-11" },
      [{
        eventId: "62000003",
        eventDate: "2026-08-15",
        plan: structuredClone(legacyPlan) as unknown as Record<string, unknown>,
        sourceSnapshot: source({ eventId: "62000003", status: "LOST" }) as unknown as Record<string, unknown>,
        sourceUpdatedAt: "2026-08-11T12:00:00.000Z",
      }],
    );

    const loaded = await loadEventPlanWindow({
      now: new Date("2026-08-11T16:00:00.000Z"),
      storage,
      legacyPlans: [],
    });

    expect(loaded.plans).toEqual([]);
    expect(await findEventPlanById(62000003, { storage, legacyPlans: [] })).toBeNull();
  });

  it("refreshes an exact requested date for Floor Plans", async () => {
    const storage = createMemoryEventPlanStorage();
    const requestedRanges: string[][] = [];

    const result = await syncEventPlanWindow(
      { startDate: "2026-08-15", endDate: "2026-08-15" },
      {
        now: new Date("2026-08-03T16:00:00.000Z"),
        storage,
        legacyPlans: [],
        adapter: liveAdapter(async (startDate, endDate) => {
          requestedRanges.push([startDate, endDate]);
          return [source()];
        }),
      },
    );

    expect(requestedRanges).toEqual([["2026-08-15", "2026-08-15"]]);
    expect(result.plans).toHaveLength(1);
    expect(result.sync).toMatchObject({
      windowStart: "2026-08-15",
      windowEnd: "2026-08-15",
      eventCount: 1,
      status: "success",
    });
  });

  it("refreshes the inclusive one-month window and persists note provenance", async () => {
    const storage = createMemoryEventPlanStorage();
    const requestedRanges: string[][] = [];

    const result = await syncRollingEventPlans({
      now: new Date("2026-07-30T16:00:00.000Z"),
      storage,
      legacyPlans: [],
      adapter: liveAdapter(async (startDate, endDate) => {
        requestedRanges.push([startDate, endDate]);
        return [source()];
      }),
    });

    expect(requestedRanges).toEqual([
      ["2026-07-30", "2026-08-30"],
    ]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      id: 62000001,
      date: "2026-08-15",
      guest_count: 40,
      rule_version: "event-plan-v1.0.2",
      synced_at: "2026-07-30T16:00:00.000Z",
      operational_notes: [
        expect.objectContaining({
          sourceId: "note-1",
          text: "Set up the awards table by the TV.",
        }),
      ],
    });
    expect(result.sync).toMatchObject({
      windowStart: "2026-07-30",
      windowEnd: "2026-08-30",
      status: "success",
      eventCount: 1,
    });
    expect(
      await findEventPlanById(62000001, {
        storage,
        legacyPlans: [],
      }),
    ).toMatchObject({ name: "Redacted Live Event" });
  });

  it("does not erase stored plans when Tripleseat refresh fails", async () => {
    const storage = createMemoryEventPlanStorage();
    await syncRollingEventPlans({
      now: new Date("2026-07-30T16:00:00.000Z"),
      storage,
      legacyPlans: [],
      adapter: liveAdapter(async () => [source()]),
    });

    await expect(
      syncRollingEventPlans({
        now: new Date("2026-07-31T16:00:00.000Z"),
        storage,
        legacyPlans: [],
        adapter: liveAdapter(async () => {
          throw new Error("Tripleseat temporarily unavailable.");
        }),
      }),
    ).rejects.toThrow("temporarily unavailable");

    const loaded = await loadEventPlanWindow({
      now: new Date("2026-07-31T16:00:00.000Z"),
      storage,
      legacyPlans: [],
    });
    expect(loaded.plans).toHaveLength(1);
    expect(loaded.sync).toMatchObject({
      status: "error",
      lastSuccessfulSyncAt: expect.any(String),
    });
  });

  it("uses only exact-ID legacy data before the first live sync", async () => {
    const storage = createMemoryEventPlanStorage();
    const loaded = await loadEventPlanWindow({
      now: new Date("2026-07-30T16:00:00.000Z"),
      storage,
      legacyPlans: [legacyPlan],
    });

    expect(loaded.plans).toEqual([legacyPlan]);
    expect(
      await findEventPlanById(62000002, {
        storage,
        legacyPlans: [legacyPlan],
      }),
    ).toEqual(legacyPlan);
    expect(
      await findEventPlanById(62000003, {
        storage,
        legacyPlans: [legacyPlan],
      }),
    ).toBeNull();
  });

  it("refuses to replace plans from a mock adapter", async () => {
    const storage = createMemoryEventPlanStorage();
    const adapter: TripleseatAdapter = {
      sourceMode: "mock",
      fetchEventsForDate: async () => [],
      fetchEventPlansForRange: async () => [],
      fetchEventDateById: async () => null,
      getDiagnostics: () => ({
        sourceMode: "mock",
        missingEnvironmentVariables: ["TRIPLESEAT_ACCESS_TOKEN"],
        warnings: [],
        locationId: "26059",
      }),
    };

    await expect(
      syncRollingEventPlans({
        now: new Date("2026-07-30T16:00:00.000Z"),
        storage,
        adapter,
        legacyPlans: [],
      }),
    ).rejects.toThrow("Live Tripleseat");
    expect(await storage.getSyncState()).toBeNull();
  });
});
