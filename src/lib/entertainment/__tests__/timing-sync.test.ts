import { describe, expect, it } from "vitest";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { confirmedContractEntertainmentSourcesForDate } from "@/lib/confirmed-contract-events";
import { buildEntertainmentSchedule } from "../domain";
import { MemoryEntertainmentStorage, SupabaseEntertainmentStorage } from "../storage";
import { getEntertainmentDay, removeEntertainmentReservation, revertEntertainmentReservation, syncEntertainmentDay, updateEntertainmentReservation } from "../sync";
import type { EntertainmentSourceEvent } from "../types";

const DATE = "2026-07-28";
function source(): EntertainmentSourceEvent {
  return { tripleseatEventId: "timing-test", tripleseatBookingId: null, eventName: "Redacted Timing Event", localDate: DATE, eventStartAt: "2026-07-28T21:30:00.000Z", eventEndAt: "2026-07-29T01:30:00.000Z", status: "DEFINITE", rooms: [], items: [{ sourceId: "line-1", name: "Bowling Lane 1", description: "1 bowling lane for 90 minutes", categoryName: "Bowling", quantity: 1, startAt: null, endAt: null }], categoryNames: ["Bowling"], sourceUpdatedAt: "2026-07-28T12:00:00.000Z", noteCount: 0 };
}
function adapter(events: EntertainmentSourceEvent[]): TripleseatAdapter {
  return { sourceMode: "live", fetchEventsForDate: async () => [], fetchEntertainmentEventsForDate: async () => structuredClone(events), fetchEventDateById: async () => null, getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }) };
}
const disabledVip = { configured: false, fetchRange: async () => { throw new Error("Disabled test integration"); } };

