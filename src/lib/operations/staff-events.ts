import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import type { EventPlan } from "@/lib/event-plans/types";
import { floorPlanSourceNamesMatch } from "@/lib/floor-plans/source-resolution";
import { VipPrepClient, vipPrepEventPlan, type VipPrepReservation } from "@/lib/vip-prep/client";

/** Corporate event prep remains authoritative when a same-date VIP block has the same canonical name. */
export function mergeVipStaffEventPlans(plans: readonly EventPlan[], reservations: readonly VipPrepReservation[], sourceSyncedAt?: string) {
  const corporateIds = new Set(plans.map((plan) => plan.id));
  const additions = reservations.filter((reservation) => !plans.some((plan) =>
    plan.date === reservation.operatingDate && floorPlanSourceNamesMatch(plan.name, reservation.eventName),
  )).map((reservation) => ({ ...vipPrepEventPlan(reservation), ...(sourceSyncedAt ? { synced_at: sourceSyncedAt } : {}) })).filter((plan) => !corporateIds.has(plan.id));
  return [...plans, ...additions].sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.name.localeCompare(right.name));
}

/** Read-only event selection feed. Never syncs sources, checks in guests, or releases kitchen food. */
export async function loadStaffEventPlans(date: string, options: {
  loadPlans?: typeof loadEventPlanWindow;
  vipClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
} = {}) {
  if (!isValidEntertainmentDate(date)) throw new Error("Event date must use a valid YYYY-MM-DD value.");
  const client = options.vipClient ?? new VipPrepClient();
  const [window, vip] = await Promise.all([
    (options.loadPlans ?? loadEventPlanWindow)({ now: new Date(`${date}T12:00:00Z`) }),
    client.configured ? client.fetchRange(date, date).then((payload) => ({ reservations: payload.reservations, syncedAt: payload.generatedAt, warning: "" })).catch(() => ({ reservations: [] as VipPrepReservation[], syncedAt: undefined, warning: "VIP bookings could not be refreshed. Corporate events remain available; do not substitute a different party." })) : Promise.resolve({ reservations: [] as VipPrepReservation[], syncedAt: undefined, warning: "VIP booking source is not configured. Corporate events remain available." }),
  ]);
  return { ...window, plans: mergeVipStaffEventPlans(window.plans, vip.reservations, vip.syncedAt), sourceWarning: vip.warning };
}
