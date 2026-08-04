import {
  adminOperationsWindow,
  buildAdminConflictCenter,
  buildAdminContractEvidence,
  evaluateEventCompleteness,
  type AdminContractEvidence,
  type AdminOperationsPayload,
} from "@/lib/admin-operations";
import { getEntertainmentStorage } from "@/lib/entertainment/storage";
import { getEventPlanStorage, type StoredEventPlan } from "@/lib/event-plans/storage";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import type { EventPlan, TripleseatEventPlanSource } from "@/lib/event-plans/types";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import { isEventOver } from "@/lib/event-lifecycle";
import { getKitchenStorage } from "@/lib/kitchen/storage";
import type { KitchenChecklist } from "@/lib/kitchen/types";

type PlanWithSource = {
  plan: EventPlan;
  source: TripleseatEventPlanSource | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEventPlan(value: unknown): value is EventPlan {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.id) &&
    typeof value.name === "string" &&
    typeof value.date === "string" &&
    typeof value.day === "string" &&
    typeof value.time === "string" &&
    typeof value.guest_count === "number" &&
    typeof value.color === "string" &&
    typeof value.verification_status === "string" &&
    isStringArray(value.rooms) &&
    isStringArray(value.food) &&
    isStringArray(value.drink_options) &&
    Array.isArray(value.entertainment) &&
    value.entertainment.every(
      (item) =>
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.quantity === "string" &&
        typeof item.time === "string" &&
        typeof item.duration === "string",
    )
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNullableString(value: unknown) {
  return value === undefined || isNullableString(value);
}

function isKitchenSourceSelection(value: unknown) {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  return (
    (value.quantity === undefined || value.quantity === null || typeof value.quantity === "number") &&
    (value.sourceId === undefined || value.sourceId === null || typeof value.sourceId === "string" || typeof value.sourceId === "number") &&
    isOptionalNullableString(value.sourceCategory) &&
    (value.isFood === undefined || value.isFood === null || typeof value.isFood === "boolean")
  );
}

function isEntertainmentSourceItem(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceId === "string" &&
    typeof value.name === "string" &&
    isNullableString(value.description) &&
    isNullableString(value.categoryName) &&
    (value.quantity === null || typeof value.quantity === "number") &&
    isNullableString(value.startAt) &&
    isNullableString(value.endAt)
  );
}

function isOperationalNote(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    value.source === "event-note" &&
    isNullableString(value.sourceId) &&
    isNullableString(value.sourceCreatedAt) &&
    isNullableString(value.sourceUpdatedAt) &&
    typeof value.text === "string"
  );
}

function isEventPlanSource(value: unknown): value is TripleseatEventPlanSource {
  if (!isRecord(value)) return false;
  return (
    typeof value.eventId === "string" &&
    isNullableString(value.bookingId) &&
    typeof value.eventName === "string" &&
    typeof value.localDate === "string" &&
    isNullableString(value.eventStartAt) &&
    isNullableString(value.eventEndAt) &&
    (value.guestCount === null || typeof value.guestCount === "number") &&
    isNullableString(value.status) &&
    isStringArray(value.rooms) &&
    Array.isArray(value.selections) &&
    value.selections.every(isKitchenSourceSelection) &&
    Array.isArray(value.documentItems) &&
    value.documentItems.every(isEntertainmentSourceItem) &&
    Array.isArray(value.operationalNotes) &&
    value.operationalNotes.every(isOperationalNote) &&
    isNullableString(value.sourceUpdatedAt)
  );
}

export function decodeStoredEventPlan(row: StoredEventPlan): PlanWithSource | null {
  if (!isEventPlan(row.plan)) return null;
  return {
    plan: structuredClone(row.plan),
    source: isEventPlanSource(row.sourceSnapshot)
      ? structuredClone(row.sourceSnapshot)
      : null,
  };
}

function checklistForEvent(
  events: readonly KitchenChecklist[],
  eventId: number,
) {
  return events.find(
    (checklist) => String(checklist.event.eventId) === String(eventId),
  ) ?? null;
}

