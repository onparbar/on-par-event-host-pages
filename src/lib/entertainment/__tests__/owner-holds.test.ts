import { describe, expect, it, vi } from "vitest";
import { buildEntertainmentSchedule } from "../domain";
import { getEntertainmentDay, syncEntertainmentDay } from "../sync";
import { MemoryEntertainmentStorage } from "../storage";
import type { EntertainmentSourceEvent } from "../types";
import type { TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { vipPrepEntertainmentEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

vi.mock("@/lib/vip-prep/known-inactive", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/vip-prep/known-inactive")>(),
  knownInactiveVipBookings: async () => ({ ids: new Set<string>(), observations: new Map<string, string>(), warnings: [] }),
}));

const DATE = "2026-12-02";
function booking(eventName = "Owner hold VIP") {
  return { ...structuredClone(vipPrepPayload.reservations[0]), operatingDate: DATE, eventName, partySize: 1,
    resource: { code: "VIPS" as const, name: "VIP 1" }, foodPrep: [], extras: [], linkedTripleseatEventIds: [],
    startAt: `${DATE}T22:00:00Z`, endAt: "2026-12-03T00:00:00Z" };
}
function payload(reservations = [booking()]) {
  return { ...structuredClone(vipPrepPayload), from: DATE, to: DATE, reservations, reservationCount: reservations.length };
}
function legacySource(eventName = "Owner hold VIP"): EntertainmentSourceEvent {
  return { ...vipPrepEntertainmentEvents([booking("Redacted VIP")])[0], eventName };
}
function adapter(events: EntertainmentSourceEvent[] = []): TripleseatAdapter {
  return { sourceMode: "live", fetchEventsForDate: async () => [], fetchEntertainmentEventsForDate: async () => structuredClone(events),
    fetchEventDateById: async () => null, getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }) };
}
const noFloorPlan = { get: async () => null };
const unavailable = { configured: false, fetchRange: async () => { throw new Error("Source unavailable"); } };
async function cached(source = legacySource(), manualOverride = false) {
  const storage = new MemoryEntertainmentStorage();
  const built = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
  built.reservations = built.reservations.map((row) => ({ ...row, manualOverride }));
  await storage.saveContractEvidence(built);
  return storage;
}

