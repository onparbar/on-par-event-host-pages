import { afterEach, describe, expect, it, vi } from "vitest";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { StaleSaveError } from "@/lib/stale-save";
import type { CorporateStaffShift, StaffingEvent } from "../domain";
import { loadStaffingCards, refreshStaffing, staffingSnapshotIsFresh, updateStaffingOverride } from "../service";
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
    expect(fetchStaffingEventsForRange).toHaveBeenCalledExactlyOnceWith("2026-11-10", "2026-11-16");
    expect(write).not.toHaveBeenCalled();
    expect(await operations.getSyncState()).toBeNull();
    expect(state.reconciliation?.assignments).toHaveLength(1);
  });

  it("protects legacy-public cards and returns only safe names and statuses to enabled staff pages", async () => {
    const storage = persistence();
    const deps = { ...storage, now, readEvents: async () => [event], readShifts: async () => [shift] };
    const good = await refreshStaffing(deps);
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");
    storage.load.mockClear();
    expect(await loadStaffingCards([event], deps)).toEqual({});
    expect(storage.load).not.toHaveBeenCalled();
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
    expect(await loadStaffingCards([event], deps)).toEqual({ 123: { names: ["Staff Two"], status: "assigned" } });
    const staleAt = new Date("2026-11-10T14:46:00Z");
    expect(staffingSnapshotIsFresh(good, staleAt)).toBe(false);
    expect(await loadStaffingCards([event], { ...deps, now: staleAt })).toEqual({ 123: { names: ["Staff Two"], status: "unverified" } });
    expect(await loadStaffingCards([{ ...event, date: "2026-11-11" }], deps)).toEqual({ 123: { names: [], status: "unverified" } });
    expect(await loadStaffingCards([{ ...event, startAt: "2026-11-10T18:00:00-05:00" }], deps)).toEqual({ 123: { names: ["Staff Two"], status: "assigned" } });
    expect(await loadStaffingCards([{ ...event, startAt: "2026-11-10T23:30:00Z" }], deps)).toEqual({ 123: { names: [], status: "unverified" } });
  });

  it("does not confirm home cards from a wall clock duplicated during the DST fallback", async () => {
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
    const autumn = { ...event, date: "2026-11-01", startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T07:30:00Z" };
    const deps = { ...persistence(), now: new Date("2026-11-01T04:00:00Z"), readEvents: async () => [autumn], readShifts: async () => [] };
    const good = await refreshStaffing(deps);
    expect(good.reconciliation?.eventStatuses["123"]).toBe("unassigned");
    expect(await loadStaffingCards([autumn], deps)).toEqual({ 123: { names: [], status: "unverified" } });
  });

  it("requires a current verified snapshot and an overlapping shift for Admin assignment; policy can change while stale", async () => {
    const otherShift = { ...shift, startAt: "2026-11-10T18:00:00Z", endAt: "2026-11-10T22:00:00Z" };
    const deps = { ...persistence(), now, readEvents: async () => [event], readShifts: async () => [otherShift] };
    const current = await refreshStaffing(deps);
    const assign = { action: "assign" as const, expectedVersion: current.version, eventId: event.eventId, shiftId: shift.shiftId };
    await expect(updateStaffingOverride(assign, deps)).rejects.toThrow("overlaps the event");
    const stale = { ...deps, now: new Date("2026-11-10T14:46:00Z") };
    await expect(updateStaffingOverride(assign, stale)).rejects.toThrow("Refresh the published schedule");
    await expect(updateStaffingOverride({ action: "keep-clear", expectedVersion: current.version, eventId: event.eventId, enabled: true }, stale)).rejects.toThrow("Refresh the published schedule");
    await expect(updateStaffingOverride({ action: "policy", expectedVersion: current.version, earlyStartMinutes: 90, allowIntermediateStarts: false }, stale)).resolves.toMatchObject({ policy: { earlyStartMinutes: 90 } });
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
});
