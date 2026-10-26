import "server-only";

import { GoTabIntegrationStorage, type StoredVipCheckin } from "@/lib/gotab/storage";
import { processGoTabDispatches } from "@/lib/gotab/worker";
import { synchronizeVipBookingFoodToEventFood } from "@/lib/gotab/sync-event-food";
import { todayInEntertainmentTimeZone, zonedDateTimeToIso } from "@/lib/entertainment/time";
import { formatEntertainmentIntervalHours } from "@/lib/entertainment/duration";
import { getKitchenStorage, KITCHEN_STAFF_ROSTER, type KitchenStorage } from "@/lib/kitchen/storage";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { assertKitchenDate } from "@/lib/kitchen/sync";
import {
  KITCHEN_ROW_KEY_BY_VIP_CODE,
  VipPrepClient,
  vipPrepExternalId,
  vipPrepKitchenEvents,
  isActiveVipPrepReservation,
  vipPrepExtras,
  vipPrepMappingIssues,
  type VipPrepReservation,
  type VipPrepFoodItem,
  type VipPrepExtra,
} from "@/lib/vip-prep/client";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";
import { vipInitialFoodSnapshot, vipReleaseFingerprint } from "./release-snapshot";

export type VipFoodStatus =
  | "NOT_CHECKED_IN"
  | "FOOD_SCHEDULED"
  | "SENDING_FOOD"
  | "FOOD_SENT"
  | "FOOD_SEND_FAILED"
  | "FOOD_PARTIAL"
  | "FOOD_HELD"
  | "FOOD_UNCERTAIN"
  | "FOOD_PENDING"
  | "NO_FOOD_ITEMS";

export type VipCheckinRow = {
  reservationId: string;
  vipName: string;
  reservationDate: string;
  reservationTime: string;
  customerName: string;
  vipArea: string;
  confirmationCode: string;
  endAt: string;
  duration: string;
  partySize: number;
  foodItems: Array<Pick<VipPrepFoodItem, "code" | "label" | "quantity">>;
  extras: VipPrepExtra[];
  sourceStatus: VipPrepReservation["status"];
  sourceUpdatedAt: string;
  lastSuccessfulBookingRefresh: string | null;
  scheduledReleaseAt: string | null;
  itemIssues: string[];
  acceptedItemCount: number;
  expectedItemCount: number;
  preorderChange?: VipPrepReservation["preorderChange"];
  checkedInAt: string | null;
  checkedInBy: string | null;
  foodStatus: VipFoodStatus;
};

type CheckinDependencies = {
  client?: Pick<VipPrepClient, "configured" | "fetchRange">;
  storage?: GoTabIntegrationStorage;
  dispatch?: typeof processGoTabDispatches;
  synchronizeFood?: typeof synchronizeVipBookingFoodToEventFood;
  kitchenStorage?: Pick<KitchenStorage, "getDay">;
};

function dependencies(options: CheckinDependencies) {
  return {
    client: options.client ?? new VipPrepClient(),
    storage: options.storage ?? new GoTabIntegrationStorage(),
  };
}

