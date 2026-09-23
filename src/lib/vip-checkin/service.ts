import "server-only";

import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { processGoTabDispatches } from "@/lib/gotab/worker";
import { synchronizeVipBookingFoodToEventFood } from "@/lib/gotab/sync-event-food";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { KITCHEN_STAFF_ROSTER } from "@/lib/kitchen/storage";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { assertKitchenDate } from "@/lib/kitchen/sync";
import {
  KITCHEN_ROW_KEY_BY_VIP_CODE,
  VipPrepClient,
  vipPrepExternalId,
  vipPrepKitchenEvents,
} from "@/lib/vip-prep/client";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";

export type VipFoodStatus =
  | "NOT_CHECKED_IN"
  | "FOOD_SCHEDULED"
  | "SENDING_FOOD"
  | "FOOD_SENT"
  | "FOOD_SEND_FAILED"
  | "NO_FOOD_ITEMS";

export type VipCheckinRow = {
  reservationId: string;
  vipName: string;
  reservationDate: string;
  reservationTime: string;
  customerName: string;
  vipArea: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  foodStatus: VipFoodStatus;
};

type CheckinDependencies = {
  client?: Pick<VipPrepClient, "configured" | "fetchRange">;
  storage?: GoTabIntegrationStorage;
  dispatch?: typeof processGoTabDispatches;
  synchronizeFood?: typeof synchronizeVipBookingFoodToEventFood;
};

function dependencies(options: CheckinDependencies) {
  return {
    client: options.client ?? new VipPrepClient(),
    storage: options.storage ?? new GoTabIntegrationStorage(),
  };
}

async function foodStatus(eventId: string, storage: GoTabIntegrationStorage): Promise<VipFoodStatus> {
  const release = await storage.getVipInitialFoodRelease(eventId);
  if (!release) return "FOOD_SEND_FAILED";
  if (release.expected_item_count === 0) return "NO_FOOD_ITEMS";
  const dispatches = await storage.listVipInitialFoodDispatches(eventId);
  if (release.status === "FAILED" ||
      dispatches.some((dispatch) => ["HELD", "FAILED", "DRY_RUN", "CANCELLED"].includes(dispatch.status))) {
    return "FOOD_SEND_FAILED";
  }
  const sentCount = new Set(dispatches.filter((dispatch) => dispatch.status === "SENT")
    .map((dispatch) => dispatch.request_id)).size;
  if (sentCount >= release.expected_item_count) return "FOOD_SENT";
  if (new Set(dispatches.filter((dispatch) => dispatch.status === "SCHEDULED")
    .map((dispatch) => dispatch.request_id)).size >= release.expected_item_count) return "FOOD_SCHEDULED";
  return "SENDING_FOOD";
}

export async function listVipCheckins(
  date: string,
  options: CheckinDependencies = {},
): Promise<VipCheckinRow[]> {
  assertKitchenDate(date);
  const { client, storage } = dependencies(options);
  if (!client.configured) throw new Error("OnPar bookings is not configured.");
  const [payload, checkins] = await Promise.all([
    client.fetchRange(date, date),
    storage.listVipCheckinsForDate(date),
  ]);
  const checkinById = new Map(checkins.map((row) => [row.reservation_id, row]));
  const testReservation = vipKdsTestReservation(date);
  const reservations = testReservation ? [...payload.reservations, testReservation] : payload.reservations;
  const rows = await Promise.all(reservations.map(async (reservation) => {
    const checkin = checkinById.get(reservation.id);
    return {
      reservationId: reservation.id,
      vipName: reservation.eventName,
      reservationDate: reservation.operatingDate,
      reservationTime: reservation.startAt,
      customerName: reservation.guestName,
      vipArea: reservation.resource.name,
      checkedInAt: checkin?.checked_in_at ?? null,
      checkedInBy: checkin?.employee_name ?? null,
      foodStatus: checkin
        ? await foodStatus(vipPrepExternalId(reservation), storage)
        : "NOT_CHECKED_IN" as const,
    };
  }));
  return rows.sort((left, right) =>
    Date.parse(left.reservationTime) - Date.parse(right.reservationTime) ||
    left.vipName.localeCompare(right.vipName),
  );
}

export async function confirmVipArrival(
  reservationId: string,
  date: string,
  employeeName: string,
  options: CheckinDependencies = {},
): Promise<VipCheckinRow> {
  assertKitchenDate(date);
  if (date > todayInEntertainmentTimeZone()) {
    throw new Error("VIP check-in is available on the reservation date, including before its start time.");
  }
  const normalizedEmployee = employeeName.trim();
  if (!KITCHEN_STAFF_ROSTER.some((name) => name === normalizedEmployee)) {
    throw new Error("Select an employee from the approved roster.");
  }
  if (!/^[A-Za-z0-9-]{1,120}$/.test(reservationId)) {
    throw new Error("Invalid VIP reservation.");
  }
  const { client, storage } = dependencies(options);
  if (!client.configured) throw new Error("OnPar bookings is not configured.");
  const payload = await client.fetchRange(date, date);
  const testReservation = vipKdsTestReservation(date);
  const reservation = [...payload.reservations, ...(testReservation ? [testReservation] : [])]
    .find((item) => item.id === reservationId);
  if (!reservation || !["confirmed", "checked_in"].includes(reservation.status)) {
    throw new Error("This VIP reservation is no longer active. No food was sent.");
  }

  const eventId = vipPrepExternalId(reservation);
  const expectedItemCount = new Set(reservation.foodPrep.map((item) =>
    KITCHEN_ROW_KEY_BY_VIP_CODE[item.code] ?? `unmapped:${item.code}`,
  )).size;
  await storage.confirmVipCheckin({
    eventId,
    reservationId,
    bookingDate: reservation.operatingDate,
    employeeName: normalizedEmployee,
    expectedItemCount,
  });
  if (reservation.foodPrep.length > 0) {
    try {
      const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
      const synchronizeFood = options.synchronizeFood ?? synchronizeVipBookingFoodToEventFood;
      const projection = await synchronizeFood(checklist, { storage });
      if (projection.exceptionCount > 0) {
        await storage.markVipInitialFoodReleaseFailed(eventId, "A food item needs GoTab mapping or review.");
      }
      const dispatch = options.dispatch ?? processGoTabDispatches;
      await dispatch({ storage });
    } catch {
      await storage.markVipInitialFoodReleaseFailed(eventId, "The kitchen order could not be confirmed. Review before retrying.");
    }
  }

  const checkin = await storage.getVipCheckin(eventId);
  if (!checkin) throw new Error("VIP check-in could not be confirmed.");
  return {
    reservationId,
    vipName: reservation.eventName,
    reservationDate: reservation.operatingDate,
    reservationTime: reservation.startAt,
    customerName: reservation.guestName,
    vipArea: reservation.resource.name,
    checkedInAt: checkin.checked_in_at,
    checkedInBy: checkin.employee_name,
    foodStatus: await foodStatus(eventId, storage),
  };
}