export async function loadAdminOperations(
  now = new Date(),
): Promise<AdminOperationsPayload> {
  const window = adminOperationsWindow(now);
  const eventPlanStorage = getEventPlanStorage();
  const warnings: string[] = [];
  let pairs: PlanWithSource[] = [];

  try {
    const rows = await eventPlanStorage.plansForWindow({
      startDate: window.startDate,
      endDate: window.endDate,
    });
    let invalidPlanCount = 0;
    let invalidSourceCount = 0;
    for (const row of rows) {
      const pair = decodeStoredEventPlan(row);
      if (!pair) {
        invalidPlanCount += 1;
        continue;
      }
      if (!pair.source) invalidSourceCount += 1;
      pairs.push(pair);
    }
    if (invalidPlanCount > 0) {
      warnings.push(`${invalidPlanCount} stored event plan${invalidPlanCount === 1 ? " is" : "s are"} invalid and could not be reviewed.`);
    }
    if (invalidSourceCount > 0) {
      warnings.push(`${invalidSourceCount} stored source snapshot${invalidSourceCount === 1 ? " is" : "s are"} incomplete; contract evidence is limited.`);
    }
  } catch {
    warnings.push(
      "Canonical Event Host source snapshots are unavailable; completeness evidence is limited.",
    );
  }

  if (pairs.length === 0) {
    const fallback = await loadEventPlanWindow({ now });
    pairs = fallback.plans
      .filter(
        (plan) =>
          plan.date >= window.startDate && plan.date <= window.endDate,
      )
      .map((plan) => ({ plan, source: null }));
  }

  pairs = pairs
    .filter(
      ({ plan }) =>
        plan.date > window.startDate || !isEventOver(plan, now),
    )
    .sort(
      (left, right) =>
        left.plan.date.localeCompare(right.plan.date) ||
        left.plan.time.localeCompare(right.plan.time) ||
        left.plan.name.localeCompare(right.plan.name),
    );

  const dates = [...new Set(pairs.map(({ plan }) => plan.date))];
  const kitchenStorage = getKitchenStorage();
  const floorPlanStorage = getFloorPlanStorage();
  const entertainmentStorage = getEntertainmentStorage();
  const dateData = new Map<
    string,
    {
      kitchen: KitchenChecklist[];
      floorPlan: FloorPlanDocument | null;
      entertainment: Awaited<ReturnType<typeof entertainmentStorage.getDay>>["reservations"];
    }
  >();

  await Promise.all(
    dates.map(async (date) => {
      const [kitchenResult, floorPlanResult, entertainmentResult] =
        await Promise.allSettled([
          kitchenStorage.getDay(date),
          floorPlanStorage.get(date),
          entertainmentStorage.getDay(date),
        ]);
      if (kitchenResult.status === "rejected") {
        warnings.push(`Kitchen completeness data is unavailable for ${date}.`);
      }
      if (floorPlanResult.status === "rejected") {
        warnings.push(`Structured floor-plan data is unavailable for ${date}.`);
      }
      if (entertainmentResult.status === "rejected") {
        warnings.push(`Entertainment conflict data is unavailable for ${date}.`);
      }
      dateData.set(date, {
        kitchen:
          kitchenResult.status === "fulfilled"
            ? kitchenResult.value.events
            : [],
        floorPlan:
          floorPlanResult.status === "fulfilled"
            ? floorPlanResult.value
            : null,
        entertainment:
          entertainmentResult.status === "fulfilled"
            ? entertainmentResult.value.reservations
            : [],
      });
    }),
  );

  const completeness = pairs.map(({ plan, source }) => {
    const data = dateData.get(plan.date);
    return evaluateEventCompleteness({
      plan,
      source,
      kitchen: checklistForEvent(data?.kitchen ?? [], plan.id),
      floorPlan: data?.floorPlan ?? null,
    });
  });
  const conflicts = dates.flatMap((date) => {
    const data = dateData.get(date);
    return buildAdminConflictCenter({
      date,
      plans: pairs.filter(({ plan }) => plan.date === date),
      floorPlan: data?.floorPlan ?? null,
      entertainmentReservations: data?.entertainment ?? [],
    });
  });

  return {
    generatedAt: now.toISOString(),
    windowStart: window.startDate,
    windowEnd: window.endDate,
    completeness,
    conflicts,
    warnings: [...new Set(warnings)],
  };
}

export async function loadAdminContractEvidence(
  eventId: number,
): Promise<AdminContractEvidence | null> {
  const row = await getEventPlanStorage().findById(String(eventId));
  if (!row?.active) {
    return null;
  }
  const pair = decodeStoredEventPlan(row);
  if (!pair) return null;
  let kitchen: KitchenChecklist | null = null;
  try {
    const day = await getKitchenStorage().getDay(pair.plan.date);
    kitchen = checklistForEvent(day.events, eventId);
  } catch {
    // The evidence drawer still shows the canonical Event Host snapshot.
  }
  return buildAdminContractEvidence(pair.plan, pair.source, kitchen);
}
