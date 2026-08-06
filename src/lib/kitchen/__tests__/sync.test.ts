import { describe, expect, it } from "vitest";
import {
  createMemoryKitchenStorage,
  SupabaseKitchenStorage,
} from "../storage";
import { quantityAwareReadinessKey } from "../readiness";
import {
  getKitchenEventFoodAddOns,
  getKitchenDay,
  normalizeKitchenEventAddOnFood,
  syncKitchenDay,
  updateKitchenEventFoodAddOns,
  updateKitchenItemCompletion,
  updateKitchenItemReadiness,
  updateKitchenManualAssignments,
  updateKitchenManualBwa,
} from "../sync";
import type {
  TripleseatAdapter,
  TripleseatKitchenSourceEvent,
} from "../tripleseat";

function testAdapter(
  getEvents: () => TripleseatKitchenSourceEvent[],
): TripleseatAdapter {
  return {
    sourceMode: "mock",
    async fetchEventsForDate() {
      return getEvents();
    },
    async fetchEventDateById(eventId: string) {
      return (
        getEvents().find((event) => String(event.eventId) === eventId)
          ?.localDate ?? null
      );
    },
    getDiagnostics() {
      return {
        sourceMode: "mock",
        missingEnvironmentVariables: [],
        warnings: [],
        locationId: "26059",
      };
    },
  };
}

function viewingTime(date: string) {
  return new Date(`${date}T12:00:00-04:00`);
}

