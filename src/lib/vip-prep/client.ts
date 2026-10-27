import type { EntertainmentSourceEvent } from "@/lib/entertainment/types";
import type { EventPlan } from "@/lib/event-plans/types";
import type { KitchenSourceEvent } from "@/lib/kitchen/types";
import { numericVipEventId, vipPrepExternalId } from "./identity";
import { isDecemberOwnerHoldVip } from "./owner-holds";
import type { VipPrepPayload, VipPrepReservation, VipPrepExtra } from "./types";
export { numericVipEventId, vipPrepExternalId } from "./identity";
export type { VipPrepFoodItem, VipPrepPayload, VipPrepReservation, VipPrepExtra, VipPrepMappingIssue } from "./types";

const DEFAULT_VIP_PREP_API_URL = "https://onparbookings.com/api/vip-prep";
const KITCHEN_SELECTION_NAME_BY_VIP_CODE: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  wings: "Wing Platter",
  "mozzarella-sticks": "Mozzarella Stick Platter",
  "tater-kegs": "Tater Keg Platter",
  "fry-platters": "Fry Platter",
  "chicken-tenders": "Chicken Tender Platter",
  "veggie-tray": "Veggie Tray",
  "dessert-platter": "Dessert Platter",
}));
export const KITCHEN_ROW_KEY_BY_VIP_CODE: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  wings: "platter-wings",
  "mozzarella-sticks": "platter-mozzarella-sticks",
  "tater-kegs": "platter-tater-kegs",
  "fry-platters": "platter-fries",
  "chicken-tenders": "platter-chicken-tenders",
  "veggie-tray": "platter-veggie-tray",
  "dessert-platter": "dessert-platter",
}));

type VipPrepClientOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
  endpoint?: string;
};

export class VipPrepApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VipPrepApiError";
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function parseReservation(value: unknown): VipPrepReservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VipPrepApiError("VIP Prep API returned an invalid reservation.");
  }
  const row = value as Record<string, unknown>;
  const resource = row.resource as Record<string, unknown> | null;
  const foodPrep = Array.isArray(row.foodPrep) ? row.foodPrep : null;
  if (
    typeof row.id !== "string" ||
    !/^[A-Za-z0-9-]{1,120}$/.test(row.id) ||
    typeof row.confirmationCode !== "string" ||
    !validDate(row.operatingDate) ||
    !resource ||
    (resource.code !== "VIPS" && resource.code !== "VIPL") ||
    typeof resource.name !== "string" ||
    typeof row.eventName !== "string" ||
    typeof row.guestName !== "string" ||
    !Number.isSafeInteger(row.partySize) ||
    Number(row.partySize) < 1 ||
    !validTimestamp(row.startAt) ||
    !validTimestamp(row.endAt) ||
    Date.parse(row.endAt) <= Date.parse(row.startAt) ||
    !["confirmed", "checked_in", "cancelled", "canceled"].includes(String(row.status)) ||
    !foodPrep ||
    !validTimestamp(row.updatedAt)
  ) {
    throw new VipPrepApiError("VIP Prep API returned an invalid reservation.");
  }
  const parsedFood = foodPrep.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new VipPrepApiError("VIP Prep API returned an invalid food item.");
    }
    const food = item as Record<string, unknown>;
    if (
      typeof food.code !== "string" ||
      typeof food.label !== "string" ||
      !Number.isSafeInteger(food.quantity) ||
      Number(food.quantity) < 1 ||
      !Number.isSafeInteger(food.unitPriceCents) ||
      !Number.isSafeInteger(food.totalCents)
    ) {
      throw new VipPrepApiError("VIP Prep API returned an invalid food item.");
    }
    return {
      code: food.code,
      label: food.label,
      quantity: Number(food.quantity),
      unitPriceCents: Number(food.unitPriceCents),
      totalCents: Number(food.totalCents),
      ...(typeof food.sourceId === "string" && food.sourceId.trim() ? { sourceId: food.sourceId.trim() } : {}),
    };
  });
  return {
    id: row.id,
    confirmationCode: row.confirmationCode,
    operatingDate: row.operatingDate,
    resource: { code: resource.code, name: resource.name },
    eventName: row.eventName,
    guestName: row.guestName,
    partySize: Number(row.partySize),
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status as VipPrepReservation["status"],
    foodPrep: parsedFood,
    extras: Array.isArray(row.extras) ? row.extras : [],
    updatedAt: row.updatedAt,
    ...(Array.isArray(row.linkedTripleseatEventIds) ? { linkedTripleseatEventIds: [...new Set(row.linkedTripleseatEventIds.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)))] } : {}),
  };
}

