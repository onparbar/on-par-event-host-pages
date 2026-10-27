import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import { findEventPlanById, loadEventPlanWindow } from "@/lib/event-plans/sync";
import { addOneCalendarMonthClamped } from "@/lib/event-plans/horizon";
import { listChecklistRecords } from "@/lib/checklist-storage";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import type { EventPlan } from "@/lib/event-plans/types";
import { isActiveVipPrepReservation, VipPrepClient, vipPrepEventPlan, type VipPrepReservation } from "@/lib/vip-prep/client";
import { isDecemberOwnerHoldReservation } from "@/lib/vip-prep/owner-holds";

/** A party name or source link alone cannot establish equivalent purchased items. */
export function mergeVipStaffEventPlans(plans: readonly EventPlan[], reservations: readonly VipPrepReservation[], sourceSyncedAt?: string) {
  const additions = reservations.filter(isActiveVipPrepReservation).map((reservation) => ({ ...vipPrepEventPlan(reservation), ...(reservation.lastRefreshedAt || sourceSyncedAt ? { synced_at: reservation.lastRefreshedAt || sourceSyncedAt } : {}) }));
  const combined = [...plans, ...additions];
  const hiddenIds = new Set(reservations.filter((reservation) => isActiveVipPrepReservation(reservation) && isDecemberOwnerHoldReservation(reservation)).map(vipPrepExternalId));
  const counts = new Map<number, number>();
  for (const plan of combined) counts.set(plan.id, (counts.get(plan.id) ?? 0) + 1);
  // Numeric checklist persistence cannot safely choose an owner on a collision.
  return combined.filter((plan) => counts.get(plan.id) === 1 && !hiddenIds.has(plan.source_event_id ?? "")).sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.name.localeCompare(right.name));
}

/** Read-only event selection feed. Never syncs sources, checks in guests, or releases kitchen food. */
export async function loadStaffEventPlans(date: string, options: {
  loadPlans?: typeof loadEventPlanWindow;
  vipClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  exactDate?: boolean;
  includeUnsubmitted?: boolean;
  loadChecklists?: typeof listChecklistRecords;
  findPlan?: typeof findEventPlanById;
} = {}) {
  if (!isValidEntertainmentDate(date)) throw new Error("Event date must use a valid YYYY-MM-DD value.");
  const client = options.vipClient ?? new VipPrepClient();
  const startDate = options.exactDate ? date : addCalendarDays(date, -1);
  const endDate = options.exactDate ? date : addOneCalendarMonthClamped(date);
  const [window, vip, unfinished] = await Promise.all([
    (options.loadPlans ?? loadEventPlanWindow)({ now: new Date(`${date}T12:00:00Z`), window: { startDate, endDate } }),
    client.configured ? client.fetchRange(startDate, date).then((payload) => ({ reservations: payload.reservations, syncedAt: payload.generatedAt, warning: "" })).catch(() => ({ reservations: [] as VipPrepReservation[], syncedAt: undefined, warning: "VIP bookings could not be refreshed. Corporate events remain available; do not substitute a different party." })) : Promise.resolve({ reservations: [] as VipPrepReservation[], syncedAt: undefined, warning: "VIP booking source is not configured. Corporate events remain available." }),
    options.includeUnsubmitted ? (options.loadChecklists ?? listChecklistRecords)().then((records) => ({ records, warning: "" })).catch(() => ({ records: [], warning: "Saved unfinished checklists could not be loaded. Existing source events remain visible; retry before relying on the recovery list." })) : Promise.resolve({ records: [], warning: "" }),
  ]);
  const corporate = [...window.plans];
  const reservations = [...vip.reservations];
  const recoveryWarnings: string[] = [];
  const vipByDate = new Map<string, Promise<VipPrepReservation[]>>();
  const pastDrafts = unfinished.records.filter((record) => record.status === "draft" && isValidEntertainmentDate(record.eventDate) &&
    record.eventDate < startDate && (!options.exactDate || record.eventDate === date));
  for (let index = 0; index < pastDrafts.length; index += 4) {
    const recovered = await Promise.all(pastDrafts.slice(index, index + 4).map(async (record) => {
      if (corporate.some((plan) => plan.id === record.eventId) || reservations.some((reservation) => numericVipEventId(vipPrepExternalId(reservation)) === record.eventId)) return null;
      try {
        const plan = await (options.findPlan ?? findEventPlanById)(record.eventId);
        if (plan) {
          if (plan.id !== record.eventId || plan.date !== record.eventDate) throw new Error("Changed source identity");
          return { plan, reservation: null };
        }
        if (!client.configured) throw new Error("Unavailable booking source");
        let dated = vipByDate.get(record.eventDate);
        if (!dated) { dated = client.fetchRange(record.eventDate, record.eventDate).then((payload) => payload.reservations); vipByDate.set(record.eventDate, dated); }
        const matches = (await dated).filter((reservation) => isActiveVipPrepReservation(reservation) &&
          reservation.operatingDate === record.eventDate && numericVipEventId(vipPrepExternalId(reservation)) === record.eventId);
        if (matches.length !== 1) throw new Error("Unverified source identity");
        return { plan: null, reservation: matches[0] };
      } catch {
        recoveryWarnings.push("Some saved unfinished checklists could not be matched to an active source and exact event date. No different party was substituted; retry source access or ask Admin to review the saved record.");
        return null;
      }
    }));
    for (const result of recovered) {
      if (result?.plan) corporate.push(result.plan);
      if (result?.reservation) reservations.push(result.reservation);
    }
  }
  const merged = mergeVipStaffEventPlans(corporate, reservations, vip.syncedAt);
  const plans = [
    ...merged.filter((plan) => plan.date >= startDate),
    ...merged.filter((plan) => plan.date < startDate).sort((left, right) => right.date.localeCompare(left.date)),
  ];
  const rawIds = [...corporate.map((plan) => plan.id), ...reservations.filter(isActiveVipPrepReservation).map((reservation) => numericVipEventId(vipPrepExternalId(reservation)))];
  const collisionWarning = new Set(rawIds).size < rawIds.length
    ? "Some event selectors are unavailable because legacy numeric event IDs collide. No parties were merged. Open Floor Plans, Kitchen, or VIP CHECK-IN using the exact date and source reservation ID; the exact VIP workspace remains read-only until numeric checklist ownership is reconciled." : "";
  const unfinishedEventIds = plans.filter((plan) => unfinished.records.some((record) => record.status === "draft" && record.eventId === plan.id && record.eventDate === plan.date)).map((plan) => plan.id);
  return { ...window, plans, unfinishedEventIds, sourceWarning: [...new Set([vip.warning, unfinished.warning, ...recoveryWarnings, collisionWarning].filter(Boolean))].join(" ") };
}
