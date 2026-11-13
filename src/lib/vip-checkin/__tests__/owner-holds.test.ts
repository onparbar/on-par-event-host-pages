import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { VipPrepReservation } from "@/lib/vip-prep/types";

vi.mock("server-only", () => ({}));

const { confirmVipArrival, listVipCheckinDay } = await import("../service");

function booking(changes: Partial<VipPrepReservation> = {}): VipPrepReservation {
  return {
    ...vipPrepPayload.reservations[0], id: "internal-hold", eventName: "VIP Unavailable",
    operatingDate: "2026-12-01", startAt: "2026-12-01T20:00:00Z", endAt: "2026-12-01T22:00:00Z",
    foodPrep: [], extras: [], ...changes,
  };
}

function options(reservations: VipPrepReservation[]) {
  return {
    client: { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations }) },
    storage: {
      listVipCheckinsForDate: vi.fn().mockResolvedValue([]),
      getVipCheckin: vi.fn(), confirmVipCheckin: vi.fn(),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 0, status: "NO_FOOD" }),
      listVipInitialFoodDispatches: vi.fn(), markVipInitialFoodReleaseFailed: vi.fn(),
    },
    kitchenStorage: { getDay: vi.fn().mockResolvedValue({ events: [] }) },
    synchronizeFood: vi.fn(), dispatch: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2028-01-02T17:00:00Z");
});
afterEach(() => vi.useRealTimers());

describe("December-only internal VIP holds at check-in", () => {
  it.each([
    ["VIP Unavailable", "2026-12-01"],
    [" Owner   hold VIP ", "2026-12-31"],
    ["vip unavailable vip", "2026-12-15"],
  ])("hides %s on %s before reading its saved food release", async (eventName, operatingDate) => {
    const reservation = booking({ eventName, operatingDate });
    const before = JSON.stringify(reservation);
    const dependencies = options([reservation]);
    dependencies.storage.listVipCheckinsForDate.mockResolvedValue([{ reservation_id: reservation.id }]);
    const result = await listVipCheckinDay(operatingDate, dependencies as never);
    expect(result.reservations).toEqual([]);
    expect(dependencies.storage.getVipInitialFoodRelease).not.toHaveBeenCalled();
    expect(dependencies.storage.listVipInitialFoodDispatches).not.toHaveBeenCalled();
    expect(dependencies.storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(dependencies.synchronizeFood).not.toHaveBeenCalled();
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(reservation)).toBe(before);
  });

  it("also hides a saved hold when the booking source is unavailable", async () => {
    const hold = booking();
    const guest = booking({ id: "real-guest", eventName: "Birthday party" });
    const dependencies = options([]);
    dependencies.client.fetchRange.mockRejectedValue(new Error("Source unavailable"));
    dependencies.kitchenStorage.getDay.mockResolvedValue({ events: [hold, guest].map((vipBooking) => ({ event: { vipBooking } })) });
    const cachedBefore = JSON.stringify(await dependencies.kitchenStorage.getDay());
    const result = await listVipCheckinDay(hold.operatingDate, dependencies as never);
    expect(result.reservations.map((row) => row.reservationId)).toEqual([guest.id]);
    expect(result.sourceError).toContain("check-in is disabled");
    expect(dependencies.storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(dependencies.synchronizeFood).not.toHaveBeenCalled();
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(await dependencies.kitchenStorage.getDay())).toBe(cachedBefore);
  });

  it.each(["confirmed", "checked_in"] as const)("rejects direct %s hold arrival before check-in or food storage access", async (status) => {
    const reservation = booking({ status });
    const dependencies = options([reservation]);
    await expect(confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", dependencies as never))
      .rejects.toThrow("internal December VIP hold is not a guest reservation");
    for (const name of ["getVipCheckin", "confirmVipCheckin", "getVipInitialFoodRelease", "listVipInitialFoodDispatches", "markVipInitialFoodReleaseFailed"] as const) {
      expect(dependencies.storage[name]).not.toHaveBeenCalled();
    }
    expect(dependencies.synchronizeFood).not.toHaveBeenCalled();
    expect(dependencies.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { label: "November boundary", changes: { operatingDate: "2026-11-30" } },
    { label: "January boundary", changes: { operatingDate: "2027-01-01" } },
    { label: "another December", changes: { operatingDate: "2027-12-01" } },
    { label: "similar customer name", changes: { eventName: "VIP Unavailable Celebration" } },
    { label: "purchased food", changes: { foodPrep: vipPrepPayload.reservations[0].foodPrep } },
    { label: "purchased extra", changes: { extras: [{ code: "mini-golf", quantity: 1 }] } },
    { label: "corporate source link", changes: { linkedTripleseatEventIds: ["123456"] } },
  ])("preserves $label in lists and direct arrival", async ({ changes }) => {
    const reservation = booking(changes);
    const before = JSON.stringify(reservation);
    const dependencies = options([reservation]);
    const day = await listVipCheckinDay(reservation.operatingDate, dependencies as never);
    expect(day.reservations.map((row) => row.reservationId)).toEqual([reservation.id]);
    const existing = { event_id: `vip-${reservation.id}`, reservation_id: reservation.id,
      booking_date: reservation.operatingDate, employee_name: "Tina", checked_in_at: "2026-12-01T20:00:00Z" };
    dependencies.storage.getVipCheckin.mockResolvedValue(existing);
    const checkedIn = await confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", dependencies as never);
    expect(checkedIn.reservationId).toBe(reservation.id);
    expect(dependencies.storage.getVipCheckin).toHaveBeenCalledOnce();
    expect(dependencies.storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(dependencies.synchronizeFood).not.toHaveBeenCalled();
    expect(dependencies.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(reservation)).toBe(before);
  });
});
