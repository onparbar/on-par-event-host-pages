import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileStaffing, type CorporateStaffShift, type StaffingEvent } from "../domain";
import { loadStaffingPrefills } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

const now = new Date("2026-11-13T17:00:00Z");
const event: StaffingEvent = { eventId: "123", eventName: "Team party", date: "2026-11-13", startAt: "2026-11-13T22:00:00Z", endAt: "2026-11-14T01:00:00Z" };
const shifts: CorporateStaffShift[] = ["Staff A", "Staff B", "Automatic staff"].map((employeeName, i) => ({
  shiftId: String(i + 1), employeeId: String(i + 11), employeeName,
  startAt: "2026-11-13T21:00:00Z", endAt: "2026-11-14T02:00:00Z",
}));
const reconciliation = reconcileStaffing({ now, events: [event], shifts, complete: true, previousAssignments: shifts.slice(0, 2).map((shift) => ({
  eventId: event.eventId, eventDate: event.date, employeeId: shift.employeeId, employeeName: shift.employeeName, shiftId: shift.shiftId, source: "manual",
})) });
const state: StaffingState = { ...emptyStaffingState(), events: [event], shifts, reconciliation };

describe("staffing form prefills", () => {
  it("projects only the explicitly assigned names for the exact event and makes no storage reads when access is off", async () => {
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");
    const load = vi.fn(async () => state);
    expect(await loadStaffingPrefills([event], { now, load })).toEqual({});
    expect(load).not.toHaveBeenCalled();
    expect(await loadStaffingPrefills([event], { now, load, allowAdminPreview: true })).toEqual({ 123: ["Staff A", "Staff B"] });
    expect(load).toHaveBeenCalledOnce();
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
    expect(await loadStaffingPrefills([event], { now, load })).toEqual({});
    expect(load).toHaveBeenCalledOnce();
  });

  it("skips stale, conflicted, changed, duplicate, wrong-source and automatic-only matches", async () => {
    const opts = { now, allowAdminPreview: true, load: async () => state };
    expect(await loadStaffingPrefills([event], { ...opts, now: new Date("2026-11-13T17:46:00Z") })).toEqual({});
    expect(await loadStaffingPrefills([{ ...event, startAt: "2026-11-13T22:01:00Z" }], opts)).toEqual({});
    expect(await loadStaffingPrefills([{ ...event, date: "2026-11-14" }], opts)).toEqual({});
    expect(await loadStaffingPrefills([{ ...event, eventId: "vip-123" }], opts)).toEqual({});
    expect(await loadStaffingPrefills([event, event], opts)).toEqual({});
    expect(await loadStaffingPrefills([event], { ...opts, load: async () => ({ ...state, reconciliation: { ...reconciliation, eventStatuses: { 123: "review" } } }) })).toEqual({});
    expect(await loadStaffingPrefills([event], { ...opts, load: async () => ({ ...state, reconciliation: {
      ...reconciliation, assignments: reconciliation.assignments.filter((row) => row.source === "automatic"),
    } }) })).toEqual({});
  });
});
