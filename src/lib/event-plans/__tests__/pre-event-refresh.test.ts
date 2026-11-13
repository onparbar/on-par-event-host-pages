import { describe, expect, it, vi } from "vitest";
import { preEventRefreshDueAt, refreshUpcomingTripleseatEvents } from "../pre-event-refresh";
import type { StoredEventPlan } from "../storage";
import type { FloorPlanStorage } from "@/lib/floor-plans/storage";
import type { KitchenStorage } from "@/lib/kitchen/storage";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import type { EntertainmentStorage } from "@/lib/entertainment/storage";

vi.mock("server-only", () => ({}));

const DATE = "2026-11-05";
const NOW = new Date("2026-11-05T21:30:00Z");
const START = "2026-11-05T22:30:00Z";
const STALE = "2026-11-05T15:00:00Z";

function event(overrides: Partial<StoredEventPlan["sourceSnapshot"]> = {}): StoredEventPlan {
  const sourceSnapshot = { eventId: "71000001", localDate: DATE, status: "DEFINITE", eventStartAt: START, ...overrides };
  return { eventId: String(sourceSnapshot.eventId), eventDate: String(sourceSnapshot.localDate), active: true,
    plan: {}, sourceSnapshot, sourceUpdatedAt: null, syncedAt: STALE };
}

function setup(events = [event()]) {
  const plans = { plansForWindow: vi.fn(async () => events) };
  const getFloor = vi.fn(async () => ({ version: 7, lastTripleseatSyncAt: STALE }));
  const getKitchen = vi.fn(async () => ({ sync: { status: "success", lastSuccessfulSyncAt: STALE, startedAt: STALE } }));
  const getEntertainment = vi.fn(async () => ({ sync: { status: "success", lastSuccessfulSyncAt: STALE, startedAt: STALE } }));
  const floorPlans = { get: getFloor } as unknown as FloorPlanStorage;
  const kitchen = { getDay: getKitchen } as unknown as KitchenStorage;
  const refreshFloorPlan = vi.fn().mockResolvedValue({ sourceRefresh: { tripleseat: "success" } });
  const refreshKitchen = vi.fn().mockResolvedValue({ eventCount: 1, retainedUnverifiedCount: 0 });
  const options: NonNullable<Parameters<typeof refreshUpcomingTripleseatEvents>[0]> = {
    now: NOW, env: { VERCEL_ENV: "production" }, plans, floorPlans, kitchen,
    entertainment: { getDay: getEntertainment } as unknown as Pick<EntertainmentStorage, "getDay">,
    adapter: { sourceMode: "live" } as TripleseatAdapter, refreshFloorPlan, refreshKitchen,
  };
  return { options, plans, getFloor, getKitchen, getEntertainment, refreshFloorPlan, refreshKitchen };
}

describe("pre-event refresh timing", () => {
  it("is due at one hour before start, but not before that or at event start", () => {
    expect(preEventRefreshDueAt(event(), new Date(NOW.getTime() - 1))).toBeNull();
    expect(preEventRefreshDueAt(event(), NOW)).toBe(NOW.getTime());
    expect(preEventRefreshDueAt(event(), new Date(START))).toBeNull();
    expect(preEventRefreshDueAt(event(), new Date(NaN))).toBeNull();
  });

  it("uses the saved Eastern time, including minutes, not the server timezone", () => {
    expect(preEventRefreshDueAt(event({ eventStartAt: "5:30 PM" }), NOW)).toBe(NOW.getTime());
    expect(preEventRefreshDueAt(event({ eventStartAt: "6:30 PM" }), NOW)).toBeNull();
  });

  it("requires a real Tripleseat identity and an unambiguous start", () => {
    for (const row of [
      event({ eventId: "vip-example" }), event({ status: "CANCELLED" }), event({ status: "LOST" }), event({ status: "PROSPECT" }),
      event({ sourceSystem: "contract-evidence" }), event({ eventStartAt: null }), event({ eventStartAt: "2026-11-04T22:30:00Z" }),
      { ...event(), active: false }, { ...event(), eventId: "71000002" },
    ]) expect(preEventRefreshDueAt(row, NOW)).toBeNull();
    expect(preEventRefreshDueAt(event({ localDate: "2026-11-01", eventStartAt: "1:30 AM" }), new Date("2026-11-01T05:00:00Z"))).toBeNull();
    expect(preEventRefreshDueAt(event({ localDate: "2026-11-01", eventStartAt: "2026-11-01T01:30:00-05:00" }), new Date("2026-11-01T05:30:00Z"))).toBe(Date.parse("2026-11-01T05:30:00Z"));
  });

  it("follows operational full-buyout eligibility without refreshing cancellations", () => {
    expect(preEventRefreshDueAt(event({ status: "PROSPECT", fullBuyout: true }), NOW)).toBe(NOW.getTime());
    expect(preEventRefreshDueAt(event({ status: "CANCELLED", fullBuyout: true }), NOW)).toBeNull();
  });
});

