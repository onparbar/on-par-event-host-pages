import { describe, expect, it, vi } from "vitest";
import { buildEntertainmentSchedule } from "../domain";
import { getEntertainmentDay, requiresTripleseatReconnect, syncEntertainmentDay } from "../sync";
import { MemoryEntertainmentStorage } from "../storage";
import { TRIPLESEAT_RECONNECT_WARNING, type EntertainmentSourceEvent } from "../types";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

vi.mock("@/lib/vip-prep/known-inactive", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/vip-prep/known-inactive")>(),
  knownInactiveVipBookings: async () => ({ ids: new Set<string>(), observations: new Map<string, string>(), warnings: [] }),
}));

const DATE = "2026-11-24";
const noFloorPlan = { get: async () => null };
function source(): EntertainmentSourceEvent {
  return { tripleseatEventId: "redacted-sync-outcome", tripleseatBookingId: null, eventName: "Redacted corporate event", localDate: DATE,
    eventStartAt: `${DATE}T22:00:00Z`, eventEndAt: `${DATE}T23:00:00Z`, status: "DEFINITE", rooms: [],
    items: [{ sourceId: "redacted-line", name: "Bowling Lane 1", description: null, categoryName: "Bowling", quantity: 1, startAt: `${DATE}T22:00:00Z`, endAt: `${DATE}T23:00:00Z` }],
    categoryNames: ["Bowling"], sourceUpdatedAt: "2026-10-27T20:00:00Z", noteCount: 0 };
}
function adapter(error?: string): TripleseatAdapter {
  return { sourceMode: "live", fetchEventsForDate: async () => [], fetchEventDateById: async () => null,
    fetchEntertainmentEventsForDate: async () => { if (error) throw new Error(error); return [source()]; },
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) };
}
function bookings() {
  return { ...structuredClone(vipPrepPayload), from: DATE, to: DATE,
    reservations: [{ ...vipPrepPayload.reservations[0], id: "redacted-real-vip", operatingDate: DATE, eventName: "Redacted VIP", foodPrep: [], extras: [],
      startAt: `${DATE}T22:00:00Z`, endAt: `${DATE}T23:00:00Z` }] };
}
const configuredVip = { configured: true, fetchRange: async () => bookings() };
const noVip = { configured: false, fetchRange: async () => { throw new Error("Not configured"); } };

describe("entertainment provider refresh outcomes", () => {
  it("reports both providers only after their source reads succeed", async () => {
    const fetchRange = vi.fn(configuredVip.fetchRange).mockResolvedValueOnce(bookings()).mockRejectedValue(new Error("Unexpected retry"));
    const day = await syncEntertainmentDay(DATE, { storage: new MemoryEntertainmentStorage(), adapter: adapter(), vipPrepClient: { configured: true, fetchRange }, localEvents: [], floorPlanStorage: noFloorPlan });
    expect(day.sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "success", reconnectTripleseat: false });
    expect(day.sync?.status).toBe("success");
    expect(fetchRange).toHaveBeenCalledOnce();
    expect(day.warnings).not.toContain("VIP Prep could not be refreshed; the last saved VIP schedule remains visible.");
  });

  it("does not call an unconfigured On Par source or claim that it refreshed", async () => {
    const fetchRange = vi.fn(noVip.fetchRange);
    const day = await syncEntertainmentDay(DATE, { storage: new MemoryEntertainmentStorage(), adapter: adapter(), vipPrepClient: { ...noVip, fetchRange }, localEvents: [], floorPlanStorage: noFloorPlan });
    expect(day.sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "not-configured", reconnectTripleseat: false });
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it("reports an On Par failure separately when Tripleseat succeeds", async () => {
    const fetchRange = vi.fn(async () => { throw new Error("Private VIP connection details"); });
    const day = await syncEntertainmentDay(DATE, { storage: new MemoryEntertainmentStorage(), adapter: adapter(), vipPrepClient: { configured: true, fetchRange }, localEvents: [], floorPlanStorage: noFloorPlan });
    expect(day.sourceRefresh).toEqual({ tripleseat: "success", onParBookings: "error", reconnectTripleseat: false });
    expect(JSON.stringify(day)).not.toContain("Private VIP connection details");
    expect(fetchRange).toHaveBeenCalledOnce();
  });

  it("reports partial provider success without changing saved Tripleseat assignments or its last success time", async () => {
    const storage = new MemoryEntertainmentStorage();
    await storage.saveContractEvidence(buildEntertainmentSchedule({ sourceEvents: [source()], localEvents: [] }));
    const before = await storage.getDay(DATE);
    const day = await syncEntertainmentDay(DATE, { storage, adapter: adapter("Tripleseat OAuth refresh was rejected (400). PRIVATE_TOKEN"), vipPrepClient: configuredVip, localEvents: [], floorPlanStorage: noFloorPlan });
    expect(day.sourceRefresh).toEqual({ tripleseat: "error", onParBookings: "success", reconnectTripleseat: true });
    expect(day.sync?.status).toBe("error");
    expect(day.sync?.lastSuccessfulSyncAt).toBe(before.sync?.lastSuccessfulSyncAt ?? null);
    expect(day.warnings).toContain(TRIPLESEAT_RECONNECT_WARNING);
    expect(day.warnings).not.toContain("The latest Tripleseat sync failed. The last saved schedule remains visible.");
    expect(JSON.stringify(day)).not.toContain("PRIVATE_TOKEN");
    const after = await storage.getDay(DATE);
    for (const row of before.reservations) expect(after.reservations).toContainEqual(row);
    for (const row of before.events) expect(after.events).toContainEqual(row);
    const read = await getEntertainmentDay(DATE, { storage, adapter: adapter(), vipPrepClient: noVip, localEvents: [], floorPlanStorage: noFloorPlan, readOnly: true });
    expect(read.warnings).toContain(TRIPLESEAT_RECONNECT_WARNING);
  });

  it("returns the fixed reconnect message on total OAuth failure without exposing upstream text", async () => {
    const storage = new MemoryEntertainmentStorage();
    await expect(syncEntertainmentDay(DATE, { storage, adapter: adapter("Tripleseat OAuth refresh was rejected (401). PRIVATE_TOKEN"), vipPrepClient: noVip, localEvents: [], floorPlanStorage: noFloorPlan }))
      .rejects.toThrow(TRIPLESEAT_RECONNECT_WARNING);
    expect((await storage.getDay(DATE)).sync?.errorSummary).toBe(TRIPLESEAT_RECONNECT_WARNING);
  });

  it.each(["Tripleseat OAuth refresh was rejected (429). Retry later", "Tripleseat OAuth refresh was rejected (500). Upstream unavailable", "Network failure PRIVATE_TOKEN"])("does not prescribe reconnect for unrelated failure: %s", async (error) => {
    expect(requiresTripleseatReconnect(new Error(error))).toBe(false);
    const day = await syncEntertainmentDay(DATE, { storage: new MemoryEntertainmentStorage(), adapter: adapter(error), vipPrepClient: configuredVip, localEvents: [], floorPlanStorage: noFloorPlan });
    expect(day.sourceRefresh).toMatchObject({ tripleseat: "error", onParBookings: "success", reconnectTripleseat: false });
    expect(JSON.stringify(day)).not.toContain("PRIVATE_TOKEN");
  });
});