export async function vipFoodReleaseState(eventId: string, storage: GoTabIntegrationStorage, current?: VipPrepReservation) {
  const release = await storage.getVipInitialFoodRelease(eventId);
  const empty = { scheduledReleaseAt: null as string | null, itemIssues: [] as string[], acceptedItemCount: 0, expectedItemCount: release?.expected_item_count ?? 0, sourceFingerprints: [] as string[] };
  if (!release) return { ...empty, foodStatus: "FOOD_HELD" as VipFoodStatus, itemIssues: ["The initial food release record is missing. No delivery is confirmed."] };
  if (release.expected_item_count === 0) return current?.foodPrep.length
    ? { ...empty, foodStatus: "FOOD_HELD" as VipFoodStatus, itemIssues: ["Food was added after the initial no-food release. Use the correction/additional-order workflow; do not resend the original order."] }
    : { ...empty, foodStatus: "NO_FOOD_ITEMS" as VipFoodStatus };
  const dispatches = await storage.listVipInitialFoodDispatches(eventId);
  const latest = [...new Map([...dispatches].reverse().map((dispatch) => [dispatch.request_id, dispatch])).values()];
  const sentCount = new Set(dispatches.filter((dispatch) => dispatch.status === "SENT")
    .map((dispatch) => dispatch.request_id)).size;
  const itemIssues = latest.flatMap((dispatch) => {
    const name = dispatch.food_name ?? dispatch.source_record_id ?? "Preordered food item";
    if (/uncertain|timeout|did not confirm an accepted order/i.test(dispatch.last_error ?? "")) return [`${name}: delivery is uncertain. Check the saved GoTab order before retrying.`];
    if (["HELD", "FAILED", "DRY_RUN", "CANCELLED"].includes(dispatch.status)) return [`${name}: ${dispatch.status === "DRY_RUN" ? "test only, not sent" : dispatch.status.toLowerCase()}; review the saved item before retrying.`];
    return [];
  });
  if (latest.length < release.expected_item_count) itemIssues.push("One or more preordered items have no verified delivery record. Review their mapping; do not resubmit the entire order.");
  if (release.status === "FAILED") itemIssues.push("The initial food release needs review; check item mappings and saved orders before retrying.");
  const sourceFingerprints = [...new Set(dispatches.flatMap((dispatch) => dispatch.source_fingerprint && /^[a-f0-9]{64}$/.test(dispatch.source_fingerprint) ? [dispatch.source_fingerprint] : []))];
  const amended = Boolean(current && sourceFingerprints.some((fingerprint) => fingerprint !== vipReleaseFingerprint(current)));
  const quantities = new Map<string, number>();
  for (const item of current?.foodPrep ?? []) {
    const key = KITCHEN_ROW_KEY_BY_VIP_CODE[item.code];
    if (key) quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
  }
  const legacyEvidence = latest.some((dispatch) => !dispatch.source_fingerprint || !/^[a-f0-9]{64}$/.test(dispatch.source_fingerprint));
  const legacyUnverified = Boolean(current && legacyEvidence && !(
    current.foodPrep.every((item) => Boolean(KITCHEN_ROW_KEY_BY_VIP_CODE[item.code])) &&
    quantities.size === release.expected_item_count && latest.length === quantities.size &&
    new Set(latest.map((item) => item.source_record_id)).size === latest.length &&
    latest.every((item) => item.source_record_id && Number.isSafeInteger(item.source_quantity) &&
      item.source_quantity != null && item.source_quantity > 0 && quantities.get(item.source_record_id) === item.source_quantity)
  ));
  if (amended) itemIssues.push("The booking or preorder changed after initial release. Use the correction/additional-order workflow; do not resend the original order.");
  if (legacyUnverified) itemIssues.push("Saved legacy order evidence does not verify the current purchased item quantities. Review the original GoTab order and use correction/additional-order review; do not resend the original order.");
  const scheduled = latest.map((dispatch) => dispatch.scheduled_at).filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const uncertain = latest.some((dispatch) => /uncertain|timeout|did not confirm an accepted order/i.test(dispatch.last_error ?? ""));
  const foodStatus: VipFoodStatus = amended || legacyUnverified ? "FOOD_HELD" : sentCount >= release.expected_item_count ? "FOOD_SENT"
    : uncertain ? "FOOD_UNCERTAIN" : sentCount > 0 ? "FOOD_PARTIAL"
    : latest.some((dispatch) => dispatch.status === "HELD" || dispatch.status === "CANCELLED") ? "FOOD_HELD"
    : release.status === "FAILED" || latest.some((dispatch) => ["FAILED", "DRY_RUN"].includes(dispatch.status)) ? "FOOD_SEND_FAILED"
    : latest.length >= release.expected_item_count && latest.every((dispatch) => dispatch.status === "SCHEDULED") ? "FOOD_SCHEDULED"
    : latest.some((dispatch) => dispatch.status === "SENDING") ? "SENDING_FOOD" : "FOOD_PENDING";
  return { foodStatus, scheduledReleaseAt: scheduled[0] ?? null, itemIssues, acceptedItemCount: sentCount,
    expectedItemCount: release.expected_item_count,
    sourceFingerprints,
  };
}