describe("scheduled Tripleseat refresh", () => {
  it("does not read data in Preview or development", async () => {
    const job = setup();
    for (const env of [{ VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" }, {}]) {
      expect(await refreshUpcomingTripleseatEvents({ ...job.options, env })).toMatchObject({ skipped: "non-production" });
    }
    expect(job.plans.plansForWindow).not.toHaveBeenCalled();
  });

  it("does not pull contracts on a check with no due events", async () => {
    const job = setup([event({ eventStartAt: "7:00 PM" })]);
    expect(await refreshUpcomingTripleseatEvents(job.options)).toMatchObject({ dueDates: 0 });
    expect(job.getFloor).not.toHaveBeenCalled();
    expect(job.refreshFloorPlan).not.toHaveBeenCalled();
    expect(job.refreshKitchen).not.toHaveBeenCalled();
  });

  it("coalesces due parties into one scoped date refresh and preserves the floor-plan version check", async () => {
    const job = setup([event(), event({ eventId: "71000002", eventStartAt: "5:25 PM" }), event({ eventId: "71000003", eventStartAt: "7:00 PM" })]);
    expect(await refreshUpcomingTripleseatEvents(job.options)).toMatchObject({ dueDates: 1, refreshedDates: [DATE], failedDates: [] });
    expect(job.refreshFloorPlan).toHaveBeenCalledExactlyOnceWith(DATE, job.options.floorPlans, 7, {
      adapter: job.options.adapter, now: NOW, recordRollingSync: false,
    });
    expect(job.refreshKitchen).toHaveBeenCalledExactlyOnceWith(DATE, { adapter: job.options.adapter, storage: job.options.kitchen, now: NOW });
  });

  it("checks tomorrow when one hour before a midnight event falls today", async () => {
    const date = "2026-11-06";
    const job = setup([event({ localDate: date, eventStartAt: "12:15 AM" })]);
    const now = new Date("2026-11-06T04:15:00Z");
    expect(await refreshUpcomingTripleseatEvents({ ...job.options, now })).toMatchObject({ refreshedDates: [date] });
    expect(job.plans.plansForWindow).toHaveBeenCalledExactlyOnceWith({ startDate: DATE, endDate: date });
  });

  it("skips an already-fresh event, but reevaluates if the saved start moves later", async () => {
    const row = event();
    const job = setup([row]);
    row.syncedAt = NOW.toISOString();
    job.getFloor.mockResolvedValue({ version: 8, lastTripleseatSyncAt: NOW.toISOString() });
    for (const get of [job.getKitchen, job.getEntertainment]) {
      get.mockResolvedValue({ sync: { status: "success", startedAt: NOW.toISOString(), lastSuccessfulSyncAt: NOW.toISOString() } });
    }
    expect(await refreshUpcomingTripleseatEvents(job.options)).toMatchObject({ refreshedDates: [] });
    expect(job.refreshFloorPlan).not.toHaveBeenCalled();
    expect(job.refreshKitchen).not.toHaveBeenCalled();
    row.sourceSnapshot.eventStartAt = "6:00 PM";
    const now = new Date("2026-11-05T22:00:00Z");
    expect(await refreshUpcomingTripleseatEvents({ ...job.options, now })).toMatchObject({ refreshedDates: [DATE] });
  });

  it("retries a failed Kitchen stage without repeating a completed floor-plan sync", async () => {
    const row = event();
    const job = setup([row]);
    job.refreshKitchen.mockRejectedValueOnce(new Error("source details must not leak"));
    expect(await refreshUpcomingTripleseatEvents(job.options)).toMatchObject({ dueDates: 1, refreshedDates: [], failedDates: [DATE] });
    row.syncedAt = NOW.toISOString();
    job.getFloor.mockResolvedValue({ version: 8, lastTripleseatSyncAt: NOW.toISOString() });
    job.getEntertainment.mockResolvedValue({ sync: { status: "success", startedAt: NOW.toISOString(), lastSuccessfulSyncAt: NOW.toISOString() } });
    expect(await refreshUpcomingTripleseatEvents({ ...job.options, now: new Date(NOW.getTime() + 300_000) })).toMatchObject({ refreshedDates: [DATE] });
    expect(job.refreshFloorPlan).toHaveBeenCalledTimes(1);
    expect(job.refreshKitchen).toHaveBeenCalledTimes(2);
  });

  it("does not count a partial source refresh as complete", async () => {
    const job = setup();
    job.refreshFloorPlan.mockResolvedValue({ sourceRefresh: { tripleseat: "partial" } });
    expect(await refreshUpcomingTripleseatEvents(job.options)).toMatchObject({ refreshedDates: [], failedDates: [DATE] });
    expect(job.refreshKitchen).not.toHaveBeenCalled();
  });
});
