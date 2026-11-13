import "server-only";

import { getEntertainmentStorage, type EntertainmentStorage } from "@/lib/entertainment/storage";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { refreshFloorPlanSources } from "@/lib/floor-plans/service";
import { getFloorPlanStorage, type FloorPlanStorage } from "@/lib/floor-plans/storage";
import { kitchenEventInterval } from "@/lib/kitchen/lifecycle";
import { getKitchenStorage, type KitchenStorage } from "@/lib/kitchen/storage";
import { refreshTripleseatKitchenDay } from "@/lib/kitchen/sync";
import { getTripleseatAdapter, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { getEventPlanStorage, type EventPlanStorage, type StoredEventPlan } from "./storage";
import { isOperationalEventStatus } from "./sync";

const ONE_HOUR = 60 * 60_000;
const SYNC_INTERVAL = 5 * 60_000;

export function preEventRefreshDueAt(row: StoredEventPlan, now: Date) {
  const source = row.sourceSnapshot;
  if (!Number.isFinite(now.getTime()) || !row.active || !/^\d+$/.test(row.eventId) || source.eventId !== row.eventId ||
      source.localDate !== row.eventDate || (source.sourceSystem != null && source.sourceSystem !== "tripleseat") ||
      !isOperationalEventStatus(source.status, source.fullBuyout === true) ||
      /^(?:cancelled|canceled)$/i.test(String(source.status ?? "").trim()) ||
      typeof source.eventStartAt !== "string") return null;
  const { startAt } = kitchenEventInterval({ localDate: row.eventDate, startTime: source.eventStartAt, endTime: null });
  if (startAt == null || now.getTime() < startAt - ONE_HOUR || now.getTime() >= startAt) return null;
  return startAt - ONE_HOUR;
}

type Options = {
  now?: Date;
  env?: Readonly<Record<string, string | undefined>>;
  plans?: Pick<EventPlanStorage, "plansForWindow">;
  floorPlans?: FloorPlanStorage;
  kitchen?: KitchenStorage;
  entertainment?: Pick<EntertainmentStorage, "getDay">;
  adapter?: TripleseatAdapter;
  refreshFloorPlan?: typeof refreshFloorPlanSources;
  refreshKitchen?: typeof refreshTripleseatKitchenDay;
};

function recentSync(state: { status: string; startedAt: string } | null, now: Date) {
  return state?.status === "running" && Date.parse(state.startedAt) > now.getTime() - SYNC_INTERVAL;
}

function fresh(timestamp: string | null | undefined, dueAt: number) {
  return Date.parse(timestamp ?? "") >= dueAt;
}

/** Refresh an exact affected date once for each due start window. The existing daily import still discovers new events. */
export async function refreshUpcomingTripleseatEvents(options: Options = {}) {
  const env = options.env ?? process.env;
  const result = { dueDates: 0, refreshedDates: [] as string[], failedDates: [] as string[], retainedKitchenRecords: [] as Array<{ date: string; count: number }> };
  if (isPreviewReviewOnly(env) || env.VERCEL_ENV !== "production") return { ...result, skipped: "non-production" };

  const now = options.now ?? new Date();
  const plans = options.plans ?? getEventPlanStorage();
  const window = {
    startDate: todayInEntertainmentTimeZone(now),
    endDate: todayInEntertainmentTimeZone(new Date(now.getTime() + ONE_HOUR)),
  };
  const due = new Map<string, Array<{ row: StoredEventPlan; dueAt: number }>>();
  for (const row of await plans.plansForWindow(window)) {
    const dueAt = preEventRefreshDueAt(row, now);
    if (dueAt === null) continue;
    const day = due.get(row.eventDate) ?? [];
    day.push({ row, dueAt });
    due.set(row.eventDate, day);
  }
  result.dueDates = due.size;
  if (due.size === 0) return result;

  const adapter = options.adapter ?? getTripleseatAdapter();
  if (adapter.sourceMode !== "live") throw new Error("Live Tripleseat synchronization is unavailable.");
  const floorPlans = options.floorPlans ?? getFloorPlanStorage();
  const kitchen = options.kitchen ?? getKitchenStorage();
  const entertainment = options.entertainment ?? getEntertainmentStorage();
  for (const [date, events] of due) {
    try {
      const [floor, prep, schedule] = await Promise.all([floorPlans.get(date), kitchen.getDay(date), entertainment.getDay(date)]);
      if (recentSync(prep.sync, now) || recentSync(schedule.sync, now)) continue;
      const dueAt = Math.max(...events.map((event) => Math.max(event.dueAt, Date.parse(event.row.sourceUpdatedAt ?? "") || 0)));
      const plansFresh = events.every((event) => fresh(event.row.syncedAt, event.dueAt));
      const floorFresh = plansFresh && fresh(floor?.lastTripleseatSyncAt, dueAt) &&
        schedule.sync?.status === "success" && fresh(schedule.sync.lastSuccessfulSyncAt, dueAt);
      const kitchenFresh = prep.sync?.status === "success" && fresh(prep.sync.lastSuccessfulSyncAt, dueAt);
      if (floorFresh && kitchenFresh) continue;

      if (!floorFresh) {
        const refreshed = await (options.refreshFloorPlan ?? refreshFloorPlanSources)(date, floorPlans, floor?.version ?? 0, {
          adapter, now, recordRollingSync: false,
        });
        if (refreshed.sourceRefresh.tripleseat !== "success") throw new Error("Tripleseat floor-plan refresh was incomplete.");
      }
      // A fresh floor plan does not prove Kitchen has imported the new food.
      // If floor/contract data was refreshed just now, bring Kitchen up to date too.
      const refreshedKitchen = await (options.refreshKitchen ?? refreshTripleseatKitchenDay)(date, { adapter, storage: kitchen, now });
      if (refreshedKitchen.retainedUnverifiedCount > 0) result.retainedKitchenRecords.push({ date, count: refreshedKitchen.retainedUnverifiedCount });
      result.refreshedDates.push(date);
    } catch {
      result.failedDates.push(date);
    }
  }
  return result;
}