function calculatedReleaseAt(reservation: VipPrepReservation) {
  if (!reservation.foodPrep.length) return null;
  const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
  const value = checklist.timing.earliestPrepTime;
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  return match ? zonedDateTimeToIso(match[1], Number(match[2]), Number(match[3])) : null;
}

async function checkinRow(reservation: VipPrepReservation, checkin: StoredVipCheckin | null, storage: GoTabIntegrationStorage, refreshedAt: string | null): Promise<VipCheckinRow> {
  const release = checkin ? await vipFoodReleaseState(vipPrepExternalId(reservation), storage, reservation) : null;
  const mappingIssues = (reservation.mappingIssues ?? vipPrepMappingIssues(reservation)).map((issue) => `${issue.quantity} × ${issue.label}: ${issue.message}`);
  const itemIssues = [...mappingIssues, ...(release?.itemIssues ?? [])];
  return {
    reservationId: reservation.id, vipName: reservation.eventName, reservationDate: reservation.operatingDate,
    reservationTime: reservation.startAt, customerName: reservation.guestName, vipArea: reservation.resource.name,
    confirmationCode: reservation.confirmationCode,
    endAt: reservation.endAt, duration: formatEntertainmentIntervalHours(reservation.startAt, reservation.endAt),
    partySize: reservation.partySize, foodItems: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })), extras: vipPrepExtras(reservation),
    sourceStatus: reservation.status, sourceUpdatedAt: reservation.updatedAt, lastSuccessfulBookingRefresh: refreshedAt,
    checkedInAt: checkin?.checked_in_at ?? null, checkedInBy: checkin?.employee_name ?? null,
    foodStatus: release?.foodStatus ?? "NOT_CHECKED_IN",
    scheduledReleaseAt: release?.scheduledReleaseAt ?? calculatedReleaseAt(reservation), itemIssues,
    acceptedItemCount: release?.acceptedItemCount ?? 0, expectedItemCount: release?.expectedItemCount ?? new Set(reservation.foodPrep.map((item) => KITCHEN_ROW_KEY_BY_VIP_CODE[item.code] ?? `unmapped:${item.code}`)).size,
    ...(reservation.preorderChange ? { preorderChange: reservation.preorderChange } : {}),
  };
}

export async function listVipCheckins(
  date: string,
  options: CheckinDependencies = {},
): Promise<VipCheckinRow[]> {
  return (await listVipCheckinDay(date, options)).reservations;
}

