import { describe, expect, it } from "vitest";
import { buildEntertainmentSchedule } from "../domain";
import { EntertainmentSyncRevisionError, SupabaseEntertainmentStorage, type SaveSyncInput } from "../storage";

const date = "2026-11-05";
const revision = "2026-11-05T12:00:00.000Z";
const newRevision = "2026-11-05T21:00:00.000Z";
const startAt = "2026-11-05T22:00:00.000Z";
const endAt = "2026-11-05T23:00:00.000Z";

function input(): Extract<SaveSyncInput, { protectConcurrentEdits: true }> {
  const { events, reservations } = buildEntertainmentSchedule({
    now: revision, localEvents: [], existingReservations: [],
    sourceEvents: [{
      tripleseatEventId: "100", tripleseatBookingId: null, eventName: "Sample Social",
      localDate: date, status: "DEFINITE", rooms: [], categoryNames: ["Bowling"],
      eventStartAt: startAt, eventEndAt: endAt, sourceUpdatedAt: revision, noteCount: 0,
      items: [{
        sourceId: "sample-item", name: "Bowling Lanes 1–2", description: null, categoryName: "Bowling",
        quantity: 2, startAt, endAt,
      }],
    }],
  });
  expect(reservations).toHaveLength(2);
  return {
    date, events, reservations, existingEvents: structuredClone(events), existingReservations: structuredClone(reservations),
    protectConcurrentEdits: true,
    stats: { eventsProcessed: 1, reservationsCreated: 0, reservationsUpdated: 0, warningsCreated: 0, conflictsFound: 0 },
  };
}

function storageForTest(response: (table: string, method: string) => Response) {
  const calls: { table: string; method: string; query: URLSearchParams; prefer: string | null; body: unknown }[] = [];
  const storage = new SupabaseEntertainmentStorage({
    env: { NODE_ENV: "test", SUPABASE_URL: "https://example.test", SUPABASE_SECRET_KEY: "test-only-key" },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1)!;
      const method = init?.method ?? "GET";
      calls.push({ table, method, query: url.searchParams, prefer: new Headers(init?.headers).get("prefer"), body: JSON.parse(String(init?.body ?? "null")) });
      return response(table, method);
    },
  });
  return { calls, storage };
}

describe("scheduled entertainment optimistic writes", () => {
  it("does not record a whole-day sync after a guarded single-event refresh", async () => {
    const update = { ...input(), recordDaySync: false as const };
    update.reservations[0] = { ...update.reservations[0], resourceId: "bowling-4", resourceName: "Bowling Lane 4", updatedAt: newRevision };
    const { calls, storage } = storageForTest(() => Response.json([{}]));
    await storage.saveSync(update);
    expect(calls.map(({ table, method }) => [table, method])).toEqual([
      ["entertainment_reservations", "PATCH"], ["entertainment_reservation_audits", "POST"],
    ]);
  });

  it("writes only changed rows and includes the observed reservation and color revisions", async () => {
    const update = input();
    update.reservations[0] = { ...update.reservations[0], notes: "Changed upstream", updatedAt: newRevision };
    update.events[0] = { ...update.events[0], syncedAt: newRevision };
    const { calls, storage } = storageForTest(() => Response.json([{}]));
    await storage.saveSync(update);
    const eventWrites = calls.filter((call) => call.table === "entertainment_event_snapshots");
    expect(eventWrites).toHaveLength(1);
    expect(eventWrites[0].query.get("synced_at")).toBe(`eq.${revision}`);
    const reservationWrites = calls.filter((call) => call.table === "entertainment_reservations");
    expect(reservationWrites).toHaveLength(1);
    expect(reservationWrites[0]).toMatchObject({ method: "PATCH", prefer: "return=representation" });
    expect(reservationWrites[0].query.get("id")).toBe(`eq.${update.reservations[0].id}`);
    expect(reservationWrites[0].query.get("updated_at")).toBe(`eq.${revision}`);
  });

  it("does not upsert or mark success when a staff reservation changed after the read", async () => {
    const update = input();
    update.reservations[0] = { ...update.reservations[0], notes: "Changed upstream", updatedAt: newRevision };
    const { calls, storage } = storageForTest(() => Response.json([]));
    await expect(storage.saveSync(update)).rejects.toBeInstanceOf(EntertainmentSyncRevisionError);
    expect(calls.map(({ table, method }) => [table, method])).toEqual([["entertainment_reservations", "PATCH"]]);
  });

  it("guards event removal by the observed color revision", async () => {
    const update = { ...input(), events: [] };
    const { calls, storage } = storageForTest(() => Response.json([]));
    await expect(storage.saveSync(update)).rejects.toBeInstanceOf(EntertainmentSyncRevisionError);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { active: false } });
    expect(calls[0].query.get("synced_at")).toBe(`eq.${revision}`);
  });

  it("inserts without merge semantics so a simultaneous new row cannot be overwritten", async () => {
    const update = { ...input(), existingReservations: [] };
    const { calls, storage } = storageForTest(() => new Response(null, { status: 409 }));
    await expect(storage.saveSync(update)).rejects.toThrow("Entertainment database request failed (409).");
    expect(calls.map(({ table, method, prefer }) => [table, method, prefer])).toEqual([
      ["entertainment_reservations", "POST", "return=minimal"],
    ]);
  });
});
