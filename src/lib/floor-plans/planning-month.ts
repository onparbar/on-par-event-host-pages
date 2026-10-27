import "server-only";
import { createMemoryEventPlanStorage, getEventPlanStorage, type EventPlanStorage } from "@/lib/event-plans/storage";
import { syncEventPlanWindow } from "@/lib/event-plans/sync";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import type { VipPrepClient } from "@/lib/vip-prep/client";
import { prepareFloorPlanDraftWindow } from "./draft-planning";
import { floorPlanPlanningMonthRange } from "./publication";
import { getFloorPlanStorage, type FloorPlanStorage } from "./storage";

export const DECEMBER_PLANNING_MONTH = "2026-12";

type PlanningMonthDependencies = {
  adapter?: TripleseatAdapter;
  eventPlanStorage?: EventPlanStorage;
  floorPlanStorage?: FloorPlanStorage;
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  prepareDrafts?: typeof prepareFloorPlanDraftWindow;
  now?: Date;
};

/** Refresh December source snapshots without changing rolling sync metadata or any saved assignments. */
export async function prepareDecemberFloorPlanDrafts(dependencies: PlanningMonthDependencies = {}) {
  const month = DECEMBER_PLANNING_MONTH;
  const window = floorPlanPlanningMonthRange(month);
  const isolatedSources = createMemoryEventPlanStorage();
  // Source failure changes only transient state. Never call start/finish/fail on durable rolling metadata.
  await syncEventPlanWindow(window, { storage: isolatedSources, adapter: dependencies.adapter, now: dependencies.now, legacyPlans: [] });
  const sources = await isolatedSources.plansForWindow(window);
  await (dependencies.eventPlanStorage ?? getEventPlanStorage()).replaceWindow(window, sources);
  const prepared = await (dependencies.prepareDrafts ?? prepareFloorPlanDraftWindow)(window.startDate, window.endDate,
    dependencies.floorPlanStorage ?? getFloorPlanStorage(), { vipPrepClient: dependencies.vipPrepClient });
  return { month, ...prepared, results: prepared.results.map((entry) => ({
    date: entry.date, status: entry.status, eventCount: entry.eventCount,
    ...(entry.planStatus ? { planStatus: entry.planStatus } : {}),
    ...(entry.message ? { message: entry.status === "error"
      ? "This date could not be prepared. Existing saved plans were preserved; check the source connection and try again."
      : entry.message === "An existing saved plan was preserved." || entry.message === "A concurrent saved plan was preserved." || entry.message === "No active event sources are available for this date."
        ? entry.message : "No new draft was created; existing saved plans were preserved." } : {}),
  })) };
}