export async function listVipCheckinDay(date: string, options: CheckinDependencies = {}) {
  assertKitchenDate(date);
  const { client, storage } = dependencies(options);
  let savedBookings: Promise<VipPrepReservation[]> | null = null;
  const cachedBookings = () => savedBookings ??= (options.kitchenStorage ?? getKitchenStorage()).getDay(date)
    .then((day) => day.events.flatMap((checklist) => checklist.event.vipBooking && checklist.event.vipBooking.operatingDate === date ? [checklist.event.vipBooking] : []))
    .catch(() => []);
  const source = await (async () => {
    try {
      if (!client.configured) throw new Error("OnPar bookings is not configured.");
      const payload = await client.fetchRange(date, date);
      const testReservation = vipKdsTestReservation(date);
      return { reservations: testReservation ? [...payload.reservations, testReservation] : payload.reservations,
        refreshedAt: payload.generatedAt as string | null, sourceError: null as string | null };
    } catch {
      const reservations = await cachedBookings();
      if (!reservations.length) throw new Error("OnPar bookings is unavailable. No current reservation list could be verified.");
      const refreshed = reservations.flatMap((reservation) => reservation.lastRefreshedAt && Number.isFinite(Date.parse(reservation.lastRefreshedAt)) ? [reservation.lastRefreshedAt] : []);
      return { reservations, refreshedAt: refreshed.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null,
        sourceError: "OnPar bookings is unavailable. Showing saved booking information only; check-in is disabled until a fresh booking refresh succeeds." };
    }
  })();
  const checkins = await storage.listVipCheckinsForDate(date);
  const checkinById = new Map(checkins.map((row) => [row.reservation_id, row]));
  const priorBookings = source.reservations.length ? await cachedBookings() : [];
  const food = (items: VipPrepReservation["foodPrep"]) => items.map(({ code, label, quantity }) => ({ code, label, quantity }));
  const facts = (items: Array<{ code: string; label: string; quantity: number }>) => JSON.stringify(items.map((item) => JSON.stringify(item)).sort());
  const reservations = source.reservations.filter(isActiveVipPrepReservation).map((reservation) => {
    if (checkinById.has(reservation.id) || source.sourceError) return reservation;
    const prior = priorBookings.find((booking) => booking.id === reservation.id);
    if (!prior) return reservation;
    const currentFood = food(reservation.foodPrep);
    const previousFood = food(prior.foodPrep);
    const preorderChange = facts(currentFood) !== facts(previousFood) ? {
      sourceUpdatedAt: reservation.updatedAt, previous: previousFood, current: currentFood,
      message: "The booked food changed. Use the current purchased quantities for planning. Food remains blocked until Event Host staff confirm arrival.",
    } : prior.preorderChange && facts(prior.preorderChange.current) === facts(currentFood) ? prior.preorderChange : undefined;
    return preorderChange ? { ...reservation, preorderChange } : reservation;
  });
  const rows = await Promise.all(reservations.map((reservation) => checkinRow(reservation, checkinById.get(reservation.id) ?? null, storage, source.sourceError ? reservation.lastRefreshedAt ?? null : source.refreshedAt)));
  return { lastSuccessfulBookingRefresh: source.refreshedAt, sourceError: source.sourceError, reservations: rows.sort((left, right) =>
    Date.parse(left.reservationTime) - Date.parse(right.reservationTime) ||
    left.vipName.localeCompare(right.vipName),
  ) };
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
  const existingCheckin = await storage.getVipCheckin(eventId);
  if (existingCheckin) {
    // Arrival is recorded once. Later source amendments use correction/add-on
    // review, never another initial preorder or a blind delivery retry.
    return checkinRow(reservation, existingCheckin, storage, payload.generatedAt);
  }
  const expectedItemCount = new Set(reservation.foodPrep.map((item) =>
    KITCHEN_ROW_KEY_BY_VIP_CODE[item.code] ?? `unmapped:${item.code}`,
  )).size;
  const savedCheckin = await storage.confirmVipCheckin({
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
      const projection = await synchronizeFood(checklist, { storage, releaseSnapshot: vipInitialFoodSnapshot(reservation, savedCheckin) });
      if (projection.exceptionCount > 0) {
        await storage.markVipInitialFoodReleaseFailed(eventId, "A food item needs GoTab mapping or review.");
      }
      const dispatch = options.dispatch ?? processGoTabDispatches;
      await dispatch({ storage, requestIds: projection.requestIds ?? [] });
    } catch {
      await storage.markVipInitialFoodReleaseFailed(eventId, "The kitchen order could not be confirmed. Review before retrying.");
    }
  }

  const checkin = await storage.getVipCheckin(eventId);
  if (!checkin) throw new Error("VIP check-in could not be confirmed.");
  return checkinRow(reservation, checkin, storage, payload.generatedAt);
}
