import { describe, expect, it } from "vitest";
import type { TripleseatAdapter } from "../../kitchen/tripleseat";
import {
  createManualEntertainmentReservation,
  EntertainmentConflictError,
  getEntertainmentDay,
  getEntertainmentReservationAudit,
  syncEntertainmentDay,
  updateEntertainmentReservation,
} from "../sync";
import {
  MemoryEntertainmentStorage,
  SupabaseEntertainmentStorage,
} from "../storage";
import type { EntertainmentSourceEvent } from "../types";
import { vipPrepPayload } from "../../vip-prep/__tests__/fixtures";
import {
  confirmedContractEntertainmentSourcesForDate,
} from "../../confirmed-contract-events";

const DATE = "2026-07-28";

function sourceEvent(): EntertainmentSourceEvent {
  return {
    tripleseatEventId: "ts-sync-1",
    tripleseatBookingId: "booking-sync-1",
    eventName: "Redacted Sync Event",
    localDate: DATE,
    eventStartAt: "2026-07-28T21:00:00.000Z",
    eventEndAt: "2026-07-28T22:00:00.000Z",
    status: "DEFINITE",
    rooms: [],
    items: [
      {
        sourceId: "line-sync-1",
        name: "Bowling Lane 1",
        description: "Bowling Lane 1",
        categoryName: "Bowling",
        quantity: 1,
        startAt: "2026-07-28T21:00:00.000Z",
        endAt: "2026-07-28T22:00:00.000Z",
      },
    ],
    categoryNames: ["Bowling"],
    sourceUpdatedAt: "2026-07-28T20:00:00.000Z",
    noteCount: 0,
  };
}

function adapter(events: EntertainmentSourceEvent[]): TripleseatAdapter {
  return {
    sourceMode: "live",
    async fetchEventsForDate() {
      return [];
    },
    async fetchEntertainmentEventsForDate() {
      return structuredClone(events);
    },
    async fetchEventDateById() {
      return null;
    },
    getDiagnostics() {
      return {
        sourceMode: "live",
        missingEnvironmentVariables: [],
        warnings: [],
        locationId: "26059",
      };
    },
  };
}

const localEvents = [
  {
    id: "ts-sync-1",
    bookingId: "booking-sync-1",
    name: "Redacted Sync Event",
    date: DATE,
    color: "#297025",
    rooms: [],
    entertainment: [],
  },
];

