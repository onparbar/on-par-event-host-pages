import { parseEntertainmentDurationMinutes, formatEntertainmentDurationHours } from "./duration";
import { canonicalCategoryForText } from "./resources";
import { addCalendarDays, parseClockTime, parseTimeRange, zonedDateTimeToIso } from "./time";
import type { EntertainmentReviewIssue, EntertainmentSourceEvent, EntertainmentSourceItem, EntertainmentStartTimeSource } from "./types";

type SourceTiming = Pick<EntertainmentSourceEvent, "localDate" | "eventStartAt" | "eventEndAt" | "timingNotes"> & {
  items?: readonly EntertainmentSourceItem[];
};
export type EntertainmentTimingItem = EntertainmentSourceItem & {
  contractedDurationMinutes?: number;
  timingReviewIssues?: EntertainmentReviewIssue[];
  resourceText?: string;
};

function textFor(item: EntertainmentSourceItem) {
  return [...new Set([item.name, item.description].filter((value): value is string => Boolean(value)))].join(" · ")
    .replace(/(hours?|hrs?|minutes?|mins?)(?=\d)/gi, "$1 ");
}

function zonedInstant(value: string | null) {
  return value && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function clockInstant(value: string, date: string) {
  const normalized = value.replace(/(\d)\s*([ap])\b/gi, "$1$2m");
  const clock = parseClockTime(normalized);
  const military = !clock ? normalized.trim().match(/^(\d{2}):([0-5]\d)(?::[0-5]\d)?$/) : null;
  const hour = clock?.hour ?? (military ? Number(military[1]) : null);
  const minute = clock?.minute ?? (military ? Number(military[2]) : null);
  if (hour == null || minute == null || hour > 23) return null;
  try { return zonedDateTimeToIso(hour < 10 ? addCalendarDays(date, 1) : date, hour, minute); }
  catch { return null; }
}

function textRange(value: string, date: string) {
  try { return parseTimeRange(value.replace(/(\d)\s*([ap])\b/gi, "$1$2m"), date); }
  catch { return null; }
}

function durationEvidence(item: EntertainmentTimingItem) {
  if (item.contractedDurationMinutes != null) return { minutes: item.contractedDurationMinutes, contradictory: false };
  const values = [...new Set([item.name, item.description].filter((value): value is string => Boolean(value)))].map((value) => value.replace(/(hours?|hrs?|minutes?|mins?)(?=\d)/gi, "$1 "));
  const durations = values.flatMap((value) => {
    const parsed = parseEntertainmentDurationMinutes(value);
    return parsed == null ? [] : [parsed];
  });
  return {
    minutes: durations[0] ?? null,
    contradictory: new Set(durations).size > 1 || values.some((value) => /\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b/i.test(value) && parseEntertainmentDurationMinutes(value) == null),
  };
}

/** Fold the contract's rental detail/extra-hour lines before choosing a start. */
export function groupEntertainmentTimingItems(items: readonly EntertainmentSourceItem[]): EntertainmentTimingItem[] {
  const result: EntertainmentTimingItem[] = [];
  for (const item of items) {
    const text = textFor(item);
    const category = canonicalCategoryForText([item.categoryName, text].filter(Boolean).join(" "));
    const previous = result.at(-1);
    const previousCategory = previous ? canonicalCategoryForText([previous.categoryName, textFor(previous)].filter(Boolean).join(" ")) : null;
    const activity = category === "bowling" ? "(?:duckpin\\s+)?bowling" : "darts?";
    const extra = category === "bowling" || category === "darts"
      ? text.match(new RegExp(`\\b(?:(\\d+(?:\\.\\d+)?)\\s+)?extra\\s+hours?\\s+of\\s+${activity}\\b`, "i")) : null;
    const rentalDetail = new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*(?:hours?|hrs?|minutes?|mins?)\\s+${activity}\\s+lane\\s+rental\\b`, "i").test(text);
    const sameQuantity = previous && (previous.quantity == null || item.quantity == null || previous.quantity === item.quantity);
    const canMerge = previous && category === previousCategory && sameQuantity && !item.startAt && !item.endAt &&
      (category === "bowling" || category === "darts");
    const detailEvidence = durationEvidence(item);
    const priorEvidence = previous ? durationEvidence(previous) : null;
    const duration = detailEvidence.minutes;
    const previousDuration = priorEvidence?.minutes ?? null;
    if (canMerge && ((rentalDetail && previousDuration == null && duration != null) || extra)) {
      const extraMinutes = extra ? Number(extra[1] ?? 1) * 60 : null;
      const combined = extraMinutes != null && previousDuration != null ? previousDuration + extraMinutes : !extra ? duration : null;
      if (combined != null && combined > 0 && Number.isSafeInteger(combined * 60_000)) {
        previous.resourceText ??= [previous.categoryName, textFor(previous)].filter(Boolean).join(" ");
        if (detailEvidence.contradictory || priorEvidence?.contradictory) {
          previous.timingReviewIssues = [...(previous.timingReviewIssues ?? []), { code: "TIME_NEEDS_REVIEW", message: `${item.name} has contradictory or invalid contracted duration information.` }];
        }
        previous.contractedDurationMinutes = combined;
        previous.description = [previous.description, `${item.sourceId}: ${text}`].filter(Boolean).join(" · ");
        if (previous.quantity == null) previous.quantity = item.quantity;
        continue;
      }
    }
    result.push({ ...item });
  }
  return result;
}

function scopedNoteTiming(item: EntertainmentSourceItem, source: SourceTiming) {
  const category = canonicalCategoryForText([item.categoryName, textFor(item)].filter(Boolean).join(" "));
  const activity = category === "bowling" ? "(?:duckpin\\s+)?bowling"
    : category === "darts" ? "darts?" : category === "pool" ? "(?:pool|billiards?)"
    : category === "shuffleboard" ? "(?:neo\\s+)?shuffleboard"
    : category === "private-rooms" ? item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  if (!activity) return { starts: [] as string[], ends: [] as string[], issues: [] as EntertainmentReviewIssue[] };
  const noteClock = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?|[ap])\\b|\\d{2}:[0-5]\\d)";
  const pattern = new RegExp(`(?:^|[.;:\\n])\\s*(?:${activity})(?:\\s+(?:lanes?|tables?|boards?)(?:\\s+[\\d\\s,&–-]+)?)?\\s*(?:(?:starts?|begins?)\\s*(?:at\\s*)?|(?:at|from)\\s+|:\\s*)?(${noteClock}[^;\\n]*)`, "i");
  const clauses = (source.timingNotes ?? []).flatMap((note) => note.split(/[;\n]+|(?<=[.!?])\s+(?=[A-Z])/).flatMap((clause) => clause.match(pattern)?.[1] ?? []));
  if (!clauses.length) return { starts: [], ends: [], issues: [] };
  const sameCategoryItems = groupEntertainmentTimingItems(source.items ?? [item]).filter((candidate) => canonicalCategoryForText([candidate.categoryName, textFor(candidate)].filter(Boolean).join(" ")) === category);
  if (sameCategoryItems.length > 1) return { starts: [], ends: [], issues: [{ code: "TIME_NEEDS_REVIEW" as const, message: `${item.name}'s entertainment note cannot be uniquely matched to one contracted activity.` }] };
  const starts: string[] = [];
  const ends: string[] = [];
  const issues: EntertainmentReviewIssue[] = [];
  for (const clause of clauses) {
    const range = textRange(clause, source.localDate);
    const start = range?.startAt ?? clockInstant(clause, source.localDate);
    if (start) starts.push(start);
    else issues.push({ code: "TIME_NEEDS_REVIEW", message: `${item.name} has an entertainment start note that cannot be interpreted exactly.` });
    if (range) ends.push(range.endAt);
  }
  return { starts: [...new Set(starts)], ends: [...new Set(ends)], issues };
}

/** A missing entertainment start is a default, never an invented duration. */
export function resolveEntertainmentItemTiming(item: EntertainmentTimingItem, source: SourceTiming): {
  startAt: string | null;
  endAt: string | null;
  durationMinutes: number | null;
  startTimeSource: EntertainmentStartTimeSource | null;
  reviewIssues: EntertainmentReviewIssue[];
} {
  const reviewIssues = [...(item.timingReviewIssues ?? [])];
  const issue = (message: string) => reviewIssues.push({ code: "TIME_NEEDS_REVIEW", message });
  const texts = [...new Set([item.name, item.description].filter((value): value is string => Boolean(value)))];
  const parsedRanges = texts.flatMap((text) => textRange(text.replace(/(hours?|hrs?|minutes?|mins?)(?=\d)/gi, "$1 "), source.localDate) ?? []);
  const parsed = parsedRanges[0] ?? null;
  const structuredStart = zonedInstant(item.startAt) ?? (item.startAt ? clockInstant(item.startAt, source.localDate) : null);
  const structuredEnd = zonedInstant(item.endAt) ?? (item.endAt ? clockInstant(item.endAt, source.localDate) : null);
  const eventDerivedInterval = item.startTimeSource === "event-start-default";
  const noteTiming = scopedNoteTiming(item, source);
  reviewIssues.push(...noteTiming.issues);
  const textClocks = [...new Set(texts.flatMap((text) => [...text.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|[ap])\b/gi)]
    .flatMap((match) => clockInstant(match[0], source.localDate) ?? [])))];
  const explicitStart = (!eventDerivedInterval ? structuredStart : null) ?? parsed?.startAt ?? textClocks[0] ?? noteTiming.starts[0] ?? null;
  const explicitEnd = (!eventDerivedInterval ? structuredEnd : null) ?? parsed?.endAt ?? noteTiming.ends[0] ?? null;
  const evidence = durationEvidence(item);
  let durationMinutes = evidence.minutes;
  if (evidence.contradictory) issue(`${item.name} has contradictory or invalid contracted duration information.`);
  if (parsedRanges.some((range) => Date.parse(range.startAt) !== Date.parse(parsed!.startAt) || Date.parse(range.endAt) !== Date.parse(parsed!.endAt)) || (!parsed && textClocks.length > 1)) issue(`${item.name} has contradictory entertainment clock times.`);
  if (!eventDerivedInterval && structuredStart && parsed && Date.parse(structuredStart) !== Date.parse(parsed.startAt)) issue(`${item.name} has contradictory entertainment start times.`);
  if (!eventDerivedInterval && structuredStart && !parsed && textClocks.some((clock) => Date.parse(clock) !== Date.parse(structuredStart))) issue(`${item.name} has contradictory explicit entertainment start times.`);
  if (noteTiming.starts.some((clock) => Date.parse(clock) !== Date.parse(explicitStart!)) || noteTiming.ends.some((clock) => explicitEnd && Date.parse(clock) !== Date.parse(explicitEnd))) issue(`${item.name} has contradictory entertainment note times.`);
  if (item.startAt && !structuredStart) issue(`${item.name} has an invalid explicit entertainment start time.`);
  if (item.endAt && !structuredEnd) issue(`${item.name} has an invalid explicit entertainment end time.`);
  if (durationMinutes == null && explicitStart && explicitEnd && Date.parse(explicitEnd) > Date.parse(explicitStart)) {
    durationMinutes = (Date.parse(explicitEnd) - Date.parse(explicitStart)) / 60_000;
  }
  if (durationMinutes == null && eventDerivedInterval && structuredStart && structuredEnd && Date.parse(structuredEnd) > Date.parse(structuredStart)) {
    durationMinutes = (Date.parse(structuredEnd) - Date.parse(structuredStart)) / 60_000;
  }
  const defaultStart = zonedInstant(source.eventStartAt);
  const startAt = explicitStart ?? defaultStart;
  const startTimeSource = item.startTimeSource === "staff-override" ? "staff-override" : explicitStart ? "contract-explicit" : defaultStart ? "event-start-default" : null;
  if (durationMinutes == null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    issue(`${item.name} has no usable contracted duration.`);
    return { startAt, endAt: null, durationMinutes: null, startTimeSource, reviewIssues };
  }
  if (!startAt) {
    issue(`${item.name} has no usable entertainment or event start time.`);
    return { startAt: null, endAt: null, durationMinutes, startTimeSource, reviewIssues };
  }
  const endEpoch = Date.parse(startAt) + durationMinutes * 60_000;
  if (!Number.isFinite(endEpoch) || !Number.isFinite(new Date(endEpoch).getTime())) {
    issue(`${item.name} has an invalid contracted duration.`);
    return { startAt, endAt: null, durationMinutes: null, startTimeSource, reviewIssues };
  }
  const endAt = new Date(endEpoch).toISOString();
  if (explicitEnd && Date.parse(explicitEnd) !== endEpoch) issue(`${item.name}'s stated end time contradicts its ${formatEntertainmentDurationHours(durationMinutes)} contracted duration. The contracted duration is retained.`);
  return { startAt, endAt, durationMinutes, startTimeSource, reviewIssues };
}
