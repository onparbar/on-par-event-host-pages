import { addCalendarDays, isValidEntertainmentDate, localDateForIso, todayInEntertainmentTimeZone, zonedDateTimeToIso } from "@/lib/entertainment/time";

export type StaffingEvent = {
  eventId: string;
  eventName: string;
  date: string;
  startAt: string | null;
  endAt: string | null;
};

/** A verified, published shift for an active employee. Older snapshots contain only Corporate Parties shifts. */
export type CorporateStaffShift = {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  startAt: string;
  endAt: string;
  corporate?: boolean;
  notes?: string;
};

export type StaffingEventDate = {
  eventId: string;
  eventDate: string;
};

export type StaffingSuppression = StaffingEventDate & { employeeId: string };

export type StaffingAssignment = StaffingSuppression & {
  employeeName: string;
  shiftId: string | null;
  source: "automatic" | "manual";
};

export type StaffingEventStatus = "assigned" | "unassigned" | "review" | "unverified";

export type StaffingReview = {
  code: "invalid-event-time" | "invalid-source" | "overlapping-shifts" | "uncertain-start" |
    "ambiguous-event" | "conflicting-note" | "unmatched-shift" | "manual-shift-changed" | "manual-coverage";
  eventIds: string[];
  shiftId?: string;
};

export type StaffingAlert = {
  key: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  startAt: string | null;
  endAt: string | null;
  openedAt: string;
  resolvedAt: string | null;
};

export type StaffingMatchPolicy = { earlyStartMinutes?: number; allowIntermediateStarts?: boolean };
export const MAX_STAFFING_EARLY_START_MINUTES = 180;

export function staffingWindow(now = new Date()) {
  const startDate = todayInEntertainmentTimeZone(now);
  return { startDate, endDate: addCalendarDays(startDate, 6), shiftStartDate: addCalendarDays(startDate, -1) };
}

export type StaffingReconciliation = {
  window: ReturnType<typeof staffingWindow>;
  dataStatus: "verified" | "unverified";
  lastSuccessfulSyncAt: string | null;
  assignments: StaffingAssignment[];
  eventStatuses: Record<string, StaffingEventStatus>;
  reviews: StaffingReview[];
  alerts: StaffingAlert[];
};

type Interval = { start: number; end: number };

export function staffingInstant(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    isValidEntertainmentDate(value.slice(0, 10)) ? Date.parse(value) : NaN;
}