describe("December owner holds in entertainment planning", () => {
  it.each(["Owner hold VIP", "VIP unavailable", "VIP unavailable VIP"])("ignores exact cached %s during an outage without writing source history", async (name) => {
    for (const configured of [false, true]) {
      const storage = await cached(legacySource(name));
      const before = await storage.getDay(DATE);
      const day = await getEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [], vipPrepClient: { ...unavailable, configured }, floorPlanStorage: noFloorPlan, readOnly: true });
      expect(day.events).toEqual([]); expect(day.reservations).toEqual([]); expect(day.conflicts).toEqual([]);
      expect(await storage.getDay(DATE)).toEqual(before);
    }
  });

  it("keeps real same-size VIPs, similar names and explicit manual hold overrides", async () => {
    for (const name of ["Redacted customer VIP", "Owner hold VIP party", "VIP unavailable guest party"]) {
      const storage = await cached(legacySource(name));
      const day = await getEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [], vipPrepClient: unavailable, floorPlanStorage: noFloorPlan, readOnly: true });
      expect(day.events).toHaveLength(1); expect(day.reservations).toHaveLength(1);
    }
    const storage = await cached(legacySource(), true);
    const before = await storage.getDay(DATE);
    const day = await getEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload() }, floorPlanStorage: noFloorPlan, readOnly: true });
    expect(day.events).toHaveLength(1); expect(day.reservations).toHaveLength(1);
    expect(day.reservations[0]).toMatchObject({ active: true, manualOverride: true });
    expect(await storage.getDay(DATE)).toEqual(before);
  });

  it("preserves linked corporate and purchase evidence in cached snapshots", async () => {
    for (const source of [
      { ...legacySource(), linkedTripleseatEventIds: ["corporate-source"] },
      { ...legacySource(), vipFoodCount: 1 }, { ...legacySource(), vipExtraCount: 1 },
    ]) {
      const day = await getEntertainmentDay(DATE, { storage: await cached(source), adapter: adapter(), localEvents: [], vipPrepClient: unavailable, floorPlanStorage: noFloorPlan, readOnly: true });
      expect(day.events).toHaveLength(1); expect(day.reservations).toHaveLength(1);
    }
  });

  it("allocates the corporate VIP while preserving ignored cached holds unchanged", async () => {
    const storage = await cached();
    const before = await storage.getDay(DATE);
    const corporate = { ...legacySource("Redacted corporate event"), tripleseatEventId: "corporate-source", sourceSystem: "tripleseat" as const };
    const day = await syncEntertainmentDay(DATE, { storage, adapter: adapter([corporate]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload() }, floorPlanStorage: noFloorPlan });
    expect(day.events).toHaveLength(1); expect(day.events[0].tripleseatEventId).toBe("corporate-source");
    expect(day.reservations).toHaveLength(1); expect(day.conflicts).toEqual([]);
    const after = await storage.getDay(DATE);
    expect(after.events.find((row) => row.eventId === before.events[0].eventId)).toEqual(before.events[0]);
    expect(after.reservations.find((row) => row.id === before.reservations[0].id)).toEqual(before.reservations[0]);
    expect(await storage.getAudit(before.reservations[0].id)).toEqual([]);
  });

  it("uses new genuine booking evidence instead of an old cached hold classification", async () => {
    const storage = await cached();
    const day = await getEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload([booking("Redacted real VIP")]) }, floorPlanStorage: noFloorPlan, readOnly: true });
    expect(day.events).toHaveLength(1); expect(day.events[0].eventName).toBe("Redacted real VIP");
    expect(day.reservations).toHaveLength(1);
  });

  it("keeps real customer VIP conflicts visible instead of freeing every VIP block", async () => {
    const corporate = { ...legacySource("Redacted corporate event"), tripleseatEventId: "corporate-source", sourceSystem: "tripleseat" as const };
    const real = { ...booking("Redacted customer VIP"), id: "real-customer-reservation" };
    const day = await syncEntertainmentDay(DATE, { storage: await cached(), adapter: adapter([corporate]), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload([booking(), real]) }, floorPlanStorage: noFloorPlan });
    expect(day.events).toHaveLength(2); expect(day.reservations).toHaveLength(2);
    expect(day.reservations.some((row) => row.eventName === "Redacted customer VIP")).toBe(true);
    expect(day.conflicts).toHaveLength(1);
  });

  it("retains a manual override once the same source ID becomes a genuine booking, without duplicates", async () => {
    const storage = await cached(legacySource(), true);
    const day = await getEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload([booking("Redacted real VIP")]) }, floorPlanStorage: noFloorPlan, readOnly: true });
    expect(day.events).toHaveLength(1); expect(day.events[0].eventName).toBe("Redacted real VIP");
    expect(day.reservations).toHaveLength(1); expect(day.reservations[0]).toMatchObject({ eventName: "Redacted real VIP", manualOverride: true, active: true });
  });

  it("leaves manual hold overrides and their history unchanged during sync", async () => {
    const storage = await cached(legacySource(), true);
    const before = await storage.getDay(DATE);
    const day = await syncEntertainmentDay(DATE, { storage, adapter: adapter(), localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload() }, floorPlanStorage: noFloorPlan });
    expect(day.reservations).toEqual(before.reservations);
    expect((await storage.getDay(DATE)).events).toEqual(before.events);
    expect(await storage.getAudit(before.reservations[0].id)).toEqual([]);
  });

  it("preserves cached source history when only OnPar can refresh", async () => {
    const storage = await cached();
    const before = await storage.getDay(DATE);
    const failed = { ...adapter(), fetchEntertainmentEventsForDate: async () => { throw new Error("Tripleseat unavailable"); } };
    const day = await syncEntertainmentDay(DATE, { storage, adapter: failed, localEvents: [],
      vipPrepClient: { configured: true, fetchRange: async () => payload() }, floorPlanStorage: noFloorPlan });
    expect(day.events).toEqual([]); expect(day.reservations).toEqual([]);
    const after = await storage.getDay(DATE);
    expect(after.events).toEqual(before.events); expect(after.reservations).toEqual(before.reservations);
    expect(await storage.getAudit(before.reservations[0].id)).toEqual([]);
  });
});
