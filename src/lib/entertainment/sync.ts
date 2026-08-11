import { randomUUID } from "node:crypto";
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
import {
  getMissingVipPrepEnvironmentVariables,
  VipPrepClient,
  vipPrepEntertainmentEvents,
} from "../vip-prep/client";

export type EntertainmentDependencies = {
  adapter?: TripleseatAdapter;
  storage?: EntertainmentStorage;
  localEvents?: LocalEntertainmentEvent[];
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
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

function safeSyncError(error: unknown) {
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

export async function getEntertainmentDay(
  date: string,
  options: EntertainmentDependencies = {},
): Promise<EntertainmentDayPayload> {
  assertEntertainmentDate(date);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? getEntertainmentStorage();
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  const [stored, vipResult] = await Promise.all([
    storage.getDay(date),
    vipPrepClient.configured
      ? vipPrepClient.fetchRange(date, date).then(
          (payload) => ({ events: vipPrepEntertainmentEvents(payload.reservations), error: null, refreshed: true }),
          () => ({ events: [], error: "VIP Prep could not be refreshed; the last saved VIP schedule remains visible.", refreshed: false }),
        )
      : Promise.resolve({ events: [], error: null, refreshed: false }),
  ]);
  const diagnostics = adapter.getDiagnostics();
  const storedReservations = stored.reservations.filter(
    (reservation) =>
      reservation.active && reservation.resourceCategory !== "mini-golf",
  );
  const liveVip = buildEntertainmentSchedule({
    sourceEvents: vipResult.events,
    localEvents: floorPlanContext(options).localEvents,
    existingReservations: storedReservations,
  });
  const reservations = [
    ...storedReservations.filter(
      (reservation) =>
        !vipResult.refreshed || reservation.source !== "vip-prep",
    ),
    ...liveVip.reservations,
  ];
  const events = [
    ...stored.events.filter(
      (event) => event.sourceSnapshot.sourceSystem !== "vip-prep",
    ),
    ...liveVip.events,
    ...manualEventSnapshots(date, reservations, stored.events),
  ].sort((left, right) =>
    (left.eventStartAt ?? "").localeCompare(right.eventStartAt ?? ""),
  );
  const warnings = [...diagnostics.warnings];
  if (vipResult.error) warnings.push(vipResult.error);
  if (stored.sync?.status === "error" && stored.sync.errorSummary) {
    warnings.push(
      "The latest Tripleseat sync failed. The last saved schedule remains visible.",
    );
  }
  return {
    date,
    events,
    reservations,
    conflicts: detectEntertainmentConflicts(reservations),
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
) {
  assertEntertainmentDate(date);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? getEntertainmentStorage();
  if (adapter.sourceMode === "mock" && storage.persistence === "database") {
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
    if (!adapter.fetchEntertainmentEventsForDate) {
      throw new Error(
        "The existing Tripleseat adapter does not expose entertainment reads.",
      );
    }
    const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
    const [tripleseatSourceEvents, vipPayload] = await Promise.all([
      adapter.fetchEntertainmentEventsForDate(date),
      vipPrepClient.configured ? vipPrepClient.fetchRange(date, date) : null,
    ]);
    let sourceEvents = [
      ...tripleseatSourceEvents,
      ...vipPrepEntertainmentEvents(vipPayload?.reservations ?? []),
    ];
    if (
      adapter.sourceMode === "mock" &&
      storage.persistence === "memory" &&
      sourceEvents.length === 0
    ) {
      sourceEvents = mockSourceEvents(date, context.localEvents);
    }
    const now = new Date().toISOString();
    const built = preserveManualEventColors(
      buildEntertainmentSchedule({
        sourceEvents,
        localEvents: context.localEvents,
        existingReservations: stored.reservations,
        now,
      }),
      stored.events,
    );
    const merged = mergeReservationsForSync(
      stored.reservations,
      built.reservations,
      now,
    );
    const conflicts = detectEntertainmentConflicts(merged);
    const counts = reservationCounts(stored.reservations, merged);
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
      events: built.events,
      reservations: merged,
      existingReservations: stored.reservations,
      stats,
    });
    return getEntertainmentDay(date, { ...options, adapter, storage });
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
  const day = await storage.getDay(reservation.operatingDate);
  const conflicts = conflictForCandidate(reservation, day.reservations);
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
  options: Pick<EntertainmentDependencies, "storage"> = {},
) {
  const normalizedId = normalizedReservationId(reservationId);
  const values = mutationFields(input);
  const storage = options.storage ?? getEntertainmentStorage();
  const existing = await storage.getReservation(normalizedId);
  if (!existing) {
    throw new Error("Entertainment reservation not found.");
  }
  const now = new Date().toISOString();
  const reviewIssues = [
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
    eventColor: values.eventColor,
    colorSource: "manual",
    manualOverride: true,
    needsReview: reviewIssues.length > 0,
    reviewIssues,
    notes: values.notes,
    active: true,
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
      "manual-update",
      existing,
      values.reason,
      intentionalConflict,
    ),
  );
  if (
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
