import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleSaveError } from "@/lib/stale-save";
import type { CorporateStaffShift, StaffingAssignment, StaffingEvent } from "../domain";
import { loadOperationalStaffingRoster, OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH, saveOperationalStaffingTeam } from "../operational";
import { refreshStaffing, StaffingReviewError } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";

vi.mock("server-only", () => ({}));

const now = new Date("2026-11-24T15:00:00Z");
const date = "2026-11-30";
const secret = "synthetic-session-secret-for-operational-unit-tests";
const event: StaffingEvent = { eventId: "501", eventName: "Synthetic afternoon event", date,
  startAt: `${date}T17:00:00-05:00`, endAt: `${date}T20:00:00-05:00` };
const shifts: CorporateStaffShift[] = ["Jordan", "Casey"].map((employeeName, index) => ({
  shiftId: `shift-${index}`, employeeId: `employee-${index}`, employeeName, corporate: false,
  startAt: `${date}T16:00:00-05:00`, endAt: `${date}T21:00:00-05:00`, notes: "Private synthetic scheduling note",
}));

function persistence(initial = emptyStaffingState()) {
  let state = structuredClone(initial);
  return {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next: StaffingState, expectedVersion: number) => {
      if (state.version !== expectedVersion || next.version !== expectedVersion) throw new StaleSaveError();
      state = structuredClone({ ...next, version: expectedVersion + 1 });
      return structuredClone(state);
    }),
    bump: () => { state.version += 1; },
  };
}

function dependencies(storage = persistence(), events = [event], schedule = shifts, time = now) {
  return { ...storage, now: time, getSecret: () => secret,
    readEvents: vi.fn(async () => structuredClone(events)), readShifts: vi.fn(async () => structuredClone(schedule)) };
}

async function fresh(events = [event], schedule = shifts, time = now) {
  return refreshStaffing({ ...dependencies(persistence(), events, schedule, time), date,
    save: async (next) => next });
}

