import "server-only";
import { getFloorPlanDay } from "@/lib/floor-plans/service";
import { getKitchenDay, assertKitchenDate } from "@/lib/kitchen/sync";
import { getKitchenStorage } from "@/lib/kitchen/storage";
import { listVipCheckins } from "@/lib/vip-checkin/service";
import { VipPrepClient, isActiveVipPrepReservation, vipPrepExternalId } from "./client";
import type { VipSyncHealth } from "./sync-health-types";

type Client = Pick<VipPrepClient, "configured" | "fetchRange">;
type HealthDependencies = {
  client?: Client;
  floorPlan?: typeof getFloorPlanDay;
  kitchen?: typeof getKitchenDay;
  checkIn?: typeof listVipCheckins;
  cachedBookings?: (date: string) => Promise<Array<{ id: string; lastRefreshedAt?: string }>>;
};

function sameInterval(left: { startAt: string | null; endAt: string | null }, right: { startAt: string; endAt: string }) {
  return Boolean(left.startAt && left.endAt && Date.parse(left.startAt) === Date.parse(right.startAt) && Date.parse(left.endAt) === Date.parse(right.endAt));
}

/** View diagnostics only: no refresh action, check-in, queue, claim, or dispatch. */
export async function loadVipSyncHealth(date: string, reservationId: string, options: HealthDependencies = {}): Promise<VipSyncHealth> {
  assertKitchenDate(date);
  if (!/^[A-Za-z0-9-]{1,120}$/.test(reservationId)) throw new Error("Invalid source reservation ID.");
  const sourceEventId = vipPrepExternalId({ id: reservationId });
  const href = (path: string) => `${path}?${new URLSearchParams({ date, eventId: sourceEventId })}`;
  const base: VipSyncHealth = {
    sourceEventId, sourceFound: null, lastSuccessfulRefreshAt: null, sourceError: null,
    floorPlan: { represented: null, detail: "Not verified.", href: href("/floor-plans") },
    entertainment: { represented: null, detail: "Not verified.", href: href("/entertainment-schedules") },
    kitchen: { represented: null, detail: "Not verified.", href: href("/kitchen") },
    checkIn: { represented: null, detail: "Not verified.", href: href("/vip-check-in") },
    arrival: "unverified", foodRelease: null,
  };
  const client = options.client ?? new VipPrepClient();
  let payload: Awaited<ReturnType<Client["fetchRange"]>>;
  try {
    if (!client.configured) throw new Error("Booking feed is not configured.");
    payload = await client.fetchRange(date, date);
  } catch {
    const cached = await (options.cachedBookings ?? (async (day) => (await getKitchenStorage().getDay(day)).events.flatMap((event) => event.event.vipBooking ? [event.event.vipBooking] : [])))(date).catch(() => []);
    return { ...base, lastSuccessfulRefreshAt: cached.find((booking) => booking.id === reservationId)?.lastRefreshedAt ?? null,
      sourceError: "On Par Bookings is unavailable. These views could not be verified against the current source. No operational action was performed." };
  }
  const reservation = payload.reservations.find((row) => row.id === reservationId && isActiveVipPrepReservation(row));
  if (!reservation) return { ...base, sourceFound: false, lastSuccessfulRefreshAt: payload.generatedAt,
    sourceError: "The current successful booking response does not contain this active reservation. It may have been cancelled or moved to another date." };
  const cachedClient: Client = { configured: true, fetchRange: async (from, to) => {
    if (from !== date || to !== date) throw new Error("Booking diagnostic date mismatch.");
    return payload;
  } };
  const [floor, kitchen, checkIn] = await Promise.allSettled([
    (options.floorPlan ?? getFloorPlanDay)(date, undefined, { vipPrepClient: cachedClient, readOnly: true }),
    (options.kitchen ?? getKitchenDay)(date, { vipPrepClient: cachedClient, persistSourceChanges: false }),
    (options.checkIn ?? listVipCheckins)(date, { client: cachedClient }),
  ]);
  const health = { ...base, sourceFound: true, lastSuccessfulRefreshAt: payload.generatedAt };
  const physicalId = reservation.resource.code === "VIPS" ? "vip-1" : "vip-2";
  if (floor.status === "fulfilled") {
    const events = floor.value.plan.events.filter((event) => event.tripleseatEventId === sourceEventId || event.source.verifiedSourceEventIds?.includes(sourceEventId));
    const represented = floor.value.plan.reservations.some((row) => events.some((event) => event.id === row.floorPlanEventId) && row.areaId === physicalId && row.reservationType === "room" && sameInterval(row, reservation));
    health.floorPlan = { ...base.floorPlan, represented,
      detail: represented ? "Exact booked section and interval are represented in the live floor-plan view. This does not assert that a staff draft was saved." : "The live floor-plan view does not contain the exact booked section and interval; review its source warnings." };
    const block = floor.value.entertainmentReservations.some((row) => row.active && row.resourceId === `private-room-${physicalId}` &&
      (row.tripleseatEventId === sourceEventId || row.localEventId === sourceEventId) && sameInterval(row, reservation));
    const scheduleUnavailable = floor.value.warnings.some((warning) => warning.startsWith("The shared Entertainment Schedule could not be loaded."));
    health.entertainment = { ...base.entertainment, represented: scheduleUnavailable ? null : block,
      detail: scheduleUnavailable ? "Shared schedule could not be read; representation is unverified."
        : block ? "Exact On Par VIP block is represented in the shared schedule." : "The shared schedule does not contain the exact source-qualified VIP block; review its source warnings." };
  } else {
    health.floorPlan = { ...base.floorPlan, detail: "Floor-plan view could not be read; representation is unverified." };
    health.entertainment = { ...base.entertainment, detail: "Shared schedule could not be read; representation is unverified." };
  }
  if (kitchen.status === "fulfilled") {
    const checklist = kitchen.value.events.find((event) => String(event.event.eventId) === sourceEventId);
    const facts = (items: readonly { code: string; label: string; quantity: number }[]) => items.map(({ code, label, quantity }) => JSON.stringify({ code, label, quantity })).sort();
    const booking = checklist?.event.vipBooking;
    const represented = Boolean(booking && booking.id === reservationId && booking.operatingDate === date &&
      booking.resource.code === reservation.resource.code && booking.partySize === reservation.partySize && sameInterval(booking, reservation) &&
      checklist?.event.room === reservation.resource.name && checklist.event.guestCount === reservation.partySize && checklist.event.localDate === date &&
      sameInterval({ startAt: checklist.event.startTime, endAt: checklist.event.endTime }, reservation) &&
      JSON.stringify(facts(booking.foodPrep)) === JSON.stringify(facts(reservation.foodPrep)));
    health.kitchen = { ...base.kitchen, represented, detail: represented ? reservation.foodPrep.length
      ? "Kitchen screen/print projection contains every exact purchased food name and quantity, including visible mapping issues. Planning is not food release."
      : "No-food VIP is represented as a valid kitchen planning entry; no empty food order is required."
      : "Exact source preorder is not represented in the kitchen planning view; review Booking Sync warnings." };
  } else health.kitchen = { ...base.kitchen, detail: "Kitchen planning view could not be read; representation is unverified." };
  if (checkIn.status === "fulfilled") {
    const row = checkIn.value.find((item) => item.reservationId === reservationId);
    const foodFacts = (items: readonly { code: string; label: string; quantity: number }[]) => items.map(({ code, label, quantity }) => JSON.stringify({ code, label, quantity })).sort();
    const represented = Boolean(row && row.reservationDate === date && row.vipArea === reservation.resource.name &&
      row.partySize === reservation.partySize && sameInterval({ startAt: row.reservationTime, endAt: row.endAt }, reservation) &&
      JSON.stringify(foodFacts(row.foodItems)) === JSON.stringify(foodFacts(reservation.foodPrep)));
    health.checkIn = { ...base.checkIn, represented, detail: represented ? "Source-qualified check-in card contains the exact current section, interval and preorder. Only the employee arrival action can authorize food." : "The exact current source booking is not represented on its check-in card." };
    health.arrival = row ? row.checkedInAt ? "checked-in" : "not-checked-in" : "unverified";
    health.foodRelease = row?.foodStatus ?? null;
  } else health.checkIn = { ...base.checkIn, detail: "Check-in records could not be read; arrival/release are unverified." };
  return health;
}