describe("persistent entertainment synchronization", () => {
  it("shows the confirmed August 21 bowling and darts schedule", async () => {
    const storage = new MemoryEntertainmentStorage();
    const day = await getEntertainmentDay("2026-08-21", {
      storage,
      adapter: adapter([]),
      vipPrepClient: {
        configured: false,
        async fetchRange() {
          throw new Error("VIP Prep is disabled for this test.");
        },
      },
    });

    const managerReservations = day.reservations.filter(
      (reservation) => reservation.eventName === "Amazon 08/21/2026",
    );
    expect(
      managerReservations.filter(
        (reservation) => reservation.resourceCategory === "bowling",
      ),
    ).toHaveLength(5);
    expect(
      managerReservations.filter(
        (reservation) => reservation.resourceCategory === "darts",
      ),
    ).toHaveLength(4);
    expect(
      managerReservations.filter(
        (reservation) => reservation.resourceId === "private-room-vip-1",
      ),
    ).toHaveLength(1);
    expect(
      managerReservations.filter((reservation) =>
        ["bowling", "darts"].includes(reservation.resourceCategory),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startAt: "2026-08-21T20:30:00.000Z",
          endAt: "2026-08-21T22:30:00.000Z",
          source: "event-host-fallback",
        }),
      ]),
    );
    const bowling = managerReservations.find(
      (reservation) => reservation.resourceCategory === "bowling",
    );
    expect(bowling).toBeDefined();
    await expect(storage.getReservation(bowling!.id)).resolves.toMatchObject({
      eventName: "Amazon 08/21/2026",
    });
    await updateEntertainmentReservation(
      bowling!.id,
      {
        operatingDate: "2026-08-21",
        eventId: bowling!.tripleseatEventId,
        eventName: bowling!.eventName,
        resourceId: bowling!.resourceId,
        startAt: bowling!.startAt,
        endAt: bowling!.endAt,
        eventColor: "#7C3AED",
        notes: "Staff verified the assigned lane.",
        reason: "Contract evidence verification",
        needsReview: false,
        forceConflict: false,
      },
      { storage },
    );
    await expect(storage.getReservation(bowling!.id)).resolves.toMatchObject({
      eventColor: "#7C3AED",
      notes: "Staff verified the assigned lane.",
    });
  });

  it("replaces an older incomplete live Amazon entertainment source during sync", async () => {
    const incomplete =
      confirmedContractEntertainmentSourcesForDate("2026-08-21")[0];
    incomplete.items = [];
    incomplete.sourceUpdatedAt = "2026-08-14T20:00:00.000Z";

    const day = await syncEntertainmentDay("2026-08-21", {
      storage: new MemoryEntertainmentStorage(),
      adapter: adapter([incomplete]),
      localEvents: [],
      vipPrepClient: {
        configured: false,
        fetchRange: async () => vipPrepPayload,
      },
    });

    const amazon = day.reservations.filter(
      (reservation) => reservation.tripleseatEventId === "62238275",
    );
    expect(
      amazon.filter(
        (reservation) => reservation.resourceCategory === "bowling",
      ),
    ).toHaveLength(5);
    expect(
      amazon.filter(
        (reservation) => reservation.resourceCategory === "darts",
      ),
    ).toHaveLength(4);
  });

  it("does not restore the confirmed Amazon schedule after Tripleseat marks it PROSPECT", async () => {
    const prospect =
      confirmedContractEntertainmentSourcesForDate("2026-08-21")[0];
    prospect.status = "PROSPECT";

    const day = await syncEntertainmentDay("2026-08-21", {
      storage: new MemoryEntertainmentStorage(),
      adapter: adapter([prospect]),
      localEvents: [],
      vipPrepClient: {
        configured: false,
        fetchRange: async () => vipPrepPayload,
      },
    });

    expect(day.events).toEqual([]);
    expect(day.reservations).toEqual([]);
  });

  it("reads the VIP schedule directly without Supabase persistence", async () => {
    const day = await getEntertainmentDay("2026-08-15", {
      storage: new MemoryEntertainmentStorage(),
      adapter: adapter([]),
      localEvents: [],
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return structuredClone(vipPrepPayload);
        },
      },
    });

    expect(day.missingEnvironmentVariables).not.toContain("SUPABASE_SECRET_KEY");
    expect(day.reservations[0]).toMatchObject({
      resourceId: "private-room-vip-2",
      source: "vip-prep",
    });
  });

  it("writes contract reservations before the event snapshot", async () => {
    const day = await getEntertainmentDay("2026-08-21", {
      storage: new MemoryEntertainmentStorage(),
      adapter: adapter([]),
      vipPrepClient: { configured: false, fetchRange: async () => vipPrepPayload },
    });
    const requestedTables: string[] = [];
    const storage = new SupabaseEntertainmentStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input) => {
        requestedTables.push(String(input));
        return new Response(null, { status: 500 });
      },
    });

    await expect(
      storage.saveContractEvidence({
        events: day.events,
        reservations: day.reservations,
      }),
    ).rejects.toThrow("Entertainment database request failed (500).");
    expect(requestedTables).toHaveLength(1);
    expect(requestedTables[0]).toContain("entertainment_reservations");
  });

  it("imports a paid VIP reservation onto the exact VIP room", async () => {
    const synced = await syncEntertainmentDay("2026-08-15", {
      storage: new MemoryEntertainmentStorage(),
      adapter: adapter([]),
      localEvents: [],
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return structuredClone(vipPrepPayload);
        },
      },
    });

    expect(synced.reservations).toHaveLength(1);
    expect(synced.reservations[0]).toMatchObject({
      tripleseatEventId: "vip-reservation-uuid",
      resourceId: "private-room-vip-2",
      resourceName: "VIP 2",
      source: "vip-prep",
      startAt: "2026-08-15T22:00:00.000Z",
      endAt: "2026-08-16T00:00:00.000Z",
      needsReview: false,
    });
  });

  it("uses the known event window when mock entertainment timing needs review", async () => {
    const storage = new MemoryEntertainmentStorage();
    const mockAdapter: TripleseatAdapter = {
      ...adapter([]),
      sourceMode: "mock",
      getDiagnostics() {
        return {
          sourceMode: "mock",
          missingEnvironmentVariables: [],
          warnings: [],
          locationId: "26059",
        };
      },
    };
    const synced = await syncEntertainmentDay(DATE, {
      storage,
      adapter: mockAdapter,
      localEvents: [
        {
          ...localEvents[0],
          eventTime: "5:00 PM - 6:00 PM",
          entertainment: [
            {
              name: "Duckpin Bowling",
              quantity: "1 lane",
              time: "Time not listed on BEO",
            },
          ],
        },
      ],
    });
    expect(synced.reservations).toHaveLength(1);
    expect(synced.reservations[0]).toMatchObject({
      startAt: "2026-07-28T21:00:00.000Z",
      endAt: "2026-07-28T22:00:00.000Z",
      needsReview: true,
    });
    expect(synced.reservations[0].reviewIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TIME_NEEDS_REVIEW" })]),
    );
  });

  it("rejects untrusted reservation IDs before querying storage", async () => {
    const storage = new MemoryEntertainmentStorage();
    await expect(
      getEntertainmentReservationAudit("../not-a-reservation", { storage }),
    ).rejects.toThrow("Invalid entertainment reservation ID");
  });

  it("is idempotent and records a sync-create audit only once", async () => {
    const storage = new MemoryEntertainmentStorage();
    const dependencies = {
      storage,
      adapter: adapter([sourceEvent()]),
      localEvents,
    };
    const first = await syncEntertainmentDay(DATE, dependencies);
    const second = await syncEntertainmentDay(DATE, dependencies);
    expect(first.reservations).toHaveLength(1);
    expect(second.reservations).toHaveLength(1);
    expect(second.reservations[0].id).toBe(first.reservations[0].id);
    expect(
      await storage.getAudit(second.reservations[0].id),
    ).toHaveLength(1);
  });

  it("keeps an authenticated manual edit after a later Tripleseat sync", async () => {
    const storage = new MemoryEntertainmentStorage();
    const dependencies = {
      storage,
      adapter: adapter([sourceEvent()]),
      localEvents,
    };
    const synced = await syncEntertainmentDay(DATE, dependencies);
    const original = synced.reservations[0];
    await updateEntertainmentReservation(
      original.id,
      {
        operatingDate: DATE,
        eventId: original.localEventId,
        eventName: original.eventName,
        resourceId: "bowling-6",
        startAt: "2026-07-28T22:00:00.000Z",
        endAt: "2026-07-28T23:00:00.000Z",
        eventColor: original.eventColor,
        notes: "Confirmed by event host.",
        reason: "Guest timing changed.",
      },
      { storage },
    );
    const resynced = await syncEntertainmentDay(DATE, dependencies);
    expect(resynced.reservations[0]).toMatchObject({
      resourceId: "bowling-6",
      startAt: "2026-07-28T22:00:00.000Z",
      manualOverride: true,
    });
    expect(await storage.getAudit(original.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "manual-update" }),
        expect.objectContaining({ action: "sync-create" }),
      ]),
    );
  });

  it("applies a linked event color to every reservation and keeps it after sync", async () => {
    const storage = new MemoryEntertainmentStorage();
    const source = sourceEvent();
    source.items = [
      {
        ...source.items[0],
        name: "Bowling Lanes 1-2",
        description: "Bowling Lanes 1-2",
        quantity: 2,
      },
    ];
    const dependencies = {
      storage,
      adapter: adapter([source]),
      localEvents,
    };
    const synced = await syncEntertainmentDay(DATE, dependencies);
    expect(synced.reservations).toHaveLength(2);

    const original = synced.reservations[0];
    await updateEntertainmentReservation(
      original.id,
      {
        operatingDate: DATE,
        eventId: original.tripleseatEventId,
        eventName: original.eventName,
        resourceId: original.resourceId,
        startAt: original.startAt,
        endAt: original.endAt,
        eventColor: "#7C3AED",
        reason: "Changed the event highlight color.",
      },
      { storage },
    );

    const updated = await getEntertainmentDay(DATE, dependencies);
    expect(updated.events[0]).toMatchObject({
      eventColor: "#7C3AED",
      colorSource: "manual",
    });
    expect(
      new Set(updated.reservations.map((reservation) => reservation.eventColor)),
    ).toEqual(new Set(["#7C3AED"]));

    const resynced = await syncEntertainmentDay(DATE, dependencies);
    expect(
      new Set(resynced.reservations.map((reservation) => reservation.eventColor)),
    ).toEqual(new Set(["#7C3AED"]));
  });

  it("rejects manual Mini Golf reservations because it is open play", async () => {
    await expect(
      createManualEntertainmentReservation(
        {
          operatingDate: DATE,
          eventName: "Open Play Event",
          resourceId: "mini-golf-level-up",
          startAt: "2026-07-28T21:00:00.000Z",
          endAt: "2026-07-28T22:00:00.000Z",
          eventColor: "#1D4ED8",
        },
        { storage: new MemoryEntertainmentStorage() },
      ),
    ).rejects.toThrow("does not require an Entertainment Schedule reservation");
  });

  it("moves a manual reservation between date buckets without a stale copy", async () => {
    const storage = new MemoryEntertainmentStorage();
    const created = await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "Manual Event",
        resourceId: "pool-1",
        startAt: "2026-07-28T21:00:00.000Z",
        endAt: "2026-07-28T22:00:00.000Z",
        eventColor: "#1D4ED8",
      },
      { storage },
    );
    await updateEntertainmentReservation(
      created.id,
      {
        operatingDate: "2026-07-29",
        eventName: "Manual Event",
        resourceId: "pool-1",
        startAt: "2026-07-29T21:00:00.000Z",
        endAt: "2026-07-29T22:00:00.000Z",
        eventColor: "#1D4ED8",
      },
      { storage },
    );
    expect((await storage.getDay(DATE)).reservations).toHaveLength(0);
    expect((await storage.getDay("2026-07-29")).reservations).toHaveLength(1);
  });

  it("flags but retains an outside-operating-day manual reservation", async () => {
    const storage = new MemoryEntertainmentStorage();
    const created = await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "Early Manual Event",
        resourceId: "darts-1",
        startAt: "2026-07-28T12:00:00.000Z",
        endAt: "2026-07-28T13:00:00.000Z",
        eventColor: "#7C3AED",
      },
      { storage },
    );
    expect(created.needsReview).toBe(true);
    expect(created.reviewIssues).toEqual([
      expect.objectContaining({ code: "OUTSIDE_OPERATING_DAY" }),
    ]);
  });

  it("requires explicit confirmation before saving a conflicting edit", async () => {
    const storage = new MemoryEntertainmentStorage();
    await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "First Event",
        resourceId: "shuffleboard-1",
        startAt: "2026-07-28T21:00:00.000Z",
        endAt: "2026-07-28T22:00:00.000Z",
        eventColor: "#0F766E",
      },
      { storage },
    );
    await expect(
      createManualEntertainmentReservation(
        {
          operatingDate: DATE,
          eventName: "Second Event",
          resourceId: "shuffleboard-1",
          startAt: "2026-07-28T21:30:00.000Z",
          endAt: "2026-07-28T22:30:00.000Z",
          eventColor: "#BE123C",
        },
        { storage },
      ),
    ).rejects.toBeInstanceOf(EntertainmentConflictError);
  });

  it("audits an intentionally confirmed conflict", async () => {
    const storage = new MemoryEntertainmentStorage();
    await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "First Event",
        resourceId: "pool-2",
        startAt: "2026-07-28T21:00:00.000Z",
        endAt: "2026-07-28T22:00:00.000Z",
        eventColor: "#0F766E",
      },
      { storage },
    );
    const second = await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "Second Event",
        resourceId: "pool-2",
        startAt: "2026-07-28T21:30:00.000Z",
        endAt: "2026-07-28T22:30:00.000Z",
        eventColor: "#BE123C",
        forceConflict: true,
        reason: "Manager approved shared setup.",
      },
      { storage },
    );
    expect(await storage.getAudit(second.id)).toEqual([
      expect.objectContaining({
        action: "manual-create",
        intentionalConflict: true,
      }),
    ]);
  });

  it("returns a synthetic event panel entry for an unlinked manual booking", async () => {
    const storage = new MemoryEntertainmentStorage();
    await createManualEntertainmentReservation(
      {
        operatingDate: DATE,
        eventName: "Unlisted Event",
        resourceId: "private-room-vip-1",
        startAt: "2026-07-28T21:00:00.000Z",
        endAt: "2026-07-28T22:00:00.000Z",
        eventColor: "#4338CA",
      },
      { storage },
    );
    const day = await getEntertainmentDay(DATE, {
      storage,
      adapter: adapter([]),
    });
    expect(day.events).toEqual([
      expect.objectContaining({
        eventId: "manual:Unlisted Event",
        eventName: "Unlisted Event",
      }),
    ]);
  });
});
