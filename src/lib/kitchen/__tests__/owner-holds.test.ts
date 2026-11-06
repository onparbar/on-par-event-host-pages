import { describe, expect, it, vi } from "vitest";
import { createMemoryKitchenStorage } from "../storage";
import { generateKitchenChecklist } from "../rules";
import { getKitchenDay, getKitchenEventChecklist, updateKitchenEventFoodAddOns } from "../sync";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { VipPrepReservation } from "@/lib/vip-prep/types";

const DATE = "2026-12-02";
function booking(eventName = "Owner hold VIP", operatingDate = DATE): VipPrepReservation {
  return { ...structuredClone(vipPrepPayload.reservations[0]), eventName, operatingDate,
    foodPrep: [], extras: [], linkedTripleseatEventIds: [],
    startAt: `${operatingDate}T20:00:00Z`, endAt: `${operatingDate}T22:00:00Z` };
}
function legacySource(reservation: VipPrepReservation) {
  return { ...vipPrepKitchenEvents([{ ...reservation, eventName: "Redacted customer" }])[0],
    eventName: reservation.eventName, vipBooking: reservation };
}
const adapter = {
  sourceMode: "live" as const,
  fetchEventsForDate: async () => [],
  fetchEventDateById: async () => null,
  getDiagnostics: () => ({ sourceMode: "live" as const, missingEnvironmentVariables: [], warnings: [], locationId: "redacted" }),
};
const floorPlanStorage = { get: async () => null };
const unavailable = { configured: true, fetchRange: async () => { throw new Error("Offline"); } };
async function seeded(reservation = booking()) {
  const storage = createMemoryKitchenStorage();
  const sourceEvent = legacySource(reservation);
  await storage.saveEvent({ sourceEvent, checklist: generateKitchenChecklist(sourceEvent) });
  return storage;
}

describe("December internal VIP holds in Kitchen", () => {
  it.each(["Owner hold VIP", "VIP unavailable", " VIP   unavailable VIP "])("hides cached %s without erasing source history", async (name) => {
    const storage = await seeded(booking(name));
    const before = await storage.getDay(DATE);
    const day = await getKitchenDay(DATE, { storage, adapter, vipPrepClient: unavailable, floorPlanStorage, persistSourceChanges: false });
    expect(day.events).toEqual([]);
    expect(day.archivedEventCount).toBe(0);
    expect(await storage.getDay(DATE)).toEqual(before);
  });

  it("keeps hidden active source IDs during a successful refresh instead of recording false absence", async () => {
    const reservation = booking();
    const storage = await seeded(reservation);
    const before = await storage.getDay(DATE);
    const save = vi.spyOn(storage, "saveEvent");
    const day = await getKitchenDay(DATE, { storage, adapter, floorPlanStorage,
      vipPrepClient: { configured: true, fetchRange: async () => ({ ...vipPrepPayload, reservations: [reservation] }) } });
    expect(day.events).toEqual([]);
    expect(day.vipBookingSync?.reservationCount).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(await storage.getDay(DATE)).toEqual(before);
  });

  it("does not initialize new placeholder checklists", async () => {
    const storage = createMemoryKitchenStorage();
    await getKitchenDay(DATE, { storage, adapter, floorPlanStorage,
      vipPrepClient: { configured: true, fetchRange: async () => ({ ...vipPrepPayload, reservations: [booking()] }) } });
    expect((await storage.getDay(DATE)).events).toEqual([]);
  });

  it("rejects a hidden direct checklist/add-on request before saving", async () => {
    const storage = await seeded();
    const save = vi.spyOn(storage, "saveFoodAddOns");
    await expect(getKitchenEventChecklist("vip-reservation-uuid", { storage })).rejects.toThrow("not found");
    await expect(updateKitchenEventFoodAddOns("vip-reservation-uuid", {}, { storage })).rejects.toThrow("not found");
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves other months, similar customer names, purchases and corporate links", async () => {
    for (const reservation of [booking("Owner hold VIP", "2026-11-30"), booking("Owner hold VIP", "2027-01-01"),
      booking("Owner hold VIP", "2027-12-02"), booking("Owner hold VIP party"),
      { ...booking(), foodPrep: structuredClone(vipPrepPayload.reservations[0].foodPrep) },
      { ...booking(), extras: ["Purchased extra"] }, { ...booking(), linkedTripleseatEventIds: ["corporate-source"] },
    ]) {
      const storage = await seeded(reservation);
      const day = await getKitchenDay(reservation.operatingDate, { storage, adapter, floorPlanStorage, vipPrepClient: unavailable, persistSourceChanges: false });
      expect(day.events).toHaveLength(1);
      await expect(getKitchenEventChecklist("vip-reservation-uuid", { storage })).resolves.toBeTruthy();
    }
  });
});
