import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import type { EventPlan } from "@/lib/event-plans/types";
import { isActiveVipPrepReservation, VipPrepClient, vipPrepEventPlan, type VipPrepReservation } from "@/lib/vip-prep/client";

/** A party name or source link alone cannot establish equivalent purchased items. */
export function mergeVipStaffEventPlans(plans: readonly EventPlan[], reservations: readonly VipPrepReservation[], sourceSyncedAt?: string) {
  const additions = reservations.filter(isActiveVipPrepReservation).map((reservation) => ({ ...vipPrepEventPlan(reservation), ...(sourceSyncedAt ? { synced_at: sourceSyncedAt } : {}) }));
  const combined = [...plans, ...additions];
  const counts = new Map<number, number>();
  for (const plan of combined) counts.set(plan.id, (counts.get(plan.id) ?? 0) + 1);
  // Numeric checklist persistence cannot safely choose an owner on a collision.
  return combined.filter((plan) => counts.get(plan.id) === 1).sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.name.localeCompare(right.name));
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
  const plans = mergeVipStaffEventPlans(window.plans, vip.reservations, vip.syncedAt);
  const collisionWarning = plans.length < window.plans.length + vip.reservations.filter(isActiveVipPrepReservation).length
    ? "Some event selectors are unavailable because legacy numeric event IDs collide. No parties were merged. Open Floor Plans, Kitchen, or VIP CHECK-IN using the exact date and source reservation ID; the exact VIP workspace remains read-only until numeric checklist ownership is reconciled." : "";
  return { ...window, plans, sourceWarning: [vip.warning, collisionWarning].filter(Boolean).join(" ") };
}
