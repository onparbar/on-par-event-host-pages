import { randomUUID } from "node:crypto";
import { isPreviewReviewOnly } from "../operations/preview-review";
import {
  getMissingTripleseatEnvironmentVariables,
  getTripleseatAdapter,
  type TripleseatAdapter,
} from "../kitchen/tripleseat";
import {
  buildEntertainmentSchedule,
  conflictForCandidate,
  detectEntertainmentConflicts,
  eventColorAndSource,
  mergeReservationsForSync,
  validateReservationTimes,
  type BuiltSchedule,
  type LocalEntertainmentEvent,
} from "./domain";
import { getLocalEntertainmentEvents } from "./floor-plan";
import {
  deterministicEventColor,
  getEntertainmentResource,
  isHexColor,
} from "./resources";
import {
  getEntertainmentStorage,
  getMissingEntertainmentEnvironmentVariables,
  type EntertainmentStorage,
  type StoredEntertainmentDay,
} from "./storage";
import {
  isInsideOperatingDay,
  isValidEntertainmentDate,
  parseTimeRange,
} from "./time";
import type {
  EntertainmentAuditEntry,
  EntertainmentDayPayload,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
  EntertainmentReviewIssue,
  EntertainmentSourceEvent,
} from "./types";
import { TRIPLESEAT_RECONNECT_WARNING } from "./types";
import {
  getMissingVipPrepEnvironmentVariables,
  VipPrepClient,
  vipPrepEntertainmentEvents,
} from "../vip-prep/client";
import { inactiveVipIsNewer, KNOWN_INACTIVE_VIP_WARNING, knownInactiveVipBookings } from "../vip-prep/known-inactive";
import { isDecemberOwnerHoldVip } from "../vip-prep/owner-holds";
import { projectDecemberOwnerHoldEntertainmentVisibility } from "./owner-holds";
import { getFloorPlanStorage, type FloorPlanStorage } from "../floor-plans/storage";
import type { FloorPlanEvent } from "../floor-plans/types";
import { projectDayEventColors } from "../floor-plans/event-colors";
import {
  confirmedContractEntertainmentSourcesForDate,
  eventMatchesConfirmedContract,
  sourceIsAtLeastAsNew,
} from "../confirmed-contract-events";

export type EntertainmentDependencies = {
  adapter?: TripleseatAdapter;
  storage?: EntertainmentStorage;
  localEvents?: LocalEntertainmentEvent[];
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  readOnly?: boolean;
  floorPlanStorage?: Pick<FloorPlanStorage, "get">;
  floorPlanEvents?: readonly FloorPlanEvent[];
};

export type ReservationMutationInput = {
  operatingDate?: unknown;
  eventId?: unknown;
  eventName?: unknown;
  resourceId?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  eventColor?: unknown;
  notes?: unknown;
  reason?: unknown;
  needsReview?: unknown;
  forceConflict?: unknown;
};

export class EntertainmentSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntertainmentSyncError";
  }
}

export class EntertainmentConflictError extends Error {
  readonly conflictingReservations: EntertainmentReservation[];

  constructor(conflictingReservations: EntertainmentReservation[]) {
    super("This change overlaps another reservation on the same resource.");
    this.name = "EntertainmentConflictError";
    this.conflictingReservations = conflictingReservations;
  }
}

