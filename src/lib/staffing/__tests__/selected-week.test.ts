import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleSaveError } from "@/lib/stale-save";
import type { CorporateStaffShift, StaffingEvent } from "../domain";
import { StaffingSourceError } from "../sevenshifts";
import { loadStaffingCards, loadStaffingPrefills, refreshStaffing, staffingEditorRoster, staffingSnapshotIsFresh, updateStaffingOverride } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";

vi.mock("server-only", () => ({}));

const now = new Date("2026-11-23T15:00:00Z");
const date = "2026-11-30";
const event: StaffingEvent = { eventId: "501", eventName: "Synthetic future event", date,
  startAt: `${date}T17:00:00-05:00`, endAt: `${date}T20:00:00-05:00` };
const shifts: CorporateStaffShift[] = ["Jordan", "Casey"].map((employeeName, index) => ({
  shiftId: `shift-${index}`, employeeId: `employee-${index}`, employeeName, corporate: false,
  startAt: `${date}T16:00:00-05:00`, endAt: `${date}T21:00:00-05:00`,
}));

function persistence() {
  let state = emptyStaffingState();
  return {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next: StaffingState, expectedVersion: number) => {
      if (state.version !== expectedVersion || next.version !== expectedVersion) throw new StaleSaveError();
      state = structuredClone({ ...next, version: expectedVersion + 1 });
      return state;
    }),
  };
}

function sources(storage: ReturnType<typeof persistence>, events = [event], schedule = shifts, selectedDate = date) {
  return { ...storage, now, date: selectedDate,
    readEvents: vi.fn(async () => events), readShifts: vi.fn(async () => schedule) };
}

