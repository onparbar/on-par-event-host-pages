import {
  getEntertainmentDay,
  syncEntertainmentDay,
  updateEntertainmentReservation,
} from "@/lib/entertainment/sync";
import { isHexColor } from "@/lib/entertainment/resources";
import { parseTimeRange, isValidEntertainmentDate } from "@/lib/entertainment/time";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { buildEventPlan } from "@/lib/event-plans/domain";
import { getEventPlanStorage } from "@/lib/event-plans/storage";
import { syncEventPlanWindow } from "@/lib/event-plans/sync";
import type {
  EventPlan,
  TripleseatEventPlanSource,
} from "@/lib/event-plans/types";
import { resolveAreaAlias } from "./configuration/aliases";
import { selectEntertainmentResources } from "./configuration/adjacency";
import { floorPlanEventColor } from "./configuration/colors";
import { getFloorPlanArea } from "./configuration/areas";
import { detectFloorPlanConflicts, timeRangesOverlap } from "./conflicts";
import { generateFloorPlanReservations } from "./generator";
import { floorPlanStatusAfterSourceChange } from "./lifecycle";
import { getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import {
  FLOOR_PLAN_RULE_VERSION,
  type FloorPlanDayPayload,
  type FloorPlanDocument,
  type FloorPlanEvent,
  type FloorPlanGenerationMode,
  type FloorPlanReservation,
  type FloorPlanStatus,
} from "./types";
import { hasBlockingValidationFailures, validateFloorPlan } from "./validator";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function sourceValue(row: UnknownRecord | null, key: string) {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceRooms(row: UnknownRecord | null, fallback: readonly string[]) {
  return Array.isArray(row?.rooms)
    ? row!.rooms.filter((value): value is string => typeof value === "string")
    : [...fallback];
}

function timeRange(plan: EventPlan, source: UnknownRecord | null) {
  const startAt = sourceValue(source, "eventStartAt");
  const endAt = sourceValue(source, "eventEndAt");
  if (startAt && endAt && Date.parse(endAt) > Date.parse(startAt)) {
    return { startAt, endAt };
  }
  return parseTimeRange(plan.time, plan.date) ?? { startAt: null, endAt: null };
}

function normalizedFloorPlanEvent(
  floorPlanId: string,
  plan: EventPlan,
  sourceSnapshot: UnknownRecord | null,
  index: number,
  usedColors: readonly string[],
): FloorPlanEvent {
  const rooms = sourceRooms(sourceSnapshot, plan.rooms);
  const contractedAreaIds = [...new Set(rooms.flatMap((room) => resolveAreaAlias(room) ?? []))];
  const unresolvedAreaNames = rooms.filter((room) => !resolveAreaAlias(room));
  const range = timeRange(plan, sourceSnapshot);
  const status = sourceValue(sourceSnapshot, "status") ?? "Definite";
  const fullBuyout =
    contractedAreaIds.includes("facility") || /full\s+(?:building|facility)?\s*buyout/i.test(status);
  return {
    id: `floor-plan-event-${plan.id}`,
    floorPlanId,
    tripleseatEventId: String(plan.id),
    name: plan.name,
    status,
    guestCount: plan.guest_count,
    startAt: range.startAt,
    endAt: range.endAt,
    contractedAreaIds,
    unresolvedAreaNames,
    color: isHexColor(plan.color)
      ? plan.color.toUpperCase()
      : floorPlanEventColor(index, usedColors),
    beoLastModifiedAt:
      sourceValue(sourceSnapshot, "sourceUpdatedAt") ??
      plan.source_updated_at ??
      null,
    fullBuyout,
    source: {
      rooms,
      food: [...plan.food],
      entertainment: plan.entertainment.map((item) => ({ ...item })),
      operationalNotes: (plan.operational_notes ?? []).map((note) => ({
        sourceId: note.sourceId,
        sourceUpdatedAt: note.sourceUpdatedAt,
        text: note.text,
      })),
      reviewReasons: [...(plan.review_reasons ?? [])],
    },
  };
}

async function sourceEventsForDate(date: string) {
  const eventPlanStorage = getEventPlanStorage();
  let stored: Awaited<ReturnType<typeof eventPlanStorage.plansForWindow>> = [];
  try {
    stored = await eventPlanStorage.plansForWindow({ startDate: date, endDate: date });
  } catch {
    // Exact-date redacted Event Host plans remain available before migration.
  }
  const rows = stored.length
    ? stored.map((row) => ({
        plan: buildEventPlan(
          structuredClone(row.sourceSnapshot) as unknown as TripleseatEventPlanSource,
          [],
        ),
        source: asRecord(row.sourceSnapshot),
      }))
    : [];
  return rows;
}

function createPlan(date: string, events: FloorPlanEvent[]) {
  const now = new Date().toISOString();
  const id = `floor-plan-${date}`;
  return {
    id,
    eventDate: date,
    status: "Draft" as const,
    version: 1,
    ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: null,
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    approvedBy: null,
    events: events.map((event) => ({ ...event, floorPlanId: id })),
    reservations: [],
  } satisfies FloorPlanDocument;
}

function sourceChanged(previous: FloorPlanEvent, current: FloorPlanEvent) {
  return JSON.stringify({
    guestCount: previous.guestCount,
    startAt: previous.startAt,
    endAt: previous.endAt,
    contractedAreaIds: previous.contractedAreaIds,
    unresolvedAreaNames: previous.unresolvedAreaNames,
    source: previous.source,
    status: previous.status,
    fullBuyout: previous.fullBuyout,
    beoLastModifiedAt: previous.beoLastModifiedAt,
  }) !== JSON.stringify({
    guestCount: current.guestCount,
    startAt: current.startAt,
    endAt: current.endAt,
    contractedAreaIds: current.contractedAreaIds,
    unresolvedAreaNames: current.unresolvedAreaNames,
    source: current.source,
    status: current.status,
    fullBuyout: current.fullBuyout,
    beoLastModifiedAt: current.beoLastModifiedAt,
  });
}

async function reconciledPlan(date: string, storage: FloorPlanStorage) {
  const [saved, sourceRows] = await Promise.all([
    storage.get(date),
    sourceEventsForDate(date),
  ]);
  const planId = saved?.id ?? `floor-plan-${date}`;
  const currentEvents: FloorPlanEvent[] = [];
  for (const [index, row] of sourceRows.entries()) {
    const usedColors = currentEvents.map((event) => event.color);
    const current = normalizedFloorPlanEvent(planId, row.plan, row.source, index, usedColors);
    const previous = saved?.events.find(
      (event) => event.tripleseatEventId === current.tripleseatEventId,
    );
    currentEvents.push(
      previous
        ? {
            ...current,
            id: previous.id,
            color: previous.color,
          }
        : current,
    );
  }
  if (!saved) return createPlan(date, currentEvents);
  if (currentEvents.length === 0) return saved;

  const currentIds = new Set(currentEvents.map((event) => event.id));
  const retainedReservations = saved.reservations.filter((reservation) =>
    currentIds.has(reservation.floorPlanEventId),
  );
  const changed = currentEvents.some((current) => {
    const previous = saved.events.find((event) => event.id === current.id);
    return !previous || sourceChanged(previous, current);
  }) || saved.events.some((event) => !currentIds.has(event.id));
  return {
    ...saved,
    events: currentEvents,
    reservations: retainedReservations,
    status: floorPlanStatusAfterSourceChange(saved.status, changed),
  };
}

export async function getFloorPlanDay(
  date: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
): Promise<FloorPlanDayPayload> {
  if (!isValidEntertainmentDate(date)) {
    throw new Error("Floor-plan date must use YYYY-MM-DD.");
  }
  const plan = await reconciledPlan(date, storage);
  const warnings: string[] = [];
  let entertainment: {
    reservations: FloorPlanDayPayload["entertainmentReservations"];
    conflicts: FloorPlanDayPayload["entertainmentConflicts"];
    sourceMode: FloorPlanDayPayload["sourceMode"];
    warnings: string[];
  } = {
    reservations: [],
    conflicts: [],
    sourceMode: "live" as const,
    warnings: [] as string[],
  };
  try {
    const day = await getEntertainmentDay(date);
    entertainment = {
      reservations: day.reservations,
      conflicts: day.conflicts,
      sourceMode: day.sourceMode,
      warnings: day.warnings,
    };
  } catch {
    warnings.push(
      "The shared Entertainment Schedule could not be loaded. Confirm its database migration and server configuration.",
    );
  }
  const entertainmentChangedAfterApproval =
    plan.status === "Approved" &&
    Boolean(plan.approvedAt) &&
    entertainment.reservations.some(
      (reservation) =>
        reservation.active &&
        plan.events.some((event) => sharedReservationMatchesEvent(reservation, event)) &&
        Date.parse(reservation.updatedAt) > Date.parse(plan.approvedAt!),
    );
  const effectivePlan: FloorPlanDocument = entertainmentChangedAfterApproval
    ? { ...plan, status: "Updated After Approval" }
    : plan;
  const floorPlanConflicts = detectFloorPlanConflicts(effectivePlan);
  const validation = validateFloorPlan(
    effectivePlan,
    entertainment.reservations,
    floorPlanConflicts,
    entertainment.conflicts,
  );
  return {
    date,
    plan: effectivePlan,
    entertainmentReservations: entertainment.reservations,
    floorPlanConflicts,
    entertainmentConflicts: entertainment.conflicts,
    validation,
    revisions: await storage.revisions(effectivePlan.id).catch(() => []),
    persistence: storage.persistence,
    sourceMode: entertainment.sourceMode,
    warnings: [...warnings, ...entertainment.warnings],
  };
}

export async function generateFloorPlan(
  date: string,
  mode: FloorPlanGenerationMode,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  await syncEventPlanWindow(
    { startDate: date, endDate: date },
    { legacyPlans: [] },
  );
  const plan = await reconciledPlan(date, storage);
  if (plan.events.length === 0) {
    throw new Error("No Tripleseat event plan is available for this date.");
  }
  const generated = {
    ...plan,
    status:
      plan.status === "Approved" || plan.status === "Updated After Approval"
        ? ("Updated After Approval" as const)
        : ("Draft" as const),
    ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: new Date().toISOString(),
    reservations: generateFloorPlanReservations(plan, mode),
  };
  await storage.save(generated, `Generated floor-plan suggestions (${mode}).`);
  let sharedReservations: EntertainmentReservation[] = [];
  try {
    sharedReservations = (await syncEntertainmentDay(date)).reservations;
  } catch {
    sharedReservations = (await getEntertainmentDay(date).catch(() => null))?.reservations ?? [];
  }
  await alignGeneratedEntertainment(generated, sharedReservations);
  return getFloorPlanDay(date, storage);
}

function sharedReservationMatchesEvent(
  reservation: EntertainmentReservation,
  event: FloorPlanEvent,
) {
  return (
    reservation.tripleseatEventId === event.tripleseatEventId ||
    reservation.localEventId === event.tripleseatEventId ||
    reservation.localEventId === event.id
  );
}

function supportsProximity(category: EntertainmentReservation["resourceCategory"]): category is "bowling" | "darts" | "pool" | "shuffleboard" | "mini-golf" {
  return category !== "private-rooms";
}

async function alignGeneratedEntertainment(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
) {
  for (const event of plan.events) {
    const eventReservations = reservations.filter(
      (reservation) => reservation.active && sharedReservationMatchesEvent(reservation, event),
    );
    const groups = new Map<string, EntertainmentReservation[]>();
    for (const reservation of eventReservations) {
      if (!supportsProximity(reservation.resourceCategory)) continue;
      const key = `${reservation.resourceCategory}:${reservation.startAt}:${reservation.endAt}`;
      groups.set(key, [...(groups.get(key) ?? []), reservation]);
    }

    for (const group of groups.values()) {
      const category = group[0].resourceCategory;
      if (!supportsProximity(category)) continue;
      const seatingAreaId = event.contractedAreaIds.find(
        (areaId) => getFloorPlanArea(areaId)?.isReservable,
      ) ?? "main-dining";
      const automatic = group.filter(
        (reservation) => reservation.autoAssigned && !reservation.manualOverride,
      );
      const automaticIds = new Set(automatic.map((reservation) => reservation.id));
      const unavailable = new Set(
        reservations.flatMap((reservation) =>
          reservation.active &&
          !automaticIds.has(reservation.id) &&
          timeRangesOverlap(
            group[0].startAt,
            group[0].endAt,
            reservation.startAt,
            reservation.endAt,
          )
            ? [reservation.resourceId]
            : [],
        ),
      );
      const selected = selectEntertainmentResources(
        seatingAreaId,
        category,
        automatic.length,
        unavailable,
      );

      for (const [index, reservation] of automatic.entries()) {
        const resourceId = selected[index] ?? reservation.resourceId;
        if (
          resourceId === reservation.resourceId &&
          reservation.eventColor.toUpperCase() === event.color.toUpperCase()
        ) {
          continue;
        }
        await updateEntertainmentReservation(reservation.id, {
          operatingDate: reservation.operatingDate,
          eventId: event.tripleseatEventId,
          eventName: event.name,
          resourceId,
          startAt: reservation.startAt,
          endAt: reservation.endAt,
          eventColor: event.color,
          notes: reservation.notes,
          reason: "Placed from Event Host Floor Plans using configured seating proximity",
          needsReview: reservation.needsReview,
          forceConflict: false,
        });
      }

      for (const reservation of group.filter((item) => !automaticIds.has(item.id))) {
        if (reservation.eventColor.toUpperCase() === event.color.toUpperCase()) continue;
        await updateEntertainmentReservation(reservation.id, {
          operatingDate: reservation.operatingDate,
          eventId: event.tripleseatEventId,
          eventName: event.name,
          resourceId: reservation.resourceId,
          startAt: reservation.startAt,
          endAt: reservation.endAt,
          eventColor: event.color,
          notes: reservation.notes,
          reason: "Synchronized event color from Event Host Floor Plans",
          needsReview: reservation.needsReview,
          forceConflict: false,
        });
      }
    }
  }
}

function sanitizeReservations(
  plan: FloorPlanDocument,
  requested: unknown,
) {
  if (!Array.isArray(requested)) throw new Error("Reservations must be an array.");
  const eventIds = new Set(plan.events.map((event) => event.id));
  const seen = new Set<string>();
  return requested.map((value): FloorPlanReservation => {
    const row = asRecord(value);
    const id = sourceValue(row, "id") ?? "";
    const floorPlanEventId = sourceValue(row, "floorPlanEventId") ?? "";
    const areaId = sourceValue(row, "areaId") ?? "";
    const reservationType = sourceValue(row, "reservationType") as FloorPlanReservation["reservationType"] | null;
    const area = getFloorPlanArea(areaId);
    if (
      !/^[A-Za-z0-9:_-]{1,240}$/.test(id) ||
      seen.has(id) ||
      !eventIds.has(floorPlanEventId) ||
      !area ||
      (!area.isReservable && reservationType !== "custom") ||
      !reservationType ||
      !["seating", "food-table", "room", "custom"].includes(reservationType)
    ) {
      throw new Error("A floor-plan reservation is invalid.");
    }
    seen.add(id);
    const event = plan.events.find((candidate) => candidate.id === floorPlanEventId)!;
    return {
      id,
      floorPlanEventId,
      areaId,
      reservationType,
      startAt: sourceValue(row, "startAt") ?? event.startAt,
      endAt: sourceValue(row, "endAt") ?? event.endAt,
      label: (sourceValue(row, "label") ?? "").slice(0, 80),
      source: "manual",
      lockedByUser: row?.lockedByUser !== false,
      ...(reservationType === "custom" && asRecord(row?.customGeometry)
        ? {
            customGeometry: {
              x: Math.max(0, Math.min(1920, Number(asRecord(row?.customGeometry)?.x) || 0)),
              y: Math.max(0, Math.min(1080, Number(asRecord(row?.customGeometry)?.y) || 0)),
              width: Math.max(20, Math.min(1920, Number(asRecord(row?.customGeometry)?.width) || 160)),
              height: Math.max(20, Math.min(1080, Number(asRecord(row?.customGeometry)?.height) || 60)),
            },
          }
        : {}),
    };
  });
}

export async function saveFloorPlanEdits(
  date: string,
  requested: unknown,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const body = asRecord(requested);
  const plan = await reconciledPlan(date, storage);
  if (!body) throw new Error("Invalid floor-plan save payload.");
  const requestedEvents = Array.isArray(body.events) ? body.events : [];
  const events = plan.events.map((event) => {
    const candidate = requestedEvents
      .map(asRecord)
      .find((row) => sourceValue(row, "id") === event.id);
    const color = sourceValue(candidate ?? null, "color");
    return color && isHexColor(color)
      ? { ...event, color: color.toUpperCase() }
      : event;
  });
  if (new Set(events.map((event) => event.color)).size !== events.length) {
    throw new Error("Each event on a date must use a distinct color.");
  }
  const next = {
    ...plan,
    events,
    reservations: sanitizeReservations(plan, body.reservations),
    status:
      plan.status === "Approved"
        ? ("Updated After Approval" as const)
        : plan.status,
  };
  const entertainmentDay = await getEntertainmentDay(date).catch(() => null);
  if (entertainmentDay) {
    for (const reservation of entertainmentDay.reservations) {
      if (!reservation.active) continue;
      const event = events.find(
        (candidate) =>
          candidate.tripleseatEventId === reservation.tripleseatEventId ||
          candidate.tripleseatEventId === reservation.localEventId ||
          candidate.id === reservation.localEventId,
      );
      if (!event || event.color === reservation.eventColor) continue;
      await updateEntertainmentReservation(reservation.id, {
        operatingDate: reservation.operatingDate,
        eventId: event.tripleseatEventId,
        eventName: event.name,
        resourceId: reservation.resourceId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        eventColor: event.color,
        notes: reservation.notes,
        reason: "Synchronized event color from Event Host Floor Plans",
        needsReview: reservation.needsReview,
        forceConflict: true,
      });
    }
  }
  await storage.save(next, "Saved manual floor-plan edits.");
  return getFloorPlanDay(date, storage);
}

export async function validateAndSaveFloorPlan(
  date: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const payload = await getFloorPlanDay(date, storage);
  const status: FloorPlanStatus =
    payload.floorPlanConflicts.length || payload.entertainmentConflicts.length
      ? "Conflict"
      : hasBlockingValidationFailures(payload.validation)
        ? "Needs Review"
        : "Needs Review";
  await storage.save({ ...payload.plan, status }, "Validated floor plan.");
  return getFloorPlanDay(date, storage);
}

export async function approveFloorPlan(
  date: string,
  warningsAcknowledged = false,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const payload = await getFloorPlanDay(date, storage);
  if (hasBlockingValidationFailures(payload.validation)) {
    throw new Error("Resolve every blocking validation failure before approval.");
  }
  const warningCount = payload.validation.filter(
    (entry) => entry.status === "Warning",
  ).length;
  if (warningCount > 0 && !warningsAcknowledged) {
    throw new Error("Acknowledge every non-blocking validation warning before approval.");
  }
  const now = new Date().toISOString();
  await storage.save(
    {
      ...payload.plan,
      status: "Approved",
      approvedAt: now,
      approvedBy: "authenticated-event-host-staff",
    },
    warningCount > 0
      ? `Approved floor plan after acknowledging ${warningCount} non-blocking warning${warningCount === 1 ? "" : "s"}.`
      : "Approved floor plan after validation.",
  );
  return getFloorPlanDay(date, storage);
}

export async function refreshFloorPlanSources(date: string) {
  await syncEventPlanWindow(
    { startDate: date, endDate: date },
    { legacyPlans: [] },
  );
  await syncEntertainmentDay(date);
  const storage = getFloorPlanStorage();
  const plan = await reconciledPlan(date, storage);
  if (await storage.get(date)) {
    await storage.save(
      { ...plan, lastTripleseatSyncAt: new Date().toISOString() },
      "Refreshed safe Tripleseat floor-plan fields.",
    );
  }
  return getFloorPlanDay(date, storage);
}