export function assertEntertainmentDate(date: string) {
  if (!isValidEntertainmentDate(date)) {
    throw new EntertainmentSyncError(
      "Entertainment date must use YYYY-MM-DD.",
    );
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function isOperationalEntertainmentStatus(status: string | null, fullBuyout = false) {
  return fullBuyout || !["LOST", "PROSPECT"].includes(
    status?.trim().toLocaleUpperCase("en-US") ?? "",
  );
}

export function requiresTripleseatReconnect(error: unknown) {
  return error instanceof Error && (error.message === TRIPLESEAT_RECONNECT_WARNING ||
    /^Tripleseat OAuth refresh was rejected \((?:400|401|403)\)\./.test(error.message));
}

function safeSyncError(error: unknown) {
  if (requiresTripleseatReconnect(error)) return TRIPLESEAT_RECONNECT_WARNING;
  if (!(error instanceof Error)) {
    return "Entertainment synchronization failed.";
  }
  const allowedPrefixes = [
    "Tripleseat OAuth configuration is incomplete:",
    "Tripleseat OAuth refresh configuration is incomplete.",
    "Tripleseat API request failed (",
    "Tripleseat OAuth response did not include an access token.",
    "Tripleseat event detail response was invalid.",
    "Entertainment database request failed (",
    "Missing SUPABASE_SECRET_KEY",
    "TRIPLESEAT_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes",
    "The existing Tripleseat adapter does not expose entertainment reads.",
    "VIP Prep API request failed (",
    "VIP Prep API returned an invalid",
  ];
  return allowedPrefixes.some((prefix) => error.message.startsWith(prefix))
    ? error.message
    : "Entertainment synchronization failed.";
}

function mockSourceEvents(
  date: string,
  localEvents: LocalEntertainmentEvent[],
) {
  return localEvents
    .filter((event) => event.date === date)
    .map((event) => {
      const eventTime = parseTimeRange(
        event.eventTime ?? event.entertainment.map((item) => item.time).join(" "),
        date,
      );
      return {
        tripleseatEventId: event.id,
        tripleseatBookingId: event.bookingId ?? null,
        eventName: event.name,
        localDate: date,
        eventStartAt: eventTime?.startAt ?? null,
        eventEndAt: eventTime?.endAt ?? null,
        status: "DEFINITE",
        rooms: event.rooms.map((name, index) => ({
          id: `mock-room-${index}`,
          name,
        })),
        items: event.entertainment.map((item, index) => ({
          sourceId: `mock-item-${index}`,
          name: item.name,
          description: `${item.quantity} ${item.name} ${item.time}`,
          categoryName: null,
          quantity: null,
          startAt: null,
          endAt: null,
        })),
        categoryNames: [],
        sourceUpdatedAt: null,
        noteCount: 0,
      } satisfies EntertainmentSourceEvent;
    });
}

function floorPlanContext(
  options: EntertainmentDependencies,
) {
  const localEvents = options.localEvents ?? getLocalEntertainmentEvents();
  return {
    localEvents,
  };
}

function manualEventSnapshots(
  date: string,
  reservations: EntertainmentReservation[],
  existingEvents: EntertainmentEventSnapshot[],
) {
  const knownEventIds = new Set(
    existingEvents.flatMap((event) => [
      event.localEventId,
      event.tripleseatEventId,
    ]).filter((eventId): eventId is string => Boolean(eventId)),
  );
  const byName = new Map<string, EntertainmentReservation>();
  for (const reservation of reservations) {
    if (
      reservation.active &&
      reservation.operatingDate === date &&
      reservation.source === "manual" &&
      !(
        reservation.localEventId &&
        knownEventIds.has(reservation.localEventId)
      ) &&
      !(
        reservation.tripleseatEventId &&
        knownEventIds.has(reservation.tripleseatEventId)
      )
    ) {
      byName.set(reservation.eventName, reservation);
    }
  }
  return [...byName.values()].map(
    (reservation) =>
      ({
        eventId: `manual:${reservation.eventName}`,
        localEventId: reservation.localEventId,
        tripleseatEventId: reservation.tripleseatEventId ?? "",
        tripleseatBookingId: reservation.tripleseatBookingId,
        eventName: reservation.eventName,
        operatingDate: date,
        eventStartAt: reservation.startAt,
        eventEndAt: reservation.endAt,
        eventColor: reservation.eventColor,
        colorSource: reservation.colorSource,
        floorPlanAssetKey: null,
        sourceUpdatedAt: null,
        needsReview: reservation.needsReview,
        reviewIssues: reservation.reviewIssues,
        sourceSnapshot: {
          tripleseatEventId: reservation.tripleseatEventId ?? "",
          tripleseatBookingId: reservation.tripleseatBookingId,
          eventName: reservation.eventName,
          localDate: date,
          eventStartAt: reservation.startAt,
          eventEndAt: reservation.endAt,
          status: null,
          rooms: [],
          items: [],
          categoryNames: [],
          sourceUpdatedAt: null,
          noteCount: 0,
        },
        active: true,
        syncedAt: reservation.updatedAt,
      }) satisfies EntertainmentEventSnapshot,
  );
}

function eventIdentityValues(event: EntertainmentEventSnapshot) {
  return [event.eventId, event.localEventId, event.tripleseatEventId].filter(
    (value): value is string => Boolean(value),
  );
}

function reservationMatchesEventId(
  reservation: EntertainmentReservation,
  eventId: string,
) {
  return [reservation.localEventId, reservation.tripleseatEventId].some(
    (value) => value === eventId,
  );
}

function preserveManualEventColors(
  built: BuiltSchedule,
  existingEvents: readonly EntertainmentEventSnapshot[],
): BuiltSchedule {
  const manualColors = new Map<string, string>();
  for (const event of existingEvents) {
    if (event.colorSource !== "manual") continue;
    for (const identity of eventIdentityValues(event)) {
      manualColors.set(identity, event.eventColor);
    }
  }
  const colorForReservation = (reservation: EntertainmentReservation) =>
    [reservation.localEventId, reservation.tripleseatEventId]
      .filter((value): value is string => Boolean(value))
      .map((identity) => manualColors.get(identity))
      .find((color): color is string => Boolean(color));
  return {
    events: built.events.map((event) => {
      const eventColor = eventIdentityValues(event)
        .map((identity) => manualColors.get(identity))
        .find((color): color is string => Boolean(color));
      return eventColor
        ? { ...event, eventColor, colorSource: "manual" }
        : event;
    }),
    reservations: built.reservations.map((reservation) => {
      const eventColor = colorForReservation(reservation);
      return eventColor
        ? { ...reservation, eventColor, colorSource: "manual" }
        : reservation;
    }),
  };
}

function dedupeConfirmedContractEntertainmentEvents(
  events: EntertainmentEventSnapshot[],
) {
  const contractEvent = events.find(
    (event) => event.sourceSnapshot.sourceSystem === "contract-evidence",
  );
  if (!contractEvent) return events;
  const matching = events.filter((event) =>
    !isVipEntertainmentEvent(event) && eventMatchesConfirmedContract(
      event.operatingDate,
      event.eventName,
      contractEvent.operatingDate,
      contractEvent.eventName,
    ),
  );
  if (matching.length < 2) return events;
  const winner = [...matching].sort((left, right) => {
    const timeDifference =
      Date.parse(right.sourceUpdatedAt ?? "") -
      Date.parse(left.sourceUpdatedAt ?? "");
    if (Number.isFinite(timeDifference) && timeDifference !== 0) {
      return timeDifference;
    }
    return Number(left.sourceSnapshot.sourceSystem === "contract-evidence") -
      Number(right.sourceSnapshot.sourceSystem === "contract-evidence");
  })[0];
  return events.filter(
    (event) =>
      event === winner || isVipEntertainmentEvent(event) ||
      !eventMatchesConfirmedContract(
        event.operatingDate,
        event.eventName,
        contractEvent.operatingDate,
        contractEvent.eventName,
      ),
  );
}

function isVipEntertainmentEvent(event: EntertainmentEventSnapshot) {
  return (
    event.sourceSnapshot.sourceSystem === "vip-prep" ||
    event.eventId.startsWith("vip-") ||
    event.tripleseatEventId.startsWith("vip-")
  );
}

function isVipEntertainmentSourceEvent(event: EntertainmentSourceEvent) {
  return (
    event.sourceSystem === "vip-prep" ||
    event.tripleseatEventId.startsWith("vip-")
  );
}

function isVipEntertainmentReservation(reservation: EntertainmentReservation) {
  return (
    reservation.source === "vip-prep" ||
    reservation.localEventId?.startsWith("vip-") === true ||
    reservation.tripleseatEventId?.startsWith("vip-") === true
  );
}

function isPlanningOwnerHoldEvent(event: EntertainmentEventSnapshot) {
  return isDecemberOwnerHoldVip({
    operatingDate: event.operatingDate, eventName: event.eventName, sourceEventId: event.tripleseatEventId,
    sourceSystem: event.sourceSnapshot.sourceSystem, linkedTripleseatEventIds: event.sourceSnapshot.linkedTripleseatEventIds,
    foodCount: event.sourceSnapshot.vipFoodCount, extraCount: event.sourceSnapshot.vipExtraCount ?? event.sourceSnapshot.items.length,
  });
}

function ownerHoldReservation(reservation: EntertainmentReservation, events: readonly EntertainmentEventSnapshot[]) {
  const event = events.find((candidate) => [candidate.eventId, candidate.tripleseatEventId, candidate.localEventId].some((id) =>
    id && [reservation.tripleseatEventId, reservation.localEventId].includes(id)));
  if (event) return isPlanningOwnerHoldEvent(event);
  return isDecemberOwnerHoldVip({ operatingDate: reservation.operatingDate, eventName: reservation.eventName,
    sourceEventId: reservation.tripleseatEventId ?? reservation.localEventId,
    sourceSystem: reservation.source === "manual" ? undefined : reservation.source });
}

function manualOwnerHoldReservation(reservation: EntertainmentReservation, events: readonly EntertainmentEventSnapshot[]) {
  return (reservation.manualOverride || reservation.source === "manual") && ownerHoldReservation(reservation, events);
}

/** Ignore internal placeholders in planning, not staff overrides or the source's stored history. */
function ownerHoldPlanningProjection(stored: StoredEntertainmentDay): StoredEntertainmentDay {
  const manualIds = new Set(stored.reservations.filter((row) => row.active && manualOwnerHoldReservation(row, stored.events))
    .flatMap((row) => [row.tripleseatEventId, row.localEventId].filter((id): id is string => Boolean(id))));
  return { ...stored,
    events: stored.events.filter((event) => !isPlanningOwnerHoldEvent(event) ||
      [event.eventId, event.tripleseatEventId, event.localEventId].some((id) => id && manualIds.has(id))),
    reservations: stored.reservations.filter((row) => !ownerHoldReservation(row, stored.events) || manualOwnerHoldReservation(row, stored.events)),
  };
}

function preserveOwnerHoldCache(stored: StoredEntertainmentDay, events: EntertainmentEventSnapshot[], reservations: EntertainmentReservation[]) {
  const refreshedIds = new Set(events.flatMap((event) => [event.eventId, event.tripleseatEventId]));
  const retainedEvents = stored.events.filter((event) => isPlanningOwnerHoldEvent(event) && !refreshedIds.has(event.tripleseatEventId));
  const byId = new Map(reservations.map((row) => [row.id, row]));
  for (const row of stored.reservations) {
    if (ownerHoldReservation(row, stored.events) && ![row.tripleseatEventId, row.localEventId].some((id) => id && refreshedIds.has(id))) byId.set(row.id, row);
  }
  return { events: [...events, ...retainedEvents], reservations: [...byId.values()] };
}

/** One physical room occupancy may be evidenced by two explicitly linked sources. */
function representedEntertainmentReservations(events: readonly EntertainmentEventSnapshot[], reservations: EntertainmentReservation[]) {
  const vipRooms = reservations.filter((row) => row.active && row.source === "vip-prep" && row.resourceCategory === "private-rooms");
  return reservations.filter((row) => row.source !== "tripleseat" || row.manualOverride || !vipRooms.some((vip) => {
    const source = events.find((event) => event.tripleseatEventId === vip.tripleseatEventId)?.sourceSnapshot;
    return Boolean(row.tripleseatEventId && source?.linkedTripleseatEventIds?.includes(row.tripleseatEventId) &&
      row.resourceId === vip.resourceId && Date.parse(row.startAt) === Date.parse(vip.startAt) && Date.parse(row.endAt) === Date.parse(vip.endAt));
  }));
}

export async function getEntertainmentDay(
  date: string,
  options: EntertainmentDependencies = {},
): Promise<EntertainmentDayPayload> {
  assertEntertainmentDate(date);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? getEntertainmentStorage();
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  const [rawStored, vipResult, floorColors] = await Promise.all([
    storage.getDay(date),
    vipPrepClient.configured
      ? vipPrepClient.fetchRange(date, date).then(
          (payload) => ({ events: vipPrepEntertainmentEvents(payload.reservations), error: null, refreshed: true }),
          () => ({ events: [], error: "VIP Prep could not be refreshed; the last saved VIP schedule remains visible.", refreshed: false }),
        )
      : Promise.resolve({ events: [], error: null, refreshed: false }),
    Promise.resolve().then(async () => ({ events: (await (options.floorPlanStorage ?? getFloorPlanStorage()).get(date))?.events ?? [], warning: null as string | null }))
      .catch(() => ({ events: [] as FloorPlanEvent[], warning: "Saved floor-plan colors could not be loaded; event colors are resolved from the current schedule until Floor Plans is available." })),
  ]);
  const stored = ownerHoldPlanningProjection(rawStored);
  const refreshedVipIds = new Set(vipResult.events.map((event) => event.tripleseatEventId));
  const retainedManualOwnerHold = (row: EntertainmentReservation) => manualOwnerHoldReservation(row, stored.events) &&
    ![row.tripleseatEventId, row.localEventId].some((id) => id && refreshedVipIds.has(id));
  const knownInactive = vipResult.error ? await knownInactiveVipBookings(date) : { ids: new Set<string>(), observations: new Map<string, string>(), warnings: [] };
  const inactiveEventIds = new Set(stored.events.filter((event) => inactiveVipIsNewer(knownInactive.observations,
    event.tripleseatEventId, event.sourceSnapshot.sourceObservedAt ?? event.sourceUpdatedAt)).map((event) => event.tripleseatEventId));
  const diagnostics = adapter.getDiagnostics();
  const storedReservations = stored.reservations.filter(
    (reservation) =>
      reservation.active && reservation.resourceCategory !== "mini-golf" &&
      ![reservation.tripleseatEventId, reservation.localEventId].some((id) => id && inactiveEventIds.has(id)),
  );
  const availableStoredReservations = projectDecemberOwnerHoldEntertainmentVisibility({ events: stored.events, reservations: storedReservations }).reservations;
  const builtVip = buildEntertainmentSchedule({
    sourceEvents: vipResult.events,
    localEvents: floorPlanContext(options).localEvents,
    existingReservations: availableStoredReservations,
  });
  const liveVip = {
    ...builtVip,
    reservations: mergeReservationsForSync(
      stored.reservations.filter((reservation) => reservation.source === "vip-prep" && !retainedManualOwnerHold(reservation)),
      builtVip.reservations,
      undefined,
      builtVip.events,
    ).filter((reservation) => reservation.active),
  };
  const confirmedSources = confirmedContractEntertainmentSourcesForDate(
    date,
    stored.sync?.lastSuccessfulSyncAt,
  ).filter(
    (source) =>
      !stored.events.some(
        (event) =>
          !isVipEntertainmentEvent(event) && eventMatchesConfirmedContract(
            event.operatingDate,
            event.eventName,
            source.localDate,
            source.eventName,
          ) &&
          sourceIsAtLeastAsNew(
            event.sourceUpdatedAt,
            source.sourceUpdatedAt,
          ),
      ),
  );
  const builtConfirmedSchedule = buildEntertainmentSchedule({
    sourceEvents: confirmedSources,
    localEvents: floorPlanContext(options).localEvents,
    existingReservations: [
      ...availableStoredReservations,
      ...liveVip.reservations,
    ],
  });
  const confirmedEventIds = new Set(builtConfirmedSchedule.events.flatMap(eventIdentityValues));
  const existingConfirmed = stored.reservations.filter((reservation) =>
    [reservation.localEventId, reservation.tripleseatEventId].some((id) => id && confirmedEventIds.has(id)),
  );
  const confirmedSchedule = {
    ...builtConfirmedSchedule,
    reservations: mergeReservationsForSync(existingConfirmed, builtConfirmedSchedule.reservations, undefined, builtConfirmedSchedule.events),
  };
  const replacedConfirmedIds = new Set(existingConfirmed.map((reservation) => reservation.id));
  let contractPersistenceWarning: string | null = null;
  if (
    !options.readOnly && !isPreviewReviewOnly() && (confirmedSchedule.events.length > 0 ||
    confirmedSchedule.reservations.length > 0)
  ) {
    try {
      await storage.saveContractEvidence({
        events: confirmedSchedule.events,
        reservations: confirmedSchedule.reservations,
      });
    } catch {
      contractPersistenceWarning =
        "Confirmed contract entertainment is visible, but its reservations could not be saved for editing.";
    }
  }
  const combinedReservations = [
    ...storedReservations.filter(
      (reservation) =>
        (!vipResult.refreshed || reservation.source !== "vip-prep" || retainedManualOwnerHold(reservation)) && !replacedConfirmedIds.has(reservation.id),
    ),
    ...liveVip.reservations,
    ...confirmedSchedule.reservations.filter((reservation) => reservation.active),
  ];
  const combinedEvents = [
    ...stored.events.filter(
      (event) => !inactiveEventIds.has(event.tripleseatEventId) && (!vipResult.refreshed || !isVipEntertainmentEvent(event) ||
        stored.reservations.some((row) => row.active && retainedManualOwnerHold(row) &&
          [event.eventId, event.tripleseatEventId, event.localEventId].some((id) => id && [row.tripleseatEventId, row.localEventId].includes(id)))),
    ),
    ...liveVip.events,
    ...confirmedSchedule.events,
    ...manualEventSnapshots(date, combinedReservations, [
      ...stored.events,
      ...liveVip.events,
      ...confirmedSchedule.events,
    ]),
  ];
  const events = dedupeConfirmedContractEntertainmentEvents(combinedEvents).sort((left, right) =>
    (left.eventStartAt ?? "").localeCompare(right.eventStartAt ?? ""),
  );
  const visibleEventIds = new Set(
    events.flatMap((event) => [
      event.eventId,
      event.tripleseatEventId,
      ...(event.localEventId ? [event.localEventId] : []),
    ]),
  );
  const contractIdentity = combinedEvents.find(
    (event) =>
      "sourceSystem" in event.sourceSnapshot &&
      event.sourceSnapshot.sourceSystem === "contract-evidence",
  );
  const reservations = representedEntertainmentReservations(events, combinedReservations.filter(
    (reservation) =>
      isVipEntertainmentReservation(reservation) || !contractIdentity ||
      !eventMatchesConfirmedContract(
        reservation.operatingDate,
        reservation.eventName,
        contractIdentity.operatingDate,
        contractIdentity.eventName,
      ) ||
      [reservation.tripleseatEventId, reservation.localEventId]
        .filter((value): value is string => Boolean(value))
        .some((value) => visibleEventIds.has(value)),
  ));
  const warnings = [...diagnostics.warnings];
  if (floorColors.warning) warnings.push(floorColors.warning);
  warnings.push(...knownInactive.warnings);
  if (inactiveEventIds.size) warnings.push(KNOWN_INACTIVE_VIP_WARNING);
  if (vipResult.error) warnings.push(vipResult.error);
  if (contractPersistenceWarning) warnings.push(contractPersistenceWarning);
  if (stored.sync?.status === "error" && stored.sync.errorSummary) {
    warnings.push(
      stored.sync.errorSummary === TRIPLESEAT_RECONNECT_WARNING ? TRIPLESEAT_RECONNECT_WARNING :
        "The latest Tripleseat sync failed. The last saved schedule remains visible.",
    );
  }
  const visible = projectDecemberOwnerHoldEntertainmentVisibility({ events, reservations });
  const colors = projectDayEventColors(options.floorPlanEvents ?? floorColors.events, visible.events, visible.reservations, floorColors.events);
  return {
    date,
    events: colors.events,
    reservations: colors.reservations,
    floorPlanEventColors: Object.fromEntries(colors.floorEvents.map((event) => [event.id, event.color])),
    conflicts: detectEntertainmentConflicts(visible.reservations),
    sync: stored.sync,
    sourceMode: adapter.sourceMode,
    warnings: unique(warnings),
    missingEnvironmentVariables: unique([
      ...diagnostics.missingEnvironmentVariables,
      ...(storage.persistence === "database" && options.storage == null
        ? getMissingEntertainmentEnvironmentVariables()
        : []),
      ...(options.vipPrepClient == null
        ? getMissingVipPrepEnvironmentVariables()
        : []),
    ]),
    canEdit: true,
  };
}

function reservationCounts(
  existing: EntertainmentReservation[],
  merged: EntertainmentReservation[],
) {
  const existingById = new Map(
    existing.map((reservation) => [reservation.id, reservation]),
  );
  let created = 0;
  let updated = 0;
  for (const reservation of merged) {
    const previous = existingById.get(reservation.id);
    if (!previous) {
      if (reservation.active && reservation.source !== "manual") {
        created += 1;
      }
    } else if (
      JSON.stringify({
        resourceId: previous.resourceId,
        startAt: previous.startAt,
        endAt: previous.endAt,
        active: previous.active,
        reviewIssues: previous.reviewIssues,
        sourceUpdatedAt: previous.sourceUpdatedAt,
      }) !==
      JSON.stringify({
        resourceId: reservation.resourceId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        active: reservation.active,
        reviewIssues: reservation.reviewIssues,
        sourceUpdatedAt: reservation.sourceUpdatedAt,
      })
    ) {
      updated += 1;
    }
  }
  return { created, updated };
}

export async function syncEntertainmentDay(
  date: string,
  options: EntertainmentDependencies = {},
): Promise<EntertainmentDayPayload> {
  assertEntertainmentDate(date);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? getEntertainmentStorage();
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  if (adapter.sourceMode === "mock" && storage.persistence === "database" && !vipPrepClient.configured) {
    throw new EntertainmentSyncError(
      "Mock Tripleseat data cannot be persisted to the entertainment database.",
    );
  }
  await storage.startSync(date);

  try {
    const [stored, context] = await Promise.all([
      storage.getDay(date),
      floorPlanContext(options),
    ]);
    const [tripleseatResult, vipResult] = await Promise.allSettled([
      adapter.sourceMode === "mock" && storage.persistence === "database"
        ? Promise.reject(new Error("Mock Tripleseat data cannot be persisted to the entertainment database."))
        : adapter.fetchEntertainmentEventsForDate?.(date) ?? Promise.reject(new Error("The existing Tripleseat adapter does not expose entertainment reads.")),
      vipPrepClient.configured ? vipPrepClient.fetchRange(date, date) : null,
    ]);
    const vipPayload = vipResult.status === "fulfilled" ? vipResult.value : null;
    if (tripleseatResult.status === "rejected") {
      if (!vipPayload) throw tripleseatResult.reason;
      const now = new Date().toISOString();
      const built = preserveManualEventColors(buildEntertainmentSchedule({
        sourceEvents: vipPrepEntertainmentEvents(vipPayload.reservations), localEvents: context.localEvents,
        existingReservations: projectDecemberOwnerHoldEntertainmentVisibility(ownerHoldPlanningProjection(stored)).reservations.filter(isVipEntertainmentReservation), now,
      }), stored.events);
      const reservations = mergeReservationsForSync(stored.reservations.filter(isVipEntertainmentReservation), built.reservations, now, built.events);
      const preserved = preserveOwnerHoldCache(stored, built.events, reservations);
      const activeIds = new Set(preserved.events.map((event) => event.eventId));
      await storage.saveContractEvidence({
        reservations: preserved.reservations,
        events: [...preserved.events, ...stored.events.filter((event) => isVipEntertainmentEvent(event) && !activeIds.has(event.eventId)).map((event) => ({ ...event, active: false, syncedAt: now }))],
      });
      await storage.failSync(date, safeSyncError(tripleseatResult.reason));
      const payload = await getEntertainmentDay(date, { ...options, adapter, storage, vipPrepClient: { configured: true, fetchRange: async () => vipPayload } });
      return { ...payload, sourceRefresh: { tripleseat: "error", onParBookings: "success", reconnectTripleseat: requiresTripleseatReconnect(tripleseatResult.reason) },
        warnings: unique([...payload.warnings, "On Par Bookings refreshed independently; Tripleseat is unavailable and its saved reservations were retained."]) };
    }
    const tripleseatSourceEvents = tripleseatResult.value;
    let allSourceEvents = [
      ...tripleseatSourceEvents,
      ...vipPrepEntertainmentEvents(vipPayload?.reservations ?? []),
    ];
    if (
      adapter.sourceMode === "mock" &&
      storage.persistence === "memory" &&
      allSourceEvents.length === 0
    ) {
      allSourceEvents = mockSourceEvents(date, context.localEvents);
    }
    let sourceEvents = allSourceEvents.filter((event) =>
      isOperationalEntertainmentStatus(event.status, event.fullBuyout),
    );
    const confirmedSources = confirmedContractEntertainmentSourcesForDate(
      date,
    ).filter(
      (source) => {
        const matchingSource = allSourceEvents.find(
          (candidate) =>
            candidate.tripleseatEventId === source.tripleseatEventId ||
            !isVipEntertainmentSourceEvent(candidate) && eventMatchesConfirmedContract(
              candidate.localDate,
              candidate.eventName,
              source.localDate,
              source.eventName,
            ),
        );
        return !(
          matchingSource &&
          (!isOperationalEntertainmentStatus(matchingSource.status, matchingSource.fullBuyout) ||
            sourceIsAtLeastAsNew(
              matchingSource.sourceUpdatedAt,
              source.sourceUpdatedAt,
            ))
        );
      },
    );
    sourceEvents = [
      ...sourceEvents.filter(
        (candidate) =>
          !confirmedSources.some((source) =>
            candidate.tripleseatEventId === source.tripleseatEventId ||
            !isVipEntertainmentSourceEvent(candidate) && eventMatchesConfirmedContract(
              candidate.localDate,
              candidate.eventName,
              source.localDate,
              source.eventName,
            ),
          ),
      ),
      ...confirmedSources,
    ];
    const now = new Date().toISOString();
    const built = preserveManualEventColors(
      buildEntertainmentSchedule({
        sourceEvents,
        localEvents: context.localEvents,
        existingReservations: projectDecemberOwnerHoldEntertainmentVisibility(ownerHoldPlanningProjection(stored)).reservations,
        now,
      }),
      stored.events,
    );
    const merged = mergeReservationsForSync(
      !vipPayload ? stored.reservations.filter((reservation) => !isVipEntertainmentReservation(reservation)) : stored.reservations,
      built.reservations,
      now,
      built.events,
    );
    if (!vipPayload) {
      merged.push(...stored.reservations.filter(isVipEntertainmentReservation));
      built.events.push(...stored.events.filter(isVipEntertainmentEvent));
    }
    const preserved = preserveOwnerHoldCache(stored, built.events, merged);
    const visible = projectDecemberOwnerHoldEntertainmentVisibility({ ...stored, ...preserved });
    const conflicts = detectEntertainmentConflicts(representedEntertainmentReservations(visible.events, visible.reservations));
    const counts = reservationCounts(stored.reservations, preserved.reservations);
    const stats = {
      eventsProcessed: built.events.length,
      reservationsCreated: counts.created,
      reservationsUpdated: counts.updated,
      warningsCreated: built.events.reduce(
        (total, event) => total + event.reviewIssues.length,
        0,
      ),
      conflictsFound: conflicts.length,
    };
    await storage.saveSync({
      date,
      events: preserved.events,
      reservations: preserved.reservations,
      existingReservations: stored.reservations,
      stats,
    });
    const payload = await getEntertainmentDay(date, { ...options, adapter, storage, vipPrepClient: {
      configured: vipPrepClient.configured,
      async fetchRange() {
        if (!vipPayload) throw new Error("On Par Bookings was unavailable during this refresh.");
        return vipPayload;
      },
    } });
    return { ...payload, sourceRefresh: { tripleseat: "success", onParBookings: vipPrepClient.configured ? vipPayload ? "success" : "error" : "not-configured", reconnectTripleseat: false } };
  } catch (error) {
    const message = safeSyncError(error);
    try {
      await storage.failSync(date, message);
    } catch {
      // Preserve the safe upstream/database error if sync-state persistence fails.
    }
    throw new EntertainmentSyncError(message);
  }
}

function stringField(
  value: unknown,
  label: string,
  maximum: number,
  required = true,
) {
  if (typeof value !== "string") {
    if (!required) {
      return "";
    }
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && !normalized) {
    throw new Error(`${label} is required.`);
  }
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function reviewIssueForManual(needsReview: boolean) {
  return needsReview
    ? [
        {
          code: "UNVERIFIED_ASSIGNMENT" as const,
          message: "Staff marked this manual reservation as needing review.",
        },
      ]
    : [];
}

function outsideOperatingDayIssue(
  startAt: string,
  endAt: string,
  operatingDate: string,
): EntertainmentReviewIssue[] {
  return isInsideOperatingDay(startAt, endAt, operatingDate)
    ? []
    : [
        {
          code: "OUTSIDE_OPERATING_DAY",
          message:
            "This reservation extends outside the 10:00 AM–1:00 AM operating day.",
        },
      ];
}

function mutationFields(input: ReservationMutationInput) {
  const operatingDate = stringField(
    input.operatingDate,
    "Operating date",
    10,
  );
  assertEntertainmentDate(operatingDate);
  const resourceId = stringField(input.resourceId, "Resource", 80);
  const resource = getEntertainmentResource(resourceId);
  if (!resource) {
    throw new Error("Unknown entertainment resource.");
  }
  if (resource.category === "mini-golf") {
    throw new Error(
      "Mini golf is open play and does not require an Entertainment Schedule reservation.",
    );
  }
  const startAt = stringField(input.startAt, "Start time", 40);
  const endAt = stringField(input.endAt, "End time", 40);
  validateReservationTimes(startAt, endAt);
  const eventColor =
    typeof input.eventColor === "string" && isHexColor(input.eventColor)
      ? input.eventColor.toUpperCase()
      : null;
  if (!eventColor) {
    throw new Error("Event color must be a six-digit hex color.");
  }
  return {
    operatingDate,
    resource,
    startAt,
    endAt,
    eventColor,
    eventId:
      typeof input.eventId === "string" && input.eventId.trim()
        ? input.eventId.trim().slice(0, 128)
        : null,
    eventName: stringField(input.eventName, "Event", 200),
    notes: stringField(input.notes, "Notes", 1_000, false),
    reason: stringField(input.reason, "Reason", 500, false),
    needsReview: input.needsReview === true,
    forceConflict: input.forceConflict === true,
  };
}

function normalizedReservationId(reservationId: string) {
  const normalized = reservationId.trim();
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(normalized)) {
    throw new Error("Invalid entertainment reservation ID.");
  }
  return normalized;
}

function auditEntry(
  reservation: EntertainmentReservation,
  action: EntertainmentAuditEntry["action"],
  previousValue: EntertainmentReservation | null,
  reason: string,
  intentionalConflict: boolean,
): EntertainmentAuditEntry {
  return {
    id: randomUUID(),
    reservationId: reservation.id,
    action,
    previousValue,
    newValue: reservation,
    changedBy: "authenticated-event-host-staff",
    changeSource: "manual",
    reason: reason || null,
    intentionalConflict,
    createdAt: reservation.updatedAt,
  };
}

async function applyEventColorOverride({
  storage,
  operatingDate,
  eventId,
  eventColor,
  excludeReservationId,
  reason,
  now,
}: {
  storage: EntertainmentStorage;
  operatingDate: string;
  eventId: string;
  eventColor: string;
  excludeReservationId: string;
  reason: string;
  now: string;
}) {
  const day = await storage.getDay(operatingDate);
  const event = day.events.find((candidate) =>
    eventIdentityValues(candidate).includes(eventId),
  );
  if (event) {
    await storage.saveEventSnapshot({
      ...event,
      eventColor,
      colorSource: "manual",
      syncedAt: now,
    });
  }
  const related = day.reservations.filter(
    (reservation) =>
      reservation.id !== excludeReservationId &&
      reservationMatchesEventId(reservation, eventId) &&
      (reservation.eventColor !== eventColor ||
        reservation.colorSource !== "manual"),
  );
  await Promise.all(
    related.map(async (existing) => {
      const reservation = {
        ...existing,
        eventColor,
        colorSource: "manual" as const,
        updatedAt: now,
        updatedBy: "authenticated-event-host-staff",
      };
      await storage.saveManualReservation(
        reservation,
        auditEntry(
          reservation,
          "manual-update",
          existing,
          reason || "Changed the event color.",
          false,
        ),
      );
    }),
  );
}

async function assertNoUnconfirmedConflict(
  reservation: EntertainmentReservation,
  storage: EntertainmentStorage,
  forceConflict: boolean,
) {
  const day = projectDecemberOwnerHoldEntertainmentVisibility(await storage.getDay(reservation.operatingDate));
  const represented = representedEntertainmentReservations(day.events, [
    ...day.reservations.filter((row) => row.id !== reservation.id), reservation,
  ]);
  const conflicts = conflictForCandidate(reservation, represented);
  if (conflicts.length > 0 && !forceConflict) {
    throw new EntertainmentConflictError(conflicts);
  }
  return conflicts.length > 0;
}

export async function createManualEntertainmentReservation(
  input: ReservationMutationInput,
  options: Pick<EntertainmentDependencies, "storage"> = {},
) {
  const values = mutationFields(input);
  const storage = options.storage ?? getEntertainmentStorage();
  const now = new Date().toISOString();
  const color = eventColorAndSource(values.eventColor, "manual");
  const reviewIssues = [
    ...reviewIssueForManual(values.needsReview),
    ...outsideOperatingDayIssue(
      values.startAt,
      values.endAt,
      values.operatingDate,
    ),
  ];
  const reservation: EntertainmentReservation = {
    id: randomUUID(),
    syncKey: null,
    localEventId: values.eventId,
    tripleseatEventId: null,
    tripleseatBookingId: null,
    eventName: values.eventName,
    operatingDate: values.operatingDate,
    resourceId: values.resource.id,
    resourceCategory: values.resource.category,
    resourceName: values.resource.canonicalName,
    startAt: values.startAt,
    endAt: values.endAt,
    sourceStartAt: null,
    sourceEndAt: null,
    sourceResourceId: null,
    startTimeSource: "staff-override",
    sourceStartTimeSource: null,
    contractedDurationMinutes: null,
    ...color,
    source: "manual",
    sourceReference: null,
    manualOverride: true,
    hasSourceUpdate: false,
    needsReview: reviewIssues.length > 0,
    reviewIssues,
    autoAssigned: false,
    notes: values.notes,
    sourceUpdatedAt: null,
    lastTripleseatSyncAt: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: "authenticated-event-host-staff",
  };
  const intentionalConflict = await assertNoUnconfirmedConflict(
    reservation,
    storage,
    values.forceConflict,
  );
  await storage.saveManualReservation(
    reservation,
    auditEntry(
      reservation,
      "manual-create",
      null,
      values.reason,
      intentionalConflict,
    ),
  );
  return reservation;
}

export async function updateEntertainmentReservation(
  reservationId: string,
  input: ReservationMutationInput,
  options: Pick<EntertainmentDependencies, "storage"> & {
    preserveAssignmentMode?: boolean;
  } = {},
) {
  const normalizedId = normalizedReservationId(reservationId);
  const values = mutationFields(input);
  const storage = options.storage ?? getEntertainmentStorage();
  const existing = await storage.getReservation(normalizedId);
  if (!existing) {
    throw new Error("Entertainment reservation not found.");
  }
  const now = new Date().toISOString();
  const reviewIssues = options.preserveAssignmentMode ? existing.reviewIssues : [
    ...existing.reviewIssues.filter(
      (issue) => issue.code === "SOURCE_HAS_NEWER_INFORMATION",
    ),
    ...reviewIssueForManual(values.needsReview),
    ...outsideOperatingDayIssue(
      values.startAt,
      values.endAt,
      values.operatingDate,
    ),
  ];
  const reservation: EntertainmentReservation = {
    ...existing,
    localEventId: values.eventId ?? existing.localEventId,
    eventName: values.eventName,
    operatingDate: values.operatingDate,
    resourceId: values.resource.id,
    resourceCategory: values.resource.category,
    resourceName: values.resource.canonicalName,
    startAt: values.startAt,
    endAt: values.endAt,
    startTimeSource: !options.preserveAssignmentMode && (
      Date.parse(existing.startAt) !== Date.parse(values.startAt) || Date.parse(existing.endAt) !== Date.parse(values.endAt)
    ) ? "staff-override" : existing.startTimeSource,
    eventColor: values.eventColor,
    colorSource: options.preserveAssignmentMode ? existing.colorSource : "manual",
    manualOverride: options.preserveAssignmentMode ? existing.manualOverride : true,
    needsReview: reviewIssues.length > 0,
    reviewIssues,
    notes: values.notes,
    active: true,
    updatedAt: now,
    updatedBy: options.preserveAssignmentMode
      ? "event-host-floor-plan-alignment"
      : "authenticated-event-host-staff",
  };
  const intentionalConflict = await assertNoUnconfirmedConflict(
    reservation,
    storage,
    values.forceConflict,
  );
  await storage.saveManualReservation(
    reservation,
    auditEntry(
      reservation,
      "manual-update",
      existing,
      values.reason,
      intentionalConflict,
    ),
  );
  if (
    !options.preserveAssignmentMode &&
    values.eventId &&
    (existing.eventColor !== reservation.eventColor ||
      existing.colorSource !== "manual")
  ) {
    await applyEventColorOverride({
      storage,
      operatingDate: reservation.operatingDate,
      eventId: values.eventId,
      eventColor: reservation.eventColor,
      excludeReservationId: reservation.id,
      reason: values.reason,
      now,
    });
  }
  return reservation;
}

export async function removeEntertainmentReservation(
  reservationId: string,
  reason: string,
  options: Pick<EntertainmentDependencies, "storage"> = {},
) {
  const storage = options.storage ?? getEntertainmentStorage();
  const normalizedId = normalizedReservationId(reservationId);
  const existing = await storage.getReservation(normalizedId);
  if (!existing) {
    throw new Error("Entertainment reservation not found.");
  }
  const reservation = {
    ...existing,
    active: false,
    manualOverride: true,
    updatedAt: new Date().toISOString(),
    updatedBy: "authenticated-event-host-staff",
  };
  await storage.saveManualReservation(
    reservation,
    auditEntry(
      reservation,
      "manual-remove",
      existing,
      stringField(reason, "Reason", 500, false),
      false,
    ),
  );
  return reservation;
}

export async function revertEntertainmentReservation(
  reservationId: string,
  forceConflict: boolean,
  reason: string,
  options: Pick<EntertainmentDependencies, "storage"> = {},
) {
  const storage = options.storage ?? getEntertainmentStorage();
  const normalizedId = normalizedReservationId(reservationId);
  const existing = await storage.getReservation(normalizedId);
  if (!existing) {
    throw new Error("Entertainment reservation not found.");
  }
  if (
    !existing.sourceStartAt ||
    !existing.sourceEndAt ||
    !existing.sourceResourceId
  ) {
    throw new Error("No Tripleseat value is available for this reservation.");
  }
  const resource = getEntertainmentResource(existing.sourceResourceId);
  if (!resource) {
    throw new Error("The Tripleseat resource is no longer active.");
  }
  const reservation: EntertainmentReservation = {
    ...existing,
    resourceId: resource.id,
    resourceCategory: resource.category,
    resourceName: resource.canonicalName,
    startAt: existing.sourceStartAt,
    endAt: existing.sourceEndAt,
    startTimeSource: existing.sourceStartTimeSource ?? null,
    manualOverride: false,
    hasSourceUpdate: false,
    reviewIssues: existing.reviewIssues.filter(
      (issue) => issue.code !== "SOURCE_HAS_NEWER_INFORMATION",
    ),
    active: true,
    updatedAt: new Date().toISOString(),
    updatedBy: "authenticated-event-host-staff",
  };
  reservation.needsReview = reservation.reviewIssues.length > 0;
  const intentionalConflict = await assertNoUnconfirmedConflict(
    reservation,
    storage,
    forceConflict,
  );
  await storage.saveManualReservation(
    reservation,
    auditEntry(
      reservation,
      "revert-to-tripleseat",
      existing,
      stringField(reason, "Reason", 500, false),
      intentionalConflict,
    ),
  );
  return reservation;
}

export async function getEntertainmentReservationAudit(
  reservationId: string,
  options: Pick<EntertainmentDependencies, "storage"> = {},
) {
  return (options.storage ?? getEntertainmentStorage()).getAudit(
    normalizedReservationId(reservationId),
  );
}

export function fallbackColorForManualEvent(eventName: string) {
  return deterministicEventColor(eventName);
}

export function issueMessages(issues: EntertainmentReviewIssue[]) {
  return unique(issues.map((issue) => issue.message));
}

export function entertainmentConfigurationWarnings() {
  return unique([
    ...getMissingTripleseatEnvironmentVariables(),
    ...getMissingEntertainmentEnvironmentVariables(),
  ]);
}
