import { afterEach, describe, expect, it, vi } from "vitest";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { StaleSaveError } from "@/lib/stale-save";
import type { CorporateStaffShift, StaffingEvent } from "../domain";
import { loadStaffingCards, loadStaffingPrefills, refreshStaffing, staffingSnapshotIsFresh, updateStaffingOverride } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";
import { StaffingSourceError } from "../sevenshifts";

vi.mock("server-only", () => ({}));
const now = new Date("2026-11-10T14:00:00Z");
const event: StaffingEvent = { eventId: "123", eventName: "Sample party", date: "2026-11-10", startAt: "2026-11-10T23:00:00Z", endAt: "2026-11-11T01:00:00Z" };
const shift: CorporateStaffShift = { shiftId: "1", employeeId: "22", employeeName: "Staff Two", startAt: "2026-11-10T22:00:00Z", endAt: "2026-11-11T01:00:00Z" };

function persistence() {
  let state = emptyStaffingState();
  return { load: vi.fn(async () => structuredClone(state)), save: vi.fn(async (next: StaffingState, expectedVersion: number) => {
    if (state.version !== expectedVersion) throw new StaleSaveError();
    state = structuredClone({ ...next, version: expectedVersion + 1 });
    return state;
  }) };
}

afterEach(() => { vi.unstubAllEnvs(); setTripleseatAdapterForTests(null); setEventPlanStorageForTests(null); });