function replaceTeam(version: number, selected = event, schedule = shifts) {
  return { action: "replace-team" as const, expectedVersion: version, eventId: selected.eventId, eventDate: selected.date,
    choices: schedule.map(({ shiftId }) => ({ shiftId })) };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Provider calls are not allowed in selected-week regressions."); })));
afterEach(() => vi.unstubAllGlobals());

describe("selected future staffing week", () => {
  it("uses the real verification time and retains the 45-minute and Eastern-day freshness limits", async () => {
    const dependencies = sources(persistence());
    const state = await refreshStaffing(dependencies, 0);
    expect(state.reconciliation).toMatchObject({
      window: { startDate: date, endDate: "2026-12-06", shiftStartDate: "2026-11-29" },
      lastSuccessfulSyncAt: now.toISOString(), dataStatus: "verified",
    });
    expect(dependencies.readEvents).toHaveBeenCalledExactlyOnceWith(state.reconciliation!.window);
    expect(dependencies.readShifts).toHaveBeenCalledExactlyOnceWith({ ...state.reconciliation!.window, endDate: "2026-12-07" });
    expect(staffingSnapshotIsFresh(state, now)).toBe(true);
    expect(staffingSnapshotIsFresh(state, new Date(now.getTime() + 45 * 60_000))).toBe(true);
    expect(staffingSnapshotIsFresh(state, new Date(now.getTime() + 45 * 60_000 + 1))).toBe(false);
    expect(staffingSnapshotIsFresh(state, new Date(now.getTime() - 1))).toBe(false);
    const late = new Date("2026-11-24T04:59:00Z");
    const overnight = await refreshStaffing({ ...sources(persistence()), now: late }, 0);
    expect(staffingSnapshotIsFresh(overnight, new Date("2026-11-24T05:00:00Z"))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed saved window shapes rather than treating their dates as verified", async () => {
    const state = await refreshStaffing(sources(persistence()), 0);
    for (const window of [
      { ...state.reconciliation!.window, endDate: "2026-12-07" },
      { ...state.reconciliation!.window, shiftStartDate: date },
      { startDate: "2026-11-22", endDate: "2026-11-28", shiftStartDate: "2026-11-21" },
      { ...state.reconciliation!.window, startDate: "2026-11-31" },
    ]) {
      const malformed = { ...state, reconciliation: { ...state.reconciliation!, window } };
      expect(staffingSnapshotIsFresh(malformed, now)).toBe(false);
      expect(() => staffingEditorRoster(malformed, event.eventId, date, now)).toThrow("Verify the published schedule");
      expect(await loadStaffingCards([event], { now, load: async () => malformed, allowPublicStatus: true }))
        .toEqual({ [`${date}:501`]: { status: "unverified", names: [] } });
      expect(await loadStaffingPrefills([event], { now, load: async () => malformed, allowAdminPreview: true })).toEqual({});
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads only the exact future day's roster from saved state without provider calls or writes", async () => {
    const storage = persistence();
    const previousDay = { ...shifts[0], shiftId: "previous-day", employeeId: "previous-employee",
      startAt: "2026-11-29T10:00:00-05:00", endAt: "2026-11-29T18:00:00-05:00" };
    const dependencies = sources(storage, [event], [...shifts, previousDay]);
    const state = await refreshStaffing(dependencies, 0);
    dependencies.readEvents.mockClear(); dependencies.readShifts.mockClear(); storage.save.mockClear();
    const roster = staffingEditorRoster(state, event.eventId, date, now);
    expect(roster).toMatchObject({ version: state.version, selectedShiftIds: [], shifts: [
      { shiftId: "shift-1", employeeName: "Casey", coversEvent: true, conflict: false },
      { shiftId: "shift-0", employeeName: "Jordan", coversEvent: true, conflict: false },
    ] });
    expect(roster!.shifts).toHaveLength(2);
    expect(staffingEditorRoster(state, "different-event", date, now)).toBeNull();
    expect(staffingEditorRoster(state, event.eventId, "2026-12-01", now)).toBeNull();
    expect(dependencies.readEvents).not.toHaveBeenCalled();
    expect(dependencies.readShifts).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves two future employees as one versioned manual team and projects only authorized prefills", async () => {
    const storage = persistence();
    const dependencies = sources(storage);
    const verified = await refreshStaffing(dependencies, 0);
    storage.save.mockClear(); dependencies.readEvents.mockClear(); dependencies.readShifts.mockClear();
    const saved = await updateStaffingOverride(replaceTeam(verified.version), dependencies);
    expect(saved.version).toBe(verified.version + 1);
    expect(storage.save).toHaveBeenCalledExactlyOnceWith(expect.anything(), verified.version);
    expect(saved.manualTeams).toEqual([{ eventId: event.eventId, eventDate: date }]);
    expect(saved.reconciliation!.assignments).toMatchObject([
      { eventId: event.eventId, eventDate: date, employeeId: "employee-0", source: "manual" },
      { eventId: event.eventId, eventDate: date, employeeId: "employee-1", source: "manual" },
    ]);
    expect(saved.reconciliation!.lastSuccessfulSyncAt).toBe(verified.reconciliation!.lastSuccessfulSyncAt);
    expect(await loadStaffingPrefills([event], { now, load: storage.load, allowAdminPreview: true })).toEqual({ 501: ["Casey", "Jordan"] });
    expect(await loadStaffingPrefills([event], { now, load: storage.load, allowPublicStatus: true })).toEqual({});
    expect(await loadStaffingCards([event], { now, load: storage.load, allowPublicStatus: true }))
      .toEqual({ [`${date}:501`]: { status: "assigned", names: [] } });
    expect(dependencies.readEvents).not.toHaveBeenCalled();
    expect(dependencies.readShifts).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains manual teams when switching weeks without verifying outside-week statuses or prefills", async () => {
    const current: StaffingEvent = { ...event, eventId: "current", date: "2026-11-23",
      startAt: "2026-11-23T17:00:00-05:00", endAt: "2026-11-23T20:00:00-05:00" };
    const currentShift = { ...shifts[0], shiftId: "current-shift", employeeId: "current-employee",
      startAt: "2026-11-23T16:00:00-05:00", endAt: "2026-11-23T21:00:00-05:00" };
    const storage = persistence();
    const currentSources = sources(storage, [current], [currentShift], current.date);
    const currentState = await refreshStaffing(currentSources, 0);
    const currentTeam = await updateStaffingOverride(replaceTeam(currentState.version, current, [currentShift]), currentSources);
    const futureSources = sources(storage);
    const futureState = await refreshStaffing(futureSources, currentTeam.version);
    expect(futureState.events).toContainEqual(current);
    expect(futureState.reconciliation!.assignments).toEqual(currentTeam.reconciliation!.assignments);
    expect(futureState.manualTeams).toContainEqual({ eventId: current.eventId, eventDate: current.date });
    expect(await loadStaffingCards([current], { now, load: storage.load, allowAdminPreview: true }))
      .toEqual({ "2026-11-23:current": { names: ["Jordan"], status: "unverified" } });
    expect(await loadStaffingPrefills([current], { now, load: storage.load, allowAdminPreview: true })).toEqual({});
    expect(() => staffingEditorRoster(futureState, current.eventId, current.date, now)).toThrow("Verify the published schedule");
    const futureTeam = await updateStaffingOverride(replaceTeam(futureState.version), futureSources);
    const returned = await refreshStaffing({ ...currentSources, readEvents: async () => [current, event] }, futureTeam.version);
    expect(returned.manualTeams).toEqual(expect.arrayContaining([
      { eventId: current.eventId, eventDate: current.date }, { eventId: event.eventId, eventDate: date },
    ]));
    expect(returned.reconciliation!.assignments).toHaveLength(3);
    expect(returned.reconciliation!.eventStatuses).toEqual({ current: "assigned" });
    expect(await loadStaffingPrefills([current], { now, load: storage.load, allowAdminPreview: true })).toEqual({ current: ["Jordan"] });
    expect(await loadStaffingPrefills([event], { now, load: storage.load, allowAdminPreview: true })).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not falsely block a future shift after the same employee's non-overlapping automatic match in another week", async () => {
    const current: StaffingEvent = { ...event, eventId: "current", date: "2026-11-23",
      startAt: "2026-11-23T17:00:00-05:00", endAt: "2026-11-23T20:00:00-05:00" };
    const currentShift = { ...shifts[0], corporate: true, shiftId: "current-shift",
      startAt: "2026-11-23T16:00:00-05:00", endAt: "2026-11-23T21:00:00-05:00" };
    const futureShift = { ...shifts[0], corporate: true };
    const storage = persistence();
    const first = await refreshStaffing(sources(storage, [current], [currentShift], current.date), 0);
    expect(first.reconciliation!.eventStatuses.current).toBe("assigned");
    const selected = await refreshStaffing(sources(storage, [event], [futureShift]), first.version);
    expect(selected.events).toContainEqual(current);
    expect(selected.reconciliation!.eventStatuses[event.eventId]).toBe("assigned");
    expect(staffingEditorRoster(selected, event.eventId, date, now)!.shifts[0]).toMatchObject({ employeeName: "Jordan", conflict: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops only obsolete automatic matches with missing context rather than blocking an unrelated future shift", async () => {
    const storage = persistence();
    const first = await refreshStaffing(sources(storage), 0);
    const legacy = await storage.save({ ...first, reconciliation: { ...first.reconciliation!, assignments: [{
      eventId: "obsolete-event", eventDate: "2026-11-23", employeeId: shifts[0].employeeId,
      employeeName: shifts[0].employeeName, shiftId: "obsolete-shift", source: "automatic",
    }] } }, first.version);
    const selected = await refreshStaffing(sources(storage, [event], [{ ...shifts[0], corporate: true }]), legacy.version);
    expect(selected.reconciliation!.assignments).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventId: "obsolete-event" })]));
    expect(selected.reconciliation!.eventStatuses[event.eventId]).toBe("assigned");
    expect(staffingEditorRoster(selected, event.eventId, date, now)!.shifts[0].conflict).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes an automatic boundary match when its published shift is removed, while retaining a still-verified one", async () => {
    const overnight: StaffingEvent = { ...event, eventId: "overnight", date: "2026-11-29",
      startAt: "2026-11-29T23:00:00-05:00", endAt: "2026-11-30T01:00:00-05:00" };
    const early: StaffingEvent = { ...event, startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" };
    const oldShift = { ...shifts[0], corporate: true, shiftId: "old-auto", startAt: overnight.startAt!, endAt: overnight.endAt! };
    const newShift = { ...shifts[0], corporate: false, shiftId: "new-shift", startAt: early.startAt!, endAt: early.endAt! };
    for (const oldShiftPresent of [true, false]) {
      const storage = persistence();
      const prior = await refreshStaffing(sources(storage, [overnight], [oldShift], overnight.date), 0);
      expect(prior.reconciliation!.assignments).toHaveLength(1);
      const selected = await refreshStaffing(sources(storage, [overnight, early], oldShiftPresent ? [oldShift, newShift] : [newShift]), prior.version);
      expect(selected.reconciliation!.assignments.some((row) => row.eventId === overnight.eventId)).toBe(oldShiftPresent);
      expect(staffingEditorRoster(selected, early.eventId, date, now)!.shifts.find((shift) => shift.shiftId === newShift.shiftId)!.conflict).toBe(oldShiftPresent);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([true, false])("blocks a different shift against an overnight manual assignment, with boundary metadata present: %s", async (hasContext) => {
    const overnight: StaffingEvent = { ...event, eventId: "overnight", date: "2026-11-29",
      startAt: "2026-11-29T23:00:00-05:00", endAt: "2026-11-30T01:00:00-05:00" };
    const early: StaffingEvent = { ...event, startAt: "2026-11-30T00:30:00-05:00", endAt: "2026-11-30T02:00:00-05:00" };
    const oldShift = { ...shifts[0], shiftId: "old-shift", startAt: overnight.startAt!, endAt: overnight.endAt! };
    const newShift = { ...shifts[0], shiftId: "new-shift", startAt: early.startAt!, endAt: early.endAt! };
    const storage = persistence();
    const prior = sources(storage, [overnight], [oldShift], overnight.date);
    const first = await refreshStaffing(prior, 0);
    const assigned = await updateStaffingOverride(replaceTeam(first.version, overnight, [oldShift]), prior);
    const selected = sources(storage, hasContext ? [overnight, early] : [early], [oldShift, newShift]);
    const verified = await refreshStaffing(selected, assigned.version);
    storage.save.mockClear();
    expect(staffingEditorRoster(verified, early.eventId, date, now)!.shifts.find((shift) => shift.shiftId === newShift.shiftId))
      .toMatchObject({ conflict: true, coversEvent: true });
    await expect(updateStaffingOverride(replaceTeam(verified.version, early, [newShift]), selected))
      .rejects.toThrow("existing assignment overlaps or could not be verified");
    expect(storage.save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["events", "incomplete"] as const)("preserves the prior verified snapshot after a failed %s future verification", async (failure) => {
    const storage = persistence();
    const dependencies = sources(storage);
    const verified = await refreshStaffing(dependencies, 0);
    const failing = failure === "events"
      ? { ...dependencies, date: "2026-12-14", readEvents: async (): Promise<StaffingEvent[]> => { throw new Error("Unavailable events"); } }
      : { ...dependencies, date: "2026-12-14", readShifts: async (): Promise<CorporateStaffShift[]> => { throw new StaffingSourceError("incomplete"); } };
    const failed = await refreshStaffing(failing, verified.version);
    expect(failed).toMatchObject({ failure, version: verified.version + 1, reconciliation: verified.reconciliation,
      events: verified.events, shifts: verified.shifts, lastAttemptAt: now.toISOString() });
    expect(staffingSnapshotIsFresh(failed, now)).toBe(false);
    expect(() => staffingEditorRoster(failed, event.eventId, date, now)).toThrow("Verify the published schedule");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects wrong-day shifts, mismatched event dates and stale versions without saving or re-reading providers", async () => {
    const wrongDay = { ...shifts[0], shiftId: "wrong-day", employeeId: "other-employee",
      startAt: "2026-11-29T10:00:00-05:00", endAt: "2026-11-29T18:00:00-05:00" };
    const storage = persistence();
    const dependencies = sources(storage, [event], [...shifts, wrongDay]);
    const verified = await refreshStaffing(dependencies, 0);
    storage.save.mockClear(); dependencies.readEvents.mockClear(); dependencies.readShifts.mockClear();
    await expect(updateStaffingOverride(replaceTeam(verified.version, event, [wrongDay]), dependencies)).rejects.toThrow("on the event day");
    await expect(updateStaffingOverride({ ...replaceTeam(verified.version), eventDate: "2026-12-01" }, dependencies)).rejects.toThrow("Choose a verified event");
    await expect(updateStaffingOverride(replaceTeam(0), dependencies)).rejects.toBeInstanceOf(StaleSaveError);
    await expect(refreshStaffing(dependencies, 0)).rejects.toBeInstanceOf(StaleSaveError);
    expect(storage.save).not.toHaveBeenCalled();
    expect(dependencies.readEvents).not.toHaveBeenCalled();
    expect(dependencies.readShifts).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