function interval(startAt: string | null, endAt: string | null): Interval | null {
  const start = staffingInstant(startAt), end = staffingInstant(endAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}

function overlaps(left: Interval, right: Interval) {
  return left.start < right.end && right.start < left.end;
}

export function staffingShiftIsOnEventDay(shift: Pick<CorporateStaffShift, "startAt" | "endAt">, date: string) {
  const time = interval(shift.startAt, shift.endAt);
  return Boolean(time && isValidEntertainmentDate(date) && overlaps(time, {
    start: Date.parse(zonedDateTimeToIso(date, 0, 0)),
    end: Date.parse(zonedDateTimeToIso(addCalendarDays(date, 1), 0, 0)),
  }));
}

export function staffingShiftCoversEvent(shift: Pick<CorporateStaffShift, "startAt" | "endAt">, event: Pick<StaffingEvent, "startAt" | "endAt">) {
  const shiftTime = interval(shift.startAt, shift.endAt), eventTime = interval(event.startAt, event.endAt);
  return Boolean(shiftTime && eventTime && shiftTime.start <= eventTime.start && shiftTime.end >= eventTime.end);
}

function nameKey(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/** Match only whole event names or explicit event/Tripleseat references, never a substring. */
function eventHints(notes: string | undefined, events: readonly StaffingEvent[]) {
  const hints: string[][] = [];
  for (const line of (notes ?? "").split(/\r?\n/).map((value) => value.trim())) {
    if (!line) continue;
    const labeledId = line.match(/^(?:(?:tripleseat\s+)?event\s+id|tripleseat(?:\s+id)?)\s*(?::|#)\s*#?([a-z0-9:_-]+)$/i);
    const labeledName = line.match(/^event(?:\s+name)?\s*:\s*(.+)$/i);
    const matches = events.filter((event) => labeledId ? event.eventId === labeledId[1]
      : nameKey(event.eventName) === nameKey(labeledName?.[1] ?? line));
    if (labeledId || labeledName || matches.length) hints.push(matches.map((event) => event.eventId));
  }
  return hints;
}

/** Reconcile only a complete, authoritative rolling window. Manual choices survive every refresh. */
export function reconcileStaffing(input: {
  events: readonly StaffingEvent[];
  shifts: readonly CorporateStaffShift[];
  complete: boolean;
  previousAssignments?: readonly StaffingAssignment[];
  previousAlerts?: readonly StaffingAlert[];
  keepClearEventIds?: readonly string[];
  manualTeams?: readonly StaffingEventDate[];
  suppressedAssignments?: readonly StaffingSuppression[];
  lastSuccessfulSyncAt?: string | null;
  now?: Date;
  policy?: StaffingMatchPolicy;
}): StaffingReconciliation {
  const now = input.now ?? new Date();
  const window = staffingWindow(now);
  const inWindow = (date: string) => date >= window.startDate && date <= window.endDate;
  const events = input.events.filter((event) => isValidEntertainmentDate(event.date) && inWindow(event.date));
  const eventIds = events.map((event) => event.eventId);
  const previous = input.previousAssignments ?? [];
  const previousAlerts = input.previousAlerts ?? [];
  const shiftIntervals = new Map(input.shifts.map((shift) => [shift.shiftId, interval(shift.startAt, shift.endAt)]));
  const invalidSource = input.events.some((event) => !isValidEntertainmentDate(event.date)) || new Set(eventIds).size !== events.length ||
    events.some((event) => !event.eventId.trim() || !event.eventName.trim()) ||
    shiftIntervals.size !== input.shifts.length || input.shifts.some((shift) => !shift.shiftId.trim() || !shift.employeeId.trim() ||
      !shift.employeeName.trim() || !shiftIntervals.get(shift.shiftId) ||
      (shift.corporate !== undefined && typeof shift.corporate !== "boolean"));
  if (!input.complete || invalidSource) return {
    window, dataStatus: "unverified", lastSuccessfulSyncAt: input.lastSuccessfulSyncAt ?? null,
    assignments: [...previous], eventStatuses: Object.fromEntries(eventIds.map((id) => [id, "unverified"])),
    reviews: invalidSource ? [{ code: "invalid-source", eventIds: [] }] : [], alerts: [...previousAlerts],
  };
  const syncedAt = now.toISOString();
  const leadMinutes = input.policy?.earlyStartMinutes ?? 60;
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > MAX_STAFFING_EARLY_START_MINUTES) {
    throw new Error(`Staffing early start must be 0 to ${MAX_STAFFING_EARLY_START_MINUTES} whole minutes.`);
  }
  const leadMs = leadMinutes * 60_000;
  const eventTimes = new Map(events.flatMap((event) => {
    const time = interval(event.startAt, event.endAt);
    return time && localDateForIso(event.startAt!) === event.date ? [[event.eventId, time] as const] : [];
  }));
  const invalidTimes = new Set(eventIds.filter((id) => !eventTimes.has(id)));
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const reviews: StaffingReview[] = [...invalidTimes].map((eventId) => ({ code: "invalid-event-time", eventIds: [eventId] }));
  const kept = previous.filter((row) => row.source === "manual" || invalidTimes.has(row.eventId) ||
    (!inWindow(row.eventDate) && !eventById.has(row.eventId)));
  const manual = kept.filter((row) => row.source === "manual");
  const manualByShift = new Map(manual.flatMap((row) => row.shiftId ? [[row.shiftId, row] as const] : []));
  const shiftById = new Map(input.shifts.map((shift) => [shift.shiftId, shift]));
  const manualReviewEventIds = new Set<string>();
  for (const row of manual) {
    const event = eventById.get(row.eventId);
    if (!row.shiftId || !event) continue;
    const shift = shiftById.get(row.shiftId);
    if (!shift || shift.employeeId !== row.employeeId || event.date !== row.eventDate || !staffingShiftIsOnEventDay(shift, event.date)) {
      reviews.push({ code: "manual-shift-changed", eventIds: [row.eventId], shiftId: row.shiftId });
      if (event.date === row.eventDate) manualReviewEventIds.add(row.eventId);
    } else if (!staffingShiftCoversEvent(shift, event)) {
      reviews.push({ code: "manual-coverage", eventIds: [row.eventId], shiftId: row.shiftId });
      manualReviewEventIds.add(row.eventId);
    }
    const eventTime = eventTimes.get(row.eventId);
    if (eventTime && event.date === row.eventDate && manual.some((other) => {
      const otherTime = eventTimes.get(other.eventId);
      return other.employeeId === row.employeeId && other.eventId !== row.eventId &&
        eventById.get(other.eventId)?.date === other.eventDate && otherTime && overlaps(eventTime, otherTime);
    })) {
      reviews.push({ code: "overlapping-shifts", eventIds: [row.eventId], shiftId: row.shiftId });
      manualReviewEventIds.add(row.eventId);
    }
  }
  const keepClear = new Set(input.keepClearEventIds);
  const manualTeamDates = new Map(input.manualTeams?.map((row) => [row.eventId, row.eventDate]));
  const suppressed = new Set(input.suppressedAssignments?.map((row) => JSON.stringify([row.eventId, row.eventDate, row.employeeId])));
  const shifts = input.shifts.filter((shift) => {
    const date = localDateForIso(shift.startAt);
    return date >= window.shiftStartDate && date <= window.endDate;
  });
  const automatic: StaffingAssignment[] = [];
  for (const shift of shifts) {
    if (shift.corporate === false || manualByShift.has(shift.shiftId)) continue;
    const time = shiftIntervals.get(shift.shiftId)!;
    const possible = events.filter((event) => {
      const eventTime = eventTimes.get(event.eventId);
      return eventTime && overlaps(time, eventTime);
    });
    const hints = eventHints(shift.notes, events);
    const target = hints.length ? possible.filter(({ eventId }) => hints.every((ids) => ids.includes(eventId))) : possible;
    const reviewed = (code: StaffingReview["code"], ids = target.map((event) => event.eventId)) => reviews.push({ code, eventIds: [...new Set(ids)].sort(), shiftId: shift.shiftId });
    if (hints.length && !target.length) {
      reviewed("conflicting-note", [...possible.map((event) => event.eventId), ...hints.flat()]);
      continue;
    }
    const eligible = target.filter((event) => !keepClear.has(event.eventId) && manualTeamDates.get(event.eventId) !== event.date &&
      !suppressed.has(JSON.stringify([event.eventId, event.date, shift.employeeId])));
    if (!eligible.length) {
      if (!target.length) reviewed("unmatched-shift");
      continue;
    }
    if (shifts.some((other) => other.employeeId === shift.employeeId && other.shiftId !== shift.shiftId && overlaps(time, shiftIntervals.get(other.shiftId)!))) {
      reviewed("overlapping-shifts", eligible.map((event) => event.eventId));
      continue;
    }
    if (eligible.length > 1) {
      reviewed("ambiguous-event", eligible.map((event) => event.eventId));
      continue;
    }
    const event = eligible[0], eventTime = eventTimes.get(event.eventId)!;
    const lead = eventTime.start - time.start;
    // A regular shift that starts earlier than the event-specific early start can still cover the event.
    if (lead < 0 || time.end < eventTime.end || (lead > 0 && lead < leadMs && !input.policy?.allowIntermediateStarts)) {
      reviewed("uncertain-start", [event.eventId]);
      continue;
    }
    if (manual.some((row) => row.employeeId === shift.employeeId && row.eventId !== event.eventId &&
        eventById.get(row.eventId)?.date === row.eventDate &&
        eventTimes.has(row.eventId) && (overlaps(time, eventTimes.get(row.eventId)!) || overlaps(eventTime, eventTimes.get(row.eventId)!)))) {
      reviewed("overlapping-shifts", [event.eventId]);
      continue;
    }
    if (kept.some((row) => row.eventId === event.eventId && row.eventDate === event.date && row.employeeId === shift.employeeId)) continue;
    automatic.push({ eventId: event.eventId, eventDate: event.date, employeeId: shift.employeeId,
      employeeName: shift.employeeName, shiftId: shift.shiftId, source: "automatic" });
  }
  const confirmedAutomatic = automatic.filter((row) => {
    if (!automatic.some((other) => other.employeeId === row.employeeId && other.eventId !== row.eventId &&
      overlaps(eventTimes.get(row.eventId)!, eventTimes.get(other.eventId)!))) return true;
    reviews.push({ code: "overlapping-shifts", eventIds: [row.eventId], shiftId: row.shiftId! });
    return false;
  });
  const assignments = [...kept, ...confirmedAutomatic].sort((a, b) => a.eventDate.localeCompare(b.eventDate) ||
    a.eventId.localeCompare(b.eventId) || a.employeeId.localeCompare(b.employeeId) || (a.shiftId ?? "").localeCompare(b.shiftId ?? ""));
  const needsReview = new Set(reviews.filter((review) => review.code !== "manual-shift-changed").flatMap((review) => review.eventIds));
  const eventStatuses = Object.fromEntries(events.map(({ eventId, date }): [string, StaffingEventStatus] => [eventId,
    invalidTimes.has(eventId) || manualReviewEventIds.has(eventId) ||
      (needsReview.has(eventId) && manualTeamDates.get(eventId) !== date && !keepClear.has(eventId)) ? "review" :
      assignments.some((row) => row.eventId === eventId && row.eventDate === date) ? "assigned" :
      needsReview.has(eventId) ? "review" : "unassigned"]));
  const alerts = new Map(previousAlerts.map((alert) => [alert.key, alert]));
  const activeKeys = new Set<string>();
  for (const event of events) {
    if (eventStatuses[event.eventId] !== "unassigned") continue;
    const key = `staffing-unassigned:${event.eventId}`;
    const previousAlert = alerts.get(key);
    activeKeys.add(key);
    alerts.set(key, { key, eventId: event.eventId, eventName: event.eventName, eventDate: event.date,
      startAt: event.startAt, endAt: event.endAt, openedAt: previousAlert && !previousAlert.resolvedAt ? previousAlert.openedAt : syncedAt, resolvedAt: null });
  }
  for (const [key, alert] of alerts) {
    if (!activeKeys.has(key) && !alert.resolvedAt && (!eventById.has(alert.eventId) || eventStatuses[alert.eventId] === "assigned")) {
      alerts.set(key, { ...alert, resolvedAt: syncedAt });
    }
  }
  return { window, dataStatus: "verified", lastSuccessfulSyncAt: syncedAt, assignments, eventStatuses, reviews, alerts: [...alerts.values()] };
}
