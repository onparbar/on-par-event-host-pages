import { createHash } from "node:crypto";
import type { EventPlan } from "@/lib/event-plans/types";
import { addCalendarDays, parseClockTime } from "@/lib/entertainment/time";
import { easternDateValue } from "@/lib/event-lifecycle";
import { kitchenEventInterval } from "@/lib/kitchen/lifecycle";

export type AutomaticChecklistSource = {
  sourceEventId: string;
  event: EventPlan;
  startAt: string | null;
  endAt: string | null;
  sourceUpdatedAt: string | null;
};

export function checklistAutoSubmitConfiguration(env: Readonly<Record<string, string | undefined>>, now: Date) {
  if (env.CHECKLIST_AUTO_SUBMIT_ENABLED !== "true") return { enabled: false as const, reason: "disabled" };
  const activatedAt = env.CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT?.trim() ?? "";
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(activatedAt) || !Number.isFinite(Date.parse(activatedAt))) {
    return { enabled: false as const, reason: "invalid-activation" };
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Automatic closeout requires a valid current time.");
  return { enabled: true as const, activatedAt, startDate: addCalendarDays(easternDateValue(new Date(activatedAt)), -1), endDate: easternDateValue(now) };
}

/** Bounded source reads retain the configured activation boundary, not a rolling overview. */
export function checklistAutoSubmitDateRanges(startDate: string, endDate: string) {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (let from = startDate; from <= endDate;) {
    const through = addCalendarDays(from, 30);
    const to = through < endDate ? through : endDate;
    ranges.push({ startDate: from, endDate: to });
    from = addCalendarDays(to, 1);
  }
  return ranges;
}

export function automaticChecklistTiming(source: AutomaticChecklistSource) {
  const clocks = [...source.event.time.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi)];
  const clock = (index: number) => {
    if (clocks.length !== 2) return null;
    const parsed = parseClockTime(clocks[index][0]);
    return parsed ? `${parsed.hour}:${String(parsed.minute).padStart(2, "0")}` : null;
  };
  const interval = kitchenEventInterval({ localDate: source.event.date,
    startTime: source.startAt || clock(0), endTime: source.endAt || clock(1) });
  if (interval.startAt === null || interval.endAt === null || interval.endAt <= interval.startAt) return null;
  return { eventEndedAt: new Date(interval.endAt).toISOString(), scheduledFor: new Date(interval.endAt + 3_600_000).toISOString() };
}

export function automaticChecklistSourceFingerprint(source: AutomaticChecklistSource) {
  return createHash("sha256").update(JSON.stringify(["checklist-auto-submit-v1", source.sourceEventId, source.sourceUpdatedAt,
    source.startAt, source.endAt, source.event])).digest("hex");
}
