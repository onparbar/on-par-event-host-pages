import "server-only";
import { getTripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";
import { StaleSaveError } from "@/lib/stale-save";
import { MAX_STAFFING_EARLY_START_MINUTES, reconcileStaffing, staffingInstant, staffingWindow, type CorporateStaffShift, type StaffingAssignment, type StaffingEvent, type StaffingEventStatus } from "./domain";
import { readPublishedCorporateShifts, StaffingSourceError } from "./sevenshifts";
import { loadStaffingState, saveStaffingState, type StaffingState } from "./storage";

export const STAFFING_FRESHNESS_MINUTES = 45;
type Window = ReturnType<typeof staffingWindow>;
type Dependencies = {
  now?: Date;
  load?: typeof loadStaffingState;
  save?: typeof saveStaffingState;
  readEvents?: (window: Window) => Promise<StaffingEvent[]>;
  readShifts?: (window: Window) => Promise<CorporateStaffShift[]>;
};

/** Use exact Tripleseat snapshots; never replace durable operational plans or advance their sync status. */
async function readTripleseatStaffingEvents({ startDate, endDate }: Window) {
  const adapter = getTripleseatAdapter();
  if (adapter.sourceMode !== "live" || !adapter.fetchStaffingEventsForRange) throw new Error("Verified Tripleseat staffing reads are unavailable.");
  return (await adapter.fetchStaffingEventsForRange(startDate, endDate)).map((source) => ({
    eventId: source.eventId, eventName: source.eventName, date: source.localDate, startAt: source.eventStartAt, endAt: source.eventEndAt,
  }));
}

export function staffingSnapshotIsFresh(state: StaffingState, now = new Date()) {
  const saved = state.reconciliation;
  const time = saved?.lastSuccessfulSyncAt ? Date.parse(saved.lastSuccessfulSyncAt) : NaN;
  const age = now.getTime() - time;
  return !state.failure && saved?.dataStatus === "verified" && saved.window.startDate === staffingWindow(now).startDate &&
    Number.isFinite(age) && age >= 0 && age <= STAFFING_FRESHNESS_MINUTES * 60_000;
}

export async function refreshStaffing(dependencies: Dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const previous = await (dependencies.load ?? loadStaffingState)();
  const save = dependencies.save ?? saveStaffingState;
  const window = staffingWindow(now);
  const [events, shifts] = await Promise.allSettled([
    (dependencies.readEvents ?? readTripleseatStaffingEvents)(window),
    (dependencies.readShifts ?? readPublishedCorporateShifts)(window),
  ]);
  const lastAttemptAt = now.toISOString();
  const fail = (failure: NonNullable<StaffingState["failure"]>) => save({ ...previous, lastAttemptAt, failure }, previous.version);
  if (events.status === "rejected") return fail("events");
  if (shifts.status === "rejected") return fail(shifts.reason instanceof StaffingSourceError && shifts.reason.reason === "incomplete" ? "incomplete" : "shifts");
  const reconciliation = reconcileStaffing({ events: events.value, shifts: shifts.value, complete: true, now,
    policy: previous.policy, keepClearEventIds: previous.keepClearEventIds, previousAssignments: previous.reconciliation?.assignments,
    previousAlerts: previous.reconciliation?.alerts, lastSuccessfulSyncAt: previous.reconciliation?.lastSuccessfulSyncAt });
  if (reconciliation.dataStatus === "unverified") return fail("incomplete");
  return save({ ...previous, reconciliation, events: events.value, shifts: shifts.value, lastAttemptAt, failure: null }, previous.version);
}

export type StaffingAdminChange = { expectedVersion: number } & (
  | { action: "assign"; eventId: string; shiftId: string }
  | { action: "remove-manual"; eventId: string; employeeId: string }
  | { action: "keep-clear"; eventId: string; enabled: boolean }
  | { action: "policy"; earlyStartMinutes: number; allowIntermediateStarts: boolean }
);

export async function updateStaffingOverride(change: StaffingAdminChange, dependencies: Pick<Dependencies, "now" | "load" | "save"> = {}) {
  const now = dependencies.now ?? new Date();
  const previous = await (dependencies.load ?? loadStaffingState)();
  if (previous.version !== change.expectedVersion) throw new StaleSaveError();
  let assignments = previous.reconciliation?.assignments ?? [];
  let policy = previous.policy;
  const keepClear = new Set(previous.keepClearEventIds);
  if (change.action === "policy") {
    if (!Number.isInteger(change.earlyStartMinutes) || change.earlyStartMinutes < 0 || change.earlyStartMinutes > MAX_STAFFING_EARLY_START_MINUTES ||
        typeof change.allowIntermediateStarts !== "boolean") throw new Error("Invalid staffing policy.");
    policy = { earlyStartMinutes: change.earlyStartMinutes, allowIntermediateStarts: change.allowIntermediateStarts };
  } else {
    if (!staffingSnapshotIsFresh(previous, now)) throw new Error("Refresh the published schedule before editing an event assignment.");
    const window = staffingWindow(now);
    const event = previous.events.find((item) => item.eventId === change.eventId && item.date >= window.startDate && item.date <= window.endDate);
    if (!event) throw new Error("Choose a verified event in the current staffing window.");
    if (change.action === "assign") {
      const shift = previous.shifts.find((item) => item.shiftId === change.shiftId);
      if (!shift) throw new Error("Choose a verified published shift.");
      const eventStart = staffingInstant(event.startAt), eventEnd = staffingInstant(event.endAt);
      if (!(eventStart < eventEnd && staffingInstant(shift.startAt) < eventEnd && staffingInstant(shift.endAt) > eventStart)) {
        throw new Error("Choose a shift that overlaps the event.");
      }
      const manual: StaffingAssignment = { eventId: event.eventId, eventDate: event.date, employeeId: shift.employeeId,
        employeeName: shift.employeeName, shiftId: shift.shiftId, source: "manual" };
      assignments = [...assignments.filter((row) => row.shiftId !== shift.shiftId &&
        !(row.eventId === event.eventId && row.employeeId === shift.employeeId)), manual];
    } else if (change.action === "remove-manual") {
      assignments = assignments.filter((row) => row.source !== "manual" || row.eventId !== event.eventId || row.employeeId !== change.employeeId);
    } else {
      if (change.enabled) {
        keepClear.add(event.eventId);
        assignments = assignments.filter((row) => row.source === "manual" || row.eventId !== event.eventId);
      } else keepClear.delete(event.eventId);
    }
  }
  const saved = previous.reconciliation;
  const reconciliation = saved && (staffingSnapshotIsFresh(previous, now) ? {
    ...reconcileStaffing({ events: previous.events, shifts: previous.shifts, previousAssignments: assignments, previousAlerts: saved.alerts,
      keepClearEventIds: [...keepClear], policy, complete: true, now }),
    // A manager edit is not a fresh upstream observation.
    lastSuccessfulSyncAt: saved.lastSuccessfulSyncAt,
  } : { ...saved, assignments });
  return (dependencies.save ?? saveStaffingState)({ ...previous, reconciliation, keepClearEventIds: [...keepClear], policy }, previous.version);
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

/** Never expose employee schedules on legacy code-free Event Host. Return just names and safe card status. */
export async function loadStaffingCards(events: readonly Omit<StaffingEvent, "eventName">[], dependencies: Pick<Dependencies, "now" | "load"> = {}): Promise<Record<string, StaffingCard>> {
  if (!staffLoginRequired()) return {};
  const state = await (dependencies.load ?? loadStaffingState)();
  const fresh = staffingSnapshotIsFresh(state, dependencies.now);
  const known = new Map(state.events.map((event) => [event.eventId, event]));
  return Object.fromEntries(events.map((event) => {
    const saved = known.get(event.eventId);
    const start = staffingInstant(event.startAt), end = staffingInstant(event.endAt);
    const timingMatches = Boolean(saved && saved.date === event.date && start < end &&
      unambiguousDisplayInstant(start) && unambiguousDisplayInstant(end) &&
      staffingInstant(saved.startAt) === start && staffingInstant(saved.endAt) === end);
    const names = new Map(state.reconciliation?.assignments.filter((row) => row.eventId === event.eventId && row.eventDate === event.date &&
      (row.source === "manual" || timingMatches))
      .map((row) => [row.employeeId, row.employeeName]));
    return [event.eventId, { names: [...names.values()].sort((a, b) => a.localeCompare(b)),
      status: fresh && timingMatches ? state.reconciliation?.eventStatuses[event.eventId] ?? "unverified" : "unverified" }];
  }));
}
