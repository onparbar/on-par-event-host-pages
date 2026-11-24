import "server-only";
import { addCalendarDays, localDateForIso, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { getTripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { StaleSaveError } from "@/lib/stale-save";
import { MAX_STAFFING_EARLY_START_MINUTES, reconcileStaffing, staffingInstant, staffingShiftCoversEvent, staffingShiftIsOnEventDay, staffingWindow, type CorporateStaffShift, type StaffingAssignment, type StaffingEvent, type StaffingEventStatus } from "./domain";
import { readPublishedStaffingShifts, StaffingSourceError } from "./sevenshifts";
import { loadStaffingState, saveStaffingState, type StaffingState } from "./storage";

export const STAFFING_FRESHNESS_MINUTES = 45;
type Window = ReturnType<typeof staffingWindow>;
type Dependencies = {
  now?: Date;
  date?: string;
  load?: typeof loadStaffingState;
  save?: typeof saveStaffingState;
  readEvents?: (window: Window) => Promise<StaffingEvent[]>;
  readShifts?: (window: Window) => Promise<CorporateStaffShift[]>;
};

/** Use exact Tripleseat snapshots; never replace durable operational plans or advance their sync status. */
async function readTripleseatStaffingEvents({ shiftStartDate, endDate }: Window) {
  const adapter = getTripleseatAdapter();
  if (adapter.sourceMode !== "live" || !adapter.fetchStaffingEventsForRange) throw new Error("Verified Tripleseat staffing reads are unavailable.");
  // Include overnight events on either boundary when checking retained assignments.
  return (await adapter.fetchStaffingEventsForRange(shiftStartDate, addCalendarDays(endDate, 1))).map((source) => ({
    eventId: source.eventId, eventName: source.eventName, date: source.localDate, startAt: source.eventStartAt, endAt: source.eventEndAt,
  }));
}

export function staffingSnapshotIsFresh(state: StaffingState, now = new Date()) {
  const saved = state.reconciliation;
  const time = saved?.lastSuccessfulSyncAt ? Date.parse(saved.lastSuccessfulSyncAt) : NaN;
  const age = now.getTime() - time;
  if (state.failure || saved?.dataStatus !== "verified" || !Number.isFinite(age) || age < 0 ||
      age > STAFFING_FRESHNESS_MINUTES * 60_000 || todayInEntertainmentTimeZone(new Date(time)) !== todayInEntertainmentTimeZone(now)) return false;
  try {
    const expected = staffingWindow(new Date(time), saved.window.startDate);
    return expected.startDate === saved.window.startDate && expected.endDate === saved.window.endDate &&
      expected.shiftStartDate === saved.window.shiftStartDate;
  } catch { return false; }
}

function dateInSnapshot(state: StaffingState, date: string, now: Date) {
  const window = state.reconciliation?.window;
  return Boolean(window && date >= todayInEntertainmentTimeZone(now) && date >= window.startDate && date <= window.endDate);
}

export async function refreshStaffing(dependencies: Dependencies = {}, expectedVersion?: number) {
  const now = dependencies.now ?? new Date();
  const previous = await (dependencies.load ?? loadStaffingState)();
  if (expectedVersion !== undefined && previous.version !== expectedVersion) throw new StaleSaveError();
  const save = dependencies.save ?? saveStaffingState;
  const window = staffingWindow(now, dependencies.date);
  const contextEnd = addCalendarDays(window.endDate, 1);
  const [events, shifts] = await Promise.allSettled([
    (dependencies.readEvents ?? readTripleseatStaffingEvents)(window),
    (dependencies.readShifts ?? readPublishedStaffingShifts)({ ...window, endDate: contextEnd }),
  ]);
  const lastAttemptAt = now.toISOString();
  const fail = (failure: NonNullable<StaffingState["failure"]>) => save({ ...previous, lastAttemptAt, failure }, previous.version);
  if (events.status === "rejected") return fail("events");
  if (shifts.status === "rejected") return fail(shifts.reason instanceof StaffingSourceError && shifts.reason.reason === "incomplete" ? "incomplete" : "shifts");
  const returnedIds = new Set(events.value.map((event) => event.eventId));
  const retainedEvents = previous.events.filter((event) => !returnedIds.has(event.eventId) &&
    (event.date < window.shiftStartDate || event.date > contextEnd) && previous.reconciliation?.assignments.some((row) =>
      row.eventId === event.eventId && row.eventDate === event.date));
  const combinedEvents = [...events.value, ...retainedEvents];
  const previousAssignments = previous.reconciliation?.assignments.filter((row) => {
    if (row.source === "manual") return true;
    const event = combinedEvents.find((item) => item.eventId === row.eventId && item.date === row.eventDate);
    if (!event) return false;
    if (row.eventDate < window.shiftStartDate || row.eventDate > contextEnd) return true;
    return shifts.value.some((shift) => shift.shiftId === row.shiftId && shift.employeeId === row.employeeId &&
      shift.corporate !== false && staffingShiftIsOnEventDay(shift, event.date) && staffingShiftCoversEvent(shift, event));
  });
  const reconciliation = reconcileStaffing({ events: combinedEvents, shifts: shifts.value, complete: true, now, startDate: window.startDate,
    policy: previous.policy, keepClearEventIds: previous.keepClearEventIds, manualTeams: previous.manualTeams,
    suppressedAssignments: previous.suppressedAssignments, previousAssignments,
    previousAlerts: previous.reconciliation?.alerts, lastSuccessfulSyncAt: previous.reconciliation?.lastSuccessfulSyncAt });
  if (reconciliation.dataStatus === "unverified") return fail("incomplete");
  return save({ ...previous, reconciliation, events: combinedEvents, shifts: shifts.value, dailyScheduleComplete: true, lastAttemptAt, failure: null }, previous.version);
}

export type StaffingAssignmentChoice = { shiftId: string; confirmPartialCoverage?: boolean; confirmMove?: boolean };

export class StaffingReviewError extends Error {}

export type StaffingAdminChange = { expectedVersion: number } & (
  | ({ action: "assign"; eventId: string } & StaffingAssignmentChoice)
  | { action: "assign-many"; eventId: string; choices: StaffingAssignmentChoice[] }
  | { action: "replace-team"; eventId: string; eventDate?: string; choices: StaffingAssignmentChoice[] }
  | { action: "remove-manual"; eventId: string; employeeId: string }
  | { action: "keep-clear"; eventId: string; enabled: boolean }
  | { action: "policy"; earlyStartMinutes: number; allowIntermediateStarts: boolean }
);

function hasOverlappingAssignment(shift: CorporateStaffShift, event: StaffingEvent, assignments: readonly StaffingAssignment[], events: readonly StaffingEvent[]) {
  return assignments.some((row) => {
    if (row.employeeId !== shift.employeeId || row.eventId === event.eventId || row.shiftId === shift.shiftId) return false;
    const other = events.find((item) => item.eventId === row.eventId && item.date === row.eventDate);
    const start = staffingInstant(other?.startAt ?? null), end = staffingInstant(other?.endAt ?? null);
    return !(start < end) || localDateForIso(other!.startAt!) !== row.eventDate ||
      (start < staffingInstant(event.endAt) && end > staffingInstant(event.startAt));
  });
}

/** Project only the requested event's roster from the verified, saved snapshot; no provider calls. */
export function staffingEditorRoster(state: StaffingState, eventId: string, date: string, now = new Date()) {
  if (eventId.startsWith("vip-") || date < todayInEntertainmentTimeZone(now)) return null;
  if (!staffingSnapshotIsFresh(state, now) || !state.dailyScheduleComplete || !dateInSnapshot(state, date, now)) {
    throw new StaffingReviewError("Verify the published schedule for this event's week in Staffing Review before assigning staff.");
  }
  const matches = state.events.filter((event) => event.eventId === eventId);
  const event = matches.length === 1 && matches[0].date === date ? matches[0] : null;
  if (!event) return null;
  const assignments = state.reconciliation?.assignments ?? [];
  const shifts = state.shifts.filter((shift) => staffingShiftIsOnEventDay(shift, date))
    .map((shift) => ({
      shiftId: shift.shiftId, employeeId: shift.employeeId, employeeName: shift.employeeName, startAt: shift.startAt, endAt: shift.endAt,
      coversEvent: staffingShiftCoversEvent(shift, event),
      needsMove: assignments.some((row) => row.shiftId === shift.shiftId && row.eventId !== eventId),
      conflict: hasOverlappingAssignment(shift, event, assignments, state.events),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || staffingInstant(a.startAt) - staffingInstant(b.startAt));
  const available = new Set(shifts.map((shift) => shift.shiftId));
  const selectedShiftIds = assignments.flatMap((row) => row.eventId === eventId && row.eventDate === date && row.shiftId && available.has(row.shiftId) ? [row.shiftId] : []);
  return { version: state.version, selectedShiftIds, shifts };
}

export async function updateStaffingOverride(change: StaffingAdminChange, dependencies: Pick<Dependencies, "now" | "load" | "save"> = {}) {
  const now = dependencies.now ?? new Date();
  const previous = await (dependencies.load ?? loadStaffingState)();
  if (previous.version !== change.expectedVersion) throw new StaleSaveError();
  let assignments = previous.reconciliation?.assignments ?? [];
  let policy = previous.policy;
  const keepClear = new Set(previous.keepClearEventIds);
  const manualTeams = new Map(previous.manualTeams?.map((row) => [row.eventId, row.eventDate]));
  const suppressed = new Map(previous.suppressedAssignments?.map((row) => [JSON.stringify([row.eventId, row.eventDate, row.employeeId]), row]));
  function suppress(eventId: string, eventDate: string, employeeId: string) {
    suppressed.set(JSON.stringify([eventId, eventDate, employeeId]), { eventId, eventDate, employeeId });
  }
  if (change.action === "policy") {
    if (!Number.isInteger(change.earlyStartMinutes) || change.earlyStartMinutes < 0 || change.earlyStartMinutes > MAX_STAFFING_EARLY_START_MINUTES ||
        typeof change.allowIntermediateStarts !== "boolean") throw new StaffingReviewError("Invalid staffing policy.");
    policy = { earlyStartMinutes: change.earlyStartMinutes, allowIntermediateStarts: change.allowIntermediateStarts };
  } else {
    if (!staffingSnapshotIsFresh(previous, now) || !previous.dailyScheduleComplete) {
      throw new StaffingReviewError("Refresh the published schedule before editing an event assignment.");
    }
    const eventDate = change.action === "replace-team" ? change.eventDate : undefined;
    const candidates = previous.events.filter((item) => item.eventId === change.eventId);
    const event = candidates.find((item) => dateInSnapshot(previous, item.date, now) &&
      (eventDate === undefined || (candidates.length === 1 && item.date === eventDate && !change.eventId.startsWith("vip-"))));
    if (!event) throw new StaffingReviewError("Choose a verified event in the selected staffing week.");
    if (change.action === "assign" || change.action === "assign-many" || change.action === "replace-team") {
      const choices = change.action === "assign" ? [change] : change.choices;
      if (!choices.length && change.action !== "replace-team") throw new StaffingReviewError("Choose at least one verified published shift.");
      const shifts = new Map(previous.shifts.map((shift) => [shift.shiftId, shift]));
      const eventStart = staffingInstant(event.startAt), eventEnd = staffingInstant(event.endAt);
      if (choices.length && !(eventStart < eventEnd)) throw new StaffingReviewError("The event time could not be verified.");
      const employeeIds = new Set<string>();
      const shiftIds = new Set<string>();
      const manual: StaffingAssignment[] = [];
      for (const choice of choices) {
        const shift = shifts.get(choice.shiftId);
        if (!shift) throw new StaffingReviewError("Choose a verified published shift.");
        if (employeeIds.has(shift.employeeId)) throw new StaffingReviewError("Choose only one published shift per employee.");
        if (!staffingShiftIsOnEventDay(shift, event.date)) throw new StaffingReviewError("Choose a published shift on the event day.");
        if (!staffingShiftCoversEvent(shift, event) && choice.confirmPartialCoverage !== true) {
          throw new StaffingReviewError("Confirm that this shift does not cover the full event.");
        }
        const previousEvents = assignments.filter((row) => row.shiftId === shift.shiftId && row.eventId !== event.eventId);
        if (previousEvents.length && choice.confirmMove !== true) {
          throw new StaffingReviewError("Confirm moving the shift from its current event.");
        }
        if (hasOverlappingAssignment(shift, event, assignments, previous.events)) throw new StaffingReviewError("This employee's existing assignment overlaps or could not be verified. Review it before assigning this event.");
        for (const row of previousEvents) suppress(row.eventId, row.eventDate, row.employeeId);
        employeeIds.add(shift.employeeId);
        shiftIds.add(shift.shiftId);
        manual.push({ eventId: event.eventId, eventDate: event.date, employeeId: shift.employeeId,
          employeeName: shift.employeeName, shiftId: shift.shiftId, source: "manual" });
      }
      if (change.action === "replace-team") manualTeams.set(event.eventId, event.date);
      assignments = [...assignments.filter((row) => !(row.shiftId && shiftIds.has(row.shiftId)) &&
        !(row.eventId === event.eventId && row.eventDate === event.date &&
          (change.action === "replace-team" || employeeIds.has(row.employeeId)))), ...manual];
    } else if (change.action === "remove-manual") {
      assignments = assignments.filter((row) => row.source !== "manual" || row.eventId !== event.eventId ||
        row.eventDate !== event.date || row.employeeId !== change.employeeId);
      suppress(event.eventId, event.date, change.employeeId);
    } else {
      if (change.enabled) {
        keepClear.add(event.eventId);
        assignments = assignments.filter((row) => row.source === "manual" || row.eventId !== event.eventId);
      } else {
        keepClear.delete(event.eventId);
        if (manualTeams.get(event.eventId) === event.date) manualTeams.delete(event.eventId);
        for (const [key, row] of suppressed) if (row.eventId === event.eventId && row.eventDate === event.date) suppressed.delete(key);
      }
    }
  }
  const overrides = { keepClearEventIds: [...keepClear], policy,
    manualTeams: [...manualTeams].map(([eventId, eventDate]) => ({ eventId, eventDate })),
    suppressedAssignments: [...suppressed.values()] };
  const saved = previous.reconciliation;
  const reconciliation = saved && (staffingSnapshotIsFresh(previous, now) ? {
    ...reconcileStaffing({ events: previous.events, shifts: previous.shifts, previousAssignments: assignments, previousAlerts: saved.alerts,
      ...overrides, complete: true, now, startDate: saved.window.startDate }),
    // A manager edit is not a fresh upstream observation.
    lastSuccessfulSyncAt: saved.lastSuccessfulSyncAt,
  } : { ...saved, assignments });
  return (dependencies.save ?? saveStaffingState)({ ...previous, reconciliation, ...overrides }, previous.version);
}

export type StaffingCard = { status: StaffingEventStatus; names: string[] };

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function unambiguousDisplayInstant(timestamp: number) {
  if (!Number.isFinite(timestamp)) return false;
  const label = wallClock.format(timestamp);
  return label !== wallClock.format(timestamp - 3_600_000) && label !== wallClock.format(timestamp + 3_600_000);
}

type StaffingProjectionOptions = Pick<Dependencies, "now" | "load"> & { allowAdminPreview?: boolean; allowPublicStatus?: boolean; allowPublicAssignments?: boolean };
type StaffingEventIdentity = Omit<StaffingEvent, "eventName">;

function verifiedStaffingTiming(event: StaffingEventIdentity, saved: StaffingEvent | undefined) {
  const start = staffingInstant(event.startAt), end = staffingInstant(event.endAt);
  return Boolean(saved && saved.date === event.date && start < end &&
    unambiguousDisplayInstant(start) && unambiguousDisplayInstant(end) &&
    staffingInstant(saved.startAt) === start && staffingInstant(saved.endAt) === end);
}

function repeatedEventIds(events: readonly StaffingEventIdentity[]) {
  const seen = new Set<string>(), repeated = new Set<string>();
  for (const { eventId } of events) {
    if (seen.has(eventId)) repeated.add(eventId);
    seen.add(eventId);
  }
  return repeated;
}

/** Public status remains names-free unless public assignment access is explicitly enabled. */
export async function loadStaffingCards(events: readonly StaffingEventIdentity[], dependencies: StaffingProjectionOptions = {}): Promise<Record<string, StaffingCard>> {
  if ((dependencies.allowAdminPreview !== true && dependencies.allowPublicStatus !== true && dependencies.allowPublicAssignments !== true) || !events.length) return {};
  const state = await (dependencies.load ?? loadStaffingState)();
  const fresh = staffingSnapshotIsFresh(state, dependencies.now);
  const known = new Map(state.events.map((event) => [event.eventId, event]));
  const repeated = repeatedEventIds(events);
  return Object.fromEntries(events.filter(({ eventId }) => !repeated.has(eventId)).map((event) => {
    const timingMatches = verifiedStaffingTiming(event, known.get(event.eventId));
    const status = fresh && dateInSnapshot(state, event.date, dependencies.now ?? new Date()) && timingMatches
      ? state.reconciliation?.eventStatuses[event.eventId] ?? "unverified" : "unverified";
    const names = (dependencies.allowAdminPreview === true || (dependencies.allowPublicAssignments === true && ["assigned", "review"].includes(status))) ? new Map(state.reconciliation?.assignments.filter((row) => row.eventId === event.eventId && row.eventDate === event.date &&
      (row.source === "manual" || timingMatches))
      .map((row) => [row.employeeId, row.employeeName])) : new Map<string, string>();
    return [`${event.date}:${event.eventId}`, { names: [...names.values()].sort((a, b) => a.localeCompare(b)),
      status }];
  }));
}

/** Only explicitly selected teams can prefill operational forms; do not return rosters or write either record. */
export async function loadStaffingPrefills(events: readonly StaffingEventIdentity[], dependencies: StaffingProjectionOptions = {}): Promise<Record<string, string[]>> {
  if (!events.length || (dependencies.allowAdminPreview !== true && dependencies.allowPublicAssignments !== true)) return {};
  const state = await (dependencies.load ?? loadStaffingState)();
  if (!staffingSnapshotIsFresh(state, dependencies.now) || !state.reconciliation) return {};
  const { assignments, eventStatuses } = state.reconciliation;
  const known = new Map(state.events.map((event) => [event.eventId, event]));
  const shifts = new Map(state.shifts.map((shift) => [shift.shiftId, shift]));
  const repeated = repeatedEventIds(events);
  return Object.fromEntries(events.flatMap((event) => {
    if (repeated.has(event.eventId) || event.eventId.startsWith("vip-") || eventStatuses[event.eventId] !== "assigned" ||
        !dateInSnapshot(state, event.date, dependencies.now ?? new Date()) || !verifiedStaffingTiming(event, known.get(event.eventId))) return [];
    const byEmployee = new Map<string, string>();
    for (const row of assignments) {
      if (row.source !== "manual" || row.eventId !== event.eventId || row.eventDate !== event.date || !row.shiftId) continue;
      const shift = shifts.get(row.shiftId);
      if (shift?.employeeId !== row.employeeId || !staffingShiftCoversEvent(shift, event)) continue;
      const name = shift.employeeName.trim();
      if (name) byEmployee.set(shift.employeeId, name);
    }
    const names = [...new Set(byEmployee.values())].sort((left, right) => left.localeCompare(right));
    return names.length ? [[event.eventId, names]] : [];
  }));
}