function change(roster: NonNullable<Awaited<ReturnType<typeof loadOperationalStaffingRoster>>>, choices = [{ shiftId: shifts[0].shiftId }]) {
  return { eventId: event.eventId, eventDate: date, expectedVersion: roster.version, reviewToken: roster.reviewToken, choices };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real provider/storage calls are forbidden in operational staffing tests."); })));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("passwordless operational staffing review", () => {
  it("reads fresh exact-day all-role shifts without writes, provider calls, raw notes, or server secrets", async () => {
    const priorDay = { ...shifts[0], shiftId: "prior-day", employeeId: "prior-day-employee", employeeName: "Other day",
      startAt: "2026-11-29T09:00:00-05:00", endAt: "2026-11-29T17:00:00-05:00" };
    const dep = dependencies(persistence(await fresh([event], [...shifts, priorDay])));
    const roster = await loadOperationalStaffingRoster(event.eventId, date, dep);
    expect(roster).toMatchObject({ version: 0, selectedShiftIds: [], shifts: [
      { employeeName: "Casey", coversEvent: true }, { employeeName: "Jordan", coversEvent: true },
    ] });
    expect(roster!.shifts).toHaveLength(2);
    expect(roster!.reviewToken).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(roster)).not.toContain("Private synthetic scheduling note");
    expect(JSON.stringify(roster)).not.toContain(secret);
    expect(JSON.stringify(roster)).not.toContain("Other day");
    expect(dep.save).not.toHaveBeenCalled();
    expect(dep.readEvents).not.toHaveBeenCalled(); expect(dep.readShifts).not.toHaveBeenCalled();
  });

  it("captures stale or missing-week verification in memory without saving the snapshot or failure metadata", async () => {
    const old = await fresh();
    const dep = dependencies(persistence(old), [event], shifts, new Date(now.getTime() + 46 * 60_000));
    const roster = await loadOperationalStaffingRoster(event.eventId, date, dep);
    expect(roster).not.toBeNull();
    expect(dep.readEvents).toHaveBeenCalledOnce(); expect(dep.readShifts).toHaveBeenCalledOnce();
    expect(dep.save).not.toHaveBeenCalled();
    expect(await dep.load()).toEqual(old);
    for (const failed of ["events", "shifts", "incomplete"]) {
      const attempt = dependencies();
      if (failed === "events") attempt.readEvents.mockRejectedValue(new Error("not available"));
      else if (failed === "shifts") attempt.readShifts.mockRejectedValue(new Error("not available"));
      else attempt.readShifts.mockResolvedValue([{ ...shifts[0], employeeName: "" }]);
      await expect(loadOperationalStaffingRoster(event.eventId, date, attempt)).rejects.toBeInstanceOf(StaffingReviewError);
      expect(attempt.save).not.toHaveBeenCalled();
      expect(await attempt.load()).toEqual(emptyStaffingState());
    }
  });

  it("reverifies an absent event or a selected future week, but never saves on GET", async () => {
    const saved = await fresh([{ ...event, eventId: "other" }]);
    const dep = dependencies(persistence(saved));
    expect(await loadOperationalStaffingRoster(event.eventId, date, dep)).not.toBeNull();
    expect(dep.readEvents).toHaveBeenCalledOnce();
    expect(dep.save).not.toHaveBeenCalled();
    dep.readEvents.mockResolvedValue([]);
    expect(await loadOperationalStaffingRoster("missing", date, dep)).toBeNull();
    expect(dep.save).not.toHaveBeenCalled();
    const future = { ...event, date: "2026-12-10", startAt: "2026-12-10T17:00:00-05:00", endAt: "2026-12-10T20:00:00-05:00" };
    dep.readEvents.mockResolvedValue([future]);
    dep.readShifts.mockResolvedValue([]);
    expect(await loadOperationalStaffingRoster(future.eventId, future.date, dep)).not.toBeNull();
    expect(dep.readEvents).toHaveBeenLastCalledWith({ startDate: future.date, endDate: "2026-12-16", shiftStartDate: "2026-12-09" });
    expect(dep.save).not.toHaveBeenCalled();
  });

  it("fails closed without the existing server signing secret, on oversized snapshots, and for invalid dates", async () => {
    const dep = dependencies(persistence(await fresh()));
    await expect(loadOperationalStaffingRoster(event.eventId, date, { ...dep, getSecret: () => null })).rejects.toBeInstanceOf(StaffingReviewError);
    await expect(loadOperationalStaffingRoster(event.eventId, "2026-11-31", dep)).rejects.toBeInstanceOf(StaffingReviewError);
    const huge = dependencies(persistence(await fresh([event], [{ ...shifts[0], notes: "x".repeat(OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH) }])));
    await expect(loadOperationalStaffingRoster(event.eventId, date, huge)).rejects.toBeInstanceOf(StaffingReviewError);
    expect(dep.save).not.toHaveBeenCalled(); expect(huge.save).not.toHaveBeenCalled();
    expect(await loadOperationalStaffingRoster("vip-1", date, dep)).toBeNull();
    expect(await loadOperationalStaffingRoster(event.eventId, "2026-11-23", dep)).toBeNull();
  });

  it("uses randomized authenticated encryption and rejects tampering, other events/dates, secret rotation, and excess size", async () => {
    const dep = dependencies(persistence(await fresh()));
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    const second = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    expect(second.reviewToken).not.toBe(roster.reviewToken);
    const tampered = roster.reviewToken.split(".");
    tampered[3] = `${tampered[3][0] === "A" ? "B" : "A"}${tampered[3].slice(1)}`;
    for (const input of [
      { ...change(roster), reviewToken: tampered.join(".") },
      { ...change(roster), eventId: "other" },
      { ...change(roster), eventDate: "2026-12-01" },
      { ...change(roster), reviewToken: "x".repeat(OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH + 1) },
    ]) await expect(saveOperationalStaffingTeam(input, dep)).rejects.toBeInstanceOf(StaffingReviewError);
    await expect(saveOperationalStaffingTeam(change(roster), { ...dep, getSecret: () => `${secret}-rotated` })).rejects.toBeInstanceOf(StaffingReviewError);
    expect(dep.save).not.toHaveBeenCalled();
  });

  it("expires by the original snapshot observation, never extends freshness, and rejects a new Eastern day", async () => {
    const observed = await fresh();
    const dep = dependencies(persistence(observed), [event], shifts, new Date(now.getTime() + 44 * 60_000));
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    await expect(saveOperationalStaffingTeam(change(roster), { ...dep, now: new Date(now.getTime() + 45 * 60_000 + 1) }))
      .rejects.toBeInstanceOf(StaffingReviewError);
    await expect(saveOperationalStaffingTeam(change(roster), { ...dep, now: new Date(now.getTime() + 43 * 60_000) }))
      .rejects.toBeInstanceOf(StaffingReviewError);
    const late = new Date("2026-11-25T04:59:00Z");
    const overnight = dependencies(persistence(await fresh([event], shifts, late)), [event], shifts, late);
    const lateRoster = (await loadOperationalStaffingRoster(event.eventId, date, overnight))!;
    await expect(saveOperationalStaffingTeam(change(lateRoster), { ...overnight, now: new Date("2026-11-25T05:00:00Z") }))
      .rejects.toBeInstanceOf(StaffingReviewError);
    expect(dep.save).not.toHaveBeenCalled(); expect(overnight.save).not.toHaveBeenCalled();
  });

  it("saves a multi-person explicit team with exactly one CAS write and preserves the observation time", async () => {
    const dep = dependencies();
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    const version = await saveOperationalStaffingTeam(change(roster, shifts.map(({ shiftId }) => ({ shiftId }))), dep);
    expect(version).toBe(1);
    expect(dep.save).toHaveBeenCalledExactlyOnceWith(expect.anything(), 0);
    const saved = await dep.load();
    expect(saved.reconciliation!.assignments).toEqual(shifts.map((shift) => ({ eventId: event.eventId, eventDate: date,
      employeeId: shift.employeeId, employeeName: shift.employeeName, shiftId: shift.shiftId, source: "manual" })));
    expect(saved.manualTeams).toEqual([{ eventId: event.eventId, eventDate: date }]);
    expect(saved.reconciliation!.eventStatuses[event.eventId]).toBe("assigned");
    expect(saved.reconciliation!.lastSuccessfulSyncAt).toBe(now.toISOString());
    expect(dep.readEvents).toHaveBeenCalledOnce(); expect(dep.readShifts).toHaveBeenCalledOnce();
  });

  it("rejects an already superseded review and a race at the single write without overwriting concurrent edits", async () => {
    const dep = dependencies();
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    dep.bump();
    await expect(saveOperationalStaffingTeam(change(roster), dep)).rejects.toBeInstanceOf(StaleSaveError);
    await expect(saveOperationalStaffingTeam({ ...change(roster), expectedVersion: 1 }, dep)).rejects.toBeInstanceOf(StaffingReviewError);
    expect(dep.save).not.toHaveBeenCalled();
    const current = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    const racedSave = vi.fn(async () => { throw new StaleSaveError(); });
    await expect(saveOperationalStaffingTeam(change(current), { ...dep, save: racedSave })).rejects.toBeInstanceOf(StaleSaveError);
    expect(racedSave).toHaveBeenCalledOnce();
    expect((await dep.load()).reconciliation).toBeNull();
  });

  it("does not persist new automatic matches for any other event while saving a target", async () => {
    const other = { ...event, eventId: "morning", startAt: `${date}T10:00:00-05:00`, endAt: `${date}T12:00:00-05:00` };
    const automatic = { ...shifts[0], shiftId: "morning-shift", employeeId: "morning-worker", employeeName: "Morning worker", corporate: true,
      startAt: `${date}T09:00:00-05:00`, endAt: `${date}T13:00:00-05:00` };
    const dep = dependencies(persistence(), [event, other], [...shifts, automatic]);
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    await saveOperationalStaffingTeam(change(roster), dep);
    const saved = await dep.load();
    expect(saved.events).toEqual([event, other]);
    expect(saved.shifts).toEqual([...shifts, automatic]);
    expect(saved.reconciliation!.assignments).toHaveLength(1);
    expect(saved.reconciliation!.assignments[0].eventId).toBe(event.eventId);
    expect(saved.reconciliation!.eventStatuses.morning).toBe("unverified");
    expect(saved.policy).toEqual(emptyStaffingState().policy);
    expect(dep.save).toHaveBeenCalledOnce();
  });

  it("retains other saved assignment rows exactly even when a refreshed calculation would drop them", async () => {
    const saved = await fresh();
    const row: StaffingAssignment = { eventId: "retained", eventDate: date, employeeId: "someone-else", employeeName: "Exact saved name",
      shiftId: "removed-upstream", source: "automatic" };
    saved.reconciliation!.assignments = [row];
    saved.reconciliation!.eventStatuses.retained = "assigned";
    saved.manualTeams = [{ eventId: "manual-other", eventDate: date }];
    saved.suppressedAssignments = [{ eventId: "suppressed-other", eventDate: date, employeeId: "suppressed-employee" }];
    const dep = dependencies(persistence(saved), [event], shifts, new Date(now.getTime() + 46 * 60_000));
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    await saveOperationalStaffingTeam(change(roster), dep);
    const result = await dep.load();
    expect(result.reconciliation!.assignments).toContainEqual(row);
    expect(result.reconciliation!.eventStatuses.retained).toBe("unverified");
    expect(result.manualTeams).toContainEqual(saved.manualTeams[0]);
    expect(result.suppressedAssignments).toContainEqual(saved.suppressedAssignments[0]);
  });

  it("requires explicit move confirmation, removes only that shift's former assignments, and retains suppressions", async () => {
    const other = { ...event, eventId: "other", eventName: "Other event" };
    const initial = await fresh([event, other]);
    const row: StaffingAssignment = { eventId: other.eventId, eventDate: date, employeeId: shifts[0].employeeId,
      employeeName: shifts[0].employeeName, shiftId: shifts[0].shiftId, source: "manual" };
    initial.reconciliation!.assignments = [row];
    initial.manualTeams = [{ eventId: other.eventId, eventDate: date }];
    const dep = dependencies(persistence(initial), [event, other]);
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    expect(roster.shifts.find((shift) => shift.shiftId === shifts[0].shiftId)!.needsMove).toBe(true);
    await expect(saveOperationalStaffingTeam(change(roster), dep)).rejects.toThrow("Confirm moving");
    expect(dep.save).not.toHaveBeenCalled();
    await saveOperationalStaffingTeam({ ...change(roster), choices: [{ shiftId: shifts[0].shiftId, confirmMove: true }] }, dep);
    const saved = await dep.load();
    expect(saved.reconciliation!.assignments).toHaveLength(1);
    expect(saved.reconciliation!.assignments[0]).toMatchObject({ eventId: event.eventId, source: "manual" });
    expect(saved.suppressedAssignments).toContainEqual({ eventId: other.eventId, eventDate: date, employeeId: shifts[0].employeeId });
    expect(saved.manualTeams).toContainEqual({ eventId: other.eventId, eventDate: date });
  });

  it("blocks same-employee overlapping assignments even if a read-only refresh lost their old automatic source", async () => {
    const initial = await fresh();
    initial.reconciliation!.assignments = [{ eventId: "missing-source-event", eventDate: date,
      employeeId: shifts[0].employeeId, employeeName: shifts[0].employeeName, shiftId: "old-shift", source: "automatic" }];
    const dep = dependencies(persistence(initial), [event], shifts, new Date(now.getTime() + 46 * 60_000));
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    expect(roster.shifts.find((shift) => shift.shiftId === shifts[0].shiftId)!.conflict).toBe(true);
    await expect(saveOperationalStaffingTeam(change(roster), dep)).rejects.toThrow("overlaps or could not be verified");
    expect(dep.save).not.toHaveBeenCalled();
  });

  it("validates partial coverage, duplicate employees, and exact-day selection before a write, and supports clearing a manual team", async () => {
    const partial = { ...shifts[0], endAt: `${date}T18:00:00-05:00` };
    const duplicate = { ...shifts[0], shiftId: "second-shift" };
    const otherDay = { ...shifts[1], shiftId: "other-day", startAt: "2026-12-01T16:00:00-05:00", endAt: "2026-12-01T21:00:00-05:00" };
    const dep = dependencies(persistence(), [event], [partial, duplicate, otherDay]);
    const roster = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    await expect(saveOperationalStaffingTeam(change(roster), dep)).rejects.toThrow("does not cover");
    await expect(saveOperationalStaffingTeam(change(roster, [{ shiftId: duplicate.shiftId }, { shiftId: partial.shiftId }]), dep)).rejects.toThrow("only one published shift");
    await expect(saveOperationalStaffingTeam(change(roster, [{ shiftId: otherDay.shiftId }]), dep)).rejects.toThrow("event day");
    expect(dep.save).not.toHaveBeenCalled();
    await saveOperationalStaffingTeam({ ...change(roster), choices: [{ shiftId: partial.shiftId, confirmPartialCoverage: true }] }, dep);
    const next = (await loadOperationalStaffingRoster(event.eventId, date, dep))!;
    expect(next.selectedShiftIds).toEqual([partial.shiftId]);
    await saveOperationalStaffingTeam(change(next, []), dep);
    expect((await dep.load()).reconciliation!.assignments).toEqual([]);
    expect((await dep.load()).manualTeams).toContainEqual({ eventId: event.eventId, eventDate: date });
  });
});
