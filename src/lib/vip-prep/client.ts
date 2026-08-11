import type { EntertainmentSourceEvent } from "@/lib/entertainment/types";
import type { KitchenSourceEvent } from "@/lib/kitchen/types";

const DEFAULT_VIP_PREP_API_URL = "https://rexreplace.vercel.app/api/vip-prep";
const KITCHEN_SELECTION_NAME_BY_VIP_CODE: Readonly<Record<string, string>> = {
  wings: "Wing Platter",
  "mozzarella-sticks": "Mozzarella Sticks",
  "tater-kegs": "Tater Kegs",
  "fry-platters": "Fry Platter",
  "chicken-tenders": "Chicken Tenders",
  "veggie-tray": "Veggie Tray",
  "dessert-platter": "Dessert Platter",
};

export type VipPrepFoodItem = {
  code: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

export type VipPrepReservation = {
  id: string;
  confirmationCode: string;
  operatingDate: string;
  resource: {
    code: "VIPS" | "VIPL";
    name: string;
  };
  eventName: string;
  guestName: string;
  partySize: number;
  startAt: string;
  endAt: string;
  status: "confirmed" | "checked_in";
  foodPrep: VipPrepFoodItem[];
  extras: unknown[];
  updatedAt: string;
};

export type VipPrepPayload = {
  from: string;
  to: string;
  timeZone: "America/New_York";
  generatedAt: string;
  reservationCount: number;
  reservations: VipPrepReservation[];
};

type VipPrepClientOptions = {
  env?: NodeJS.ProcessEnv;
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
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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
    (row.status !== "confirmed" && row.status !== "checked_in") ||
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
    status: row.status,
    foodPrep: parsedFood,
    extras: Array.isArray(row.extras) ? row.extras : [],
    updatedAt: row.updatedAt,
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
      !Array.isArray(value.reservations)
    ) {
      throw new VipPrepApiError("VIP Prep API returned an invalid response.");
    }
    const reservations = value.reservations.map(parseReservation).filter(
      (reservation) => reservation.operatingDate >= from && reservation.operatingDate <= to,
    );
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

export function vipPrepExternalId(reservation: Pick<VipPrepReservation, "id">) {
  return `vip-${reservation.id}`;
}

export function vipPrepKitchenEvents(
  reservations: readonly VipPrepReservation[],
): KitchenSourceEvent[] {
  return reservations.filter((reservation) => reservation.foodPrep.length > 0).map((reservation) => ({
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
    selections: reservation.foodPrep.map((item) => ({
      name: KITCHEN_SELECTION_NAME_BY_VIP_CODE[item.code] ?? item.label,
      quantity: item.quantity,
      sourceId: `vip-prep:${reservation.id}:${item.code}`,
      sourceCategory: "VIP Prep",
      isFood: true,
    })),
    foodNotes: [],
    specialNotes: [],
    sourceUpdatedAt: reservation.updatedAt,
    sourceState: "fresh",
  }));
}

export function vipPrepEntertainmentEvents(
  reservations: readonly VipPrepReservation[],
): EntertainmentSourceEvent[] {
  return reservations.map((reservation) => ({
    tripleseatEventId: vipPrepExternalId(reservation),
    tripleseatBookingId: reservation.confirmationCode,
    eventName: reservation.eventName,
    localDate: reservation.operatingDate,
    eventStartAt: reservation.startAt,
    eventEndAt: reservation.endAt,
    status: "DEFINITE",
    rooms: [{ id: reservation.resource.code, name: reservation.resource.name }],
    items: [],
    categoryNames: ["Private Rooms"],
    sourceUpdatedAt: reservation.updatedAt,
    noteCount: 0,
    sourceSystem: "vip-prep",
  }));
}
