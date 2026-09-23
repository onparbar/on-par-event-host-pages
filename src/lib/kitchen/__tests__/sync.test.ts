import { describe, expect, it, vi } from "vitest";
import {
  createMemoryKitchenStorage,
  SupabaseKitchenStorage,
} from "../storage";
import { quantityAwareReadinessKey } from "../readiness";
import { generateKitchenChecklist } from "../rules";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { confirmedContractKitchenSourcesForDate } from "../../confirmed-contract-events";
import {
  getKitchenEventFoodAddOns,
  getKitchenDay,
  normalizeKitchenEventAddOnFood,
  syncKitchenDay,
  syncVipBookingDay,
  updateKitchenEventFoodAddOns,
  updateKitchenItemCompletion,
  updateKitchenItemPrepped,
  updateKitchenItemReadiness,
  updateKitchenManualAssignments,
  updateKitchenManualBwa,
} from "../sync";
import type {
  TripleseatAdapter,
  TripleseatKitchenSourceEvent,
} from "../tripleseat";
import { vipPrepPayload } from "../../vip-prep/__tests__/fixtures";
import { vipPrepKitchenEvents } from "../../vip-prep/client";

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
  it("refreshes VIP bookings without Tripleseat sync and preserves other kitchen events", async () => {
    const storage = createMemoryKitchenStorage();
    const corporateEvent = {
      ...MOCK_KITCHEN_EVENTS[0],
      localDate: "2026-08-15",
    };
    await storage.saveEvent({
      sourceEvent: corporateEvent,
      checklist: generateKitchenChecklist(corporateEvent),
    });
    const fetchRange = vi.fn(async () => structuredClone(vipPrepPayload));
    const adapter = testAdapter(() => {
      throw new Error("Tripleseat is unavailable");
    });

    const day = await syncVipBookingDay("2026-08-15", {
      adapter,
      storage,
      vipPrepClient: { configured: true, fetchRange },
      now: viewingTime("2026-08-15"),
    });

    expect(fetchRange).toHaveBeenCalledExactlyOnceWith("2026-08-15", "2026-08-15");
    expect(day.bookingCount).toBe(1);
    expect(day.events.map((event) => event.event.eventId)).toEqual(
      expect.arrayContaining(["mock-taco-001", "vip-reservation-uuid"]),
    );
    expect((await storage.getDay("2026-08-15")).events).toHaveLength(2);
  });

  it("reports a booking feed failure without replacing the saved kitchen day", async () => {
    const storage = createMemoryKitchenStorage();
    const existing = {
      ...MOCK_KITCHEN_EVENTS[0],
      localDate: "2026-08-15",
    };
    await storage.saveEvent({
      sourceEvent: existing,
      checklist: generateKitchenChecklist(existing),
    });

    await expect(syncVipBookingDay("2026-08-15", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          throw new Error("network detail must not reach the UI");
        },
      },
      now: viewingTime("2026-08-15"),
    })).rejects.toThrow("OnPar bookings could not be refreshed.");
    expect((await storage.getDay("2026-08-15")).events.map(
      (event) => event.event.eventId,
    )).toEqual(["mock-taco-001"]);
  });

  it("keeps a red full-buyout event in the kitchen dashboard", async () => {
    const storage = createMemoryKitchenStorage();
    const result = await syncKitchenDay("2026-08-15", {
      adapter: testAdapter(() => [
        {
          eventId: "red-buyout-1",
          eventName: "Redacted Full Buyout",
          localDate: "2026-08-15",
          startTime: "2026-08-15T18:00:00-04:00",
          endTime: "2026-08-16T01:00:00-04:00",
          guestCount: 140,
          status: "PROSPECT",
          fullBuyout: true,
          room: "Full Building Buyout",
          selections: [
            {
              name: "Wing Bar",
              sourceCategory: "Wing Bar",
              quantity: 1,
              isFood: true,
            },
          ],
        },
      ]),
      storage,
      vipPrepClient: {
        configured: false,
        async fetchRange() {
          throw new Error("VIP Prep is disabled for this test.");
        },
      },
      now: viewingTime("2026-08-15"),
    });

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            eventId: "red-buyout-1",
            name: "Redacted Full Buyout",
            status: "PROSPECT",
          }),
        }),
      ]),
    );
  });

  it("shows the confirmed August 21 Wing Bar and five dessert platters", async () => {
    const storage = createMemoryKitchenStorage();
    const day = await getKitchenDay("2026-08-21", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: false,
        async fetchRange() {
          throw new Error("VIP Prep is disabled for this test.");
        },
      },
      now: viewingTime("2026-08-21"),
    });

    const checklist = day.events.find(
      (event) => event.event.name === "Amazon 08/21/2026",
    );
    expect(checklist).toBeDefined();
    expect(checklist?.event).toMatchObject({
      localDate: "2026-08-21",
      guestCount: 50,
      room: "VIP 1",
    });
    expect(checklist?.timing).toMatchObject({
      startTime: "2026-08-21T16:00",
      foodReadyBy: "2026-08-21T15:45",
      earliestPrepTime: "2026-08-21T14:45",
    });
    expect(
      checklist?.sections.flatMap((section) => section.rows),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          foodName: "Wings",
          quantity: 400,
          numberOfPans: 16,
          panSize: "1/3",
        }),
        expect.objectContaining({
          foodName: "Fries",
          quantity: 10,
          numberOfPans: 2,
          panSize: "1/2",
        }),
        expect.objectContaining({
          foodName: "Assorted Desserts",
          quantity: 5,
          numberOfPans: 5,
          unit: "pretzel plates",
          panSize: null,
        }),
      ]),
    );
    expect(checklist?.chafingDishes.total).toBe(1);
    await expect(storage.getEventDate("62238275")).resolves.toBe(
      "2026-08-21",
    );
    await updateKitchenManualAssignments(
      "62238275",
      ["Ryan"],
      ["Diana"],
      { storage },
    );
    const reloaded = await getKitchenDay("2026-08-21", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: false,
        async fetchRange() {
          throw new Error("VIP Prep is disabled for this test.");
        },
      },
      now: viewingTime("2026-08-21"),
    });
    expect(reloaded.events[0]).toMatchObject({
      foodRunners: ["Ryan"],
      pocs: ["Diana"],
    });
  });

  it("saves VIP booking prep under its stable kitchen event ID", async () => {
    const storage = createMemoryKitchenStorage();
    const day = await getKitchenDay("2026-08-15", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return structuredClone(vipPrepPayload);
        },
      },
      now: viewingTime("2026-08-15"),
    });

    expect(day.missingEnvironmentVariables).not.toContain("SUPABASE_SECRET_KEY");
    expect(day.events[0].event.eventId).toBe("vip-reservation-uuid");
    await expect(storage.getEventDate("vip-reservation-uuid")).resolves.toBe("2026-08-15");
    await updateKitchenManualAssignments(
      "vip-reservation-uuid",
      ["Ryan"],
      ["Diana"],
      { storage },
    );
    await updateKitchenEventFoodAddOns(
      "vip-reservation-uuid",
      { "tater-kegs": { quantity: 1 } },
      { storage },
    );
    const refreshed = await getKitchenDay("2026-08-15", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return structuredClone(vipPrepPayload);
        },
      },
      now: viewingTime("2026-08-15"),
    });
    expect(refreshed.events[0].foodRunners).toEqual(["Ryan"]);
    expect(refreshed.events[0].pocs).toEqual(["Diana"]);
    expect(refreshed.events[0].liveFoodAddOns).toEqual([
      expect.objectContaining({ itemKey: "addon:tater-kegs", quantity: 64 }),
    ]);
  });

  it("refreshes older VIP food labels even when the booking timestamp has not changed", async () => {
    const storage = createMemoryKitchenStorage();
    const payload = structuredClone(vipPrepPayload);
    payload.reservations[0].foodPrep[0].code = "tater-kegs";
    const sourceEvent = vipPrepKitchenEvents(payload.reservations)[0];
    const oldSource = {
      ...sourceEvent,
      selections: sourceEvent.selections.map((selection) => ({
        ...selection,
        name: "Tater Kegs",
      })),
    };
    await storage.saveEvent({ sourceEvent: oldSource, checklist: generateKitchenChecklist(oldSource) });

    const day = await getKitchenDay("2026-08-15", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return payload;
        },
      },
      now: viewingTime("2026-08-15"),
    });

    expect(day.events[0].sections.flatMap((section) => section.rows))
      .toContainEqual(expect.objectContaining({ key: "platter-tater-kegs", quantity: 128 }));
    expect(day.events[0].normalizedSelections[0].originalName).toBe("Tater Keg Platter");
  });

  it("uses the event booking instead of a same-name VIP reservation for prep", async () => {
    const eventBooking: TripleseatKitchenSourceEvent = {
      eventId: "tripleseat-event-123",
      bookingId: "tripleseat-booking-123",
      eventName: "Redacted VIP",
      localDate: "2026-08-15",
      startTime: "2026-08-15T17:00:00-04:00",
      endTime: "2026-08-15T20:00:00-04:00",
      guestCount: 40,
      status: "DEFINITE",
      room: "Main Dining",
      selections: [
        {
          name: "The Full Course",
          sourceCategory: "Food Packages",
          quantity: 40,
          isFood: true,
        },
        {
          name: "Wing Bar",
          quantity: 40,
          sourceCategory: "Food Packages",
          isFood: true,
        },
      ],
      specialNotes: [],
      sourceUpdatedAt: "2026-08-15T12:00:00.000Z",
      sourceState: "fresh",
    };
    const vipPayload = structuredClone(vipPrepPayload);
    vipPayload.reservations[0].eventName = "Redacted VIP";

    const day = await syncKitchenDay("2026-08-15", {
      adapter: testAdapter(() => [eventBooking]),
      storage: createMemoryKitchenStorage(),
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return vipPayload;
        },
      },
      now: viewingTime("2026-08-15"),
    });

    expect(day.events).toHaveLength(1);
    expect(day.events[0].event.eventId).toBe("tripleseat-event-123");
    expect(day.events[0].sections.flatMap((section) => section.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: "Wings", quantity: 320 }),
      ]),
    );
  });

  it("matches a VIP suffix to the event booking name", async () => {
    const eventBooking: TripleseatKitchenSourceEvent = {
      eventId: "tripleseat-buyout-924",
      eventName: "Peoples Buy out",
      localDate: "2026-09-24",
      startTime: "2026-09-24T18:00:00-04:00",
      endTime: "2026-09-25T01:00:00-04:00",
      guestCount: 200,
      status: "PROSPECT",
      fullBuyout: true,
      room: "Full Building Buyout",
      selections: [],
      specialNotes: [],
      sourceUpdatedAt: "2026-09-24T12:00:00.000Z",
      sourceState: "fresh",
    };
    const vipPayload = structuredClone(vipPrepPayload);
    vipPayload.reservations = vipPayload.reservations.map((reservation) => ({
      ...reservation,
      operatingDate: "2026-09-24",
      eventName: "Peoples Buy out VIP",
    }));

    const day = await syncKitchenDay("2026-09-24", {
      adapter: testAdapter(() => [eventBooking]),
      storage: createMemoryKitchenStorage(),
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return vipPayload;
        },
      },
      now: viewingTime("2026-09-24"),
    });

    expect(day.events.filter((event) => event.event.eventId.startsWith("vip-"))).toEqual([]);
    expect(day.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            eventId: "tripleseat-buyout-924",
            name: "Peoples Buy out",
          }),
        }),
      ]),
    );
  });

  it("replaces an older same-name kitchen snapshot with contract evidence", async () => {
    const storage = createMemoryKitchenStorage();
    const stale = confirmedContractKitchenSourcesForDate("2026-08-21")[0];
    stale.eventId = "older-manager-outing";
    stale.sourceUpdatedAt = "2026-08-14T20:00:00.000Z";
    stale.selections = [];
    await storage.replaceDay("2026-08-21", [
      { sourceEvent: stale, checklist: generateKitchenChecklist(stale) },
    ]);

    const day = await getKitchenDay("2026-08-21", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: false,
        fetchRange: async () => vipPrepPayload,
      },
      now: viewingTime("2026-08-21"),
    });

    expect(
      day.events.filter((event) => event.event.name === "Amazon 08/21/2026"),
    ).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ eventId: "62238275" }),
      }),
    ]);
  });

  it("replaces an older incomplete live Amazon kitchen source during sync", async () => {
    const incomplete = confirmedContractKitchenSourcesForDate("2026-08-21")[0];
    incomplete.selections = [];
    incomplete.sourceUpdatedAt = "2026-08-14T20:00:00.000Z";

    const day = await syncKitchenDay("2026-08-21", {
      adapter: testAdapter(() => [incomplete]),
      storage: createMemoryKitchenStorage(),
      vipPrepClient: {
        configured: false,
        fetchRange: async () => vipPrepPayload,
      },
      now: new Date("2026-08-14T22:00:00.000Z"),
    });

    expect(day.events).toHaveLength(1);
    expect(day.events[0].event.eventId).toBe("62238275");
    expect(day.events[0].sections.flatMap((section) => section.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: "Wings", quantity: 400 }),
        expect.objectContaining({ foodName: "Assorted Desserts", quantity: 5 }),
      ]),
    );
  });

  it("does not restore the confirmed Amazon kitchen event after Tripleseat marks it LOST", async () => {
    const lost = confirmedContractKitchenSourcesForDate("2026-08-21")[0];
    lost.status = "LOST";

    const day = await syncKitchenDay("2026-08-21", {
      adapter: testAdapter(() => [lost]),
      storage: createMemoryKitchenStorage(),
      vipPrepClient: { configured: false, fetchRange: async () => vipPrepPayload },
      now: new Date("2026-08-14T22:00:00.000Z"),
    });

    expect(day.events).toEqual([]);
  });

  it("imports paid VIP food quantities into the Kitchen checklist", async () => {
    const storage = createMemoryKitchenStorage();
    const day = await syncKitchenDay("2026-08-15", {
      adapter: testAdapter(() => []),
      storage,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return structuredClone(vipPrepPayload);
        },
      },
      now: viewingTime("2026-08-15"),
    });

    expect(day.events).toHaveLength(1);
    expect(day.events[0].event).toMatchObject({
      eventId: "vip-reservation-uuid",
      name: "Redacted VIP",
      room: "VIP 2",
    });
    expect(day.events[0].sections.flatMap((section) => section.rows)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: "Wings", quantity: 128 }),
      ]),
    );
  });

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

  it("validates and records the Prepped employee with one server timestamp", async () => {
    const storage = createMemoryKitchenStorage();
    const now = new Date("2026-08-14T16:05:00.000Z");

    await expect(
      updateKitchenItemPrepped(
        "staff-123",
        "taco-beef",
        true,
        null,
        { storage, now },
      ),
    ).rejects.toThrow("Select the employee who prepped this item.");
    await expect(
      updateKitchenItemPrepped(
        "staff-123",
        "taco-beef",
        true,
        "Not On Roster",
        { storage, now },
      ),
    ).rejects.toThrow("outside the approved roster");

    await expect(
      updateKitchenItemPrepped(
        "staff-123",
        "taco-beef",
        true,
        "  Diana  ",
        { storage, now },
      ),
    ).resolves.toEqual({
      eventId: "staff-123",
      itemKey: "taco-beef",
      prepped: true,
      employeeName: "Diana",
      preppedAt: "2026-08-14T16:05:00.000Z",
    });
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

  it("keeps ended events visible through their operating day", async () => {
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

    expect(visibleDay.archivedEventCount).toBe(0);
    expect(
      visibleDay.events.map((event) => String(event.event.eventId)),
    ).toEqual(["ended-event", "active-event"]);
    expect(
      visibleDay.addOnActivity.map((activity) => activity.eventId),
    ).toEqual(["ended-event", "active-event"]);
    expect(
      visibleDay.addOnCompletions.map((completion) => completion.eventId),
    ).toEqual(["ended-event", "active-event"]);

    const archivedDay = await getKitchenDay("2026-07-29", {
      adapter,
      storage,
      now: new Date("2026-07-30T04:00:00.000Z"),
    });

    expect(archivedDay.archivedEventCount).toBe(2);
    expect(archivedDay.events).toEqual([]);
    expect(archivedDay.addOnActivity).toEqual([]);
    expect(archivedDay.addOnCompletions).toEqual([]);
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
