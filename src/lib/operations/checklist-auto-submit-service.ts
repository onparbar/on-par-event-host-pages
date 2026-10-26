import "server-only";
import { getChecklistRecord, saveChecklist } from "@/lib/checklist-storage";
import type { EventChecklistState } from "@/lib/checklist-model";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { getEventPlanStorage, type EventPlanStorage, type StoredEventPlan } from "@/lib/event-plans/storage";
import type { EventPlan } from "@/lib/event-plans/types";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { isActiveVipPrepReservation, VipPrepClient, vipPrepEventPlan, vipPrepExternalId, vipPrepMappingIssues, type VipPrepReservation } from "@/lib/vip-prep/client";
import { StaleSaveError } from "@/lib/stale-save";
import { AUTO_SUBMISSION_KEY, type AutomaticChecklistSubmission } from "./checklist-auto-submission";
import { isPreviewReviewOnly } from "./preview-review";
import { automaticChecklistSourceFingerprint, automaticChecklistTiming, checklistAutoSubmitConfiguration,
  checklistAutoSubmitDateRanges, type AutomaticChecklistSource } from "./checklist-auto-submit-policy";

type Dependencies = {
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  plans?: Pick<EventPlanStorage, "plansForWindow" | "findById">;
  vipClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  getRecord?: typeof getChecklistRecord;
  saveRecord?: typeof saveChecklist;
};

function planSource(row: StoredEventPlan): AutomaticChecklistSource | null {
  const plan = row.plan as unknown as EventPlan;
  if (!row.active || !/^\d+$/.test(row.eventId) || !Number.isSafeInteger(plan.id) || plan.id <= 0 || plan.id === 99990001 ||
      String(plan.id) !== row.eventId || plan.date !== row.eventDate || !isValidEntertainmentDate(plan.date) ||
      typeof plan.name !== "string" || typeof plan.time !== "string" ||
      ![plan.rooms, plan.food, plan.drink_options].every((items) => Array.isArray(items) && items.every((item) => typeof item === "string")) ||
      !Array.isArray(plan.entertainment) || plan.entertainment.some((item) => !item || typeof item.name !== "string" || typeof item.quantity !== "string") ||
      /^(?:cancelled|canceled|lost|prospect)$/i.test(String(row.sourceSnapshot.status ?? "")) ||
      plan.source_event_id && plan.source_event_id !== row.eventId) return null;
  const instant = (key: string) => typeof row.sourceSnapshot[key] === "string" ? String(row.sourceSnapshot[key]).trim() || null : null;
  return { sourceEventId: row.eventId, event: plan, startAt: instant("eventStartAt"), endAt: instant("eventEndAt"), sourceUpdatedAt: row.sourceUpdatedAt };
}

function vipSource(reservation: VipPrepReservation): AutomaticChecklistSource {
  const event = vipPrepEventPlan(reservation);
  const mappingIssues = vipPrepMappingIssues(reservation);
  return { sourceEventId: vipPrepExternalId(reservation), event: { ...event,
    needs_review: event.needs_review || mappingIssues.length > 0,
    review_reasons: [...(event.review_reasons ?? []), ...mappingIssues.map((issue) => `${issue.quantity} × ${issue.label}: ${issue.message}`)] },
    startAt: reservation.startAt, endAt: reservation.endAt, sourceUpdatedAt: reservation.updatedAt };
}

function blankChecklist(): EventChecklistState {
  return { bwa: "", poc: "", extrasAdded: "", remainingDrinkCardBalance: "", tasks: {}, taskEvidence: {}, food: {}, entertainment: {} };
}

