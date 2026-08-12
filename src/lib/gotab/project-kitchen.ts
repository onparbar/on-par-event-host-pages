import { zonedDateTimeToIso } from "@/lib/entertainment/time";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import {
  normalizeEventFoodItem,
  type EventFoodProductMapping,
  type EventFoodSourceType,
  type NormalizedEventFoodItem,
} from "./event-food";

export type EventFoodProjectionException = {
  eventId: string;
  itemKey: string;
  foodName: string;
  reason: string;
};

export type EventFoodProjection = {
  requests: NormalizedEventFoodItem[];
  exceptions: EventFoodProjectionException[];
};

function localTimestamp(value: string | null, label: string) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`${label} is missing or invalid.`);
  return zonedDateTimeToIso(match[1], Number(match[2]), Number(match[3]));
}

type ProjectableKitchenRow = {
  key: string;
  foodName: string;
  description: string;
  quantity: number | null;
  unit: string;
  numberOfPans: number | null;
  panSize: "1/3" | "1/2" | null;
};

function mappingKey(row: ProjectableKitchenRow) {
  const panSize = row.panSize === "1/3"
    ? "THIRD_PAN"
    : row.panSize === "1/2"
      ? "HALF_PAN"
      : row.unit.toLowerCase().includes("pretzel plate")
        ? "TRAY"
        : row.unit.toLowerCase().includes("bowl")
          ? "BOWL"
          : "NOT_APPLICABLE";
  return `${row.key}:${panSize}`;
}

export function projectKitchenChecklist(
  checklist: KitchenChecklist,
  mappings: readonly EventFoodProductMapping[],
  options: {
    sourceType?: EventFoodSourceType;
    sourceVersion: number;
    requesterName?: string | null;
    defaultPrepLeadMinutes?: number;
  },
): EventFoodProjection {
  const eventId = String(checklist.event.eventId);
  const rows: ProjectableKitchenRow[] = [
    ...checklist.sections.flatMap((section) => section.rows),
    ...checklist.liveFoodAddOns.map((item) => ({
      key: item.itemKey,
      foodName: item.foodName,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      numberOfPans: item.numberOfPans,
      panSize: item.panSize,
    })),
  ];
  const mappingByKey = new Map(mappings.map((mapping) => [
    `${mapping.canonicalProductKey}:${mapping.panSize}`,
    mapping,
  ]));
  const requests: NormalizedEventFoodItem[] = [];
  const exceptions: EventFoodProjectionException[] = [];
  let foodServiceAt: string;
  let prepDueAt: string;
  try {
    foodServiceAt = localTimestamp(checklist.timing.foodReadyBy, "Food service time");
    prepDueAt = checklist.timing.earliestPrepTime
      ? localTimestamp(checklist.timing.earliestPrepTime, "Prep due time")
      : new Date(
          Date.parse(foodServiceAt) - (options.defaultPrepLeadMinutes ?? 60) * 60_000,
        ).toISOString();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Kitchen timing is invalid.";
    return {
      requests,
      exceptions: rows.map((row) => ({ eventId, itemKey: row.key, foodName: row.foodName, reason })),
    };
  }

  for (const row of rows) {
    const quantity = row.numberOfPans ?? row.quantity;
    if (!Number.isSafeInteger(quantity) || quantity == null || quantity <= 0) {
      exceptions.push({
        eventId,
        itemKey: row.key,
        foodName: row.foodName,
        reason: "A positive operational quantity is required.",
      });
      continue;
    }
    const mapping = mappingByKey.get(mappingKey(row)) ?? null;
    if (!mapping || !mapping.gotabProductUuid) {
      exceptions.push({
        eventId,
        itemKey: row.key,
        foodName: row.foodName,
        reason: "A verified GoTab product mapping is required.",
      });
      continue;
    }
    try {
      requests.push(normalizeEventFoodItem(row, {
        id: `${eventId}-${row.key}-${options.sourceVersion}`,
        eventId,
        tripleseatEventId: eventId.startsWith("vip-") ? null : eventId,
        tripleseatBookingId: checklist.event.bookingId == null ? null : String(checklist.event.bookingId),
        sourceType: options.sourceType ?? (eventId.startsWith("vip-") ? "VIP_ADDON" : "TRIPLESEAT_CONTRACT"),
        sourceRecordId: row.key,
        sourceVersion: options.sourceVersion,
        originalSourceName: row.foodName,
        eventName: checklist.event.name,
        eventArea: checklist.event.room,
        foodServiceAt,
        prepDueAt,
        requesterName: options.requesterName ?? null,
        requestNotes: null,
        dietaryNotes: checklist.event.foodNotes?.map((note) => note.text).join(" | ") || null,
        allergyNotes: null,
      }, mapping));
    } catch (error) {
      exceptions.push({
        eventId,
        itemKey: row.key,
        foodName: row.foodName,
        reason: error instanceof Error ? error.message : "The food row could not be normalized.",
      });
    }
  }
  return { requests, exceptions };
}
