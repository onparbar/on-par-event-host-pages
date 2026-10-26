import {
  getEntertainmentDay,
  syncEntertainmentDay,
  updateEntertainmentReservation,
} from "@/lib/entertainment/sync";
import { validEntertainmentInterval } from "@/lib/entertainment/domain";
import {
  deterministicEventColor,
  isHexColor,
} from "@/lib/entertainment/resources";
import {
  addCalendarDays,
  formatClock,
  parseTimeRange,
  isValidEntertainmentDate,
  todayInEntertainmentTimeZone,
} from "@/lib/entertainment/time";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { buildEventPlan } from "@/lib/event-plans/domain";
import { getEventPlanStorage } from "@/lib/event-plans/storage";
import { syncEventPlanWindow } from "@/lib/event-plans/sync";
import type {
  EventPlan,
  TripleseatEventPlanSource,
} from "@/lib/event-plans/types";
import {
  VipPrepClient,
  isActiveVipPrepReservation,
  type VipPrepReservation,
  vipPrepExternalId,
  numericVipEventId,
} from "@/lib/vip-prep/client";
import { inactiveVipIsNewer, KNOWN_INACTIVE_VIP_WARNING, knownInactiveVipBookings } from "@/lib/vip-prep/known-inactive";
import {
  confirmedContractDatesInWindow,
  confirmedContractEventPlans,
  confirmedContractEventPlanSourcesForDate,
  eventMatchesConfirmedContract,
  sourceIsAtLeastAsNew,
} from "@/lib/confirmed-contract-events";
import { resolveAreaAlias } from "./configuration/aliases";
import { selectEntertainmentResources } from "./configuration/adjacency";
import {
  distinctFloorPlanEventColor,
  ensureDistinctFloorPlanEventColors,
  floorPlanEventColorsAreDistinct,
} from "./configuration/colors";
import { getFloorPlanArea, requiredFoodTableCount } from "./configuration/areas";
import { detectFloorPlanConflicts, timeRangesOverlap } from "./conflicts";
import {
  entertainmentReservationMatchesFloorPlanEvent,
  floorPlanEventSourceIds,
} from "./identity";
import {
  resolveFloorPlanSourceRows,
  type FloorPlanSourceRow,
} from "./source-resolution";
import {
  generateFloorPlanReservations,
  generateFloorPlanReservationProposal,
  reservationAllowedForFloorPlanEvent,
  reservationForCurrentFloorPlanEvent,
  isVipOnlyFloorPlanEvent,
} from "./generator";
import { reservationTimingSource, sameReservationInterval } from "./reservation-state";
import { floorPlanPublicationDates } from "./publication";
import { seatingCoverageMessage, summarizeEventSeating } from "./seating-summary";
import { floorPlanStatusAfterSourceChange } from "./lifecycle";
import { floorPlanStorageAtVersion, getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import { StaleSaveError } from "@/lib/stale-save";
import {
  FLOOR_PLAN_RULE_VERSION,
  type FloorPlanDayPayload,
  type FloorPlanDocument,
  type FloorPlanEvent,
  type FloorPlanGenerationMode,
  type FloorPlanReservation,
  type FloorPlanStatus,
  type FloorPlanSourceChange,
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

function sourceBoolean(row: UnknownRecord | null, key: string) {
  return row?.[key] === true;
}

function sourceRooms(row: UnknownRecord | null, fallback: readonly string[]) {
  return Array.isArray(row?.rooms)
    ? row!.rooms.filter((value): value is string => typeof value === "string")
    : [...fallback];
}

function sourceStrings(row: UnknownRecord | null, key: string) {
  return Array.isArray(row?.[key])
    ? row![key].filter((value): value is string => typeof value === "string")
    : [];
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
  sourceEventId = String(plan.id),
): FloorPlanEvent {
  const rooms = sourceRooms(sourceSnapshot, plan.rooms);
  const contractedAreaIds = [...new Set(rooms.flatMap((room) => resolveAreaAlias(room) ?? []))];
  const unresolvedAreaNames = rooms.filter((room) => !resolveAreaAlias(room));
  const range = timeRange(plan, sourceSnapshot);
  const status = sourceValue(sourceSnapshot, "status") ?? "Definite";
  const fullBuyout =
    sourceBoolean(sourceSnapshot, "fullBuyout") ||
    contractedAreaIds.includes("facility") ||
    /full\s+(?:building|facility)?\s*buyout/i.test(status);
  const sourceEventIds = [
    ...new Set([
      sourceEventId,
      ...sourceStrings(sourceSnapshot, "sourceEventIds"),
    ]),
  ];
  const verifiedSourceEventIds = sourceStrings(sourceSnapshot, "verifiedSourceEventIds");
  const onParBookingAreaIds = sourceStrings(
    sourceSnapshot,
    "onParBookingRooms",
  ).flatMap((room) => resolveAreaAlias(room) ?? []);
  return {
    id: `floor-plan-event-${sourceEventId.startsWith("vip-") ? sourceEventId : plan.id}`,
    floorPlanId,
    tripleseatEventId: sourceEventId,
    name: plan.name,
    status,
    guestCount: plan.guest_count,
    startAt: range.startAt,
    endAt: range.endAt,
    contractedAreaIds,
    unresolvedAreaNames,
    color: distinctFloorPlanEventColor(
      isHexColor(plan.color) ? plan.color : null,
      index,
      usedColors,
    ),
    beoLastModifiedAt:
      sourceValue(sourceSnapshot, "sourceUpdatedAt") ??
      plan.source_updated_at ??
      null,
    fullBuyout,
    source: {
      rooms,
      ...(sourceEventIds.length > 1 ? { sourceEventIds } : {}),
      ...(verifiedSourceEventIds.length ? { verifiedSourceEventIds } : {}),
      ...(sourceSnapshot?.onParBooking && asRecord(sourceSnapshot.onParBooking) ? { onParBooking: sourceSnapshot.onParBooking as NonNullable<FloorPlanEvent["source"]["onParBooking"]> } : {}),
      ...(onParBookingAreaIds.length > 0 ? { onParBookingAreaIds } : {}),
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

function vipEventPlan(reservation: VipPrepReservation): EventPlan {
  const externalId = vipPrepExternalId(reservation);
  const date = new Date(`${reservation.operatingDate}T12:00:00Z`);
  return {
    id: numericVipEventId(externalId),
    name: reservation.eventName,
    date: reservation.operatingDate,
    day: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date),
    time: `${formatClock(reservation.startAt)} - ${formatClock(reservation.endAt)}`,
    guest_count: reservation.partySize,
    rooms: [reservation.resource.name],
    color: deterministicEventColor(externalId),
    food: reservation.foodPrep.map((item) => `${item.quantity} ${item.label}`),
    drink_options: [],
    entertainment: [],
    verification_status: "Paid VIP reservation imported from the read-only VIP Prep API.",
    needs_review: false,
    review_reasons: [],
    tripleseat_booking_id: reservation.confirmationCode,
    source_updated_at: reservation.updatedAt,
    synced_at: new Date().toISOString(),
  };
}

type FloorPlanReadOptions = { vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">; readOnly?: boolean };

async function sourceEventsForDate(date: string, options: FloorPlanReadOptions = {}) {
  const eventPlanStorage = getEventPlanStorage();
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  let stored: Awaited<ReturnType<typeof eventPlanStorage.plansForWindow>> = [];
  let sourceWindowWasSynchronized = false;
  let lastSuccessfulSyncAt: string | null = null;
  let synchronizedWindow: { startDate: string; endDate: string } | null = null;
  const warnings: string[] = [];
  try {
    const [rows, syncState] = await Promise.all([
      eventPlanStorage.plansForWindow({ startDate: date, endDate: date }),
      eventPlanStorage.getSyncState(),
    ]);
    stored = rows;
    lastSuccessfulSyncAt = syncState?.lastSuccessfulSyncAt ?? null;
    sourceWindowWasSynchronized = Boolean(
      syncState?.status === "success" &&
      syncState.windowStart <= date &&
      syncState.windowEnd >= date,
    );
    synchronizedWindow = syncState
      ? {
          startDate: syncState.windowStart,
          endDate: syncState.windowEnd,
        }
      : null;
  } catch {
    warnings.push("Tripleseat source could not be loaded; its saved floor-plan assignments are retained.");
  }
  const tripleseatRows: FloorPlanSourceRow[] = stored.length
    ? stored.map((row) => ({
        plan: buildEventPlan(
          structuredClone(row.sourceSnapshot) as unknown as TripleseatEventPlanSource,
          [],
        ),
        source: asRecord(row.sourceSnapshot),
        sourceEventId: row.eventId,
      }))
    : [];
  let vipPayload: Awaited<ReturnType<VipPrepClient["fetchRange"]>> | null = null;
  let knownInactiveVipIds = new Set<string>();
  let knownInactiveVipObservations = new Map<string, string>();
  if (vipPrepClient.configured) {
    try { vipPayload = await vipPrepClient.fetchRange(date, date); }
    catch {
      warnings.push("On Par Bookings is unavailable; its last saved VIP floor-plan assignments remain visible unless known inactive.");
      const inactive = await knownInactiveVipBookings(date);
      knownInactiveVipIds = inactive.ids;
      knownInactiveVipObservations = inactive.observations;
      warnings.push(...inactive.warnings);
    }
  }
  const vipRows: FloorPlanSourceRow[] = (
    vipPayload?.reservations ?? []
  ).filter(isActiveVipPrepReservation).map((reservation) => ({
    plan: vipEventPlan(reservation),
    source: {
      status: "DEFINITE",
      rooms: [reservation.resource.name],
      eventStartAt: reservation.startAt,
      eventEndAt: reservation.endAt,
      sourceUpdatedAt: reservation.updatedAt,
      sourceSystem: "vip-prep",
      linkedTripleseatEventIds: reservation.linkedTripleseatEventIds ?? [],
      onParBooking: {
        reservationId: reservation.id, confirmationCode: reservation.confirmationCode,
        sourceUpdatedAt: reservation.updatedAt, refreshedAt: vipPayload!.generatedAt,
        linkedTripleseatEventIds: reservation.linkedTripleseatEventIds ?? [],
      },
    } satisfies UnknownRecord,
    sourceEventId: vipPrepExternalId(reservation),
  }));
  const liveRows = [...tripleseatRows, ...vipRows];
  const confirmedRows = confirmedContractEventPlanSourcesForDate(
    date,
    lastSuccessfulSyncAt,
    synchronizedWindow,
  )
    .filter(
      (row) =>
        !liveRows.some((candidate) =>
          !candidate.sourceEventId.startsWith("vip-") && eventMatchesConfirmedContract(
            candidate.plan.date,
            candidate.plan.name,
            row.plan.date,
            row.plan.name,
          ) &&
          sourceIsAtLeastAsNew(
            candidate.plan.source_updated_at,
            row.plan.source_updated_at,
          ),
        ),
    )
    .map((row) => ({
      plan: row.plan,
      source: asRecord(row.source),
      sourceEventId: row.sourceEventId,
    }));
  const rows = resolveFloorPlanSourceRows([
    ...liveRows.filter(
      (candidate) =>
        !confirmedRows.some((confirmed) =>
          !candidate.sourceEventId.startsWith("vip-") && eventMatchesConfirmedContract(
            candidate.plan.date,
            candidate.plan.name,
            confirmed.plan.date,
            confirmed.plan.name,
          ),
        ),
    ),
    ...confirmedRows,
  ]);
  return {
    warnings,
    knownInactiveVipIds,
    knownInactiveVipObservations,
    vipAuthoritative: vipPayload !== null,
    tripleseatAuthoritative: stored.length > 0 || sourceWindowWasSynchronized,
    rows: rows.filter(
      (row) =>
        sourceValue(row.source, "status")?.toUpperCase() === "DEFINITE" ||
        sourceBoolean(row.source, "fullBuyout") ||
        /full\s+(?:building|facility)?\s*buyout/i.test(
          sourceValue(row.source, "status") ?? "",
        ) ||
        sourceValue(row.source, "sourceSystem") === "contract-evidence",
    ),
    sourceRowCount:
      vipPayload !== null || knownInactiveVipIds.size > 0 || stored.length + vipRows.length + confirmedRows.length > 0 ||
      sourceWindowWasSynchronized
        ? 1
        : 0,
  };
}

function createPlan(date: string, events: FloorPlanEvent[]) {
  const now = new Date().toISOString();
  const id = `floor-plan-${date}`;
  return {
    id,
    eventDate: date,
    status: "Draft" as const,
    version: 0,
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
  const sourceFacts = (event: FloorPlanEvent) => {
    const { floorPlanChanges: _changes, seatingGenerationIssues: _issues, onParBooking, ...source } = event.source;
    if (!onParBooking) return source;
    const { refreshedAt: _refreshed, ...bookingFacts } = onParBooking;
    return { ...source, onParBooking: bookingFacts };
  };
  return JSON.stringify({
    guestCount: previous.guestCount,
    startAt: previous.startAt,
    endAt: previous.endAt,
    contractedAreaIds: previous.contractedAreaIds,
    unresolvedAreaNames: previous.unresolvedAreaNames,
    source: sourceFacts(previous),
    status: previous.status,
    fullBuyout: previous.fullBuyout,
    beoLastModifiedAt: previous.beoLastModifiedAt,
  }) !== JSON.stringify({
    guestCount: current.guestCount,
    startAt: current.startAt,
    endAt: current.endAt,
    contractedAreaIds: current.contractedAreaIds,
    unresolvedAreaNames: current.unresolvedAreaNames,
    source: sourceFacts(current),
    status: current.status,
    fullBuyout: current.fullBuyout,
    beoLastModifiedAt: current.beoLastModifiedAt,
  });
}

function contractSeatingChanges(previous: FloorPlanEvent, current: FloorPlanEvent): FloorPlanSourceChange[] {
  const changes: FloorPlanSourceChange[] = [];
  const add = (field: FloorPlanSourceChange["field"], previousValue: string, currentValue: string, message: string) => {
    if (previousValue !== currentValue) changes.push({ eventId: current.id, field, previousValue, currentValue, message });
  };
  add("guestCount", String(previous.guestCount), String(current.guestCount), `Guest count changed from ${previous.guestCount} to ${current.guestCount}; review full-event seating capacity.`);
  const areaNames = (event: FloorPlanEvent) => event.contractedAreaIds.map((id) => getFloorPlanArea(id)?.name ?? id).sort().join(", ");
  add("contractedArea", areaNames(previous), areaNames(current), `Contracted area changed from ${areaNames(previous) || "not listed"} to ${areaNames(current) || "not listed"}; existing staff choices are retained for review.`);
  const interval = (event: FloorPlanEvent) => [event.startAt, event.endAt].map((time) => time && Number.isFinite(Date.parse(time))
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time)) : "not listed").join(" – ");
  if (!sameReservationInterval(previous, current)) {
    add("eventTime", interval(previous), interval(current), `Event time changed from ${interval(previous)} to ${interval(current)}. Event-following holds move; explicit seating-time overrides stay fixed and require coverage review.`);
  }
  const foodCount = (event: FloorPlanEvent) => isVipOnlyFloorPlanEvent(event) ? 0 : requiredFoodTableCount(event.guestCount);
  add("foodTables", String(foodCount(previous)), String(foodCount(current)), `Food-table requirement changed from ${foodCount(previous)} to ${foodCount(current)}.`);
  return changes;
}

export function reservationsForReconciledFloorPlanEvents(
  saved: FloorPlanDocument,
  currentEvents: readonly FloorPlanEvent[],
) {
  const savedEventsById = new Map(
    saved.events.map((event) => [event.id, event]),
  );
  const retainedByAssignment = new Map<string, FloorPlanReservation>();
  for (const reservation of saved.reservations) {
    const savedEvent = savedEventsById.get(reservation.floorPlanEventId);
    if (
      savedEvent &&
      !reservationAllowedForFloorPlanEvent(savedEvent, reservation)
    ) {
      continue;
    }
    const compatible = (candidate: FloorPlanEvent) =>
      reservationAllowedForFloorPlanEvent(candidate, {
        ...reservation,
        floorPlanEventId: candidate.id,
      });
    const containsReservationArea = (candidate: FloorPlanEvent) => {
      const area = getFloorPlanArea(reservation.areaId);
      return candidate.contractedAreaIds.includes(reservation.areaId) ||
        Boolean(
          area?.parentAreaId &&
            candidate.contractedAreaIds.includes(area.parentAreaId),
        );
    };
    const exactEvents = currentEvents.filter(
      (candidate) =>
        candidate.id === reservation.floorPlanEventId && compatible(candidate),
    );
    const aliasEvents = savedEvent
      ? currentEvents.filter(
          (candidate) =>
            floorPlanEventsShareSource(candidate, savedEvent) &&
            compatible(candidate),
        )
      : [];
    const event =
      exactEvents.find(containsReservationArea) ??
      aliasEvents.find(containsReservationArea) ??
      exactEvents[0] ??
      aliasEvents[0];
    if (!event) continue;
    const followsChangedEvent = savedEvent && !sameReservationInterval(savedEvent, event);
    const timingSource = savedEvent ? reservationTimingSource(reservation, savedEvent) : reservation.timingSource;
    const current = reservationForCurrentFloorPlanEvent(event, {
      ...reservation,
      floorPlanEventId: event.id,
      ...(followsChangedEvent ? {
        timingSource,
        ...(timingSource === "event-default" ? { changeDetails: { fields: ["startAt", "endAt"], reason: "Contract event time changed; seating follows the event while physical placement is preserved." } } : {}),
      } : {}),
    });
    if (!current) continue;
    const key = current.reservationType === "custom"
      ? `${event.id}:custom:${current.id}`
      : `${event.id}:${current.areaId}:${current.reservationType}`;
    const existing = retainedByAssignment.get(key);
    if (!existing || (!existing.lockedByUser && current.lockedByUser)) {
      retainedByAssignment.set(key, current);
    }
  }
  return [...retainedByAssignment.values()];
}

function floorPlanEventsShareSource(
  left: FloorPlanEvent,
  right: FloorPlanEvent,
) {
  // Historical trace IDs can preserve a staff draft while old merged rows split;
  // they are not verification for merging bookings or matching entertainment.
  const traceIds = (event: FloorPlanEvent) => [event.tripleseatEventId, ...(event.source.sourceEventIds ?? []), ...(event.source.verifiedSourceEventIds ?? [])];
  const leftIds = new Set(traceIds(left));
  return traceIds(right).some((id) => leftIds.has(id));
}

export function floorPlanEventsWithSavedIdentity(
  currentEvents: readonly FloorPlanEvent[],
  savedEvents: readonly FloorPlanEvent[],
) {
  const matchedSavedIndexes = new Set<number>();
  const previousByCurrentIndex = new Map<number, FloorPlanEvent>();

  const uniqueSavedId = (event: FloorPlanEvent) => savedEvents.filter((candidate) => candidate.id === event.id).length === 1;
  for (const [currentIndex, current] of currentEvents.entries()) {
    const candidates = savedEvents.map((event, index) => ({ event, index })).filter(
      ({ event, index }) =>
        uniqueSavedId(event) &&
        !matchedSavedIndexes.has(index) &&
        event.tripleseatEventId === current.tripleseatEventId,
    );
    if (candidates.length !== 1) continue;
    const savedIndex = candidates[0].index;
    matchedSavedIndexes.add(savedIndex);
    previousByCurrentIndex.set(currentIndex, savedEvents[savedIndex]);
  }
  for (const [currentIndex, current] of currentEvents.entries()) {
    if (previousByCurrentIndex.has(currentIndex)) continue;
    const currentIds = floorPlanEventSourceIds(current);
    const candidates = savedEvents.map((event, index) => ({ event, index })).filter(
      ({ event, index }) =>
        uniqueSavedId(event) &&
        !matchedSavedIndexes.has(index) &&
        [...floorPlanEventSourceIds(event)].some((id) => currentIds.has(id)),
    );
    if (candidates.length !== 1) continue;
    const savedIndex = candidates[0].index;
    const matchingCurrent = currentEvents.filter((event) => [...floorPlanEventSourceIds(event)].some((id) => floorPlanEventSourceIds(savedEvents[savedIndex]).has(id)));
    if (matchingCurrent.length !== 1) continue;
    matchedSavedIndexes.add(savedIndex);
    previousByCurrentIndex.set(currentIndex, savedEvents[savedIndex]);
  }

  const reconciled: FloorPlanEvent[] = [];
  for (const [index, current] of currentEvents.entries()) {
    const previous = previousByCurrentIndex.get(index);
    const color = distinctFloorPlanEventColor(
      previous && isHexColor(previous.color) ? previous.color : current.color,
      index,
      reconciled.map((event) => event.color),
    );
    reconciled.push(
      previous ? { ...current, id: previous.id, color } : { ...current, color },
    );
  }
  return reconciled;
}

/** Live booked VIP holds are a read projection, not staff arrival or a Save. */
export function projectVipFloorPlanReservations(plan: FloorPlanDocument) {
  const reservations = [...plan.reservations];
  for (const event of plan.events) {
    if (!event.tripleseatEventId.startsWith("vip-") || !event.source.onParBooking) continue;
    for (const areaId of event.source.onParBookingAreaIds ?? event.contractedAreaIds) {
      if (!["vip-1", "vip-2"].includes(areaId)) continue;
      if (reservations.some((row) => row.floorPlanEventId === event.id && row.areaId === areaId && row.reservationType === "room" && sameReservationInterval(row, event))) continue;
      const canonicalId = `${event.id}:room:${areaId}`;
      const id = reservations.some((row) => row.id === canonicalId) ? `vip-source:${canonicalId}` : canonicalId;
      reservations.push({ id, floorPlanEventId: event.id, areaId, reservationType: "room", startAt: event.startAt, endAt: event.endAt,
        label: getFloorPlanArea(areaId)?.shortLabel ?? areaId, source: "generated", lockedByUser: false, timingSource: "event-default" });
    }
  }
  return { ...plan, reservations };
}

async function reconciledPlan(date: string, storage: FloorPlanStorage, options: FloorPlanReadOptions = {}) {
  const [saved, sourceResult] = await Promise.all([
    storage.get(date),
    sourceEventsForDate(date, options),
  ]);
  const finish = (plan: FloorPlanDocument) => ({ ...projectVipFloorPlanReservations(plan), sourceWarnings: sourceResult.warnings });
  if (saved?.events.some((event, index) => saved.events.findIndex((candidate) => candidate.id === event.id) !== index)) {
    sourceResult.warnings.push("Saved floor-plan event identities are duplicated. Canonical booking identities are shown; ambiguous historical staff assignments require review.");
  }
  const sourceRows = sourceResult.rows;
  const planId = saved?.id ?? `floor-plan-${date}`;
  const normalizedEvents: FloorPlanEvent[] = [];
  for (const [index, row] of sourceRows.entries()) {
    normalizedEvents.push(
      normalizedFloorPlanEvent(
        planId,
        row.plan,
        row.source,
        index,
        normalizedEvents.map((event) => event.color),
        row.sourceEventId,
      ),
    );
  }
  for (const event of saved?.events ?? []) {
    const vip = event.tripleseatEventId.startsWith("vip-");
    if (vip && inactiveVipIsNewer(sourceResult.knownInactiveVipObservations, event.tripleseatEventId,
      event.source.onParBooking?.refreshedAt ?? event.beoLastModifiedAt)) {
      if (!sourceResult.warnings.includes(KNOWN_INACTIVE_VIP_WARNING)) sourceResult.warnings.push(KNOWN_INACTIVE_VIP_WARNING);
      continue;
    }
    if (vip ? sourceResult.vipAuthoritative : sourceResult.tripleseatAuthoritative) continue;
    if (!normalizedEvents.some((candidate) => candidate.tripleseatEventId === event.tripleseatEventId)) normalizedEvents.push(event);
  }
  const currentEvents = floorPlanEventsWithSavedIdentity(
    normalizedEvents,
    saved?.events ?? [],
  ).map((event) => {
    const previous = saved?.events.find((candidate) => candidate.id === event.id);
    if (!previous) return event;
    const changes = contractSeatingChanges(previous, event);
    const floorPlanChanges = changes.length ? changes : previous.source.floorPlanChanges;
    return { ...event, source: { ...event.source,
      ...(floorPlanChanges?.length ? { floorPlanChanges } : {}),
      ...(previous.source.seatingGenerationIssues?.length ? { seatingGenerationIssues: previous.source.seatingGenerationIssues } : {}),
    } };
  });
  if (!saved) {
    if (!currentEvents.length && sourceResult.warnings.length) throw new Error(sourceResult.warnings.join(" "));
    return finish(createPlan(date, currentEvents));
  }
  if (currentEvents.length === 0) {
    return finish(sourceResult.sourceRowCount > 0
      ? {
          ...saved,
          events: [],
          reservations: [],
          status: floorPlanStatusAfterSourceChange(saved.status, saved.events.length > 0),
        }
      : {
          ...saved,
          events: ensureDistinctFloorPlanEventColors(saved.events),
        });
  }

  const currentIds = new Set(currentEvents.map((event) => event.id));
  const retainedReservations = reservationsForReconciledFloorPlanEvents(
    saved,
    currentEvents,
  );
  const eventsWithSeatingAttention = currentEvents.map((event) => {
    const previous = saved.events.find((candidate) => candidate.id === event.id);
    if (!previous || !contractSeatingChanges(previous, event).length) return event;
    const summary = summarizeEventSeating(event, retainedReservations, { allReservations: retainedReservations });
    if (summary.fullEventCoverage && summary.foodAssigned >= summary.foodRequired && !summary.issues.length) return event;
    const before = summarizeEventSeating(previous, saved.reservations, { allReservations: saved.reservations });
    const change: FloorPlanSourceChange = {
      eventId: event.id, field: "assignments",
      previousValue: `${before.coveredCapacity} full-event seats; ${before.foodAssigned} food tables`,
      currentValue: `${summary.coveredCapacity} full-event seats; ${summary.foodAssigned} food tables`,
      message: `Existing assignments need attention after the contract change. ${seatingCoverageMessage(event, summary)} Food tables: ${summary.foodAssigned} assigned / ${summary.foodRequired} required.`,
    };
    return { ...event, source: { ...event.source, floorPlanChanges: [...(event.source.floorPlanChanges ?? []).filter((item) => item.field !== "assignments"), change] } };
  });
  const changed = currentEvents.some((current) => {
    const previous = saved.events.find((event) => event.id === current.id);
    return !previous || sourceChanged(previous, current);
  }) || saved.events.some((event) => !currentIds.has(event.id));
  return finish({
    ...saved,
    events: eventsWithSeatingAttention,
    reservations: retainedReservations,
    status: floorPlanStatusAfterSourceChange(saved.status, changed),
  });
}

export async function getFloorPlanDay(
  date: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  options: FloorPlanReadOptions = {},
): Promise<FloorPlanDayPayload> {
  if (!isValidEntertainmentDate(date)) {
    throw new Error("Floor-plan date must use YYYY-MM-DD.");
  }
  let plan = await reconciledPlan(date, storage, options);
  const warnings: string[] = [...plan.sourceWarnings];
  if (plan.ruleVersion !== FLOOR_PLAN_RULE_VERSION) {
    warnings.push(
      "This saved floor plan uses an earlier seating rule version. Select ‘Replace generated only’, then ‘Generate Floor Plan’ to refresh seating highlights; manual and locked assignments are preserved.",
    );
  }
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
    const day = await getEntertainmentDay(date, { vipPrepClient: options.vipPrepClient, readOnly: options.readOnly, floorPlanStorage: storage, floorPlanEvents: plan.events });
    plan = { ...plan, events: plan.events.map((event) => ({ ...event, color: day.floorPlanEventColors?.[event.id] ?? event.color })) };
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
    warnings: [...warnings, ...entertainment.warnings, ...effectivePlan.events.flatMap((event) => (event.source.seatingGenerationIssues ?? []).map((issue) => issue.message))],
    sourceChanges: effectivePlan.events.flatMap((event) => event.source.floorPlanChanges ?? []),
  };
}

/** Load the overview plus an exact requested date, including unsaved VIP-only dates. */
export async function loadLiveFloorPlanPublicationWindow(
  today: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  requestedDate?: string | null,
  vipPrepClient: Pick<VipPrepClient, "configured" | "fetchRange"> = new VipPrepClient(),
) {
  const dates = floorPlanPublicationDates(today, requestedDate);
  const endDate = addCalendarDays(today, 14);
  const ranges = [{ from: today, to: endDate }, ...dates.filter((date) => date < today || date > endDate).map((date) => ({ from: date, to: date }))];
  const [savedPlans, refreshed] = await Promise.all([
    Promise.all(dates.map((date) => storage.get(date).catch(() => null))),
    vipPrepClient.configured ? Promise.all(ranges.map(async (range) => {
      try { return { ...range, payload: await vipPrepClient.fetchRange(range.from, range.to), error: false }; }
      catch { return { ...range, payload: null, error: true }; }
    })) : [],
  ]);
  const liveVipDates = new Set(refreshed.flatMap((entry) => entry.payload?.reservations.filter(isActiveVipPrepReservation).map((reservation) => reservation.operatingDate) ?? []));
  const savedByDate = new Map(savedPlans.filter((plan): plan is FloorPlanDocument => Boolean(plan)).map((plan) => [plan.eventDate, plan]));
  const projectionDates = dates.filter((date) => Boolean(savedByDate.get(date)?.events.length) || liveVipDates.has(date) || date === requestedDate);
  const cachedClient: Pick<VipPrepClient, "configured" | "fetchRange"> = {
    configured: vipPrepClient.configured,
    async fetchRange(from, to) {
      const range = refreshed.find((entry) => entry.from <= from && entry.to >= to);
      if (!range?.payload || range.error) throw new Error("On Par Bookings is unavailable.");
      const reservations = range.payload.reservations.filter((reservation) => reservation.operatingDate >= from && reservation.operatingDate <= to);
      return { ...range.payload, from, to, reservations, reservationCount: reservations.length };
    },
  };
  const publications = await Promise.all(projectionDates.map(async (date) => {
    try {
      const payload = await getFloorPlanDay(date, storage, { vipPrepClient: cachedClient, readOnly: true });
      return payload.plan.events.length ? { plan: payload.plan, payload } : null;
    } catch {
      const plan = savedByDate.get(date) ?? null;
      return plan?.events.length ? { plan, payload: null } : null;
    }
  }));
  return publications.filter((publication): publication is NonNullable<typeof publication> => publication !== null);
}

async function generateFloorPlanFromStoredSources(
  date: string,
  mode: FloorPlanGenerationMode,
  storage: FloorPlanStorage,
  selectedEventId?: string,
) {
  const savedBeforeGeneration = await storage.get(date);
  let plan = await reconciledPlan(date, storage);
  if (selectedEventId) {
    const selected = plan.events.find((event) => event.id === selectedEventId);
    if (!selected || !savedBeforeGeneration?.events.some((event) => event.id === selectedEventId)) {
      throw new Error("Load a saved event before repairing its seating.");
    }
    // Event-only repair must not retime or rewrite another party from a source refresh.
    plan = {
      ...savedBeforeGeneration,
      sourceWarnings: plan.sourceWarnings,
      events: savedBeforeGeneration.events.map((event) => event.id === selectedEventId ? selected : event),
      reservations: [
        ...savedBeforeGeneration.reservations.filter((row) => row.floorPlanEventId !== selectedEventId),
        ...plan.reservations.filter((row) => row.floorPlanEventId === selectedEventId),
      ],
    };
  }
  if (plan.events.length === 0) {
    if (
      savedBeforeGeneration &&
      (savedBeforeGeneration.events.length > 0 ||
        savedBeforeGeneration.reservations.length > 0)
    ) {
      await storage.save(
        {
          ...plan,
          events: [],
          reservations: [],
          lastTripleseatSyncAt: new Date().toISOString(),
        },
        "Removed floor-plan holds without a DEFINITE Tripleseat event.",
      );
    }
    throw new Error("No Tripleseat event plan is available for this date.");
  }
  const proposal = generateFloorPlanReservationProposal(plan, mode, selectedEventId);
  const generationWarnings = proposal.issues.map((issue) => issue.message);
  if (selectedEventId && mode !== "fill-missing" && !proposal.complete) {
    throw new Error(generationWarnings.join(" ") || "No valid replacement was found; the existing event assignments were not changed.");
  }
  const proposedPlan = { ...plan, reservations: proposal.reservations };
  if (selectedEventId) {
    const conflicts = detectFloorPlanConflicts(proposedPlan).filter((conflict) => conflict.eventIds.includes(selectedEventId));
    const previousConflicts = new Set(detectFloorPlanConflicts(plan).map((conflict) => conflict.id));
    if (conflicts.some((conflict) => !previousConflicts.has(conflict.id))) {
      throw new Error("The proposed seating introduces a resource conflict. Existing assignments were not changed.");
    }
  }
  const generated = {
    ...plan,
    status:
      plan.status === "Approved" || plan.status === "Updated After Approval"
        ? ("Updated After Approval" as const)
        : ("Draft" as const),
    ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: selectedEventId ? plan.lastTripleseatSyncAt : new Date().toISOString(),
    events: plan.events.map((event) => {
      if (selectedEventId && event.id !== selectedEventId) return event;
      const { seatingGenerationIssues: _previousIssues, ...source } = event.source;
      const issues = proposal.issues.filter((issue) => issue.blocking && (!issue.eventId || issue.eventId === event.id));
      return { ...event, source: { ...source, ...(issues.length ? { seatingGenerationIssues: issues } : {}) } };
    }),
    reservations: proposal.reservations.map((row) => proposal.addedReservationIds.includes(row.id)
      ? { ...row, changeDetails: { fields: ["created"], reason: proposal.issues.find((issue) => issue.eventId === row.floorPlanEventId && issue.code === "seating-selection")?.message
        ?? "Generated from contracted inventory, required capacity, food-table rules and applicable availability buffers." } }
      : row),
  };
  const savedGenerated = await storage.save(generated, `Generated ${selectedEventId ? `event ${selectedEventId}` : "entire-date"} suggestions (${mode}); added ${proposal.addedReservationIds.length}, replaced ${proposal.movedReservationIds.length}. ${generationWarnings.join(" ")}`);
  if (selectedEventId) {
    const payload = await getFloorPlanDay(date, storage);
    const floorPlanConflicts = detectFloorPlanConflicts(savedGenerated);
    return {
      ...payload,
      plan: savedGenerated,
      floorPlanConflicts,
      validation: validateFloorPlan(savedGenerated, payload.entertainmentReservations, floorPlanConflicts, payload.entertainmentConflicts),
      sourceChanges: savedGenerated.events.flatMap((event) => event.source.floorPlanChanges ?? []),
      warnings: [...payload.warnings, ...generationWarnings],
    };
  }
  let sharedReservations: EntertainmentReservation[] = [];
  try {
    sharedReservations = (await syncEntertainmentDay(date)).reservations;
  } catch {
    sharedReservations = (await getEntertainmentDay(date).catch(() => null))?.reservations ?? [];
  }
  let alignmentWarning: string | null = null;
  try {
    alignmentWarning = await alignGeneratedEntertainment(generated, sharedReservations);
  } catch (error) {
    alignmentWarning = error instanceof Error
      ? error.message
      : "Entertainment reservations could not be aligned with the generated floor plan.";
  }
  const day = await getFloorPlanDay(date, storage);
  const payload = { ...day, warnings: [...day.warnings, ...generationWarnings] };
  return alignmentWarning
    ? {
        ...payload,
        warnings: [
          ...payload.warnings,
          `Entertainment alignment needs review: ${alignmentWarning}`,
        ],
      }
    : payload;
}

export async function generateFloorPlan(
  date: string,
  mode: FloorPlanGenerationMode,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  expectedVersion?: number,
  selectedEventId?: string,
) {
  if (expectedVersion !== undefined) {
    storage = floorPlanStorageAtVersion(storage, expectedVersion);
    await storage.get(date);
  }
  if (selectedEventId && mode === "reset-event") throw new Error("Reset is an entire-date action; use event-only rework to preserve staff choices.");
  if (!selectedEventId) {
    await syncEventPlanWindow(
      { startDate: date, endDate: date },
      { legacyPlans: [] },
    );
  }
  return generateFloorPlanFromStoredSources(date, mode, storage, selectedEventId);
}

export async function maintainTwoWeekFloorPlanHorizon(
  now = new Date(),
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const startDate = todayInEntertainmentTimeZone(now);
  const endDate = addCalendarDays(startDate, 14);
  const results: Array<{
    date: string;
    status: "generated" | "skipped" | "error";
    eventCount: number;
    planStatus?: FloorPlanStatus;
    message?: string;
    warnings?: string[];
  }> = [];

  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addCalendarDays(startDate, offset);
    try {
      const generated = await generateFloorPlanFromStoredSources(
        date,
        "fill-missing",
        storage,
      );
      const validated = await validateAndSaveFloorPlan(date, storage);
      const warnings = [...new Set([...generated.warnings, ...validated.warnings])];
      results.push({
        date,
        status: "generated",
        eventCount: generated.plan.events.length,
        planStatus: validated.plan.status,
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Floor-plan generation failed.";
      results.push({
        date,
        status: message === "No Tripleseat event plan is available for this date."
          ? "skipped"
          : "error",
        eventCount: 0,
        message,
      });
    }
  }

  return { startDate, endDate, results };
}

export async function ensureConfirmedContractFloorPlanWindow(
  startDate: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const endDate = addCalendarDays(startDate, 14);
  const dates = confirmedContractDatesInWindow(startDate, endDate);
  const results: Array<{
    date: string;
    status: "generated" | "skipped" | "error";
    eventCount: number;
    planStatus?: FloorPlanStatus;
    message?: string;
  }> = [];
  for (const date of dates) {
    try {
      const [saved, current] = await Promise.all([
        storage.get(date),
        reconciledPlan(date, storage),
      ]);
      const hasConfirmedEvent = (plan: FloorPlanDocument | null) =>
        Boolean(
          plan?.events.some((event) =>
            confirmedContractEventPlans.some((confirmed) =>
              eventMatchesConfirmedContract(
                date,
                event.name,
                confirmed.date,
                confirmed.name,
              ),
            ),
          ),
        );
      const sourceIsCurrent = Boolean(
        saved &&
          saved.events.length === current.events.length &&
          current.events.every((event) => {
            const previous = saved.events.find(
              (candidate) => candidate.id === event.id,
            );
            return previous && !sourceChanged(previous, event);
          }),
      );
      const reservationSignature = (
        reservations: readonly FloorPlanReservation[],
      ) =>
        JSON.stringify(
          [...reservations]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((reservation) => ({
              id: reservation.id,
              floorPlanEventId: reservation.floorPlanEventId,
              areaId: reservation.areaId,
              reservationType: reservation.reservationType,
              startAt: reservation.startAt,
              endAt: reservation.endAt,
              label: reservation.label,
              source: reservation.source,
              lockedByUser: reservation.lockedByUser,
              customGeometry: reservation.customGeometry ?? null,
            })),
        );
      const expectedReservations = generateFloorPlanReservations(
        current,
        "fill-missing",
      );
      const reservationsAreComplete =
        reservationSignature(current.reservations) ===
        reservationSignature(expectedReservations);
      if (
        hasConfirmedEvent(current) &&
        hasConfirmedEvent(saved) &&
        sourceIsCurrent &&
        reservationsAreComplete
      ) {
        results.push({
          date,
          status: "skipped",
          eventCount: current.events.length,
          planStatus: current.status,
        });
        continue;
      }
      const generated = await generateFloorPlanFromStoredSources(
        date,
        "fill-missing",
        storage,
      );
      results.push({
        date,
        status: "generated",
        eventCount: generated.plan.events.length,
        planStatus: generated.plan.status,
      });
    } catch (error) {
      results.push({
        date,
        status: "error",
        eventCount: 0,
        message:
          error instanceof Error
            ? error.message
            : "Confirmed contract floor-plan generation failed.",
      });
    }
  }
  return { startDate, endDate, results };
}

function sharedReservationMatchesEvent(
  reservation: EntertainmentReservation,
  event: FloorPlanEvent,
) {
  return entertainmentReservationMatchesFloorPlanEvent(reservation, event);
}

function supportsProximity(category: EntertainmentReservation["resourceCategory"]): category is "bowling" | "darts" | "pool" | "shuffleboard" {
  return category !== "private-rooms" && category !== "mini-golf";
}

export async function alignGeneratedEntertainment(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
) {
  const currentReservations = new Map(reservations.map((item) => [item.id, item]));
  const warnings: string[] = [];
  for (const event of plan.events) {
    const eventReservations = [...currentReservations.values()].filter(
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
      if (!validEntertainmentInterval(group[0].startAt, group[0].endAt)) {
        warnings.push(`${event.name}: entertainment times are missing or invalid; existing assignments were kept for review.`);
        continue;
      }
      const seatingAreaIds = event.contractedAreaIds.filter((areaId) => {
        const area = getFloorPlanArea(areaId);
        return areaId !== "facility" && area?.isReservable;
      });
      const automatic = group.filter(
        (reservation) => reservation.autoAssigned && !reservation.manualOverride,
      );
      const automaticIds = new Set(automatic.map((reservation) => reservation.id));
      const unavailable = new Set(
        [...currentReservations.values()].flatMap((reservation) =>
          reservation.active &&
          !automaticIds.has(reservation.id) &&
          (!validEntertainmentInterval(reservation.startAt, reservation.endAt) || timeRangesOverlap(
            group[0].startAt,
            group[0].endAt,
            reservation.startAt,
            reservation.endAt,
          ))
            ? [reservation.resourceId]
            : [],
        ),
      );
      const selected = selectEntertainmentResources(
        seatingAreaIds,
        category,
        automatic.length,
        unavailable,
      );
      const canPlaceAutomatic = seatingAreaIds.length > 0 && selected.length === automatic.length;
      if (automatic.length && !canPlaceAutomatic) {
        warnings.push(`${event.name}: ${seatingAreaIds.length ? "not enough available entertainment inventory" : "no verified reserved seating area"}; existing assignments were kept.`);
      }
      // Retain reservations already in the chosen block. Only move the rest to
      // unused destinations, so a shift (4/5 -> 5/6) never collides mid-update.
      const remaining = new Set(selected);
      const targets = new Map<string, string>();
      for (const reservation of automatic) {
        if (remaining.delete(reservation.resourceId)) {
          targets.set(reservation.id, reservation.resourceId);
        }
      }
      for (const reservation of automatic) {
        if (!targets.has(reservation.id)) {
          const resourceId = remaining.values().next().value;
          if (resourceId) {
            remaining.delete(resourceId);
            targets.set(reservation.id, resourceId);
          }
        }
      }
      for (const reservation of automatic) {
        const resourceId = canPlaceAutomatic
          ? targets.get(reservation.id) ?? reservation.resourceId
          : reservation.resourceId;
        if (
          resourceId === reservation.resourceId &&
          reservation.eventColor.toUpperCase() === event.color.toUpperCase()
        ) {
          continue;
        }
        const updated = await updateEntertainmentReservation(reservation.id, {
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
        }, { preserveAssignmentMode: true });
        currentReservations.set(updated.id, updated);
      }

      for (const reservation of group.filter((item) => !automaticIds.has(item.id))) {
        if (reservation.eventColor.toUpperCase() === event.color.toUpperCase()) continue;
        const updated = await updateEntertainmentReservation(reservation.id, {
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
        }, { preserveAssignmentMode: true });
        currentReservations.set(updated.id, updated);
      }
    }
  }
  return warnings.length ? warnings.join(" ") : null;
}

function sanitizeReservations(
  plan: FloorPlanDocument,
  requested: unknown,
  saved: FloorPlanDocument | null,
) {
  if (!Array.isArray(requested)) throw new Error("Reservations must be an array.");
  const eventIds = new Set(plan.events.map((event) => event.id));
  const seen = new Set<string>();
  return requested.map((value): FloorPlanReservation => {
    const row = asRecord(value);
    const id = sourceValue(row, "id") ?? "";
    const floorPlanEventId = sourceValue(row, "floorPlanEventId") ?? "";
    const areaId = sourceValue(row, "areaId") ?? "";
    const requestedType = sourceValue(row, "reservationType") as FloorPlanReservation["reservationType"] | null;
    const area = getFloorPlanArea(areaId);
    // Older plans used seating for section highlights that do not count as seats.
    const reservationType = requestedType === "seating" && area?.type === "seating-section" && area.capacity === 0
      ? "room" : requestedType;
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
    const event = plan.events.find((candidate) => candidate.id === floorPlanEventId)!;
    if (
      (reservationType === "food-table" && !area.canBeFoodTable) ||
      (reservationType === "seating" && area.capacity <= 0)
    ) {
      throw new Error(`${area.name} (${event.name}) cannot be used as ${reservationType === "food-table" ? "a food table" : "guest seating"}. Choose a seating table or an authorized food table for this assignment.`);
    }
    seen.add(id);
    const baseline = saved?.reservations.find((item) => item.id === id);
    const current = plan.reservations.find((item) => item.id === id);
    const previousEvent = saved?.events.find((item) => item.id === baseline?.floorPlanEventId) ?? event;
    const submittedInterval = {
      startAt: sourceValue(row, "startAt") ?? event.startAt,
      endAt: sourceValue(row, "endAt") ?? event.endAt,
    };
    if ((submittedInterval.startAt || submittedInterval.endAt) && !(submittedInterval.startAt && submittedInterval.endAt && validEntertainmentInterval(submittedInterval.startAt, submittedInterval.endAt))) {
      throw new Error(`${area.name} (${event.name}) needs a valid seating interval with a time zone and an end after its start.`);
    }
    const geometry = reservationType === "custom" && asRecord(row?.customGeometry)
      ? {
          x: Math.max(0, Math.min(1920, Number(asRecord(row?.customGeometry)?.x) || 0)),
          y: Math.max(0, Math.min(1080, Number(asRecord(row?.customGeometry)?.y) || 0)),
          width: Math.max(20, Math.min(1920, Number(asRecord(row?.customGeometry)?.width) || 160)),
          height: Math.max(20, Math.min(1080, Number(asRecord(row?.customGeometry)?.height) || 60)),
        } : undefined;
    const legacySectionNormalization = baseline && baseline.reservationType === requestedType && requestedType === "seating" && reservationType === "room";
    const placementChanged = !baseline || baseline.floorPlanEventId !== floorPlanEventId || baseline.areaId !== areaId ||
      (!legacySectionNormalization && baseline.reservationType !== reservationType) || JSON.stringify(baseline.customGeometry ?? undefined) !== JSON.stringify(geometry);
    const intervalChanged = baseline
      ? !sameReservationInterval(submittedInterval, baseline) && !(current && sameReservationInterval(submittedInterval, current))
      : !sameReservationInterval(submittedInterval, event);
    const previousTimingSource = baseline ? reservationTimingSource(baseline, previousEvent) : "event-default";
    const requestedTimingSource = sourceValue(row, "timingSource");
    const timingSource = requestedTimingSource === "event-default" ? "event-default"
      : requestedTimingSource === "staff-override" || intervalChanged ? "staff-override" : previousTimingSource;
    const preserveUnknownMetadata = baseline && !intervalChanged && requestedTimingSource === null && baseline.timingSource === undefined && sameReservationInterval(previousEvent, event);
    const explicitlyPinnedCurrentTime = requestedTimingSource === "staff-override" && previousTimingSource !== "staff-override";
    const interval = timingSource === "event-default" ? { startAt: event.startAt, endAt: event.endAt }
      : intervalChanged || explicitlyPinnedCurrentTime || !baseline ? submittedInterval : { startAt: baseline.startAt, endAt: baseline.endAt };
    const sanitized: FloorPlanReservation = {
      id,
      floorPlanEventId,
      areaId,
      reservationType,
      ...interval,
      label: (sourceValue(row, "label") ?? "").slice(0, 80),
      source: placementChanged ? "manual" : baseline!.source,
      lockedByUser: typeof row?.lockedByUser === "boolean" ? row.lockedByUser : baseline?.lockedByUser ?? true,
      ...(!preserveUnknownMetadata ? { timingSource } : {}),
      ...(placementChanged ? { placementOverride: true } : baseline?.placementOverride !== undefined ? { placementOverride: baseline.placementOverride } : {}),
      ...(geometry ? { customGeometry: geometry } : {}),
      ...(baseline?.changeDetails ? { changeDetails: baseline.changeDetails } : {}),
    };
    const fields = baseline ? (["floorPlanEventId", "areaId", "reservationType", "label", "lockedByUser", "customGeometry", "timingSource"] as const)
      .filter((key) => JSON.stringify(sanitized[key]) !== JSON.stringify(baseline[key])) : ["created"];
    if (baseline && !sameReservationInterval(sanitized, baseline)) fields.push("startAt", "endAt");
    if (fields.length) sanitized.changeDetails = {
      fields,
      reason: legacySectionNormalization ? "Normalized a legacy zero-capacity section to a non-counted room highlight; physical placement and timing are unchanged."
        : placementChanged ? "Staff selected or changed this physical assignment."
        : timingSource === "event-default" && baseline && !intervalChanged && !sameReservationInterval(baseline, sanitized) ? "Contract event time changed; seating follows the event while physical placement is preserved."
        : intervalChanged || requestedTimingSource !== null && timingSource !== previousTimingSource ? "Staff changed whether this seating interval follows the event or uses explicit times."
        : "Staff changed the listed assignment fields; unrelated placement and timing are preserved.",
    };
    return sanitized;
  });
}

export async function saveFloorPlanEdits(
  date: string,
  requested: unknown,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const body = asRecord(requested);
  if (!body) throw new Error("Invalid floor-plan save payload.");
  const [saved, reconciled] = await Promise.all([
    storage.get(date),
    reconciledPlan(date, storage),
  ]);
  if (body.version !== (saved?.version ?? 0)) throw new StaleSaveError();
  const requestedEvents = Array.isArray(body.events) ? body.events : [];
  const requestedReservations = body.reservations;
  const requestedReservationRows = Array.isArray(requestedReservations)
    ? requestedReservations
    : [];
  const requestedEventIds = new Set(
    requestedEvents.flatMap((value) => {
      const id = sourceValue(asRecord(value), "id");
      return id ? [id] : [];
    }),
  );
  for (const value of requestedReservationRows) {
    const id = sourceValue(asRecord(value), "floorPlanEventId");
    if (id) requestedEventIds.add(id);
  }

  // A live source refresh can change the event rows between the initial GET
  // and this save. Keep any saved event identities referenced by the editor so
  // manual highlights are not rejected just because Tripleseat changed while
  // the page was open. The next explicit sync still reconciles source fields.
  const currentEventIds = new Set(reconciled.events.map((event) => event.id));
  const savedEventsNeeded = (saved?.events ?? []).filter(
    (event) => requestedEventIds.has(event.id) && !currentEventIds.has(event.id),
  );
  const plan = savedEventsNeeded.length
    ? { ...reconciled, events: [...reconciled.events, ...savedEventsNeeded] }
    : reconciled;
  const events = plan.events.map((event) => {
    const candidate = requestedEvents
      .map(asRecord)
      .find((row) => sourceValue(row, "id") === event.id);
    const color = sourceValue(candidate ?? null, "color");
    return color && isHexColor(color)
      ? { ...event, color: color.toUpperCase() }
      : event;
  });
  if (
    events.some((event, index) =>
      events
        .slice(0, index)
        .some(
          (candidate) =>
            !floorPlanEventColorsAreDistinct(event.color, candidate.color),
        ),
    )
  ) {
    throw new Error("Each event on a date must use a visually distinct color.");
  }
  const next = {
    ...plan,
    version: Number(body.version),
    events,
    reservations: sanitizeReservations(plan, requestedReservations, saved),
    status:
      plan.status === "Approved"
        ? ("Updated After Approval" as const)
        : plan.status,
  };
  // Persist the floor-plan edit before updating the shared entertainment
  // overlays. A stale/deleted entertainment reservation must not prevent the
  // seating, room, or custom highlight changes from being saved.
  const changedRows = next.reservations.filter((row) => JSON.stringify(row) !== JSON.stringify(saved?.reservations.find((previous) => previous.id === row.id)));
  const removed = saved?.reservations.filter((row) => !next.reservations.some((current) => current.id === row.id)) ?? [];
  const colorChanges = events.filter((event) => saved?.events.find((previous) => previous.id === event.id)?.color !== event.color);
  const description = [
    "Saved floor-plan edits.",
    ...changedRows.map((row) => `${row.areaId}: ${row.changeDetails?.fields.join(", ") || "event-following refresh"}.`),
    ...removed.map((row) => `${row.areaId}: removed by staff.`),
    ...colorChanges.map((event) => `${event.id}: color.`),
  ].join(" ");
  await storage.save(next, description);
  const entertainmentWarnings: string[] = [];
  const entertainmentDay = await getEntertainmentDay(date).catch(() => null);
  if (entertainmentDay) {
    for (const reservation of entertainmentDay.reservations) {
      if (!reservation.active) continue;
      const event = events.find(
        (candidate) =>
          entertainmentReservationMatchesFloorPlanEvent(
            reservation,
            candidate,
          ),
      );
      if (!event || event.color === reservation.eventColor) continue;
      try {
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
        }, { preserveAssignmentMode: true });
      } catch {
        entertainmentWarnings.push(
          `The floor plan was saved, but the ${reservation.resourceName} entertainment overlay could not be updated.`,
        );
      }
    }
  }
  const savedPayload = await getFloorPlanDay(date, storage);
  return entertainmentWarnings.length
    ? { ...savedPayload, warnings: [...savedPayload.warnings, ...entertainmentWarnings] }
    : savedPayload;
}

export async function validateAndSaveFloorPlan(
  date: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined) storage = floorPlanStorageAtVersion(storage, expectedVersion);
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
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined) storage = floorPlanStorageAtVersion(storage, expectedVersion);
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

export async function refreshFloorPlanSources(
  date: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  expectedVersion?: number,
) {
  if (expectedVersion !== undefined) storage = floorPlanStorageAtVersion(storage, expectedVersion);
  const savedBeforeRefresh = await storage.get(date);
  const refreshWarnings: string[] = [];
  let tripleseatRefreshed = false;
  try {
    await syncEventPlanWindow({ startDate: date, endDate: date }, { legacyPlans: [] });
    tripleseatRefreshed = true;
  } catch {
    refreshWarnings.push("Tripleseat could not be refreshed. On Par Bookings is refreshed independently and saved Tripleseat assignments are retained.");
  }
  try {
    const entertainment = await syncEntertainmentDay(date);
    refreshWarnings.push(...entertainment.warnings);
  } catch {
    refreshWarnings.push("The shared entertainment source could not be refreshed; its saved assignments remain available.");
  }
  const plan = await reconciledPlan(date, storage);
  if (!plan.events.length) {
    if (
      savedBeforeRefresh &&
      (savedBeforeRefresh.events.length > 0 ||
        savedBeforeRefresh.reservations.length > 0)
    ) {
      await storage.save(
        {
          ...plan,
          events: [],
          reservations: [],
          lastTripleseatSyncAt: tripleseatRefreshed ? new Date().toISOString() : savedBeforeRefresh.lastTripleseatSyncAt,
        },
        "Removed floor-plan holds after the source confirmed no active reservations.",
      );
    }
    const empty = await getFloorPlanDay(date, storage);
    return { ...empty, warnings: [...new Set([...empty.warnings, ...refreshWarnings])] };
  }
  await storage.save(
    {
      ...plan,
      lastTripleseatSyncAt: tripleseatRefreshed ? new Date().toISOString() : savedBeforeRefresh?.lastTripleseatSyncAt ?? null,
    },
    "Synchronized live Tripleseat floor-plan fields.",
  );
  const payload = await getFloorPlanDay(date, storage);
  return { ...payload, warnings: [...new Set([...payload.warnings, ...refreshWarnings])] };
}