describe("persisted entertainment timing provenance", () => {
  it("retimes event defaults after color/resource-only edits while retaining those staff overrides", async () => {
    const event = source();
    const storage = new MemoryEntertainmentStorage();
    const dependencies = { adapter: adapter([event]), storage, localEvents: [], vipPrepClient: disabledVip };
    const first = await syncEntertainmentDay(DATE, dependencies);
    const original = first.reservations[0];
    const edited = await updateEntertainmentReservation(original.id, { operatingDate: DATE, eventId: event.tripleseatEventId, eventName: event.eventName, resourceId: "bowling-8", startAt: original.startAt, endAt: original.endAt, eventColor: "#A020F0", needsReview: false }, { storage });
    expect(edited.startTimeSource).toBe("event-start-default");
    event.eventStartAt = "2026-07-28T22:15:00.000Z";
    event.sourceUpdatedAt = "2026-07-28T13:00:00.000Z";
    const refreshed = await syncEntertainmentDay(DATE, dependencies);
    expect(refreshed.reservations.filter((row) => row.active)).toHaveLength(1);
    expect(refreshed.reservations[0]).toMatchObject({ id: original.id, resourceId: "bowling-8", eventColor: "#A020F0", startAt: event.eventStartAt, endAt: "2026-07-28T23:45:00.000Z", startTimeSource: "event-start-default", contractedDurationMinutes: 90, hasSourceUpdate: false });
    expect((await storage.getDay(DATE)).reservations[0].startTimeSource).toBe("event-start-default");
  });

  it("retains staff time overrides as purchased duration changes, then restores source provenance on revert", async () => {
    const event = source();
    const storage = new MemoryEntertainmentStorage();
    const dependencies = { adapter: adapter([event]), storage, localEvents: [], vipPrepClient: disabledVip };
    const initial = (await syncEntertainmentDay(DATE, dependencies)).reservations[0];
    const overridden = await updateEntertainmentReservation(initial.id, { operatingDate: DATE, eventId: event.tripleseatEventId, eventName: event.eventName, resourceId: initial.resourceId, startAt: "2026-07-28T23:00:00.000Z", endAt: "2026-07-29T00:30:00.000Z", eventColor: initial.eventColor, needsReview: false }, { storage });
    expect(overridden.startTimeSource).toBe("staff-override");
    event.eventStartAt = "2026-07-28T22:15:00.000Z";
    event.items[0].description = "1 bowling lane for 2 hours";
    event.sourceUpdatedAt = "2026-07-28T13:00:00.000Z";
    const refreshed = await syncEntertainmentDay(DATE, dependencies);
    expect(refreshed.reservations.filter((row) => row.active)).toHaveLength(1);
    expect(refreshed.reservations[0]).toMatchObject({ id: initial.id, startAt: overridden.startAt, endAt: overridden.endAt, startTimeSource: "staff-override", sourceStartTimeSource: "event-start-default", contractedDurationMinutes: 120, hasSourceUpdate: true });
    const reverted = await revertEntertainmentReservation(initial.id, false, "Restore current contract timing", { storage });
    expect(reverted).toMatchObject({ startTimeSource: "event-start-default", startAt: event.eventStartAt, endAt: "2026-07-29T00:15:00.000Z", manualOverride: false, hasSourceUpdate: false });
  });

  it("preserves stored VIP timing overrides during live VIP refresh", async () => {
    const payload = structuredClone(vipPrepPayload);
    const date = payload.reservations[0].operatingDate;
    const vipPrepClient = { configured: true, fetchRange: async () => structuredClone(payload) };
    const storage = new MemoryEntertainmentStorage();
    const dependencies = { adapter: adapter([]), storage, localEvents: [], vipPrepClient };
    const initial = (await syncEntertainmentDay(date, dependencies)).reservations[0];
    expect(initial.startTimeSource).toBe("event-start-default");
    const manual = await updateEntertainmentReservation(initial.id, { operatingDate: date, eventId: initial.tripleseatEventId, eventName: initial.eventName, resourceId: initial.resourceId, startAt: "2026-08-15T23:00:00.000Z", endAt: "2026-08-16T01:00:00.000Z", eventColor: initial.eventColor, needsReview: false }, { storage });
    payload.reservations[0].startAt = "2026-08-15T22:30:00.000Z";
    payload.reservations[0].updatedAt = "2026-08-12T12:00:00.000Z";
    const day = await getEntertainmentDay(date, dependencies);
    expect(day.reservations).toHaveLength(1);
    expect(day.reservations[0]).toMatchObject({ id: initial.id, startAt: manual.startAt, endAt: manual.endAt, startTimeSource: "staff-override", manualOverride: true });
  });

  it("does not reactivate a staff-removed VIP reservation during live refresh", async () => {
    const payload = structuredClone(vipPrepPayload);
    const date = payload.reservations[0].operatingDate;
    const storage = new MemoryEntertainmentStorage();
    const dependencies = { adapter: adapter([]), storage, localEvents: [], vipPrepClient: { configured: true, fetchRange: async () => structuredClone(payload) } };
    const initial = (await syncEntertainmentDay(date, dependencies)).reservations[0];
    await removeEntertainmentReservation(initial.id, "Staff removed test reservation", { storage });
    expect((await getEntertainmentDay(date, dependencies)).reservations).toEqual([]);
  });

  it("preserves staff timing when newer confirmed contract evidence is refreshed without duplicate rows", async () => {
    const date = "2026-08-21";
    const built = buildEntertainmentSchedule({ sourceEvents: confirmedContractEntertainmentSourcesForDate(date), localEvents: [], now: "2026-08-01T12:00:00.000Z" });
    const original = built.reservations[0];
    const overridden = { ...original, manualOverride: true, startTimeSource: "staff-override" as const, startAt: new Date(Date.parse(original.startAt) + 15 * 60_000).toISOString(), endAt: new Date(Date.parse(original.endAt) + 15 * 60_000).toISOString() };
    const storage = new MemoryEntertainmentStorage();
    await storage.saveSync({ date, events: built.events.map((event) => ({ ...event, sourceUpdatedAt: "2000-01-01T00:00:00.000Z" })), reservations: [overridden, ...built.reservations.slice(1)], existingReservations: [], stats: { eventsProcessed: built.events.length, reservationsCreated: built.reservations.length, reservationsUpdated: 0, warningsCreated: 0, conflictsFound: 0 } });
    const day = await getEntertainmentDay(date, { storage, adapter: adapter([]), localEvents: [], vipPrepClient: disabledVip });
    expect(day.reservations.filter((row) => row.id === original.id)).toHaveLength(1);
    expect(day.reservations.find((row) => row.id === original.id)).toMatchObject({ startAt: overridden.startAt, endAt: overridden.endAt, startTimeSource: "staff-override" });
  });

  it("round-trips timing provenance through the database row serializer", async () => {
    const memory = new MemoryEntertainmentStorage();
    const initial = (await syncEntertainmentDay(DATE, { storage: memory, adapter: adapter([source()]), localEvents: [], vipPrepClient: disabledVip })).reservations[0];
    let saved: Record<string, unknown> | null = null;
    const storage = new SupabaseEntertainmentStorage({ env: { NODE_ENV: "test", SUPABASE_URL: "https://example.test", SUPABASE_SECRET_KEY: "test-only-key" }, fetchImpl: async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/entertainment_reservations")) saved = JSON.parse(String(init.body));
      return Response.json(init?.method ? [] : saved ? [saved] : []);
    } });
    await storage.saveManualReservation(initial, { id: "audit-test", reservationId: initial.id, action: "manual-update", previousValue: null, newValue: initial, changedBy: "Redacted Staff", changeSource: "manual", reason: "Timing test", intentionalConflict: false, createdAt: initial.updatedAt });
    expect(saved).toMatchObject({ start_time_source: "event-start-default", source_start_time_source: "event-start-default", contracted_duration_minutes: 90 });
    expect(await storage.getReservation(initial.id)).toMatchObject({ startTimeSource: "event-start-default", sourceStartTimeSource: "event-start-default", contractedDurationMinutes: 90 });
  });
});