/** Only saved Admin records are written. Never import an arrival, queue food, or synchronize add-ons here. */
export async function autoSubmitChecklists(options: Dependencies = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const summary = { enabled: false, reason: "", considered: 0, due: 0, submitted: 0, skipped: 0, conflicts: 0, failed: 0, sourceErrors: [] as string[] };
  if (isPreviewReviewOnly(env)) return { ...summary, reason: "read-only-preview" };
  const configuration = checklistAutoSubmitConfiguration(env, now);
  if (!configuration.enabled) return { ...summary, reason: configuration.reason };
  summary.enabled = true;
  if (now.getTime() < Date.parse(configuration.activatedAt)) return { ...summary, reason: "not-active-yet" };
  const plans = options.plans ?? getEventPlanStorage();
  const vipClient = options.vipClient ?? new VipPrepClient();
  const sources: AutomaticChecklistSource[] = [];
  for (const range of checklistAutoSubmitDateRanges(configuration.startDate, configuration.endDate)) {
    try {
      const rows = await plans.plansForWindow(range);
      if (rows.length >= 1000) summary.sourceErrors.push("A corporate source range reached the safe row limit; that range was not closed automatically.");
      else for (const row of rows) {
        const source = planSource(row);
        if (source) sources.push(source); else summary.skipped += 1;
      }
    } catch { summary.sourceErrors.push("Corporate source records are unavailable for a date range; affected events were not closed automatically."); }
    if (!vipClient.configured) {
      summary.sourceErrors.push("On Par Bookings is not configured; VIP checklists were not closed automatically.");
      continue;
    }
    try {
      const payload = await vipClient.fetchRange(range.startDate, range.endDate);
      sources.push(...payload.reservations.filter(isActiveVipPrepReservation).map(vipSource));
    } catch { summary.sourceErrors.push("On Par Bookings is unavailable for a date range; affected VIP events were not closed automatically."); }
  }
  const sourceCounts = new Map<string, number>();
  const numericCounts = new Map<number, number>();
  for (const source of sources) {
    sourceCounts.set(source.sourceEventId, (sourceCounts.get(source.sourceEventId) ?? 0) + 1);
    numericCounts.set(source.event.id, (numericCounts.get(source.event.id) ?? 0) + 1);
  }
  const getRecord = options.getRecord ?? getChecklistRecord;
  for (const scanned of sources) {
    summary.considered += 1;
    if (scanned.event.id === 99990001 || sourceCounts.get(scanned.sourceEventId) !== 1 || numericCounts.get(scanned.event.id) !== 1) { summary.skipped += 1; continue; }
    const scannedTiming = automaticChecklistTiming(scanned);
    if (!scannedTiming || Date.parse(scannedTiming.scheduledFor) < Date.parse(configuration.activatedAt) || now.getTime() < Date.parse(scannedTiming.scheduledFor)) { summary.skipped += 1; continue; }
    try {
      const existing = await getRecord(scanned.event.id);
      if (existing && (existing.eventDate !== scanned.event.date || existing.status === "submitted" ||
          Object.hasOwn(existing.tasks, AUTO_SUBMISSION_KEY) || Object.hasOwn(existing.taskEvidence ?? {}, AUTO_SUBMISSION_KEY))) { summary.skipped += 1; continue; }
      // A source may have moved or been cancelled since the range was read.
      let source: AutomaticChecklistSource | null;
      if (scanned.sourceEventId.startsWith("vip-")) {
        const current = await vipClient.fetchRange(scanned.event.date, scanned.event.date);
        const matching = current.reservations.filter((booking) => isActiveVipPrepReservation(booking) && vipPrepExternalId(booking) === scanned.sourceEventId);
        const owners = current.reservations.filter((booking) => isActiveVipPrepReservation(booking) && vipPrepEventPlan(booking).id === scanned.event.id);
        source = matching.length === 1 && owners.length === 1 ? vipSource(matching[0]) : null;
      } else {
        const row = await plans.findById(scanned.sourceEventId);
        source = row ? planSource(row) : null;
      }
      const timing = source && automaticChecklistTiming(source);
      if (!source || source.event.id !== scanned.event.id || source.event.date !== scanned.event.date || !timing ||
          Date.parse(timing.scheduledFor) < Date.parse(configuration.activatedAt) || now.getTime() < Date.parse(timing.scheduledFor)) { summary.skipped += 1; continue; }
      const state: EventChecklistState = existing ? structuredClone(existing) : blankChecklist();
      const readiness = checklistReadiness(source.event, state);
      const complete = (key: string) => state.tasks[key] === true && typeof state.taskEvidence?.[key]?.employeeName === "string" && Boolean(state.taskEvidence[key].employeeName.trim()) &&
        Number.isFinite(Date.parse(state.taskEvidence?.[key]?.completedAt ?? ""));
      const receipt: AutomaticChecklistSubmission = { version: 1, actor: "SYSTEM", ...timing,
        submittedAt: now.toISOString(), sourceEventId: source.sourceEventId, sourceFingerprint: automaticChecklistSourceFingerprint(source),
        missingTaskKeys: readiness.tasks.filter((task) => task.applicability !== "not-applicable" && (task.applicability === "needs-review" || !complete(task.key))).map((task) => task.key),
        missingBwa: !state.bwa.trim(), missingPoc: !state.poc?.trim(), contractWarnings: [...new Set([
          ...readiness.tasks.filter((task) => task.applicability === "needs-review").map((task) => `${task.label}: ${task.reason}`),
          ...(source.event.review_reasons ?? []),
        ])] };
      summary.due += 1;
      await (options.saveRecord ?? saveChecklist)({ action: "submit", eventId: source.event.id, eventName: source.event.name, eventDate: source.event.date,
        poc: existing?.poc ?? "", checklist: state, expectedUpdatedAt: existing?.updatedAt ?? null, autoSubmission: receipt });
      summary.submitted += 1;
    } catch (error) {
      if (error instanceof StaleSaveError) summary.conflicts += 1;
      else summary.failed += 1;
    }
  }
  summary.sourceErrors = [...new Set(summary.sourceErrors)];
  return summary;
}
