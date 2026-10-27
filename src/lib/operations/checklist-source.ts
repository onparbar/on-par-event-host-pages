import { getChecklistRecord } from "@/lib/checklist-storage";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { rollingEventPlanHorizon } from "@/lib/event-plans/horizon";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { findVipPrepReservationByEventId, vipPrepEventPlan, vipPrepExternalId, VipPrepApiError, VipPrepClient } from "@/lib/vip-prep/client";
import { numericVipEventId } from "@/lib/vip-prep/identity";
import { isDecemberOwnerHoldReservation } from "@/lib/vip-prep/owner-holds";
import { readAutomaticSubmission } from "./checklist-auto-submission";

export class ChecklistSourceError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 503) { super(message); }
}

/** Resolve writes from exact source/date evidence, never a party name or another source's hash. */
export async function resolveChecklistSource(input: { eventId: number; sourceEventId?: unknown; eventDate?: unknown }, options: {
  findPlan?: typeof findEventPlanById;
  findVip?: typeof findVipPrepReservationByEventId;
  getRecord?: typeof getChecklistRecord;
} = {}) {
  if (!Number.isSafeInteger(input.eventId) || input.eventId <= 0) throw new ChecklistSourceError("Invalid eventId.", 400);
  if (input.eventDate !== undefined && (typeof input.eventDate !== "string" || !isValidEntertainmentDate(input.eventDate))) throw new ChecklistSourceError("Event date must use YYYY-MM-DD.", 400);
  const sourceId = input.sourceEventId;
  if (sourceId !== undefined && (typeof sourceId !== "string" || !/^(?:[1-9]\d*|vip-[A-Za-z0-9-]{1,120})$/.test(sourceId))) throw new ChecklistSourceError("Invalid source event identity.", 400);
  const canonicalVip = typeof sourceId === "string" && sourceId.startsWith("vip-");
  if (sourceId !== undefined && (canonicalVip ? numericVipEventId(sourceId as string) !== input.eventId : sourceId !== String(input.eventId))) throw new ChecklistSourceError("The source event does not match this checklist. Refresh the selected event.", 409);
  let bookingProbeSignal: AbortSignal | undefined;
  const findVip = options.findVip ?? ((eventId, from, to) => findVipPrepReservationByEventId(eventId, from, to, new VipPrepClient({
    fetchImpl: (url, init) => fetch(url, { ...init, signal: bookingProbeSignal ??= AbortSignal.timeout(3000) }),
  })));
  let corporate: Awaited<ReturnType<typeof findEventPlanById>>;
  let stored: Awaited<ReturnType<typeof getChecklistRecord>>;
  try {
    [corporate, stored] = await Promise.all([(options.findPlan ?? findEventPlanById)(input.eventId), (options.getRecord ?? getChecklistRecord)(input.eventId)]);
  } catch { throw new ChecklistSourceError("The saved event source or checklist ownership could not be verified. Your draft has not been changed; retry source access.", 503); }
  if (corporate && (corporate.id !== input.eventId || !isValidEntertainmentDate(corporate.date)) || stored && stored.eventId !== input.eventId) throw new ChecklistSourceError("The saved source identity does not match this checklist. No other party was selected.", 409);
  const requestedDate = typeof input.eventDate === "string" ? input.eventDate : stored?.eventDate || corporate?.date;
  if (canonicalVip && !requestedDate) throw new ChecklistSourceError("Choose the exact VIP booking date before saving.", 400);
  if (canonicalVip && corporate) throw new ChecklistSourceError("This legacy numeric checklist identity belongs to more than one source. Admin must reconcile ownership before a saved record can change.", 409);
  const horizon = rollingEventPlanHorizon();
  let reservation: Awaited<ReturnType<typeof findVipPrepReservationByEventId>> = null;
  try {
    reservation = await findVip(canonicalVip ? sourceId as string : input.eventId, requestedDate || horizon.startDate, requestedDate || horizon.endDate);
    if (canonicalVip && reservation) {
      const owner = await findVip(input.eventId, reservation.operatingDate, reservation.operatingDate);
      if (!owner || vipPrepExternalId(owner) !== sourceId) throw new ChecklistSourceError("This VIP checklist identity is ambiguous. No other party's record was selected.", 409);
    }
  } catch (error) {
    if (error instanceof ChecklistSourceError) throw error;
    if (error instanceof VipPrepApiError && /identity is ambiguous/i.test(error.message)) throw new ChecklistSourceError("This legacy numeric checklist identity is ambiguous. Use the source reservation ID and ask Admin to review ownership.", 409);
    // An explicitly qualified corporate source remains authoritative during an unrelated booking outage.
    if (!corporate || sourceId !== String(input.eventId)) throw new ChecklistSourceError("The current booking source could not be verified. No different party was substituted and no changes were saved.", 503);
  }
  if (reservation && numericVipEventId(vipPrepExternalId(reservation)) !== input.eventId) throw new ChecklistSourceError("The source reservation does not match this numeric checklist identity.", 409);
  if (!canonicalVip && corporate && reservation) throw new ChecklistSourceError("This legacy numeric checklist identity matches corporate and VIP sources. No party was selected automatically; Admin must review ownership.", 409);
  if (canonicalVip && reservation && vipPrepExternalId(reservation) !== sourceId) throw new ChecklistSourceError("The source VIP identity could not be verified.", 409);
  if (reservation && isDecemberOwnerHoldReservation(reservation)) throw new ChecklistSourceError("This December internal VIP block is not a staff event. No checklist changes were saved.", 400);
  const plan = canonicalVip ? reservation ? vipPrepEventPlan(reservation) : null : corporate ?? (reservation ? vipPrepEventPlan(reservation) : null);
  if (!plan) throw new ChecklistSourceError("Unknown or inactive event. Refresh the source before saving.", 400);
  const sourceProof = stored ? readAutomaticSubmission(stored) : null;
  if (sourceProof && sourceProof.sourceEventId !== (plan.source_event_id ?? String(plan.id))) throw new ChecklistSourceError("The saved submission belongs to another source identity. Admin must review ownership before this checklist can change.", 409);
  if (input.eventDate !== undefined && plan.date !== input.eventDate || stored && stored.eventDate !== plan.date) throw new ChecklistSourceError("The saved checklist or booking date changed. Refresh and review the exact event before saving.", 409);
  return { plan, kitchenEventId: reservation && !corporate ? vipPrepExternalId(reservation) : String(plan.id) };
}
