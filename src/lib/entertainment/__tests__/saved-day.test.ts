import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedEntertainmentDay } from "../saved-day";
import { workspaceReservation } from "@/lib/operations/__tests__/workspace-fixtures";

const mocks = vi.hoisted(() => ({ adapter: { sourceMode: "live", fetchEvents: vi.fn() } }));
vi.mock("@/lib/kitchen/tripleseat", () => ({ getTripleseatAdapter: () => mocks.adapter }));
afterEach(() => vi.clearAllMocks());
describe("read-only saved itinerary schedule", () => {
  it("reads saved reservations and derives conflicts without sync/save/network/release", async () => {
    const reservations = [workspaceReservation(), workspaceReservation({ id: "other-event", localEventId: "99", tripleseatEventId: "99" })];
    const storage = { getDay: vi.fn().mockResolvedValue({ date: "2026-10-23", events: [], reservations, sync: null }), saveSync: vi.fn(), startSync: vi.fn(), saveEventSnapshot: vi.fn() };
    const result = await readSavedEntertainmentDay("2026-10-23", storage);
    expect(storage.getDay).toHaveBeenCalledExactlyOnceWith("2026-10-23");
    expect(result.reservations).toEqual(reservations);
    expect(result.conflicts).toHaveLength(1);
    expect(result).toMatchObject({ sourceMode: "live", canEdit: false, missingEnvironmentVariables: [] });
    expect(storage.saveSync).not.toHaveBeenCalled();
    expect(storage.startSync).not.toHaveBeenCalled();
    expect(storage.saveEventSnapshot).not.toHaveBeenCalled();
    expect(mocks.adapter.fetchEvents).not.toHaveBeenCalled();
  });
  it("preserves last saved schedule and reports failed sync without retrying it", async () => {
    const storage = { getDay: vi.fn().mockResolvedValue({ date: "2026-10-23", events: [], reservations: [], sync: { status: "error" } }) };
    const result = await readSavedEntertainmentDay("2026-10-23", storage);
    expect(result.warnings).toEqual(["The latest entertainment sync failed. This is the last saved schedule."]);
    expect(mocks.adapter.fetchEvents).not.toHaveBeenCalled();
  });
});