describe("Staffing snapshot service", () => {
  it("keeps the previous snapshot, alert and refresh time on failed and incomplete feeds", async () => {
    const storage = persistence();
    const second = { ...event, eventId: "456", eventName: "Unassigned redacted party", startAt: "2026-11-11T02:00:00Z", endAt: "2026-11-11T04:00:00Z" };
    const deps = { ...storage, now, readEvents: async () => [event, second], readShifts: async () => [shift] };
    const good = await refreshStaffing(deps);
    expect(staffingSnapshotIsFresh(good, now)).toBe(true);
    expect(good.reconciliation?.assignments).toHaveLength(1);
    expect(good.reconciliation?.alerts).toHaveLength(1);
    for (const [readShifts, failure] of [
      [async () => { throw new StaffingSourceError("rate-limited"); }, "shifts"],
      [async () => { throw new StaffingSourceError("incomplete"); }, "incomplete"],
      [async () => [{ ...shift, endAt: "unknown" }], "incomplete"],
    ] as const) {
      const failed = await refreshStaffing({ ...deps, readShifts });
      expect(failed).toMatchObject({ reconciliation: good.reconciliation, events: good.events, shifts: good.shifts, failure });
      expect(staffingSnapshotIsFresh(failed, now)).toBe(false);
    }
  });

  it("reads exact Tripleseat staffing metadata without updating operational source state", async () => {
    const operations = createMemoryEventPlanStorage();
    setEventPlanStorageForTests(operations);
    const write = vi.spyOn(operations, "replaceWindow");
    const fetchStaffingEventsForRange = vi.fn(async () => [{ eventId: event.eventId, eventName: event.eventName,
      localDate: event.date, eventStartAt: event.startAt, eventEndAt: event.endAt }]);
    setTripleseatAdapterForTests({ sourceMode: "live", fetchStaffingEventsForRange } as unknown as TripleseatAdapter);
    const state = await refreshStaffing({ ...persistence(), now, readShifts: async () => [shift] });
    expect(fetchStaffingEventsForRange).toHaveBeenCalledExactlyOnceWith("2026-11-09", "2026-11-17");
    expect(write).not.toHaveBeenCalled();
    expect(await operations.getSyncState()).toBeNull();
    expect(state.reconciliation?.assignments).toHaveLength(1);
  });

  it("protects legacy-public cards and returns only safe names and statuses to an authorized Admin", async () => {
    const storage = persistence();
    const deps = { ...storage, now, readEvents: async () => [event], readShifts: async () => [shift] };
    const good = await refreshStaffing(deps);
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");
    storage.load.mockClear();
    expect(await loadStaffingCards([event], deps)).toEqual({});
    expect(storage.load).not.toHaveBeenCalled();
    expect(await loadStaffingCards([event], { ...deps, allowAdminPreview: true })).toEqual({ "2026-11-10:123": { names: ["Staff Two"], status: "assigned" } });
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
    storage.load.mockClear();
    expect(await loadStaffingCards([event], deps)).toEqual({});
    expect(storage.load).not.toHaveBeenCalled();
    const admin = { ...deps, allowAdminPreview: true };
    const staleAt = new Date("2026-11-10T14:46:00Z");
    expect(staffingSnapshotIsFresh(good, staleAt)).toBe(false);
    expect(await loadStaffingCards([event], { ...admin, now: staleAt })).toEqual({ "2026-11-10:123": { names: ["Staff Two"], status: "unverified" } });
    expect(await loadStaffingCards([{ ...event, date: "2026-11-11" }], admin)).toEqual({ "2026-11-11:123": { names: [], status: "unverified" } });
    expect(await loadStaffingCards([event, { ...event, date: "2026-11-11" }], admin)).toEqual({});
    expect(await loadStaffingCards([{ ...event, startAt: "2026-11-10T18:00:00-05:00" }], admin)).toEqual({ "2026-11-10:123": { names: ["Staff Two"], status: "assigned" } });
    expect(await loadStaffingCards([{ ...event, startAt: "2026-11-10T23:30:00Z" }], admin)).toEqual({ "2026-11-10:123": { names: [], status: "unverified" } });
  });

  it("projects only explicitly requested public statuses from one saved snapshot without employee details or provider reads", async () => {
    const storage = persistence();
    const deps = { ...storage, now, readEvents: vi.fn(async () => [event]),
      readShifts: vi.fn(async () => [{ ...shift, notes: "Private employee schedule note" }]) };
    const good = await refreshStaffing(deps);
    const unassigned = { ...event, eventId: "456" }, review = { ...event, eventId: "789" }, unknown = { ...event, eventId: "999" };
    const state: StaffingState = { ...good, events: [event, unassigned, review],
      reconciliation: { ...good.reconciliation!, eventStatuses: { 123: "assigned", 456: "unassigned", 789: "review" } } };
    const load = vi.fn(async () => state);
    storage.save.mockClear();
    deps.readEvents.mockClear();
    deps.readShifts.mockClear();
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");

    expect(await loadStaffingCards([event, unassigned, review, unknown], { ...deps, load, allowPublicStatus: true })).toEqual({
      "2026-11-10:123": { names: [], status: "assigned" },
      "2026-11-10:456": { names: [], status: "unassigned" },
      "2026-11-10:789": { names: [], status: "review" },
      "2026-11-10:999": { names: [], status: "unverified" },
    });
    expect(load).toHaveBeenCalledOnce();
    expect(storage.save).not.toHaveBeenCalled();
    expect(deps.readEvents).not.toHaveBeenCalled();
    expect(deps.readShifts).not.toHaveBeenCalled();
  });

  it("keeps public staffing statuses unverified for stale or changed timing and omits repeated event identities", async () => {
    const deps = { ...persistence(), now, readEvents: async () => [event], readShifts: async () => [shift] };
    const good = await refreshStaffing(deps);
    const publicStatus = { ...deps, allowPublicStatus: true };
    expect(await loadStaffingCards([event], { ...publicStatus, now: new Date("2026-11-10T14:46:00Z") }))
      .toEqual({ "2026-11-10:123": { names: [], status: "unverified" } });
    expect(await loadStaffingCards([{ ...event, startAt: "2026-11-10T23:30:00Z" }], publicStatus))
      .toEqual({ "2026-11-10:123": { names: [], status: "unverified" } });
    expect(await loadStaffingCards([event, { ...event, date: "2026-11-11" }], publicStatus)).toEqual({});
    expect(good.reconciliation?.assignments).toHaveLength(1);
  });

  it("does not treat the public-status option as permission for employee names or form prefills", async () => {
    const load = vi.fn(async () => emptyStaffingState());
    expect(await loadStaffingCards([event], { now, load, allowPublicStatus: false })).toEqual({});
    expect(await loadStaffingCards([], { now, load, allowPublicStatus: true })).toEqual({});
    expect(await loadStaffingPrefills([event], { now, load, allowPublicStatus: true })).toEqual({});
    expect(load).not.toHaveBeenCalled();
  });

  it("does not confirm home cards from a wall clock duplicated during the DST fallback", async () => {
    const autumn = { ...event, date: "2026-11-01", startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T07:30:00Z" };
    const deps = { ...persistence(), now: new Date("2026-11-01T04:00:00Z"), readEvents: async () => [autumn], readShifts: async () => [] };
    const good = await refreshStaffing(deps);
    expect(good.reconciliation?.eventStatuses["123"]).toBe("unassigned");
    expect(await loadStaffingCards([autumn], { ...deps, allowAdminPreview: true })).toEqual({ "2026-11-01:123": { names: [], status: "unverified" } });
  });

  it("requires a current verified snapshot and confirmation for an event-day shift without full coverage", async () => {
    const otherShift = { ...shift, startAt: "2026-11-10T18:00:00Z", endAt: "2026-11-10T22:00:00Z" };
    const deps = { ...persistence(), now, readEvents: async () => [event], readShifts: async () => [otherShift] };
    const current = await refreshStaffing(deps);
    const assign = { action: "assign" as const, expectedVersion: current.version, eventId: event.eventId, shiftId: shift.shiftId };
    await expect(updateStaffingOverride(assign, deps)).rejects.toThrow("does not cover the full event");
    const stale = { ...deps, now: new Date("2026-11-10T14:46:00Z") };
    await expect(updateStaffingOverride(assign, stale)).rejects.toThrow("Refresh the published schedule");
    await expect(updateStaffingOverride({ action: "keep-clear", expectedVersion: current.version, eventId: event.eventId, enabled: true }, stale)).rejects.toThrow("Refresh the published schedule");
    await expect(updateStaffingOverride({ action: "policy", expectedVersion: current.version, earlyStartMinutes: 90, allowIntermediateStarts: false }, stale)).resolves.toMatchObject({ policy: { earlyStartMinutes: 90 } });
  });

  it("retains a coverage review for a confirmed day-of manual assignment and clears it after correction", async () => {
    const earlier = { ...shift, corporate: false, startAt: "2026-11-10T18:00:00Z", endAt: "2026-11-10T22:00:00Z" };
    const covering = { ...shift, corporate: false, shiftId: "2" };
    const previousDay = { ...shift, corporate: false, shiftId: "3", startAt: "2026-11-10T00:00:00Z", endAt: "2026-11-10T05:00:00Z" };
    const deps = { ...persistence(), now, readEvents: async () => [event], readShifts: async () => [earlier, covering, previousDay] };
    const current = await refreshStaffing(deps);
    expect(current).toMatchObject({ dailyScheduleComplete: true, reconciliation: { assignments: [] } });
    const assign = { action: "assign" as const, expectedVersion: current.version, eventId: event.eventId, shiftId: previousDay.shiftId };
    await expect(updateStaffingOverride({ ...assign, confirmPartialCoverage: true }, deps)).rejects.toThrow("on the event day");
    const saved = await updateStaffingOverride({ ...assign, shiftId: earlier.shiftId, confirmPartialCoverage: true }, deps);
    expect(saved.reconciliation).toMatchObject({
      assignments: [{ eventId: event.eventId, shiftId: earlier.shiftId, source: "manual" }],
      eventStatuses: { [event.eventId]: "review" },
      reviews: [{ code: "manual-coverage", eventIds: [event.eventId], shiftId: earlier.shiftId }],
    });
    const corrected = await updateStaffingOverride({ ...assign, expectedVersion: saved.version, shiftId: covering.shiftId }, deps);
    expect(corrected.reconciliation).toMatchObject({
      assignments: [{ eventId: event.eventId, shiftId: covering.shiftId, source: "manual" }],
      eventStatuses: { [event.eventId]: "assigned" }, reviews: [],
    });
  });

  it("requires confirmation to move one shift and rejects duplicating the employee via a different shift", async () => {
    const second = { ...event, eventId: "456", eventName: "Second party", startAt: "2026-11-10T23:30:00Z" };
    const anotherShift = { ...shift, corporate: false, shiftId: "2" };
    const firstShift = { ...shift, corporate: false };
    const deps = { ...persistence(), now, readEvents: async () => [event, second], readShifts: async () => [firstShift, anotherShift] };
    const current = await refreshStaffing(deps);
    const assign = { action: "assign" as const, expectedVersion: current.version, eventId: event.eventId, shiftId: firstShift.shiftId };
    const assigned = await updateStaffingOverride(assign, deps);
    const move = { ...assign, eventId: second.eventId, expectedVersion: assigned.version };
    await expect(updateStaffingOverride(move, deps)).rejects.toThrow("Confirm moving the shift");
    await expect(updateStaffingOverride({ ...move, shiftId: anotherShift.shiftId, confirmMove: true }, deps)).rejects.toThrow("existing assignment overlaps or could not be verified");
    const moved = await updateStaffingOverride({ ...move, confirmMove: true }, deps);
    expect(moved.reconciliation?.assignments).toMatchObject([{ eventId: second.eventId, shiftId: firstShift.shiftId, source: "manual" }]);
  });

  it("enforces a reviewed version for assignment and persists manager decisions without faking a sync", async () => {
    const deps = { ...persistence(), now, readEvents: async () => [event], readShifts: async () => [shift] };
    const first = await refreshStaffing(deps);
    await expect(updateStaffingOverride({ action: "assign", expectedVersion: 0, eventId: event.eventId, shiftId: shift.shiftId }, deps)).rejects.toBeInstanceOf(StaleSaveError);
    const edited = await updateStaffingOverride({ action: "assign", expectedVersion: first.version, eventId: event.eventId, shiftId: shift.shiftId }, deps);
    expect(edited.reconciliation?.assignments).toMatchObject([{ source: "manual", employeeId: shift.employeeId }]);
    const noShifts = await refreshStaffing({ ...deps, readShifts: async () => [] });
    expect(noShifts.reconciliation?.assignments).toEqual(edited.reconciliation?.assignments);
    const removed = await updateStaffingOverride({ action: "remove-manual", expectedVersion: noShifts.version, eventId: event.eventId, employeeId: shift.employeeId }, { ...deps, now: new Date("2026-11-10T14:10:00Z") });
    expect(removed.reconciliation?.lastSuccessfulSyncAt).toBe(now.toISOString());
    expect(removed.reconciliation?.alerts[0]).toMatchObject({ eventId: event.eventId, resolvedAt: null });
  });

  it("assigns multiple distinct employees to the same event with just one checked write", async () => {
    const storage = persistence();
    const other = { ...shift, shiftId: "2", employeeId: "33", employeeName: "One More", corporate: false };
    const deps = { ...storage, now, readEvents: async () => [event], readShifts: async () => [{ ...shift, corporate: false }, other] };
    const current = await refreshStaffing(deps);
    storage.save.mockClear();
    const change = { action: "assign-many" as const, expectedVersion: current.version, eventId: event.eventId,
      choices: [{ shiftId: shift.shiftId }, { shiftId: other.shiftId }] };
    const saved = await updateStaffingOverride(change, deps);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledWith(expect.anything(), current.version);
    expect(saved.version).toBe(current.version + 1);
    expect(saved.reconciliation?.assignments).toMatchObject([
      { eventId: event.eventId, employeeId: shift.employeeId, source: "manual" },
      { eventId: event.eventId, employeeId: other.employeeId, source: "manual" },
    ]);
    await expect(updateStaffingOverride(change, deps)).rejects.toBeInstanceOf(StaleSaveError);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("rejects the entire batch for duplicate employees or an unconfirmed partial shift", async () => {
    const storage = persistence();
    const candidate = { ...shift, corporate: false };
    const duplicate = { ...candidate, shiftId: "2" };
    const partial = { ...candidate, shiftId: "3", employeeId: "33", startAt: "2026-11-10T23:30:00Z" };
    const deps = { ...storage, now, readEvents: async () => [event], readShifts: async () => [candidate, duplicate, partial] };
    const current = await refreshStaffing(deps);
    storage.save.mockClear();
    const change = { action: "assign-many" as const, expectedVersion: current.version, eventId: event.eventId };
    await expect(updateStaffingOverride({ ...change, choices: [{ shiftId: "1" }, { shiftId: "2" }] }, deps)).rejects.toThrow("one published shift per employee");
    await expect(updateStaffingOverride({ ...change, choices: [{ shiftId: "1", confirmPartialCoverage: true }, { shiftId: "3" }] }, deps)).rejects.toThrow("does not cover the full event");
    expect(storage.save).not.toHaveBeenCalled();
    expect(await storage.load()).toEqual(current);
    const saved = await updateStaffingOverride({ ...change, choices: [{ shiftId: "1" }, { shiftId: "3", confirmPartialCoverage: true }] }, deps);
    expect(saved.reconciliation?.assignments).toHaveLength(2);
    expect(saved.reconciliation?.eventStatuses[event.eventId]).toBe("review");
  });

  it("keeps edited and emptied teams exact after refresh and rejects a stale sync before provider reads", async () => {
    const other = { ...shift, shiftId: "2", employeeId: "33", employeeName: "One More" };
    const storage = persistence();
    const deps = { ...storage, now, readEvents: vi.fn(async () => [event]), readShifts: vi.fn(async () => [shift, other]) };
    const current = await refreshStaffing(deps, 0);
    expect(current.reconciliation?.assignments).toHaveLength(2);
    const replace = { action: "replace-team" as const, eventId: event.eventId };
    const edited = await updateStaffingOverride({ ...replace, expectedVersion: current.version, choices: [{ shiftId: other.shiftId }] }, deps);
    expect(edited.reconciliation?.assignments).toMatchObject([{ employeeId: other.employeeId, source: "manual" }]);
    await expect(refreshStaffing(deps, current.version)).rejects.toBeInstanceOf(StaleSaveError);
    expect(deps.readEvents).toHaveBeenCalledOnce();
    expect(deps.readShifts).toHaveBeenCalledOnce();
    const refreshed = await refreshStaffing(deps, edited.version);
    expect(refreshed.reconciliation?.assignments).toEqual(edited.reconciliation?.assignments);
    const emptied = await updateStaffingOverride({ ...replace, expectedVersion: refreshed.version, choices: [] }, deps);
    const after = await refreshStaffing(deps, emptied.version);
    expect(after.reconciliation).toMatchObject({ assignments: [], eventStatuses: { 123: "unassigned" } });
    const resumed = await updateStaffingOverride({ action: "keep-clear", eventId: event.eventId, expectedVersion: after.version, enabled: false }, deps);
    expect(resumed.reconciliation?.assignments).toHaveLength(2);
  });

  it("rejects a date-scoped team replacement if the event is no longer on that card date", async () => {
    const storage = persistence();
    const deps = { ...storage, now, readEvents: async () => [event], readShifts: async () => [shift] };
    const current = await refreshStaffing(deps, 0);
    storage.save.mockClear();
    const change = { action: "replace-team" as const, eventId: event.eventId, expectedVersion: current.version, choices: [{ shiftId: shift.shiftId }] };
    await expect(updateStaffingOverride({ ...change, eventDate: "2026-11-11" }, deps)).rejects.toThrow("Choose a verified event");
    expect(storage.save).not.toHaveBeenCalled();
    const saved = await updateStaffingOverride({ ...change, eventDate: event.date }, deps);
    expect(saved.reconciliation?.assignments).toMatchObject([{ eventId: event.eventId, eventDate: event.date, source: "manual" }]);
  });

  it("does not automatically reassign an employee to the previous event after a confirmed move", async () => {
    const second = { ...event, eventId: "456", eventName: "Second party", startAt: "2026-11-11T01:00:00Z", endAt: "2026-11-11T02:00:00Z" };
    const movedShift = { ...shift, endAt: second.endAt, notes: "Event ID: 123" };
    const untouched = { ...shift, shiftId: "2", employeeId: "33", employeeName: "One More" };
    const deps = { ...persistence(), now, readEvents: async () => [event, second], readShifts: async () => [movedShift, untouched] };
    const current = await refreshStaffing(deps, 0);
    const move = { action: "replace-team" as const, eventId: second.eventId, expectedVersion: current.version };
    await expect(updateStaffingOverride({ ...move, choices: [{ shiftId: movedShift.shiftId }] }, deps)).rejects.toThrow("Confirm moving the shift");
    const moved = await updateStaffingOverride({ ...move, choices: [{ shiftId: movedShift.shiftId, confirmMove: true }] }, deps);
    const removed = await updateStaffingOverride({ ...move, expectedVersion: moved.version, choices: [] }, deps);
    const after = await refreshStaffing(deps, removed.version);
    expect(after.reconciliation?.assignments).toMatchObject([{ eventId: event.eventId, employeeId: untouched.employeeId }]);
  });
});

describe("saved manual staffing names on public cards", () => {
  async function savedTeam() {
    const shifts = [
      { ...shift, employeeName: "Saved A" },
      { ...shift, shiftId: "2", employeeId: "33", employeeName: "Saved B" },
      { ...shift, shiftId: "3", employeeId: "44", employeeName: "Automatic C" },
    ];
    const state = await refreshStaffing({ ...persistence(), now, readEvents: async () => [event], readShifts: async () => shifts });
    return { ...state, reconciliation: { ...state.reconciliation!, assignments: state.reconciliation!.assignments.map((row) => ({
      ...row, source: row.employeeId === "44" ? "automatic" as const : "manual" as const,
    })) } };
  }
  const key = `${event.date}:${event.eventId}`;
  const staleAt = new Date(now.getTime() + 46 * 60_000);

  it("keeps a saved multi-person manual team visible when stale while hiding automatic names and retaining unverified status", async () => {
    const state = await savedTeam();
    const load = vi.fn(async () => state);
    expect(await loadStaffingCards([event], { now: staleAt, load, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
    expect(load).toHaveBeenCalledOnce();
    expect(await loadStaffingCards([event], { now, load, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Automatic C", "Saved A", "Saved B"], status: "assigned" } });
    expect(await loadStaffingCards([event], { now: staleAt, load, allowPublicStatus: true }))
      .toEqual({ [key]: { names: [], status: "unverified" } });
    expect(await loadStaffingCards([event], { now: staleAt, load, allowPublicAssignments: false })).toEqual({});
  });

  it.each(["events", "shifts", "incomplete"] as const)("retains saved manual names after a %s source failure without verifying coverage", async (failure) => {
    const state = { ...await savedTeam(), failure };
    expect(await loadStaffingCards([event], { now, load: async () => state, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
  });

  it("keeps manual names on an Eastern day rollover and outside the selected verified week", async () => {
    const state = await savedTeam();
    expect(await loadStaffingCards([event], { now: new Date("2026-11-11T05:00:00Z"), load: async () => state, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
    const anotherWeek = { ...state, reconciliation: { ...state.reconciliation!,
      window: { startDate: "2026-11-17", endDate: "2026-11-23", shiftStartDate: "2026-11-16" } } };
    expect(staffingSnapshotIsFresh(anotherWeek, now)).toBe(true);
    expect(await loadStaffingCards([event], { now, load: async () => anotherWeek, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
  });

  it("keeps manual names when event clock times change, without exposing automatic names or confirming status", async () => {
    const state = await savedTeam();
    for (const changed of [{ ...event, startAt: "2026-11-10T23:30:00Z" }, { ...event, startAt: null, endAt: null }]) {
      expect(await loadStaffingCards([changed], { now, load: async () => state, allowPublicAssignments: true }))
        .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
    }
    const changedSavedTiming = { ...state, events: [{ ...event, startAt: "2026-11-10T23:30:00Z" }] };
    expect(await loadStaffingCards([event], { now, load: async () => changedSavedTiming, allowPublicAssignments: true }))
      .toEqual({ [key]: { names: ["Saved A", "Saved B"], status: "unverified" } });
  });

  it("requires an exact unique known event ID and date before showing saved manual names", async () => {
    const state = await savedTeam();
    const options = { now: staleAt, load: async () => state, allowPublicAssignments: true };
    const wrongDate = { ...event, date: "2026-11-11" };
    expect(await loadStaffingCards([wrongDate], options))
      .toEqual({ [`${wrongDate.date}:${event.eventId}`]: { names: [], status: "unverified" } });
    expect(await loadStaffingCards([event, event], options)).toEqual({});
    expect(await loadStaffingCards([event, wrongDate], options)).toEqual({});
    for (const events of [[], [event, event], [{ ...event, date: wrongDate.date }]]) {
      expect(await loadStaffingCards([event], { ...options, load: async () => ({ ...state, events }) }))
        .toEqual({ [key]: { names: [], status: "unverified" } });
    }
    const wrongAssignmentDate = { ...state, reconciliation: { ...state.reconciliation!, assignments:
      state.reconciliation!.assignments.map((row) => ({ ...row, eventDate: wrongDate.date })) } };
    expect(await loadStaffingCards([event], { ...options, load: async () => wrongAssignmentDate }))
      .toEqual({ [key]: { names: [], status: "unverified" } });
  });

  it("does not change Admin visibility, stale prefills or stale-save rejection", async () => {
    const state = await savedTeam();
    const load = vi.fn(async () => state), save = vi.fn(async (next: StaffingState) => next);
    expect(await loadStaffingCards([event], { now: staleAt, load, allowAdminPreview: true }))
      .toEqual({ [key]: { names: ["Automatic C", "Saved A", "Saved B"], status: "unverified" } });
    expect(await loadStaffingPrefills([event], { now: staleAt, load, allowPublicAssignments: true })).toEqual({});
    await expect(updateStaffingOverride({ action: "replace-team", eventId: event.eventId, eventDate: event.date,
      expectedVersion: state.version, choices: [{ shiftId: shift.shiftId }] }, { now: staleAt, load, save }))
      .rejects.toThrow("Refresh the published schedule");
    expect(save).not.toHaveBeenCalled();
  });
});