export class VipPrepClient {
  private readonly token: string | null;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VipPrepClientOptions = {}) {
    const env = options.env ?? process.env;
    this.token = env.VIP_PREP_API_TOKEN?.trim() || null;
    this.endpoint = options.endpoint ?? (env.VIP_PREP_API_URL?.trim() || DEFAULT_VIP_PREP_API_URL);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get configured() {
    return Boolean(this.token);
  }

  async fetchRange(from: string, to: string): Promise<VipPrepPayload> {
    if (!validDate(from) || !validDate(to) || from > to) {
      throw new VipPrepApiError("VIP Prep date range is invalid.");
    }
    if (!this.token) {
      throw new VipPrepApiError("VIP_PREP_API_TOKEN is not configured.");
    }
    const url = new URL(this.endpoint);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${this.token}` },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new VipPrepApiError(`VIP Prep API request failed (${response.status}).`);
    }
    const value = await response.json() as Record<string, unknown>;
    if (
      value.from !== from ||
      value.to !== to ||
      value.timeZone !== "America/New_York" ||
      !validTimestamp(value.generatedAt) ||
      !Array.isArray(value.reservations) ||
      !Number.isSafeInteger(value.reservationCount) || value.reservationCount !== value.reservations.length
    ) {
      throw new VipPrepApiError("VIP Prep API returned an invalid response.");
    }
    const reservations = value.reservations.map(parseReservation).map((reservation) => ({ ...reservation, lastRefreshedAt: String(value.generatedAt), mappingIssues: vipPrepMappingIssues(reservation) })).filter(
      (reservation) => reservation.operatingDate >= from && reservation.operatingDate <= to,
    );
    if (new Set(reservations.map((reservation) => reservation.id)).size !== reservations.length) {
      throw new VipPrepApiError("VIP Prep API returned duplicate source reservation IDs.");
    }
    return {
      from,
      to,
      timeZone: "America/New_York",
      generatedAt: value.generatedAt,
      reservationCount: reservations.length,
      reservations,
    };
  }
}

export function getMissingVipPrepEnvironmentVariables(env = process.env) {
  return env.VIP_PREP_API_TOKEN?.trim() ? [] : ["VIP_PREP_API_TOKEN"];
}

export function isActiveVipPrepReservation(reservation: VipPrepReservation) {
  return reservation.activeInSource !== false && (reservation.status === "confirmed" || reservation.status === "checked_in");
}

export function vipPrepMappingIssues(reservation: VipPrepReservation) {
  return reservation.foodPrep.filter((item) => !KITCHEN_ROW_KEY_BY_VIP_CODE[item.code]).map((item) => ({
    code: item.code, label: item.label, quantity: item.quantity,
    message: `Preordered ${item.label} (${item.code}) has no verified kitchen mapping.`,
  }));
}

export function vipPrepExtras(reservation: VipPrepReservation): VipPrepExtra[] {
  return reservation.extras.map((value) => {
    if (typeof value === "string") return { code: null, label: value, quantity: null };
    const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const label = [row.label, row.name, row.description, row.code].find((item) => typeof item === "string" && item.trim());
    return { code: typeof row.code === "string" ? row.code : null,
      label: typeof label === "string" ? label : "Purchased extra — details unavailable",
      quantity: typeof row.quantity === "number" && Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : null };
  });
}

function purchasedMiniGolf(reservation: VipPrepReservation) {
  return vipPrepExtras(reservation).filter((extra) => extra.code === "mini-golf")
    .reduce((quantity, extra) => quantity + (extra.quantity ?? 0), 0);
}

/** Exact semantic preorder evidence; timestamps are recorded separately, not guessed. */
export function vipPreorderFingerprint(reservation: VipPrepReservation) {
  return JSON.stringify({ reservationId: reservation.id, confirmationCode: reservation.confirmationCode,
    resourceCode: reservation.resource.code, operatingDate: reservation.operatingDate, startAt: new Date(reservation.startAt).toISOString(),
    endAt: new Date(reservation.endAt).toISOString(), partySize: reservation.partySize,
    foodPrep: reservation.foodPrep.map((item) => ({ code: item.code, label: item.label, quantity: item.quantity,
      unitPriceCents: item.unitPriceCents, totalCents: item.totalCents, sourceId: item.sourceId ?? null }))
      .sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0),
  });
}


function vipClock(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function vipPrepEventPlan(reservation: VipPrepReservation): EventPlan {
  const externalId = vipPrepExternalId(reservation);
  return {
    id: numericVipEventId(externalId),
    source_event_id: externalId,
    name: `${reservation.eventName} · ${reservation.resource.name}`,
    date: reservation.operatingDate,
    day: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(`${reservation.operatingDate}T12:00:00Z`)),
    time: `${vipClock(reservation.startAt)} - ${vipClock(reservation.endAt)}`,
    guest_count: reservation.partySize,
    rooms: [reservation.resource.name],
    color: reservation.resource.code === "VIPS" ? "#526D52" : "#297025",
    food: reservation.foodPrep.map((item) => `${item.quantity} ${item.label}`),
    drink_options: [],
    entertainment: purchasedMiniGolf(reservation) > 0 ? [{ name: "Mini Golf", quantity: String(purchasedMiniGolf(reservation)), time: "Open play — no reserved time", duration: "" }] : [],
    verification_status: "Paid VIP reservation imported from the read-only VIP Prep API.",
    needs_review: false,
    review_reasons: [],
    tripleseat_booking_id: reservation.confirmationCode,
    source_updated_at: reservation.updatedAt,
  };
}

export async function findVipPrepReservationByEventId(
  eventId: number | string,
  from: string,
  to: string,
  client = new VipPrepClient(),
) {
  if (!client.configured) return null;
  const payload = await client.fetchRange(from, to);
  const matches = payload.reservations.filter(
    (reservation) => isActiveVipPrepReservation(reservation) && (String(eventId).startsWith("vip-")
      ? vipPrepExternalId(reservation) === eventId
      : numericVipEventId(vipPrepExternalId(reservation)) === Number(eventId)),
  );
  if (matches.length > 1) throw new VipPrepApiError("VIP booking identity is ambiguous. Use the source reservation ID.");
  return matches[0] ?? null;
}

export function vipPrepKitchenEvents(
  reservations: readonly VipPrepReservation[],
): KitchenSourceEvent[] {
  return reservations.filter(isActiveVipPrepReservation).map((reservation) => ({
    eventId: vipPrepExternalId(reservation),
    bookingId: reservation.confirmationCode,
    eventName: reservation.eventName,
    localDate: reservation.operatingDate,
    localDateVerified: true,
    startTime: reservation.startAt,
    endTime: reservation.endAt,
    guestCount: reservation.partySize,
    status: "DEFINITE",
    statusVerified: true,
    room: reservation.resource.name,
    selections: reservation.foodPrep.map((item, index) => ({
      name: KITCHEN_SELECTION_NAME_BY_VIP_CODE[item.code] ?? "Unmapped VIP preorder item",
      quantity: item.quantity,
      sourceId: `vip-prep:${reservation.id}:${reservation.foodPrep.slice(0, index).some((other) => other.code === item.code) ? `${index}:` : ""}${encodeURIComponent(item.code)}`,
      sourceCategory: "VIP Prep",
      isFood: true,
    })),
    foodNotes: [],
    specialNotes: [],
    sourceUpdatedAt: reservation.updatedAt,
    sourceState: "fresh",
    vipBooking: { ...reservation, mappingIssues: vipPrepMappingIssues(reservation) },
  }));
}

export function vipPrepEntertainmentEvents(
  reservations: readonly VipPrepReservation[],
): EntertainmentSourceEvent[] {
  return reservations.filter((reservation) => isActiveVipPrepReservation(reservation) && !isDecemberOwnerHoldVip({
    operatingDate: reservation.operatingDate, eventName: reservation.eventName, sourceEventId: vipPrepExternalId(reservation),
    linkedTripleseatEventIds: reservation.linkedTripleseatEventIds, foodCount: reservation.foodPrep.length, extraCount: reservation.extras.length,
  })).map((reservation) => ({
    tripleseatEventId: vipPrepExternalId(reservation),
    tripleseatBookingId: reservation.confirmationCode,
    eventName: reservation.eventName,
    localDate: reservation.operatingDate,
    eventStartAt: reservation.startAt,
    eventEndAt: reservation.endAt,
    status: "DEFINITE",
    rooms: [{ id: reservation.resource.code, name: reservation.resource.name }],
    items: purchasedMiniGolf(reservation) > 0 ? [{ sourceId: `vip-prep-extra:${reservation.id}:mini-golf`, name: "Mini Golf", description: "Purchased open-play Mini Golf", categoryName: "Mini Golf", quantity: purchasedMiniGolf(reservation), startAt: null, endAt: null }] : [],
    categoryNames: ["Private Rooms"],
    sourceUpdatedAt: reservation.updatedAt,
    sourceObservedAt: reservation.lastRefreshedAt ?? null,
    noteCount: 0,
    sourceSystem: "vip-prep",
    vipFoodCount: reservation.foodPrep.length,
    vipExtraCount: reservation.extras.length,
    linkedTripleseatEventIds: reservation.linkedTripleseatEventIds ?? [],
  }));
}
