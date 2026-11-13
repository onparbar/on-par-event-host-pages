import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { MemoryFloorPlanStorage } from "../storage";
import { prepareFloorPlanDraftWindow } from "../draft-planning";
import { prepareDecemberFloorPlanDrafts } from "../planning-month";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument } from "../types";
import { summarizeEventSeating } from "../seating-summary";

vi.mock("server-only", () => ({}));
const window = { startDate: "2026-12-01", endDate: "2026-12-31" };
const currentWindow = { startDate: "2026-10-27", endDate: "2026-11-27" };
function source(date = "2026-12-05", id = "93000001") {
  return { eventId: id, bookingId: `booking-${id}`, eventName: "Redacted December source", localDate: date,
    eventStartAt: `${date}T22:30:00Z`, eventEndAt: `${date}T23:30:00Z`, guestCount: 10, status: "DEFINITE", rooms: ["Main Dining"],
    selections: [], documentItems: [], operationalNotes: [], sourceUpdatedAt: "2026-10-27T14:00:00Z" };
}
function adapter(): TripleseatAdapter {
  return { sourceMode: "live", fetchEventPlansForRange: vi.fn(async () => [source()]), fetchEventsForDate: vi.fn(async () => []),
    fetchEntertainmentEventsForDate: vi.fn(async () => []), fetchEventDateById: async () => null,
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) };
}
async function setup() {
  const eventPlanStorage = createMemoryEventPlanStorage();
  const old = source("2026-10-27", "92000001");
  await eventPlanStorage.replaceWindow(currentWindow, [{ eventId: old.eventId, eventDate: old.localDate, sourceSnapshot: old, plan: { name: "Current event unchanged" }, sourceUpdatedAt: old.sourceUpdatedAt }]);
  await eventPlanStorage.start(currentWindow); await eventPlanStorage.finish(1);
  setEventPlanStorageForTests(eventPlanStorage);
  const entertainment = createMemoryEntertainmentStorage(); setEntertainmentStorageForTests(entertainment);
  const sourceAdapter = adapter(); setTripleseatAdapterForTests(sourceAdapter);
  return { adapter: sourceAdapter, eventPlanStorage, floorPlanStorage: new MemoryFloorPlanStorage(), vipPrepClient: { configured: false, fetchRange: vi.fn() }, entertainment };
}
afterEach(() => { setEventPlanStorageForTests(null); setEntertainmentStorageForTests(null); setTripleseatAdapterForTests(null); });

