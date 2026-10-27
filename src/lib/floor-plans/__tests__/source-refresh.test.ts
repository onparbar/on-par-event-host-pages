import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { eventSync, scheduleSync, entertainmentRead } = vi.hoisted(() => ({ eventSync: vi.fn(), scheduleSync: vi.fn(), entertainmentRead: vi.fn() }));
vi.mock("@/lib/event-plans/sync", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/event-plans/sync")>(), syncEventPlanWindow: eventSync }));
vi.mock("@/lib/entertainment/sync", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/entertainment/sync")>(), syncEntertainmentDay: scheduleSync, getEntertainmentDay: entertainmentRead }));
import { TRIPLESEAT_RECONNECT_WARNING, type EntertainmentDayPayload, type SourceRefreshResult } from "@/lib/entertainment/types";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { VipPrepClient } from "@/lib/vip-prep/client";
import { refreshFloorPlanSources } from "../service";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument } from "../types";

const DATE = "2026-11-24";
const PREVIOUS_SYNC = "2026-10-27T19:00:00Z";
function document(): FloorPlanDocument {
  return { id: `floor-plan-${DATE}`, eventDate: DATE, status: "Needs Review", version: 0, ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: PREVIOUS_SYNC, createdAt: PREVIOUS_SYNC, updatedAt: PREVIOUS_SYNC, approvedAt: null, approvedBy: null,
    events: [{ id: "floor-plan-event-94000001", floorPlanId: `floor-plan-${DATE}`, tripleseatEventId: "94000001", name: "Redacted sync outcome", status: "DEFINITE", guestCount: 10,
      startAt: `${DATE}T22:00:00Z`, endAt: `${DATE}T23:00:00Z`, contractedAreaIds: ["main-dining"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: PREVIOUS_SYNC, fullBuyout: false,
      source: { rooms: ["Main Dining"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } }],
    reservations: [{ id: "staff-seat", floorPlanEventId: "floor-plan-event-94000001", areaId: "main-rect-left-1", reservationType: "seating",
      startAt: `${DATE}T22:00:00Z`, endAt: `${DATE}T23:00:00Z`, label: "Staff saved seating", source: "manual", lockedByUser: true, timingSource: "event-default" }] };
}
function schedule(sourceRefresh?: SourceRefreshResult): EntertainmentDayPayload {
  return { date: DATE, events: [], reservations: [], conflicts: [], sync: null, sourceMode: "live", warnings: [], missingEnvironmentVariables: [], canEdit: true,
    ...(sourceRefresh ? { sourceRefresh } : {}) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const sources = createMemoryEventPlanStorage(); setEventPlanStorageForTests(sources);
  setKitchenStorageForTests(createMemoryKitchenStorage());
  vi.spyOn(VipPrepClient.prototype, "configured", "get").mockReturnValue(false);
  await sources.replaceWindow({ startDate: DATE, endDate: DATE }, [{ eventId: "94000001", eventDate: DATE, plan: {}, sourceUpdatedAt: PREVIOUS_SYNC,
    sourceSnapshot: { eventId: "94000001", bookingId: "redacted-booking", eventName: "Redacted sync outcome", localDate: DATE, eventStartAt: `${DATE}T22:00:00Z`, eventEndAt: `${DATE}T23:00:00Z`, guestCount: 10,
      status: "DEFINITE", rooms: ["Main Dining"], selections: [], documentItems: [], operationalNotes: [], sourceUpdatedAt: PREVIOUS_SYNC } }]);
  eventSync.mockResolvedValue({});
  scheduleSync.mockResolvedValue(schedule({ tripleseat: "success", onParBookings: "not-configured", reconnectTripleseat: false }));
  entertainmentRead.mockResolvedValue(schedule());
});
afterEach(() => { vi.restoreAllMocks(); setEventPlanStorageForTests(null); setKitchenStorageForTests(null); });

async function refresh() {
  const storage = new MemoryFloorPlanStorage(); const before = await storage.save(document(), "Seed staff work.");
  const payload = await refreshFloorPlanSources(DATE, storage, before.version);
  expect(payload.plan.reservations).toContainEqual(before.reservations[0]);
  return payload;
}

describe("floor-plan provider refresh result", () => {
  it("reports success only when event-plan and entertainment Tripleseat reads both succeeded", async () => {
    scheduleSync.mockResolvedValue(schedule({ tripleseat: "success", onParBookings: "success", reconnectTripleseat: false }));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "success", reconnectTripleseat: false });
    expect(Date.parse(payload.plan.lastTripleseatSyncAt!)).toBeGreaterThan(Date.parse(PREVIOUS_SYNC));
  });

  it("reports an On Par-only refresh and preserves the previous Tripleseat success timestamp", async () => {
    eventSync.mockRejectedValue(new Error("Tripleseat OAuth refresh was rejected (400). PRIVATE_TOKEN"));
    scheduleSync.mockResolvedValue({ ...schedule({ tripleseat: "error", onParBookings: "success", reconnectTripleseat: true }), warnings: [TRIPLESEAT_RECONNECT_WARNING] });
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "error", onParBookings: "success", reconnectTripleseat: true });
    expect(payload.plan.lastTripleseatSyncAt).toBe(PREVIOUS_SYNC);
    expect(payload.warnings.filter((message) => message === TRIPLESEAT_RECONNECT_WARNING)).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_TOKEN");
  });

  it("keeps partial Tripleseat status when the event source succeeds but entertainment fails", async () => {
    scheduleSync.mockResolvedValue(schedule({ tripleseat: "error", onParBookings: "success", reconnectTripleseat: true }));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "partial", onParBookings: "success", reconnectTripleseat: true });
    expect(Date.parse(payload.plan.lastTripleseatSyncAt!)).toBeGreaterThan(Date.parse(PREVIOUS_SYNC));
  });

  it("keeps partial Tripleseat status when entertainment succeeds but the event source fails", async () => {
    eventSync.mockRejectedValue(new Error("Network unavailable"));
    scheduleSync.mockResolvedValue(schedule({ tripleseat: "success", onParBookings: "success", reconnectTripleseat: false }));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "partial", onParBookings: "success", reconnectTripleseat: false });
    expect(payload.plan.lastTripleseatSyncAt).toBe(PREVIOUS_SYNC);
  });

  it("does not keep prescribing reconnect when the later entertainment Tripleseat read proves authorization recovered", async () => {
    eventSync.mockRejectedValue(new Error("Tripleseat OAuth refresh was rejected (400). PRIVATE_TOKEN"));
    scheduleSync.mockResolvedValue(schedule({ tripleseat: "success", onParBookings: "success", reconnectTripleseat: false }));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "partial", onParBookings: "success", reconnectTripleseat: false });
    expect(payload.plan.lastTripleseatSyncAt).toBe(PREVIOUS_SYNC);
    expect(payload.warnings).not.toContain(TRIPLESEAT_RECONNECT_WARNING);
    expect(payload.warnings).toContain("Tripleseat event details did not refresh; saved event details were retained.");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_TOKEN");
  });

  it("distinguishes a failed On Par refresh from successful Tripleseat sources", async () => {
    scheduleSync.mockResolvedValue(schedule({ tripleseat: "success", onParBookings: "error", reconnectTripleseat: false }));
    expect((await refresh()).sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "error", reconnectTripleseat: false });
  });

  it("reports both-source failure and a fixed reconnect instruction, never an upstream error tail", async () => {
    eventSync.mockRejectedValue(new Error("Tripleseat OAuth refresh was rejected (401). PRIVATE_TOKEN"));
    scheduleSync.mockRejectedValue(new Error(TRIPLESEAT_RECONNECT_WARNING));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "error", onParBookings: "not-configured", reconnectTripleseat: true });
    expect(payload.plan.lastTripleseatSyncAt).toBe(PREVIOUS_SYNC);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_TOKEN");
  });

  it("does not report a configured but unavailable On Par source as refreshed when both provider syncs fail", async () => {
    vi.spyOn(VipPrepClient.prototype, "configured", "get").mockReturnValue(true);
    vi.spyOn(VipPrepClient.prototype, "fetchRange").mockRejectedValue(new Error("Private booking-source failure"));
    eventSync.mockRejectedValue(new Error("Network failure"));
    scheduleSync.mockRejectedValue(new Error("Network failure"));
    const payload = await refresh();
    expect(payload.sourceRefresh).toEqual({ tripleseat: "error", onParBookings: "error", reconnectTripleseat: false });
    expect(payload.plan.lastTripleseatSyncAt).toBe(PREVIOUS_SYNC);
    expect(JSON.stringify(payload)).not.toContain("Private booking-source failure");
  });

  it("does not infer entertainment refresh success from a legacy or cached HTTP200-shaped payload", async () => {
    scheduleSync.mockResolvedValue(schedule());
    expect((await refresh()).sourceRefresh?.tripleseat).toBe("partial");
  });

  it("reports the same explicit provider results when no active events remain", async () => {
    setEventPlanStorageForTests(createMemoryEventPlanStorage());
    const payload = await refreshFloorPlanSources(DATE, new MemoryFloorPlanStorage());
    expect(payload.plan.events).toEqual([]);
    expect(payload.sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "not-configured", reconnectTripleseat: false });
  });
});
