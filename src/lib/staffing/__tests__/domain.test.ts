import { describe, expect, it } from "vitest";
import { reconcileStaffing, staffingWindow, type CorporateStaffShift, type StaffingAssignment, type StaffingEvent } from "../domain";

const NOW = new Date("2026-11-10T15:00:00Z");
const event: StaffingEvent = { eventId: "123", eventName: "Sample party", date: "2026-11-10", startAt: "2026-11-10T18:00:00-05:00", endAt: "2026-11-10T20:00:00-05:00" };
function shift(overrides: Partial<CorporateStaffShift> = {}): CorporateStaffShift {
  return { shiftId: "1", employeeId: "11", employeeName: "Staff One", startAt: "2026-11-10T22:00:00Z", endAt: "2026-11-11T01:00:00Z", ...overrides };
}
const complete = { complete: true, now: NOW, events: [event] };

describe("Corporate Parties staffing reconciliation", () => {
  it("assigns multiple employees at exactly one hour before or at event start", () => {
    const result = reconcileStaffing({ ...complete, shifts: [shift(), shift({ shiftId: "2", employeeId: "22", employeeName: "Staff Two", startAt: "2026-11-10T23:00:00Z" })] });
    expect(result.assignments.map((row) => [row.eventId, row.shiftId, row.employeeId])).toEqual([["123", "1", "11"], ["123", "2", "22"]]);
    expect(result.eventStatuses).toEqual({ 123: "assigned" });
    expect(result.alerts).toEqual([]);
  });

  it("flags an intermediate start unless the admin policy explicitly allows it", () => {
    const data = { ...complete, shifts: [shift({ startAt: "2026-11-10T22:30:00Z" })] };
    const standard = reconcileStaffing(data);
    expect(standard.eventStatuses).toEqual({ 123: "review" });
    expect(standard.reviews).toContainEqual({ code: "uncertain-start", eventIds: ["123"], shiftId: "1" });
    expect(standard.alerts).toEqual([]);
    expect(reconcileStaffing({ ...data, policy: { allowIntermediateStarts: true } }).assignments).toHaveLength(1);
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
    const moved = { ...event, startAt: "2026-11-10T19:00:00-05:00" };
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