describe("kitchen synchronization", () => {
  it("refuses to persist mock events in the database backend", async () => {
    let requested = false;
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async () => {
        requested = true;
        return new Response(null, { status: 204 });
      },
    });
    const adapter = testAdapter(() => []);

    await expect(
      syncKitchenDay("2026-07-28", { adapter, storage }),
    ).rejects.toThrow(
      "Mock Tripleseat data cannot be persisted to the kitchen database.",
    );
    expect(requested).toBe(false);
  });

  it("persists multiple Food Runners and POCs independently", async () => {
    const storage = createMemoryKitchenStorage();
    const adapter = testAdapter(() => [
      {
        eventId: "staff-123",
        bookingId: null,
        eventName: "Staff assignment test",
        localDate: "2026-07-28",
        localDateVerified: true,
        startTime: "12:00",
        endTime: "14:00",
        guestCount: 20,
        status: "DEFINITE",
        statusVerified: true,
        room: "VIP 1",
        selections: [{ name: "Taco Bar", isFood: true }],
        specialNotes: [],
        sourceUpdatedAt: "2026-07-28T12:00:00Z",
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);
    await syncKitchenDay("2026-07-28", { adapter, storage });
    await updateKitchenManualAssignments(
      "staff-123",
      ["Ryan", "Diana"],
      ["Molly", "Taylor"],
      { storage },
    );

    const day = await getKitchenDay("2026-07-28", {
      adapter,
      storage,
      now: viewingTime("2026-07-28"),
    });
    expect(day.events[0].foodRunners).toEqual(["Ryan", "Diana"]);
    expect(day.events[0].pocs).toEqual(["Molly", "Taylor"]);
  });

  it("marks stored database events stale when live Tripleseat is unavailable", async () => {
    const storage = createMemoryKitchenStorage();
    const adapter = testAdapter(() => [
      {
        eventId: "stale-123",
        bookingId: null,
        eventName: "Stored Event",
        localDate: "2026-07-28",
        startTime: "17:00",
        endTime: "19:00",
        guestCount: 24,
        status: "DEFINITE",
        statusVerified: true,
        room: "Event Room",
        selections: [
          { name: "The Full Course", isFood: true },
          { name: "Taco Bar", isFood: true },
        ],
        specialNotes: [],
        sourceUpdatedAt: "2026-07-28T12:00:00Z",
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);

    await syncKitchenDay("2026-07-28", { adapter, storage });
    Object.defineProperty(storage, "persistence", {
      value: "database",
    });
    const day = await getKitchenDay("2026-07-28", {
      adapter,
      storage,
      now: viewingTime("2026-07-28"),
    });

    expect(day.events[0].needsReview).toBe(true);
    expect(
      day.events[0].warnings.some(
        (warning) => warning.code === "SOURCE_STALE",
      ),
    ).toBe(true);
  });

  it("preserves a manual BWA assignment across Tripleseat resyncs", async () => {
    const storage = createMemoryKitchenStorage();
    let sourceUpdatedAt = "2026-07-28T12:00:00Z";
    const adapter = testAdapter(() => [
      {
        eventId: "12345",
        bookingId: "67890",
        eventName: "Redacted Taco Event",
        localDate: "2026-07-28",
        startTime: "17:00",
        endTime: "19:00",
        guestCount: 48,
        status: "DEFINITE",
        statusVerified: true,
        room: "Event Room",
        selections: [
          { name: "The Full Course", isFood: true },
          { name: "Taco Bar", isFood: true },
        ],
        specialNotes: [],
        sourceUpdatedAt,
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);

    await syncKitchenDay("2026-07-28", { adapter, storage });
    await updateKitchenManualBwa("12345", "  Ryan  ", { storage });
    sourceUpdatedAt = "2026-07-28T13:00:00Z";
    await syncKitchenDay("2026-07-28", { adapter, storage });

    const day = await getKitchenDay("2026-07-28", {
      adapter,
      storage,
      now: viewingTime("2026-07-28"),
    });
    expect(day.events).toHaveLength(1);
    expect(day.events[0].foodRunnerOrBwa).toBe("Ryan");
    expect(day.bwaOptions).toEqual(
      expect.arrayContaining(["Adrian", "Molly", "Veronica"]),
    );
    expect(day.events[0].event.sourceUpdatedAt).toBe(
      "2026-07-28T13:00:00Z",
    );

    const failingAdapter: TripleseatAdapter = {
      ...adapter,
      async fetchEventsForDate() {
        throw new Error("temporary upstream error");
      },
    };
    await expect(
      syncKitchenDay("2026-07-28", {
        adapter: failingAdapter,
        storage,
      }),
    ).rejects.toThrow("Kitchen synchronization failed.");

    const failedDay = await getKitchenDay("2026-07-28", {
      adapter: failingAdapter,
      storage,
      now: viewingTime("2026-07-28"),
    });
    expect(failedDay.syncStatus).toBe("error");
    expect(failedDay.events[0].needsReview).toBe(true);
    expect(
      failedDay.events[0].warnings.some(
        (warning) => warning.code === "SOURCE_SYNC_FAILED",
      ),
    ).toBe(true);
    expect(failedDay.events[0].foodRunnerOrBwa).toBe("Ryan");
  });

  it("preserves the safe reconnect instruction when Tripleseat rejects a refresh token", async () => {
    const storage = createMemoryKitchenStorage();
    const message = "Tripleseat OAuth refresh was rejected (400). Reconnect Tripleseat before refreshing Event Host.";
    const adapter: TripleseatAdapter = {
      sourceMode: "live",
      getDiagnostics: () => ({
        sourceMode: "live",
        missingEnvironmentVariables: [],
        warnings: [],
        locationId: "test",
      }),
      async fetchEventsForDate() {
        throw new Error(message);
      },
      async fetchEventDateById() {
        return null;
      },
    };

    await expect(
      syncKitchenDay("2026-07-28", { adapter, storage }),
    ).rejects.toThrow(message);
    await expect(storage.getDay("2026-07-28")).resolves.toMatchObject({
      sync: { errorMessage: message },
    });
  });

  it("preserves item readiness across Tripleseat resyncs", async () => {
    const storage = createMemoryKitchenStorage();
    const adapter = testAdapter(() => [
      {
        eventId: "12345",
        bookingId: null,
        eventName: "Redacted Appetizer Event",
        localDate: "2026-07-29",
        startTime: "17:00",
        endTime: "19:00",
        guestCount: 24,
        status: "DEFINITE",
        statusVerified: true,
        room: "Event Room",
        selections: [
          { name: "The Full Course", isFood: true },
          { name: "Appetizer Bar", isFood: true },
        ],
        specialNotes: [],
        sourceUpdatedAt: "2026-07-29T12:00:00Z",
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);

    await syncKitchenDay("2026-07-29", { adapter, storage });
    await updateKitchenItemReadiness(
      "12345",
      "appetizer-chicken-tenders",
      true,
      { storage },
    );
    await syncKitchenDay("2026-07-29", { adapter, storage });

    const day = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(day.events[0].completedItemKeys).toEqual([
      "appetizer-chicken-tenders",
    ]);

    await updateKitchenItemReadiness(
      "12345",
      "appetizer-chicken-tenders",
      false,
      { storage },
    );
    const uncheckedDay = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(uncheckedDay.events[0].completedItemKeys).toEqual([]);
  });

  it("preserves final item completion independently across Tripleseat resyncs", async () => {
    const storage = createMemoryKitchenStorage();
    const adapter = testAdapter(() => [
      {
        eventId: "completed-123",
        bookingId: null,
        eventName: "Redacted Completed Event",
        localDate: "2026-07-29",
        startTime: "17:00",
        endTime: "19:00",
        guestCount: 24,
        status: "DEFINITE",
        statusVerified: true,
        room: "Event Room",
        selections: [
          { name: "The Full Course", isFood: true },
          { name: "Appetizer Bar", isFood: true },
        ],
        specialNotes: [],
        sourceUpdatedAt: "2026-07-29T12:00:00Z",
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);

    await syncKitchenDay("2026-07-29", { adapter, storage });
    await updateKitchenItemCompletion(
      "completed-123",
      "appetizer-chicken-tenders",
      true,
      { storage },
    );
    await syncKitchenDay("2026-07-29", { adapter, storage });

    const day = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(day.events[0].completedItemKeys).toEqual([]);
    expect(day.events[0].finalCompletedItemKeys).toEqual([
      "appetizer-chicken-tenders",
    ]);

    await updateKitchenItemCompletion(
      "completed-123",
      "appetizer-chicken-tenders",
      false,
      { storage },
    );
    const uncheckedDay = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(uncheckedDay.events[0].finalCompletedItemKeys).toEqual([]);
  });

  it("archives ended events without deleting active add-on alert metadata", async () => {
    const storage = createMemoryKitchenStorage();
    const baseEvent = {
      bookingId: null,
      localDate: "2026-07-29",
      guestCount: 24,
      status: "DEFINITE",
      statusVerified: true,
      room: "Event Room",
      selections: [
        { name: "The Full Course", isFood: true },
        { name: "Taco Bar", isFood: true },
      ],
      specialNotes: [],
      sourceUpdatedAt: "2026-07-29T12:00:00Z",
      sourceState: "fresh" as const,
      documentMetadata: [],
    };
    const adapter = testAdapter(() => [
      {
        ...baseEvent,
        eventId: "ended-event",
        eventName: "Redacted Ended Event",
        startTime: "09:00",
        endTime: "10:00",
      },
      {
        ...baseEvent,
        eventId: "active-event",
        eventName: "Redacted Active Event",
        startTime: "17:00",
        endTime: "19:00",
      },
    ]);

    await syncKitchenDay("2026-07-29", { adapter, storage });
    for (const eventId of ["ended-event", "active-event"]) {
      await updateKitchenEventFoodAddOns(
        eventId,
        { wings: { quantity: 1 } },
        { storage },
      );
    }
    const storedDay = await storage.getDay("2026-07-29");
    for (const checklist of storedDay.events) {
      const addOn = checklist.liveFoodAddOns[0];
      await storage.saveItemReadiness(
        String(checklist.event.eventId),
        quantityAwareReadinessKey({
          ...addOn,
          ruleVersion: checklist.ruleVersion,
        }),
        true,
      );
    }

    const visibleDay = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });

    expect(visibleDay.archivedEventCount).toBe(1);
    expect(
      visibleDay.events.map((event) => String(event.event.eventId)),
    ).toEqual(["active-event"]);
    expect(
      visibleDay.addOnActivity.map((activity) => activity.eventId),
    ).toEqual(["active-event"]);
    expect(
      visibleDay.addOnCompletions.map((completion) => completion.eventId),
    ).toEqual(["active-event"]);
    expect(await storage.getEventDate("ended-event")).toBe("2026-07-29");
  });

  it("validates event IDs, item keys, and readiness values", async () => {
    const storage = createMemoryKitchenStorage();

    await expect(
      updateKitchenItemReadiness(" 12345 ", " addon:wings ", true, {
        storage,
      }),
    ).resolves.toEqual({
      eventId: "12345",
      itemKey: "addon:wings",
      ready: true,
    });
    await expect(
      updateKitchenItemReadiness("../event", "taco-beef", true, {
        storage,
      }),
    ).rejects.toThrow("Invalid kitchen event ID.");
    await expect(
      updateKitchenItemReadiness("12345", "item with spaces", true, {
        storage,
      }),
    ).rejects.toThrow("Invalid kitchen item key.");
    await expect(
      updateKitchenItemReadiness(
        "12345",
        "taco-beef",
        "true" as unknown as boolean,
        { storage },
      ),
    ).rejects.toThrow("Kitchen item readiness must be a boolean.");
    await expect(
      updateKitchenItemCompletion(
        "12345",
        "taco-beef",
        "true" as unknown as boolean,
        { storage },
      ),
    ).rejects.toThrow("Kitchen item completion must be a boolean.");
  });

  it("normalizes all allowlisted add-ons and persists them across resyncs", async () => {
    const storage = createMemoryKitchenStorage();
    const adapter = testAdapter(() => [
      {
        eventId: "preview-alpha",
        bookingId: null,
        eventName: "Redacted Add-On Event",
        localDate: "2026-07-29",
        startTime: "17:00",
        endTime: "19:00",
        guestCount: 24,
        status: "DEFINITE",
        statusVerified: true,
        room: "Event Room",
        selections: [
          { name: "The Full Course", isFood: true },
          { name: "Taco Bar", isFood: true },
        ],
        specialNotes: [],
        sourceUpdatedAt: "2026-07-29T12:00:00Z",
        sourceState: "fresh",
        documentMetadata: [],
      },
    ]);
    const allFood = {
      wings: { quantity: "1", manualPrice: "120" },
      "mozzarella-sticks": 1,
      "tater-kegs": { quantity: 1 },
      "fry-platters": { quantity: "1" },
      "chicken-tenders": { quantity: 1 },
      "veggie-tray": { quantity: "1" },
      "bbq-sauce": { quantity: 1 },
      "garlic-parm": { quantity: "1" },
      "buffalo-sauce": { quantity: 1 },
      ranch: { quantity: "1" },
      "dessert-platter": { quantity: 1 },
    };

    await syncKitchenDay("2026-07-29", { adapter, storage });
    const saved = await updateKitchenEventFoodAddOns(
      "preview-alpha",
      allFood,
      { storage },
    );
    expect(saved.eventId).toBe("preview-alpha");
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.food).toEqual({
      wings: { quantity: 1 },
      "mozzarella-sticks": { quantity: 1 },
      "tater-kegs": { quantity: 1 },
      "fry-platters": { quantity: 1 },
      "chicken-tenders": { quantity: 1 },
      "veggie-tray": { quantity: 1 },
      "bbq-sauce": { quantity: 1 },
      "garlic-parm": { quantity: 1 },
      "buffalo-sauce": { quantity: 1 },
      ranch: { quantity: 1 },
      "dessert-platter": { quantity: 1 },
    });

    await syncKitchenDay("2026-07-29", { adapter, storage });
    await expect(
      getKitchenEventFoodAddOns("preview-alpha", { storage }),
    ).resolves.toEqual(saved);
    const day = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(day.events[0].liveFoodAddOns).toHaveLength(11);
    expect(day.events[0].liveFoodAddOns.map((item) => item.itemKey)).toEqual([
      "addon:wings",
      "addon:mozzarella-sticks",
      "addon:tater-kegs",
      "addon:fry-platters",
      "addon:chicken-tenders",
      "addon:veggie-tray",
      "addon:bbq-sauce",
      "addon:garlic-parm",
      "addon:buffalo-sauce",
      "addon:ranch",
      "addon:dessert-platter",
    ]);
    expect(day.addOnActivity).toEqual([
      expect.objectContaining({
        eventId: "preview-alpha",
        eventName: "Redacted Add-On Event",
        revision: 1,
        itemNames: [
          "Wings",
          "Mozzarella Sticks",
          "Tater Kegs",
          "Fries",
          "Chicken Tenders",
          "Veggie Tray",
          "BBQ Sauce",
          "Garlic Parm",
          "Buffalo Sauce",
          "Ranch",
          "Dessert Platter",
        ],
      }),
    ]);
    expect(day.addOnCompletions).toEqual([]);

    const wings = day.events[0].liveFoodAddOns[0];
    const wingsReadinessKey = quantityAwareReadinessKey({
      ...wings,
      ruleVersion: day.events[0].ruleVersion,
    });
    await updateKitchenItemReadiness(
      "preview-alpha",
      wingsReadinessKey,
      true,
      { storage },
    );
    const completedDay = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: viewingTime("2026-07-29"),
    });
    expect(completedDay.addOnCompletions).toEqual([
      expect.objectContaining({
        eventId: "preview-alpha",
        itemKey: "addon:wings",
        foodName: "Wings",
        readinessUpdatedAt: expect.any(String),
      }),
    ]);

    await storage.replaceDay("2026-07-29", []);
    await expect(storage.getFoodAddOns("preview-alpha")).resolves.toBeNull();
  });

  it("validates full add-on snapshots and treats blank or zero as removal", async () => {
    expect(
      normalizeKitchenEventAddOnFood({
        wings: { quantity: "" },
        ranch: 0,
        "dessert-platter": { quantity: "2" },
      }),
    ).toEqual({
      "dessert-platter": { quantity: 2 },
    });
    expect(() =>
      normalizeKitchenEventAddOnFood({
        "unknown-food": { quantity: 1 },
      }),
    ).toThrow("Unknown kitchen food add-on key: unknown-food.");
    expect(() =>
      normalizeKitchenEventAddOnFood({
        wings: { quantity: "1.5" },
      }),
    ).toThrow(
      'Food add-on "wings" quantity must be a positive whole number.',
    );
    expect(() =>
      normalizeKitchenEventAddOnFood({
        wings: { quantity: -1 },
      }),
    ).toThrow(
      'Food add-on "wings" quantity must be a positive whole number.',
    );
    expect(
      normalizeKitchenEventAddOnFood({
        wings: { quantity: 10 },
        ranch: { quantity: 9999 },
      }),
    ).toEqual({
      wings: { quantity: 10 },
      ranch: { quantity: 9999 },
    });
    expect(() =>
      normalizeKitchenEventAddOnFood({
        wings: { quantity: 11 },
      }),
    ).toThrow('Food add-on "wings" cannot exceed 10 platters.');
    expect(() => normalizeKitchenEventAddOnFood([])).toThrow(
      "Kitchen food add-ons must be an object.",
    );

    const storage = createMemoryKitchenStorage();
    await expect(
      updateKitchenEventFoodAddOns("missing-event", { wings: 1 }, {
        storage,
      }),
    ).rejects.toThrow("Kitchen event was not found.");
    await expect(
      getKitchenEventFoodAddOns("../event", { storage }),
    ).rejects.toThrow("Invalid kitchen event ID.");
  });
});
