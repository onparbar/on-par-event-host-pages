import { describe, expect, it, vi } from "vitest";
import type { CorporateStaffShift, StaffingEvent } from "../domain";
import { loadStaffingCards, refreshStaffing, updateStaffingOverride } from "../service";
import { emptyStaffingState, type StaffingState } from "../storage";

vi.mock("server-only", () => ({}));

describe("staffing home-card rehearsal", () => {
  it("resolves the three overlapping parties with the reviewed assignments and publishes only card summaries", async () => {
    const date = "2026-11-13";
    const now = new Date(`${date}T12:00:00-05:00`);
    const at = (time: string, day = date) => `${day}T${time}:00-05:00`;
    const events: StaffingEvent[] = [
      { eventId: "1", eventName: "Party A", date, startAt: at("15:30"), endAt: at("17:30") },
      { eventId: "2", eventName: "Party B", date, startAt: at("17:00"), endAt: at("20:00") },
      { eventId: "3", eventName: "Party C", date, startAt: at("18:00"), endAt: at("20:00") },
    ];
    const shifts: CorporateStaffShift[] = [
      { shiftId: "10", employeeId: "100", employeeName: "Staff A", startAt: at("14:30"), endAt: at("20:30") },
      { shiftId: "20", employeeId: "200", employeeName: "Staff B", startAt: at("17:00"), endAt: at("01:15", "2026-11-14") },
      { shiftId: "30", employeeId: "300", employeeName: "Staff C", startAt: at("17:00"), endAt: at("21:00") },
    ];
    let state = emptyStaffingState();
    const deps = {
      now,
      load: async () => state,
      save: async (next: StaffingState, expectedVersion: number) => {
        expect(expectedVersion).toBe(state.version);
        state = { ...next, version: expectedVersion + 1 };
        return state;
      },
      readEvents: async () => events,
      readShifts: async () => shifts,
    };
    state = await refreshStaffing(deps);
    expect(state.reconciliation?.eventStatuses).toEqual({ "1": "review", "2": "review", "3": "review" });

    for (const [eventId, shiftId] of [["2", "20"], ["3", "30"], ["1", "10"]]) {
      state = await updateStaffingOverride({ action: "assign", eventId, shiftId, expectedVersion: state.version }, deps);
    }
    expect(await loadStaffingCards(events, { ...deps, allowAdminPreview: true })).toEqual({
      [`${events[0].date}:1`]: { status: "assigned", names: ["Staff A"] },
      [`${events[1].date}:2`]: { status: "assigned", names: ["Staff B"] },
      [`${events[2].date}:3`]: { status: "assigned", names: ["Staff C"] },
    });
  });
});