describe("December server-side planning orchestration", () => {
  it("imports only December after a successful source fetch while preserving rolling sync metadata and existing assignments", async () => {
    const deps = await setup();
    deps.adapter.fetchEventPlansForRange = vi.fn(async () => [source(), source("2026-12-12", "93000002")]);
    const metadata = await deps.eventPlanStorage.getSyncState();
    const previous = await deps.eventPlanStorage.findById("92000001");
    const start = vi.spyOn(deps.eventPlanStorage, "start"), finish = vi.spyOn(deps.eventPlanStorage, "finish"), fail = vi.spyOn(deps.eventPlanStorage, "fail");
    const replace = vi.spyOn(deps.eventPlanStorage, "replaceWindow");
    const existing: FloorPlanDocument = { id: "floor-plan-2026-12-05", eventDate: "2026-12-05", status: "Approved", version: 0, ruleVersion: FLOOR_PLAN_RULE_VERSION,
      lastTripleseatSyncAt: null, createdAt: "2026-10-26T15:00:00Z", updatedAt: "2026-10-26T15:00:00Z", approvedAt: "2026-10-26T15:00:00Z", approvedBy: "Staff", events: [], reservations: [] };
    const saved = await deps.floorPlanStorage.save(existing, "Existing approved staff plan");
    const entertainmentBefore = await deps.entertainment.getDay("2026-12-05");
    const saveEvidence = vi.spyOn(deps.entertainment, "saveContractEvidence");
    const result = await prepareDecemberFloorPlanDrafts(deps);
    expect(result.month).toBe("2026-12"); expect(result.results).toHaveLength(31);
    expect(deps.adapter.fetchEventPlansForRange).toHaveBeenCalledExactlyOnceWith("2026-12-01", "2026-12-31");
    expect(replace).toHaveBeenCalledOnce(); expect(replace.mock.calls[0][0]).toEqual(window);
    expect(await deps.eventPlanStorage.plansForWindow(window)).toHaveLength(2);
    expect(await deps.eventPlanStorage.findById("92000001")).toEqual(previous);
    expect(await deps.eventPlanStorage.getSyncState()).toEqual(metadata);
    expect(start).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
    expect(await deps.floorPlanStorage.get("2026-12-05")).toEqual(saved);
    expect(result.results.find((entry) => entry.date === "2026-12-12")?.status).toBe("created");
    const created = (await deps.floorPlanStorage.get("2026-12-12"))!;
    expect(created.version).toBe(1); expect(created.approvedAt).toBeNull(); expect(created.approvedBy).toBeNull();
    expect(created.reservations.length).toBeGreaterThan(0);
    expect(await deps.entertainment.getDay("2026-12-05")).toEqual(entertainmentBefore); expect(saveEvidence).not.toHaveBeenCalled();
    expect(deps.adapter.fetchEntertainmentEventsForDate).not.toHaveBeenCalled();
  });

  it("performs no durable source or floor-plan write after an upstream failure", async () => {
    const deps = await setup(); const before = await deps.eventPlanStorage.getSyncState();
    deps.adapter.fetchEventPlansForRange = vi.fn(async () => { throw new Error("Private upstream diagnostic"); });
    const replace = vi.spyOn(deps.eventPlanStorage, "replaceWindow"), save = vi.spyOn(deps.floorPlanStorage, "save");
    await expect(prepareDecemberFloorPlanDrafts(deps)).rejects.toThrow("Private upstream diagnostic");
    expect(replace).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(await deps.eventPlanStorage.getSyncState()).toEqual(before);
  });

  it("returns date/status aggregates without leaking source names or private per-date diagnostics", async () => {
    const deps = await setup();
    const prepareDrafts = vi.fn<typeof prepareFloorPlanDraftWindow>().mockResolvedValue({ ...window, results: [
      { date: "2026-12-05", status: "created", eventCount: 1, planStatus: "Draft" },
      { date: "2026-12-06", status: "error", eventCount: 0, message: "PRIVATE_TOKEN and guest contact" },
    ] });
    const result = await prepareDecemberFloorPlanDrafts({ ...deps, prepareDrafts });
    expect(prepareDrafts).toHaveBeenCalledExactlyOnceWith(window.startDate, window.endDate, deps.floorPlanStorage, { vipPrepClient: deps.vipPrepClient });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TOKEN|guest contact|Redacted December source/);
    expect(result.results[1]).toMatchObject({ date: "2026-12-06", status: "error", eventCount: 0 });
  });

  it("opts in to existing-draft repair using only the IDs from the freshly loaded December contracts", async () => {
    const deps = await setup();
    const prepareDrafts = vi.fn<typeof prepareFloorPlanDraftWindow>().mockResolvedValue({ ...window, results: [
      { date: "2026-12-05", status: "updated", eventCount: 2, needsSeatingReview: true },
    ] });
    const result = await prepareDecemberFloorPlanDrafts({ ...deps, prepareDrafts, fillMissingSeating: true });
    expect(prepareDrafts).toHaveBeenCalledExactlyOnceWith(window.startDate, window.endDate, deps.floorPlanStorage, {
      vipPrepClient: deps.vipPrepClient, fillMissingSeating: true, refreshedTripleseatEventDates: new Map([["93000001", "2026-12-05"]]),
    });
    expect(result.results[0]).toMatchObject({ status: "updated", needsSeatingReview: true });
  });

  it("adds a newly synced 90-guest booking to an already prepared date without replacing its first party", async () => {
    const deps = await setup();
    const date = "2026-12-08";
    const first = { ...source(date), rooms: ["VIP 1"] };
    const second = { ...source(date, "93000002"), eventName: "Redacted large December event", guestCount: 90 };
    deps.adapter.fetchEventPlansForRange = vi.fn(async () => [first]);
    await prepareDecemberFloorPlanDrafts(deps);
    const original = (await deps.floorPlanStorage.get(date))!;
    expect(original.events).toHaveLength(1);
    const sharedBefore = await deps.entertainment.getDay(date);
    deps.adapter.fetchEventPlansForRange = vi.fn(async () => [first, second]);

    const result = await prepareDecemberFloorPlanDrafts({ ...deps, fillMissingSeating: true });
    expect(result.results.find((entry) => entry.date === date)).toMatchObject({ status: "updated", eventCount: 2 });
    const repaired = (await deps.floorPlanStorage.get(date))!;
    expect(repaired.events[0]).toEqual(original.events[0]);
    expect(repaired.reservations.filter((row) => row.floorPlanEventId === original.events[0].id)).toEqual(original.reservations);
    expect(summarizeEventSeating(repaired.events[1], repaired.reservations)).toMatchObject({ fullEventCoverage: true, coveredCapacity: 90, foodAssigned: 1 });
    expect(await deps.entertainment.getDay(date)).toEqual(sharedBefore);
    expect(repaired.approvedAt).toBeNull();
  });
});
