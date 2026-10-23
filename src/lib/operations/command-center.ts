import type { ChecklistRecord } from "@/lib/checklist-model";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { easternDateValue } from "@/lib/event-lifecycle";
import { addCalendarDays, isValidEntertainmentDate, parseClockTime, zonedDateTimeToIso } from "@/lib/entertainment/time";
import type { EventPlan, EventPlanSyncState } from "@/lib/event-plans/types";
import { operationalEventFromPlan, type SelectedOperationalEvent } from "./event-context";

export type CommandCenterFilter = "today" | "upcoming" | "attention" | "next60";
export type OperationalEventSummary = {
  event: SelectedOperationalEvent;
  startsAt: string | null;
  endsAt: string | null;
  attention: string[];
  sourceSyncedAt: string | null;
  sourceUpdatedAt: string | null;
  checklistStatus: "not-started" | "in-progress" | "submitted" | "unavailable";
  checklistCompleted: number;
  checklistTotal: number;
  hostAssigned: boolean;
};

export function operationalEventWindow(plan: Pick<EventPlan, "date" | "time">) {
  const parts = plan.time.split(/\s+[-–—]\s+/);
  if (!isValidEntertainmentDate(plan.date) || parts.length !== 2) return null;
  const start = parseClockTime(parts[0]);
  const end = parseClockTime(parts[1]);
  if (!start || !end) return null;
  try {
    return {
      startsAt: zonedDateTimeToIso(plan.date, start.hour, start.minute),
      endsAt: zonedDateTimeToIso(
        end.hour * 60 + end.minute <= start.hour * 60 + start.minute ? addCalendarDays(plan.date, 1) : plan.date,
        end.hour,
        end.minute,
      ),
    };
  } catch {
    return null;
  }
}

function validTimestamp(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function buildOperationalEventSummaries(
  plans: readonly EventPlan[],
  records: readonly Pick<ChecklistRecord, "eventId" | "eventDate" | "status" | "tasks" | "bwa" | "taskEvidence">[] | null,
  sync: EventPlanSyncState | null,
) {
  const recordById = new Map(records?.map((record) => [record.eventId, record]));
  return plans.map((plan): OperationalEventSummary => {
    const saved = recordById.get(plan.id);
    const record = saved?.eventDate === plan.date ? saved : undefined;
    const window = operationalEventWindow(plan);
    const attention: string[] = [];
    if (plan.needs_review || /needs\s+review/i.test(plan.verification_status)) attention.push("Contract needs review");
    if (!plan.rooms.length) attention.push("Reserved area missing");
    if (!Number.isFinite(plan.guest_count) || plan.guest_count <= 0) attention.push("Guest count needs review");
    if (!window) attention.push("Event time needs review");
    const syncCoversEvent = Boolean(sync && plan.date >= sync.windowStart && plan.date <= sync.windowEnd);
    const sourceSyncedAt = validTimestamp(plan.synced_at) ?? (syncCoversEvent ? validTimestamp(sync?.lastSuccessfulSyncAt) : null);
    const sourceUpdatedAt = validTimestamp(plan.source_updated_at);
    if (syncCoversEvent && sync?.status === "error") attention.push("Source sync needs retry");
    else if (!sourceSyncedAt) attention.push("Source refresh not verified");
    else if (sourceUpdatedAt && Date.parse(sourceUpdatedAt) > Date.parse(sourceSyncedAt)) attention.push("Source changed after refresh");
    if (records === null) attention.push("Checklist status unavailable");
    const readiness = checklistReadiness(plan, { tasks: record?.tasks ?? {}, bwa: record?.bwa ?? "", taskEvidence: record?.taskEvidence });
    return {
      event: operationalEventFromPlan(plan),
      startsAt: window?.startsAt ?? null,
      endsAt: window?.endsAt ?? null,
      attention,
      sourceSyncedAt,
      sourceUpdatedAt,
      checklistStatus: records === null ? "unavailable" : record?.status === "submitted" ? "submitted" : record ? "in-progress" : "not-started",
      checklistCompleted: readiness.completed,
      checklistTotal: readiness.total,
      hostAssigned: Boolean(record?.bwa.trim()),
    };
  }).sort((left, right) => left.event.date.localeCompare(right.event.date) || (left.startsAt ?? "~").localeCompare(right.startsAt ?? "~") || left.event.eventName.localeCompare(right.event.eventName));
}

export function commandCenterEvents(
  events: readonly OperationalEventSummary[],
  filter: CommandCenterFilter,
  now: Date,
) {
  const today = easternDateValue(now);
  const timestamp = now.getTime();
  return events.filter((item) => {
    if (filter === "today") return item.event.date === today;
    if (filter === "upcoming") return item.startsAt ? Date.parse(item.startsAt) > timestamp : item.event.date > today;
    if (filter === "next60") return Boolean(item.startsAt && item.endsAt && Date.parse(item.startsAt) <= timestamp + 60 * 60_000 && Date.parse(item.endsAt) > timestamp);
    return item.attention.length > 0 && (item.event.date >= today || Boolean(item.endsAt && Date.parse(item.endsAt) > timestamp));
  });
}
