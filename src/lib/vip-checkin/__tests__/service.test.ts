import { describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

vi.mock("server-only", () => ({}));

const { confirmVipArrival, listVipCheckins } = await import("../service");
const reservation = vipPrepPayload.reservations[0];
const eventId = `vip-${reservation.id}`;

function client(foodPrep = reservation.foodPrep) {
  return {
    configured: true,
    fetchRange: vi.fn().mockResolvedValue({
      ...vipPrepPayload,
      reservations: [{ ...reservation, foodPrep }],
    }),
  };
}

describe("VIP arrival and food release", () => {
  it("does not check in a VIP before its reservation date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-22T16:00:00Z");
    try {
      const testClient = { configured: true, fetchRange: vi.fn() };
      await expect(confirmVipArrival("event-host-kds-retest-20260923", "2026-09-23", "Tina", {
        client: testClient,
      })).rejects.toThrow("VIP check-in is available on the reservation date");
      expect(testClient.fetchRange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows early VIP check-in while leaving booked food scheduled for prep time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-23T16:00:00Z");
    try {
      const testId = "event-host-kds-retest-20260923";
      const testEventId = `vip-${testId}`;
      const saved = {
        event_id: testEventId,
        reservation_id: testId,
        booking_date: "2026-09-23",
        employee_name: "Tina",
        checked_in_at: "2026-09-23T16:00:00Z",
      };
      const storage = {
        listVipCheckinsForDate: vi.fn().mockResolvedValue([]),
        confirmVipCheckin: vi.fn().mockResolvedValue(saved),
        getVipCheckin: vi.fn().mockResolvedValue(saved),
        getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 2, status: "PENDING" }),
        listVipInitialFoodDispatches: vi.fn().mockResolvedValue([
          { request_id: "chicken", status: "SCHEDULED" },
          { request_id: "dessert", status: "SCHEDULED" },
        ]),
      };
      const testClient = {
        configured: true,
        fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [] }),
      };
      const before = await listVipCheckins("2026-09-23", {
        client: testClient, storage: storage as never,
      });
      expect(before).toMatchObject([{ reservationId: testId, foodStatus: "NOT_CHECKED_IN" }]);
      expect(storage.confirmVipCheckin).not.toHaveBeenCalled();

      const synchronizeFood = vi.fn().mockResolvedValue({ exceptionCount: 0 });
      const dispatch = vi.fn().mockResolvedValue({ sent: 0 });
      const result = await confirmVipArrival(testId, "2026-09-23", "Tina", {
        client: testClient, storage: storage as never,
        synchronizeFood: synchronizeFood as never,
        dispatch: dispatch as never,
      });
      expect(storage.confirmVipCheckin).toHaveBeenCalledWith(expect.objectContaining({
        eventId: testEventId,
        expectedItemCount: 2,
      }));
      expect(synchronizeFood).toHaveBeenCalledOnce();
      expect(dispatch).toHaveBeenCalledOnce();
      expect(result.checkedInAt).toBe("2026-09-23T16:00:00Z");
      expect(result.foodStatus).toBe("FOOD_SCHEDULED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a late, not-checked-in VIP visible without dispatching food", async () => {
    const storage = {
      listVipCheckinsForDate: vi.fn().mockResolvedValue([]),
    };
    const rows = await listVipCheckins(reservation.operatingDate, {
      client: client(), storage: storage as never,
    });
    expect(rows).toMatchObject([{
      reservationId: reservation.id,
      vipName: "Redacted VIP",
      customerName: "Redacted Guest",
      reservationTime: reservation.startAt,
      checkedInAt: null,
      foodStatus: "NOT_CHECKED_IN",
    }]);
  });

  it("saves check-in and reports food sent only after a confirmed dispatch", async () => {
    let saved: {
      event_id: string; reservation_id: string; booking_date: string;
      employee_name: string; checked_in_at: string;
    } | null = null;
    let dispatchStatus = "QUEUED";
    const storage = {
      confirmVipCheckin: vi.fn().mockImplementation(async (input) => {
        saved ??= {
          event_id: input.eventId,
          reservation_id: input.reservationId,
          booking_date: input.bookingDate,
          employee_name: input.employeeName,
          checked_in_at: "2026-08-16T00:30:00.000Z",
        };
        return saved;
      }),
      getVipCheckin: vi.fn().mockImplementation(async () => saved),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({
        expected_item_count: 1, status: "PENDING",
      }),
      listVipInitialFoodDispatches: vi.fn().mockImplementation(async () => [{
        request_id: "request-1", status: dispatchStatus,
      }]),
      listVipCheckinsForDate: vi.fn().mockImplementation(async () => saved ? [saved] : []),
    };
    const synchronizeFood = vi.fn().mockResolvedValue({ exceptionCount: 0 });
    const dispatch = vi.fn().mockImplementation(async () => {
      dispatchStatus = "SENT";
      return { sent: 1 };
    });
    const options = {
      client: client(), storage: storage as never,
      synchronizeFood: synchronizeFood as never,
      dispatch: dispatch as never,
    };

    const checkedIn = await confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", options);
    expect(checkedIn.foodStatus).toBe("FOOD_SENT");
    expect(checkedIn.checkedInBy).toBe("Tina");
    expect(storage.confirmVipCheckin).toHaveBeenCalledWith(expect.objectContaining({
      eventId, reservationId: reservation.id, expectedItemCount: 1,
    }));
    expect(synchronizeFood).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const reloaded = await listVipCheckins(reservation.operatingDate, options);
    expect(reloaded[0]).toMatchObject({ checkedInBy: "Tina", foodStatus: "FOOD_SENT" });
  });

  it("keeps check-in saved but never reports Food Sent when the dispatch fails", async () => {
    const saved = {
      event_id: eventId,
      reservation_id: reservation.id,
      booking_date: reservation.operatingDate,
      employee_name: "Tina",
      checked_in_at: "2026-08-16T00:30:00.000Z",
    };
    const storage = {
      confirmVipCheckin: vi.fn().mockResolvedValue(saved),
      getVipCheckin: vi.fn().mockResolvedValue(saved),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({
        expected_item_count: 1, status: "FAILED",
      }),
      listVipInitialFoodDispatches: vi.fn().mockResolvedValue([{ request_id: "request-1", status: "HELD" }]),
      releaseCheckedInVipDispatches: vi.fn().mockResolvedValue(1),
      markVipInitialFoodReleaseFailed: vi.fn().mockResolvedValue(undefined),
    };
    const result = await confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", {
      client: client(), storage: storage as never,
      synchronizeFood: vi.fn().mockResolvedValue({ exceptionCount: 1 }) as never,
      dispatch: vi.fn().mockResolvedValue({ sent: 0 }) as never,
    });
    expect(result.foodStatus).toBe("FOOD_SEND_FAILED");
    expect(result.checkedInAt).toBe(saved.checked_in_at);
  });

  it("checks in a VIP with no food without creating a kitchen ticket", async () => {
    const saved = {
      event_id: eventId,
      reservation_id: reservation.id,
      booking_date: reservation.operatingDate,
      employee_name: "Tina",
      checked_in_at: "2026-08-16T00:30:00.000Z",
    };
    const storage = {
      confirmVipCheckin: vi.fn().mockResolvedValue(saved),
      getVipCheckin: vi.fn().mockResolvedValue(saved),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({
        expected_item_count: 0, status: "NO_FOOD",
      }),
    };
    const synchronizeFood = vi.fn();
    const dispatch = vi.fn();
    const result = await confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", {
      client: client([]), storage: storage as never,
      synchronizeFood: synchronizeFood as never,
      dispatch: dispatch as never,
    });
    expect(result.foodStatus).toBe("NO_FOOD_ITEMS");
    expect(synchronizeFood).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
