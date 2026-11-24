import { describe, expect, it } from "vitest";
import { reconcileStaffing, staffingShiftIsOnEventDay, staffingWindow, type CorporateStaffShift, type StaffingAssignment, type StaffingEvent } from "../domain";

const NOW = new Date("2026-11-10T15:00:00Z");
const event: StaffingEvent = { eventId: "123", eventName: "Sample party", date: "2026-11-10", startAt: "2026-11-10T18:00:00-05:00", endAt: "2026-11-10T20:00:00-05:00" };
function shift(overrides: Partial<CorporateStaffShift> = {}): CorporateStaffShift {
  return { shiftId: "1", employeeId: "11", employeeName: "Staff One", startAt: "2026-11-10T22:00:00Z", endAt: "2026-11-11T01:00:00Z", ...overrides };
}
const complete = { complete: true, now: NOW, events: [event] };

describe("Corporate Parties staffing reconciliation", () => {
  it("supports a selected future week without changing the observation time or default window", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    expect(staffingWindow(now)).toEqual({ startDate: "2026-11-23", endDate: "2026-11-29", shiftStartDate: "2026-11-22" });
    expect(staffingWindow(now, "2026-11-30")).toEqual({ startDate: "2026-11-30", endDate: "2026-12-06", shiftStartDate: "2026-11-29" });
    const future = { ...event, date: "2026-11-30", startAt: "2026-11-30T18:00:00-05:00", endAt: "2026-11-30T20:00:00-05:00" };
    const result = reconcileStaffing({ complete: true, now, startDate: future.date, events: [{ ...event, eventId: "historical" }, future],
      shifts: [shift({ startAt: "2026-11-30T17:00:00-05:00", endAt: "2026-11-30T20:00:00-05:00" })] });
    expect(result.window).toEqual(staffingWindow(now, future.date));
    expect(result.lastSuccessfulSyncAt).toBe(now.toISOString());
    expect(result.eventStatuses).toEqual({ 123: "assigned" });
    expect(result.assignments).toMatchObject([{ eventId: future.eventId, eventDate: future.date, source: "automatic" }]);
  });

  it("rejects invalid and past explicit staffing dates, including impossible calendar dates", () => {
    for (const date of ["2026-11-09", "2026-11-31", "2026-02-29", "2026-11-10T00:00:00Z", "9999-12-31", ""]) {
      expect(() => staffingWindow(NOW, date)).toThrow("Choose today or a valid future staffing date.");
    }
    expect(staffingWindow(NOW, "2026-11-10")).toEqual(staffingWindow(NOW));
    expect(() => reconcileStaffing({ ...complete, startDate: "2026-11-09", shifts: [] })).toThrow("Choose today or a valid future staffing date.");
  });

  it("uses outside-week overnight event context to block a conflicting automatic assignment without matching context events", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    const future: StaffingEvent = { ...event, eventId: "future", date: "2026-11-30", startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" };
    const context: StaffingEvent = { ...event, eventId: "context", date: "2026-11-29", startAt: "2026-11-29T23:00:00-05:00", endAt: "2026-11-30T01:00:00-05:00" };
    const manual: StaffingAssignment = { eventId: context.eventId, eventDate: context.date, employeeId: "11", employeeName: "Staff One", shiftId: "old-shift", source: "manual" };
    const candidate = shift({ startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" });
    const result = reconcileStaffing({ complete: true, now, startDate: future.date, events: [context, future], shifts: [candidate], previousAssignments: [manual] });
    expect(result.assignments).toEqual([manual]);
    expect(result.reviews).toContainEqual({ code: "overlapping-shifts", eventIds: [future.eventId], shiftId: candidate.shiftId });
    expect(result.eventStatuses).toEqual({ future: "review" });
    expect(result.eventStatuses).not.toHaveProperty(context.eventId);
    const otherEmployee = shift({ shiftId: "2", employeeId: "22", startAt: context.startAt!, endAt: context.endAt! });
    const noMatch = reconcileStaffing({ complete: true, now, startDate: future.date, events: [context], shifts: [otherEmployee] });
    expect(noMatch.eventStatuses).toEqual({});
    expect(noMatch.assignments).toEqual([]);
  });

  it.each(["missing", "invalid-time", "changed-date"] as const)("does not automatically assign an employee whose retained manual assignment has %s event metadata", (problem) => {
    const now = new Date("2026-11-23T15:00:00Z");
    const future: StaffingEvent = { ...event, eventId: "future", date: "2026-11-30", startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" };
    const context: StaffingEvent = { ...event, eventId: "context", date: "2026-11-29", startAt: "2026-11-29T23:00:00-05:00", endAt: "2026-11-30T01:00:00-05:00" };
    const manual: StaffingAssignment = { eventId: context.eventId, eventDate: context.date, employeeId: "11", employeeName: "Staff One", shiftId: "old-shift", source: "manual" };
    const candidate = shift({ corporate: true, startAt: future.startAt!, endAt: future.endAt! });
    const observed = problem === "missing" ? [] : problem === "invalid-time" ? [{ ...context, startAt: "unverified" }]
      : [{ ...context, date: "2026-11-28", startAt: "2026-11-28T23:00:00-05:00", endAt: "2026-11-29T01:00:00-05:00" }];
    const result = reconcileStaffing({ complete: true, now, startDate: future.date, events: [...observed, future], shifts: [candidate], previousAssignments: [manual] });
    expect(result.assignments).toEqual([manual]);
    expect(result.reviews).toContainEqual({ code: "unverified-assignment", eventIds: [future.eventId], shiftId: candidate.shiftId });
    expect(result.eventStatuses).toEqual({ future: "review" });
  });

  it("does not resolve unrelated unassigned-event alerts when another future week is verified", () => {
    const previous = reconcileStaffing({ ...complete, shifts: [] });
    const future = { ...event, eventId: "future", date: "2026-11-30", startAt: "2026-11-30T18:00:00-05:00", endAt: "2026-11-30T20:00:00-05:00" };
    const result = reconcileStaffing({ complete: true, now: NOW, startDate: future.date, events: [future], shifts: [], previousAlerts: previous.alerts });
    expect(result.alerts.find((alert) => alert.eventId === event.eventId)).toEqual(previous.alerts[0]);
    expect(result.alerts.find((alert) => alert.eventId === future.eventId)).toMatchObject({ resolvedAt: null, eventDate: future.date });
  });

  it("assigns multiple employees at exactly one hour before or at event start", () => {
    const result = reconcileStaffing({ ...complete, shifts: [shift(), shift({ shiftId: "2", employeeId: "22", employeeName: "Staff Two", startAt: "2026-11-10T23:00:00Z" })] });
    expect(result.assignments.map((row) => [row.eventId, row.shiftId, row.employeeId])).toEqual([["123", "1", "11"], ["123", "2", "22"]]);
    expect(result.eventStatuses).toEqual({ 123: "assigned" });
    expect(result.alerts).toEqual([]);
  });

  it("never matches other stations automatically, and flags an employee's overlapping shifts from any station", () => {
    const other = shift({ shiftId: "2", corporate: false, notes: "Event ID: 123" });
    const manualOnly = reconcileStaffing({ ...complete, shifts: [other] });
    expect(manualOnly.assignments).toEqual([]);
    expect(manualOnly.reviews).toEqual([]);
    expect(manualOnly.eventStatuses["123"]).toBe("unassigned");
    const overlapping = reconcileStaffing({ ...complete, shifts: [shift(), other] });
    expect(overlapping.assignments).toEqual([]);
    expect(overlapping.reviews).toContainEqual({ code: "overlapping-shifts", eventIds: ["123"], shiftId: "1" });
  });

  it("uses venue-local day boundaries, including a preceding-day overnight shift", () => {
    expect(staffingShiftIsOnEventDay(shift({ startAt: "2026-11-10T03:00:00Z", endAt: "2026-11-10T06:00:00Z" }), event.date)).toBe(true);
    expect(staffingShiftIsOnEventDay(shift({ startAt: "2026-11-10T03:00:00Z", endAt: "2026-11-10T05:00:00Z" }), event.date)).toBe(false);
    expect(staffingShiftIsOnEventDay(shift({ startAt: "2026-11-11T05:00:00Z", endAt: "2026-11-11T06:00:00Z" }), event.date)).toBe(false);
  });

  it("flags an intermediate start unless the admin policy explicitly allows it", () => {
    const data = { ...complete, shifts: [shift({ startAt: "2026-11-10T22:30:00Z" })] };
    const standard = reconcileStaffing(data);
    expect(standard.eventStatuses).toEqual({ 123: "review" });
    expect(standard.reviews).toContainEqual({ code: "uncertain-start", eventIds: ["123"], shiftId: "1" });
    expect(standard.alerts).toEqual([]);
    expect(reconcileStaffing({ ...data, policy: { allowIntermediateStarts: true } }).assignments).toHaveLength(1);
  });

  it("assigns a regular Corporate Parties shift that covers its only matching event", () => {
    const regular = shift({ startAt: "2026-11-10T19:00:00Z" });
    const result = reconcileStaffing({ ...complete, shifts: [regular] });
    expect(result.assignments).toMatchObject([{ eventId: "123", shiftId: "1", source: "automatic" }]);
    expect(result.eventStatuses["123"]).toBe("assigned");
  });

  it("puts partial coverage in review, even for an exact start or an explicit event note", () => {
    for (const partial of [
      shift({ startAt: "2026-11-10T19:00:00Z", endAt: "2026-11-11T00:30:00Z", notes: "Event ID: 123" }),
      shift({ startAt: "2026-11-10T23:00:00Z", endAt: "2026-11-11T00:30:00Z" }),
      shift({ startAt: "2026-11-10T23:30:00Z" }),
    ]) {
      const result = reconcileStaffing({ ...complete, shifts: [partial] });
      expect(result.assignments).toEqual([]);
      expect(result.reviews).toContainEqual({ code: "uncertain-start", eventIds: ["123"], shiftId: "1" });
      expect(result.eventStatuses["123"]).toBe("review");
    }
  });

  it("reviews a regular shift with competing events unless an exact note identifies a fully covered event", () => {
    const second = { ...event, eventId: "456", eventName: "Later party", startAt: "2026-11-10T20:00:00-05:00", endAt: "2026-11-10T22:00:00-05:00" };
    const regular = shift({ startAt: "2026-11-10T19:00:00Z", endAt: "2026-11-11T03:00:00Z" });
    const data = { ...complete, events: [event, second] };
    const ambiguous = reconcileStaffing({ ...data, shifts: [regular] });
    expect(ambiguous.assignments).toEqual([]);
    expect(ambiguous.reviews).toContainEqual({ code: "ambiguous-event", eventIds: ["123", "456"], shiftId: "1" });
    expect(reconcileStaffing({ ...data, shifts: [{ ...regular, notes: "Event ID: 456" }] }).assignments).toMatchObject([{ eventId: "456" }]);
    const partial = { ...regular, endAt: "2026-11-11T02:00:00Z" };
    expect(reconcileStaffing({ ...data, shifts: [partial] }).assignments).toEqual([]);
    expect(reconcileStaffing({ ...data, shifts: [{ ...partial, notes: "Event ID: 123" }] }).assignments).toMatchObject([{ eventId: "123" }]);
  });

  it("does not guess between overlapping events; exact note name or ID breaks the tie", () => {
    const second = { ...event, eventId: "456", eventName: "Sample party second room" };
    const data = { ...complete, events: [event, second], shifts: [shift()] };
    expect(reconcileStaffing(data).eventStatuses).toEqual({ 123: "review", 456: "review" });
    for (const notes of ["Event ID: 456", "Tripleseat #456", "Event: Sample party second room"]) {
      expect(reconcileStaffing({ ...data, shifts: [shift({ notes })] }).assignments.map((row) => row.eventId)).toEqual(["456"]);
    }
    expect(reconcileStaffing({ ...data, shifts: [shift({ notes: "Bring supplies to Sample party" })] }).assignments).toEqual([]);
    expect(reconcileStaffing({ ...data, shifts: [shift({ notes: "Event ID: 456\nEvent: Sample party" })] }).reviews[0].code).toBe("conflicting-note");
  });

  it("can assign one employee to separate shifts but flags an employee's actual overlap", () => {
    const second = { ...event, eventId: "456", eventName: "Later party", startAt: "2026-11-10T20:00:00-05:00", endAt: "2026-11-10T22:00:00-05:00" };
    const later = shift({ shiftId: "2", startAt: "2026-11-11T01:00:00Z", endAt: "2026-11-11T03:00:00Z" });
    const data = { ...complete, events: [event, second], shifts: [shift(), later] };
    expect(reconcileStaffing(data).assignments).toHaveLength(2);
    const overlapping = reconcileStaffing({ ...data, shifts: [shift({ endAt: "2026-11-11T01:01:00Z" }), later] });
    expect(overlapping.assignments).toHaveLength(0);
    expect(overlapping.reviews.map((review) => review.code)).toEqual(["overlapping-shifts", "overlapping-shifts"]);
  });

  it("flags overlapping events even if the same employee's two shifts are adjacent", () => {
    const second = { ...event, eventId: "456", eventName: "Later party", startAt: "2026-11-10T19:30:00-05:00", endAt: "2026-11-10T21:30:00-05:00" };
    const shifts = [shift({ endAt: "2026-11-10T23:30:00Z" }), shift({ shiftId: "2", startAt: "2026-11-10T23:30:00Z", endAt: "2026-11-11T03:00:00Z" })];
    const result = reconcileStaffing({ ...complete, events: [event, second], shifts });
    expect(result.assignments).toEqual([]);
    expect(result.eventStatuses).toEqual({ 123: "review", 456: "review" });
  });

  it("retains assignments and alerts on a failed/invalid sync but reassigns or removes confirmed changes", () => {
    const first = reconcileStaffing({ ...complete, shifts: [shift()] });
    const previous = { previousAssignments: first.assignments, previousAlerts: first.alerts, lastSuccessfulSyncAt: first.lastSuccessfulSyncAt };
    const failed = reconcileStaffing({ ...complete, ...previous, shifts: [], complete: false });
    expect(failed).toMatchObject({ assignments: first.assignments, alerts: first.alerts, eventStatuses: { 123: "unverified" }, lastSuccessfulSyncAt: NOW.toISOString() });
    const invalid = reconcileStaffing({ ...complete, ...previous, shifts: [shift({ endAt: "not a timestamp" })] });
    expect(invalid).toMatchObject({ assignments: first.assignments, dataStatus: "unverified" });
    const changed = reconcileStaffing({ ...complete, ...previous, shifts: [shift({ employeeId: "22", employeeName: "Staff Two" })] });
    expect(changed.assignments.map((row) => row.employeeId)).toEqual(["22"]);
    const cancelled = reconcileStaffing({ ...complete, ...previous, shifts: [] });
    expect(cancelled.assignments).toEqual([]);
    expect(cancelled.eventStatuses["123"]).toBe("unassigned");
    const moved = { ...event, startAt: "2026-11-10T19:00:00-05:00", endAt: "2026-11-10T21:00:00-05:00" };
    expect(reconcileStaffing({ ...complete, ...previous, events: [moved], shifts: [shift()] }).assignments).toEqual([]);
  });

  it("keeps manual assignment and keep-clear choices even when underlying shifts change", () => {
    const manual: StaffingAssignment = { eventId: "123", eventDate: event.date, employeeId: "99", employeeName: "Manual employee", shiftId: "1", source: "manual" };
    const result = reconcileStaffing({ ...complete, shifts: [shift()], previousAssignments: [manual] });
    expect(result.assignments).toEqual([manual]);
    expect(result.reviews).toContainEqual({ code: "manual-shift-changed", eventIds: ["123"], shiftId: "1" });
    const held = reconcileStaffing({ ...complete, shifts: [shift()], keepClearEventIds: [event.eventId] });
    expect(held.assignments).toEqual([]);
    expect(held.eventStatuses["123"]).toBe("unassigned");
  });

  it.each(["none", "manual-team", "keep-clear"] as const)("retains a planned null-shift team as review after a fresh complete sync despite %s override", (override) => {
    const planned: StaffingAssignment = { eventId: event.eventId, eventDate: event.date, employeeId: "99",
      employeeName: "Planned staff", shiftId: null, source: "manual" };
    const unassigned = reconcileStaffing({ ...complete, shifts: [] });
    const result = reconcileStaffing({ ...complete, shifts: [], previousAssignments: [planned], previousAlerts: unassigned.alerts,
      manualTeams: override === "manual-team" ? [{ eventId: event.eventId, eventDate: event.date }] : [],
      keepClearEventIds: override === "keep-clear" ? [event.eventId] : [] });
    expect(result.assignments).toEqual([planned]);
    expect(result.dataStatus).toBe("verified");
    expect(result.lastSuccessfulSyncAt).toBe(NOW.toISOString());
    expect(result.eventStatuses).toEqual({ [event.eventId]: "review" });
    expect(result.reviews).toContainEqual({ code: "unverified-assignment", eventIds: [event.eventId] });
    expect(result.alerts).toEqual(unassigned.alerts);
  });

  it("does not let another verified manual team member hide a null-shift planned assignment", () => {
    const verified: StaffingAssignment = { eventId: event.eventId, eventDate: event.date, employeeId: "11",
      employeeName: "Staff One", shiftId: "1", source: "manual" };
    const planned: StaffingAssignment = { ...verified, employeeId: "99", employeeName: "Planned staff", shiftId: null };
    const result = reconcileStaffing({ ...complete, shifts: [shift()], previousAssignments: [verified, planned],
      manualTeams: [{ eventId: event.eventId, eventDate: event.date }] });
    expect(result.assignments).toEqual([verified, planned]);
    expect(result.eventStatuses[event.eventId]).toBe("review");
    expect(result.reviews).toEqual([{ code: "unverified-assignment", eventIds: [event.eventId] }]);
  });

  it("continues to verify a real published full-coverage manual shift normally", () => {
    const verified: StaffingAssignment = { eventId: event.eventId, eventDate: event.date, employeeId: "11",
      employeeName: "Staff One", shiftId: "1", source: "manual" };
    const result = reconcileStaffing({ ...complete, shifts: [shift()], previousAssignments: [verified],
      manualTeams: [{ eventId: event.eventId, eventDate: event.date }] });
    expect(result.assignments).toEqual([verified]);
    expect(result.eventStatuses[event.eventId]).toBe("assigned");
    expect(result.reviews).toEqual([]);
  });

  it("retains overlap review when a verified manual shift conflicts with a planned null-shift assignment", () => {
    const other: StaffingEvent = { ...event, eventId: "456", startAt: "2026-11-10T18:30:00-05:00" };
    const planned: StaffingAssignment = { eventId: event.eventId, eventDate: event.date, employeeId: "11",
      employeeName: "Staff One", shiftId: null, source: "manual" };
    const verified: StaffingAssignment = { ...planned, eventId: other.eventId, shiftId: "1" };
    const result = reconcileStaffing({ ...complete, events: [event, other], shifts: [shift()], previousAssignments: [planned, verified],
      manualTeams: [{ eventId: event.eventId, eventDate: event.date }, { eventId: other.eventId, eventDate: other.date }] });
    expect(result.assignments).toEqual([planned, verified]);
    expect(result.eventStatuses).toEqual({ [event.eventId]: "review", [other.eventId]: "review" });
    expect(result.reviews).toContainEqual({ code: "unverified-assignment", eventIds: [event.eventId] });
    expect(result.reviews).toContainEqual({ code: "overlapping-shifts", eventIds: [other.eventId], shiftId: "1" });
  });

  it("does not automatically assign a published future shift over a retained planned overnight assignment", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    const future: StaffingEvent = { ...event, eventId: "future", date: "2026-11-30", startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" };
    const context: StaffingEvent = { ...event, eventId: "context", date: "2026-11-29", startAt: "2026-11-29T23:00:00-05:00", endAt: "2026-11-30T01:00:00-05:00" };
    const planned: StaffingAssignment = { eventId: context.eventId, eventDate: context.date, employeeId: "11", employeeName: "Staff One", shiftId: null, source: "manual" };
    const candidate = shift({ startAt: future.startAt!, endAt: future.endAt! });
    const result = reconcileStaffing({ complete: true, now, startDate: future.date, events: [context, future], shifts: [candidate], previousAssignments: [planned] });
    expect(result.assignments).toEqual([planned]);
    expect(result.reviews).toContainEqual({ code: "unverified-assignment", eventIds: [context.eventId] });
    expect(result.reviews).toContainEqual({ code: "overlapping-shifts", eventIds: [future.eventId], shiftId: candidate.shiftId });
    expect(result.eventStatuses).toEqual({ future: "review" });
  });

  it("lets a fresh assignment cover a moved event without hiding the historical manual-change note", () => {
    const manual: StaffingAssignment = { eventId: "123", eventDate: "2026-11-09", employeeId: "22", employeeName: "Historical employee", shiftId: "2", source: "manual" };
    const result = reconcileStaffing({ ...complete, shifts: [shift()], previousAssignments: [manual] });
    expect(result.eventStatuses["123"]).toBe("assigned");
    expect(result.reviews).toContainEqual({ code: "manual-shift-changed", eventIds: ["123"], shiftId: "2" });
  });

  it("does not duplicate alerts, resolves assigned events and reopens later removals", () => {
    const first = reconcileStaffing({ ...complete, shifts: [] });
    const nextNow = new Date("2026-11-10T16:00:00Z");
    const repeated = reconcileStaffing({ ...complete, shifts: [], previousAlerts: first.alerts, now: nextNow });
    expect(repeated.alerts).toEqual(first.alerts);
    const ambiguous = reconcileStaffing({ ...complete, shifts: [shift({ startAt: "2026-11-10T22:30:00Z" })], previousAlerts: first.alerts, now: nextNow });
    expect(ambiguous.eventStatuses["123"]).toBe("review");
    expect(ambiguous.alerts).toEqual(first.alerts);
    const resolved = reconcileStaffing({ ...complete, shifts: [shift()], previousAlerts: first.alerts, now: nextNow });
    expect(resolved.alerts).toEqual([{ ...first.alerts[0], resolvedAt: nextNow.toISOString() }]);
    const laterNow = new Date("2026-11-10T17:00:00Z");
    const reopened = reconcileStaffing({ ...complete, shifts: [], previousAlerts: resolved.alerts, now: laterNow });
    expect(reopened.alerts).toEqual([{ ...first.alerts[0], openedAt: laterNow.toISOString() }]);
  });

  it("uses the preceding local date for early shifts across midnight and counts DST hours by instant", () => {
    const midnight = { ...event, startAt: "2026-11-10T00:30:00-05:00", endAt: "2026-11-10T02:00:00-05:00" };
    const early = shift({ startAt: "2026-11-09T23:30:00-05:00", endAt: "2026-11-10T02:00:00-05:00" });
    expect(reconcileStaffing({ ...complete, events: [midnight], shifts: [early] }).assignments).toHaveLength(1);
    const fall = { ...event, date: "2026-11-01", startAt: "2026-11-01T01:30:00-05:00", endAt: "2026-11-01T02:30:00-05:00" };
    const firstHour = shift({ startAt: "2026-11-01T01:30:00-04:00", endAt: "2026-11-01T02:30:00-05:00" });
    const fallNow = new Date("2026-11-01T04:00:00Z");
    expect(reconcileStaffing({ events: [fall], shifts: [firstHour], complete: true, now: fallNow }).assignments).toHaveLength(1);
    expect(staffingWindow(new Date("2026-11-01T03:59:00Z"))).toEqual({ startDate: "2026-10-31", endDate: "2026-11-06", shiftStartDate: "2026-10-30" });
    expect(staffingWindow(new Date("2026-03-08T05:00:00Z"))).toEqual({ startDate: "2026-03-08", endDate: "2026-03-14", shiftStartDate: "2026-03-07" });
  });
});
