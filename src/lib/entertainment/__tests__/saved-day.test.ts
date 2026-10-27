import { afterEach, describe, expect, it, vi } from "vitest";
import { readSavedEntertainmentDay } from "../saved-day";
import { workspaceReservation } from "@/lib/operations/__tests__/workspace-fixtures";
import { buildEntertainmentSchedule } from "../domain";
import { vipPrepEntertainmentEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

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

  it("hides saved manual December placeholders from itineraries and recomputes conflicts without saves", async () => {
    const date = "2026-12-02";
    const source = vipPrepEntertainmentEvents([{ ...structuredClone(vipPrepPayload.reservations[0]), eventName: "Redacted VIP",
      operatingDate: date, foodPrep: [], extras: [], resource: { code: "VIPS", name: "VIP 1" },
      startAt: `${date}T22:00:00Z`, endAt: `${date}T23:00:00Z` }])[0];
    const built = buildEntertainmentSchedule({ sourceEvents: [{ ...source, eventName: "Owner hold VIP" },
      { ...source, tripleseatEventId: "vip-redacted-real", eventName: "Redacted real VIP" }], localEvents: [], now: "2026-10-27T12:00:00Z" });
    const stored = { date, events: built.events, reservations: built.reservations.map((row) => ({ ...row, manualOverride: true })), sync: null };
    const before = structuredClone(stored);
    const storage = { getDay: vi.fn().mockResolvedValue(stored), saveSync: vi.fn(), saveContractEvidence: vi.fn() };
    const result = await readSavedEntertainmentDay(date, storage);
    expect(result.events.map((event) => event.eventName)).toEqual(["Redacted real VIP"]);
    expect(result.reservations).toHaveLength(1); expect(result.conflicts).toEqual([]);
    expect(stored).toEqual(before);
    expect(storage.saveSync).not.toHaveBeenCalled(); expect(storage.saveContractEvidence).not.toHaveBeenCalled();
    expect(mocks.adapter.fetchEvents).not.toHaveBeenCalled();
  });
});
