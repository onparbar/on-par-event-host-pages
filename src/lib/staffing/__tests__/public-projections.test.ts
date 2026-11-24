import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileStaffing, type CorporateStaffShift, type StaffingEvent } from "../domain";
import { loadStaffingCards, loadStaffingPrefills } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";

vi.mock("server-only", () => ({}));

const now = new Date("2026-11-24T15:00:00Z");
const event: StaffingEvent = { eventId: "501", eventName: "Synthetic party", date: "2026-11-24",
  startAt: "2026-11-24T22:00:00Z", endAt: "2026-11-25T01:00:00Z" };
const shifts: CorporateStaffShift[] = ["Casey", "Jordan"].map((employeeName, index) => ({
  shiftId: `shift-${index}`, employeeId: `employee-${index}`, employeeName,
  startAt: "2026-11-24T21:00:00Z", endAt: "2026-11-25T02:00:00Z",
}));
const reconciliation = reconcileStaffing({ now, events: [event], shifts, complete: true,
  previousAssignments: shifts.map((shift) => ({ eventId: event.eventId, eventDate: event.date,
    employeeId: shift.employeeId, employeeName: shift.employeeName, shiftId: shift.shiftId, source: "manual" })) });
const state: StaffingState = { ...emptyStaffingState(), events: [event], shifts, reconciliation };
const key = `${event.date}:${event.eventId}`;

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Projection tests must not contact a provider."); })));
afterEach(() => vi.unstubAllGlobals());

describe("explicit public assignment projections", () => {
  it("exposes only the requested saved team and verified manual prefills when explicitly allowed", async () => {
    const load = vi.fn(async () => state);
    const options = { now, load, allowPublicAssignments: true };
    expect(await loadStaffingCards([event], options)).toEqual({ [key]: { names: ["Casey", "Jordan"], status: "assigned" } });
    expect(await loadStaffingPrefills([event], options)).toEqual({ 501: ["Casey", "Jordan"] });
    expect(load).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not elevate status-only access into employee names or prefills", async () => {
    const load = vi.fn(async () => state);
    expect(await loadStaffingCards([event], { now, load, allowPublicStatus: true }))
      .toEqual({ [key]: { names: [], status: "assigned" } });
    expect(await loadStaffingPrefills([event], { now, load, allowPublicStatus: true })).toEqual({});
    expect(load).toHaveBeenCalledOnce();
    load.mockClear();
    expect(await loadStaffingCards([event], { now, load, allowPublicAssignments: false })).toEqual({});
    expect(await loadStaffingPrefills([event], { now, load, allowPublicAssignments: false })).toEqual({});
    expect(load).not.toHaveBeenCalled();
  });

  it("retains saved manual names for an unverified exact event without confirming coverage or exposing other identities", async () => {
    const options = { now, load: async () => state, allowPublicAssignments: true };
    for (const [events, currentNow, names] of [
      [[event], new Date("2026-11-24T15:45:00.001Z"), ["Casey", "Jordan"]],
      [[{ ...event, startAt: "2026-11-24T22:01:00Z" }], now, ["Casey", "Jordan"]],
      [[{ ...event, date: "2026-11-25" }], now, []],
      [[{ ...event, eventId: "unknown" }], now, []],
    ] as const) {
      const cards = await loadStaffingCards(events, { ...options, now: currentNow });
      expect(Object.values(cards)).toEqual([{ names, status: "unverified" }]);
      expect(await loadStaffingPrefills(events, { ...options, now: currentNow })).toEqual({});
    }
    expect(await loadStaffingCards([event, event], options)).toEqual({});
    expect(await loadStaffingPrefills([event, event], options)).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows selected names under review but never pre-fills a form from review or automatic-only assignments", async () => {
    const review = { ...state, reconciliation: { ...reconciliation, eventStatuses: { 501: "review" as const } } };
    const options = { now, load: async () => review, allowPublicAssignments: true };
    expect(await loadStaffingCards([event], options)).toEqual({ [key]: { names: ["Casey", "Jordan"], status: "review" } });
    expect(await loadStaffingPrefills([event], options)).toEqual({});
    const automatic = { ...state, reconciliation: { ...reconciliation,
      assignments: reconciliation.assignments.map((row) => ({ ...row, source: "automatic" as const })) } };
    expect(await loadStaffingPrefills([event], { ...options, load: async () => automatic })).toEqual({});
  });
});
