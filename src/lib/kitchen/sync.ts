import {
  KITCHEN_EVENT_ADD_ON_FIELDS,
  normalizeKitchenOrderNotes,
  type KitchenEventAddOnFood,
} from "./addons";
import { activeKitchenChecklists } from "./lifecycle";
import { isPreviewReviewOnly } from "../operations/preview-review";
import { generateKitchenChecklist } from "./rules";
import { withKitchenReservedAreas } from "./reserved-area";
import {
  getFloorPlanStorage,
  type FloorPlanStorage,
} from "../floor-plans/storage";
import {
  getKitchenStorage,
  getMissingSupabaseEnvironmentVariables,
  KITCHEN_STAFF_ROSTER,
  type KitchenStorage,
  type KitchenSyncState,
} from "./storage";
import {
  getTripleseatAdapter,
  isValidKitchenDate,
  type TripleseatAdapter,
} from "./tripleseat";
import type {
  KitchenAddOnActivity,
  KitchenAddOnCompletion,
  KitchenChecklist,
  KitchenSourceEvent,
} from "./types";
import {
  getMissingVipPrepEnvironmentVariables,
  VipPrepApiError,
  VipPrepClient,
  vipPrepKitchenEvents,
  isActiveVipPrepReservation,
} from "../vip-prep/client";
import {
  confirmedContractKitchenSourcesForDate,
  eventMatchesConfirmedContract,
  isConfirmedContractEventPlanId,
  sourceIsAtLeastAsNew,
} from "../confirmed-contract-events";

export type KitchenDayPayload = {
  date: string;
  events: KitchenChecklist[];
  bwaOptions: string[];
  archivedEventCount: number;
  addOnActivity: KitchenAddOnActivity[];
  addOnCompletions: KitchenAddOnCompletion[];
  lastSyncedAt: string | null;
  sourceMode: "live" | "mock";
  source: "live" | "mock";
  syncStatus: KitchenSyncState["status"] | "never";
  syncError: string | null;
  warnings: string[];
  missingEnvironmentVariables: string[];
  vipBookingSync?: {
    status: "success" | "error" | "unconfigured";
    lastSuccessfulRefreshAt: string | null;
    error: string | null;
    reservationCount: number | null;
  };
};

export type KitchenSyncDependencies = {
  adapter?: TripleseatAdapter;
  storage?: KitchenStorage;
  now?: Date;
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
  floorPlanStorage?: Pick<FloorPlanStorage, "get">;
  /** Projection-only diagnostics must not initialize or refresh saved records. */
  persistSourceChanges?: boolean;
};

export class KitchenSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KitchenSyncError";
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function isOperationalKitchenStatus(status: string | null, fullBuyout = false) {
  return fullBuyout || !["LOST", "PROSPECT"].includes(
    status?.trim().toLocaleUpperCase("en-US") ?? "",
  );
}

function dedupeConfirmedContractKitchenEvents(events: KitchenChecklist[]) {
  const contractEvent = events.find((event) =>
    isConfirmedContractEventPlanId(Number(event.event.eventId)),
  );
  if (!contractEvent) return events;
  const matching = events.filter((event) =>
    !String(event.event.eventId).startsWith("vip-") && eventMatchesConfirmedContract(
      event.event.localDate,
      event.event.name,
      contractEvent.event.localDate,
      contractEvent.event.name,
    ),
  );
  if (matching.length < 2) return events;
  const winner = [...matching].sort((left, right) => {
    const timeDifference =
      Date.parse(right.event.sourceUpdatedAt ?? "") -
      Date.parse(left.event.sourceUpdatedAt ?? "");
    if (Number.isFinite(timeDifference) && timeDifference !== 0) {
      return timeDifference;
    }
    return Number(
      isConfirmedContractEventPlanId(Number(left.event.eventId)),
    ) - Number(
      isConfirmedContractEventPlanId(Number(right.event.eventId)),
    );
  })[0];
  return events.filter(
    (event) =>
      event === winner || String(event.event.eventId).startsWith("vip-") ||
      !eventMatchesConfirmedContract(
        event.event.localDate,
        event.event.name,
        contractEvent.event.localDate,
        contractEvent.event.name,
      ),
  );
}

function uniqueKitchenSourceIdentities<T>(events: readonly T[], id: (event: T) => string) {
  return [...new Map(events.map((event) => [id(event), event])).values()];
}

function sameVipBookingFacts(left: KitchenChecklist, right: KitchenChecklist) {
  const facts = (checklist: KitchenChecklist) => {
    if (!checklist.event.vipBooking) return null;
    const { lastRefreshedAt: _refresh, ...booking } = checklist.event.vipBooking;
    return booking;
  };
  return JSON.stringify(facts(left)) === JSON.stringify(facts(right));
}

function withVipPreorderChange(source: KitchenSourceEvent, previous: KitchenChecklist | undefined): KitchenSourceEvent {
  const booking = source.vipBooking;
  const prior = previous?.event.vipBooking;
  if (!booking || !prior) return source;
  const food = (items: typeof booking.foodPrep) => items.map(({ code, label, quantity }) => ({ code, label, quantity }));
  const facts = (items: typeof booking.foodPrep) => food(items).map((item) => JSON.stringify(item)).sort();
  const changed = JSON.stringify(facts(booking.foodPrep)) !== JSON.stringify(facts(prior.foodPrep));
  const preorderChange = changed ? {
    sourceUpdatedAt: booking.updatedAt, previous: food(prior.foodPrep), current: food(booking.foodPrep),
    message: "The booked food changed. Use the current purchased quantities for planning.",
  } : prior.preorderChange;
  return preorderChange ? { ...source, vipBooking: { ...booking, preorderChange } } : source;
}

function markSourceWarning(
  events: KitchenChecklist[],
  code: "SOURCE_STALE" | "SOURCE_SYNC_FAILED",
  message: string,
) {
  return events.map((event) => {
    // An unrelated Tripleseat failure says nothing about the booking feed.
    if (String(event.event.eventId).startsWith("vip-")) return event;
    if (event.warnings.some((warning) => warning.code === code)) {
      return event;
    }

    return {
      ...event,
      warnings: [
        ...event.warnings,
        {
          code,
          message,
          requiresReview: true,
          scope: "event" as const,
        },
      ],
      needsReview: true,
    };
  });
}

function dependencies(options: KitchenSyncDependencies) {
  return {
    adapter: options.adapter ?? getTripleseatAdapter(),
    storage: options.storage ?? getKitchenStorage(),
  };
}

function safeSyncError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Kitchen synchronization failed.";
  }

  const allowedPrefixes = [
    "Kitchen sync date must use YYYY-MM-DD.",
    "Tripleseat OAuth configuration is incomplete:",
    "Tripleseat OAuth refresh configuration is incomplete.",
    "Tripleseat OAuth refresh was rejected (",
    "Tripleseat API request failed (",
    "Tripleseat OAuth response did not include an access token.",
    "Tripleseat event detail response was invalid.",
    "VIP Prep API request failed (",
    "VIP Prep API returned an invalid",
    "Kitchen database request failed (",
    "Missing SUPABASE_SECRET_KEY",
    "TRIPLESEAT_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes",
  ];
  return allowedPrefixes.some((prefix) => error.message.startsWith(prefix))
    ? error.message
    : "Kitchen synchronization failed.";
}

export function assertKitchenDate(date: string) {
  if (!isValidKitchenDate(date)) {
    throw new KitchenSyncError("Kitchen date must use YYYY-MM-DD.");
  }
}

export async function getKitchenDay(
  date: string,
  options: KitchenSyncDependencies = {},
): Promise<KitchenDayPayload> {
  assertKitchenDate(date);
  const persistSourceChanges = options.persistSourceChanges !== false && !isPreviewReviewOnly();
  const { adapter, storage } = dependencies(options);
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  const [initialStored, diagnostics, liveVipResult, floorPlanResult] = await Promise.all([
    storage.getDay(date),
    Promise.resolve(adapter.getDiagnostics()),
    vipPrepClient.configured
      ? vipPrepClient.fetchRange(date, date).then(
          (payload) => {
            const events = vipPrepKitchenEvents(payload.reservations);
            return { events, error: null, refreshed: true, refreshedAt: payload.generatedAt, count: events.length };
          },
          () => ({ events: [], error: "VIP Prep could not be refreshed; the last saved VIP checklist remains visible.", refreshed: false, refreshedAt: null, count: null }),
        )
      : Promise.resolve({ events: [], error: null, refreshed: false, refreshedAt: null, count: null }),
    (options.floorPlanStorage ?? getFloorPlanStorage()).get(date).then(
      (plan) => ({ plan, error: null }),
      () => ({
        plan: null,
        error: "Saved floor-plan areas could not be loaded; booking areas are shown.",
      }),
    ),
  ]);
  let stored = initialStored;
  let contractPersistenceWarning: string | null = null;
  let vipPersistenceWarning: string | null = null;
  const liveVipEvents = liveVipResult.events.map((source) => withVipPreorderChange(source,
    stored.events.find((event) => String(event.event.eventId) === String(source.eventId)),
  ));
  const contractSources = confirmedContractKitchenSourcesForDate(
    date,
    stored.sync?.lastSuccessfulSyncAt,
  ).filter(
    (source) =>
      !stored.events.some(
        (checklist) =>
          !String(checklist.event.eventId).startsWith("vip-") && eventMatchesConfirmedContract(
            checklist.event.localDate,
            checklist.event.name,
            source.localDate,
            source.eventName,
          ) &&
          sourceIsAtLeastAsNew(
            checklist.event.sourceUpdatedAt,
            source.sourceUpdatedAt,
          ),
      ),
  );
  if (contractSources.length > 0 && persistSourceChanges) {
    try {
      for (const sourceEvent of contractSources) {
        await storage.saveEvent({
          sourceEvent,
          checklist: generateKitchenChecklist(sourceEvent),
        });
      }
      stored = await storage.getDay(date);
    } catch {
      contractPersistenceWarning =
        "Confirmed contract food is visible, but its kitchen checklist could not be saved for staff edits.";
    }
  }
  if (liveVipResult.refreshed && persistSourceChanges) {
    try {
      for (const sourceEvent of liveVipEvents) {
        const existing = stored.events.find((checklist) =>
          String(checklist.event.eventId) === String(sourceEvent.eventId),
        );
        const checklist = generateKitchenChecklist(sourceEvent);
        if (
          existing &&
          existing.event.sourceUpdatedAt === sourceEvent.sourceUpdatedAt &&
          existing.ruleVersion === checklist.ruleVersion &&
          JSON.stringify(existing.normalizedSelections) === JSON.stringify(checklist.normalizedSelections) &&
          sameVipBookingFacts(existing, checklist)
        ) {
          continue;
        }
        await storage.saveEvent({
          sourceEvent,
          checklist,
        });
      }
      const activeVipIds = new Set(liveVipEvents.map((event) => String(event.eventId)));
      for (const checklist of stored.events) {
        const booking = checklist.event.vipBooking;
        if (!booking || activeVipIds.has(String(checklist.event.eventId)) || booking.activeInSource === false) continue;
        // Absence in a successful source response is durable, unlike an outage.
        // Retain the last known preorder and staff-owned history, not an active hold.
        const vipBooking = { ...booking, activeInSource: false, lastRefreshedAt: liveVipResult.refreshedAt ?? undefined };
        const sourceEvent = vipPrepKitchenEvents([{ ...booking, activeInSource: true }])[0];
        if (!sourceEvent) continue;
        await storage.saveEvent({
          sourceEvent: { ...sourceEvent, vipBooking },
          checklist: { ...checklist, event: { ...checklist.event, vipBooking } },
        });
      }
      stored = await storage.getDay(date);
    } catch {
      vipPersistenceWarning =
        "VIP booking prep is visible, but its kitchen checklist could not be saved for staff edits and add-ons.";
    }
  }
  const databaseMissing =
    storage.persistence === "database" && options.storage == null
      ? getMissingSupabaseEnvironmentVariables()
      : [];
  const liveSourceUnavailable =
    adapter.sourceMode === "mock" &&
    storage.persistence === "database";
  const storedEventsWithSourceStatus =
    stored.sync?.status === "error"
      ? markSourceWarning(
          dedupeConfirmedContractKitchenEvents(stored.events),
          "SOURCE_SYNC_FAILED",
          "The latest Tripleseat sync failed; this stored checklist may be stale.",
        )
      : liveSourceUnavailable
        ? markSourceWarning(
            dedupeConfirmedContractKitchenEvents(stored.events),
            "SOURCE_STALE",
            "Live Tripleseat configuration is unavailable; this stored checklist may be stale.",
          )
        : dedupeConfirmedContractKitchenEvents(stored.events);
  const storedAndVipEvents = [
    ...storedEventsWithSourceStatus.filter(
      (event) =>
        (!event.event.vipBooking || isActiveVipPrepReservation(event.event.vipBooking)) &&
        (!liveVipResult.refreshed || !String(event.event.eventId).startsWith("vip-")),
    ).map((event) => liveVipResult.error && String(event.event.eventId).startsWith("vip-")
      ? { ...event, needsReview: true, warnings: [...event.warnings.filter((warning) => warning.code !== "SOURCE_SYNC_FAILED"), { code: "SOURCE_SYNC_FAILED" as const, message: liveVipResult.error, requiresReview: true, scope: "event" as const }] }
      : event),
    ...liveVipEvents.map((event) => {
      const fresh = generateKitchenChecklist(event);
      const saved = stored.events.find((checklist) =>
        String(checklist.event.eventId) === String(event.eventId) &&
        checklist.event.sourceUpdatedAt === event.sourceUpdatedAt &&
        JSON.stringify(checklist.normalizedSelections) === JSON.stringify(fresh.normalizedSelections) &&
        sameVipBookingFacts(checklist, fresh),
      );
      if (saved) return { ...saved, event: { ...saved.event, vipBooking: fresh.event.vipBooking } };
      const previous = stored.events.find((checklist) => String(checklist.event.eventId) === String(event.eventId));
      return previous ? { ...fresh,
        foodRunnerOrBwa: previous.foodRunnerOrBwa, foodRunners: previous.foodRunners, pocs: previous.pocs,
        setup: previous.setup, preppedBy: previous.preppedBy, verifiedBy: previous.verifiedBy,
        assignmentUpdatedAt: previous.assignmentUpdatedAt,
      } : fresh;
    }),
  ];
  const confirmedContractEvents = contractSources
    .filter(
      (source) =>
        !storedAndVipEvents.some((checklist) =>
          !String(checklist.event.eventId).startsWith("vip-") && eventMatchesConfirmedContract(
            checklist.event.localDate,
            checklist.event.name,
            source.localDate,
            source.eventName,
          ),
        ),
    )
    .map((source) => generateKitchenChecklist(source));
  const eventsWithSourceStatus = uniqueKitchenSourceIdentities([
    ...storedAndVipEvents,
    ...confirmedContractEvents,
  ], (event) => String(event.event.eventId));
  const events = withKitchenReservedAreas(
    activeKitchenChecklists(
      eventsWithSourceStatus,
      options.now ?? new Date(),
    ),
    floorPlanResult.plan,
  );
  const activeEventIds = new Set(
    events.map((event) => String(event.event.eventId)),
  );

  return {
    date,
    events,
    bwaOptions: stored.bwaOptions,
    archivedEventCount: eventsWithSourceStatus.length - events.length,
    addOnActivity: (stored.addOnActivity ?? []).filter((activity) =>
      activeEventIds.has(activity.eventId),
    ),
    addOnCompletions: (stored.addOnCompletions ?? []).filter((completion) =>
      activeEventIds.has(completion.eventId),
    ),
    lastSyncedAt: stored.sync?.lastSuccessfulSyncAt ?? null,
    sourceMode: diagnostics.sourceMode,
    source: diagnostics.sourceMode,
    syncStatus: stored.sync?.status ?? "never",
    syncError: stored.sync?.errorMessage ?? null,
    vipBookingSync: {
      status: liveVipResult.refreshed ? "success" : liveVipResult.error ? "error" : "unconfigured",
      lastSuccessfulRefreshAt: liveVipResult.refreshedAt ?? stored.events.map((event) => event.event.vipBooking?.lastRefreshedAt)
        .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).sort().at(-1) ?? null,
      error: liveVipResult.error,
      reservationCount: liveVipResult.count,
    },
    warnings: unique([
      ...diagnostics.warnings,
      ...(liveVipResult.error ? [liveVipResult.error] : []),
      ...(contractPersistenceWarning ? [contractPersistenceWarning] : []),
      ...(vipPersistenceWarning ? [vipPersistenceWarning] : []),
      ...(floorPlanResult.error ? [floorPlanResult.error] : []),
    ]),
    missingEnvironmentVariables: unique([
      ...diagnostics.missingEnvironmentVariables,
      ...databaseMissing,
      ...(options.vipPrepClient == null
        ? getMissingVipPrepEnvironmentVariables()
        : []),
    ]),
  };
}

export async function syncKitchenDay(
  date: string,
  options: KitchenSyncDependencies = {},
): Promise<KitchenDayPayload> {
  assertKitchenDate(date);
  const { adapter, storage } = dependencies(options);
  if (
    adapter.sourceMode === "mock" &&
    storage.persistence === "database"
  ) {
    throw new KitchenSyncError(
      "Mock Tripleseat data cannot be persisted to the kitchen database.",
    );
  }
  await storage.startSync(date);

  try {
    const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
    const [tripleseatEvents, vipPayload] = await Promise.all([
      adapter.fetchEventsForDate(date),
      vipPrepClient.configured ? vipPrepClient.fetchRange(date, date) : null,
    ]);
    const allUpstreamEvents = [
      ...tripleseatEvents,
      ...vipPrepKitchenEvents(vipPayload?.reservations ?? []),
    ];
    const upstreamEvents = allUpstreamEvents.filter((event) =>
      isOperationalKitchenStatus(event.status, event.fullBuyout),
    );
    const confirmedEvents = confirmedContractKitchenSourcesForDate(date).filter(
      (source) => {
        const matchingSource = allUpstreamEvents.find(
          (candidate) =>
            candidate.eventId === source.eventId ||
            (!String(candidate.eventId).startsWith("vip-") && eventMatchesConfirmedContract(
              candidate.localDate,
              candidate.eventName,
              source.localDate,
              source.eventName,
            )),
        );
        return !(
          matchingSource &&
          (!isOperationalKitchenStatus(matchingSource.status, matchingSource.fullBuyout) ||
            sourceIsAtLeastAsNew(
              matchingSource.sourceUpdatedAt,
              source.sourceUpdatedAt,
            ))
        );
      },
    );
    const sourceEvents = uniqueKitchenSourceIdentities([
      ...upstreamEvents.filter(
        (candidate) =>
          !confirmedEvents.some((source) =>
            candidate.eventId === source.eventId ||
            (!String(candidate.eventId).startsWith("vip-") && eventMatchesConfirmedContract(
              candidate.localDate,
              candidate.eventName,
              source.localDate,
              source.eventName,
            )),
        ),
      ),
      ...confirmedEvents,
    ], (event) => String(event.eventId));
    const previousKitchenDay = await storage.getDay(date);
    const storedEvents = sourceEvents.map((source) => {
      const sourceEvent = withVipPreorderChange(source, previousKitchenDay.events.find((event) => String(event.event.eventId) === String(source.eventId)));
      return { sourceEvent, checklist: generateKitchenChecklist(sourceEvent) };
    });
    await storage.replaceDay(date, storedEvents);
    await storage.completeSync(date, storedEvents.length);
    return getKitchenDay(date, {
      adapter,
      storage,
      now: options.now,
      vipPrepClient: vipPayload ? { configured: true, fetchRange: async () => vipPayload } : vipPrepClient,
      floorPlanStorage: options.floorPlanStorage,
    });
  } catch (error) {
    const message = safeSyncError(error);
    try {
      await storage.failSync(date, message);
    } catch {
      // Preserve the original safe integration error if sync-state storage fails.
    }
    throw new KitchenSyncError(message);
  }
}

export async function syncVipBookingDay(
  date: string,
  options: KitchenSyncDependencies = {},
): Promise<KitchenDayPayload & { bookingCount: number }> {
  assertKitchenDate(date);
  const vipPrepClient = options.vipPrepClient ?? new VipPrepClient();
  if (!vipPrepClient.configured) {
    throw new KitchenSyncError("OnPar Booking Sync is not configured.");
  }

  try {
    const bookingPayload = await vipPrepClient.fetchRange(date, date);
    const day = await getKitchenDay(date, {
      ...options,
      vipPrepClient: {
        configured: true,
        async fetchRange() {
          return bookingPayload;
        },
      },
    });
    if (day.warnings.some((warning) => warning.startsWith("VIP booking prep is visible"))) {
      throw new KitchenSyncError("VIP booking prep could not be saved to the kitchen sheet.");
    }
    return { ...day, bookingCount: vipPrepKitchenEvents(bookingPayload.reservations).length };
  } catch (error) {
    if (error instanceof KitchenSyncError) throw error;
    if (error instanceof VipPrepApiError) throw new KitchenSyncError(error.message);
    throw new KitchenSyncError("OnPar bookings could not be refreshed.");
  }
}

export async function updateKitchenManualAssignments(
  eventId: string,
  foodRunners: readonly string[],
  pocs: readonly string[],
  options: Pick<KitchenSyncDependencies, "storage"> = {},
  preppedBy = "",
  verifiedBy = "",
  setup: readonly string[] = [],
  expectedUpdatedAt?: string | null,
) {
  const normalizedEventId = eventId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedEventId)) {
    throw new Error("Invalid kitchen event ID.");
  }
  const normalizeNames = (values: readonly string[], label: string) => {
    if (values.length > 24) {
      throw new Error(`${label} can include at most 24 employees.`);
    }
    const normalized = unique(
      values.map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean),
    );
    if (normalized.some((value) => value.length > 80)) {
      throw new Error(`${label} names must be 80 characters or fewer.`);
    }
    if (
      normalized.some(
        (value) =>
          !KITCHEN_STAFF_ROSTER.includes(
            value as (typeof KITCHEN_STAFF_ROSTER)[number],
          ),
      )
    ) {
      throw new Error(`${label} contains an employee outside the approved roster.`);
    }
    return normalized;
  };
  const normalizedFoodRunners = normalizeNames(foodRunners, "Food Runner");
  const normalizedPocs = normalizeNames(pocs, "POC");
  const normalizeSingleName = (value: string, label: string) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (
      normalized &&
      !KITCHEN_STAFF_ROSTER.includes(
        normalized as (typeof KITCHEN_STAFF_ROSTER)[number],
      )
    ) {
      throw new Error(`${label} contains an employee outside the approved roster.`);
    }
    return normalized;
  };
  const normalizedPreppedBy = normalizeSingleName(preppedBy, "Prepped by");
  const normalizedVerifiedBy = normalizeSingleName(verifiedBy, "Verified by");
  const normalizedSetup = normalizeNames(setup, "Set Up");

  const updatedAt = await (options.storage ?? getKitchenStorage()).saveManualAssignments(
    normalizedEventId,
    normalizedFoodRunners,
    normalizedPocs,
    normalizedPreppedBy,
    normalizedVerifiedBy,
    normalizedSetup,
    expectedUpdatedAt,
  );
  return {
    eventId: normalizedEventId,
    foodRunners: normalizedFoodRunners,
    pocs: normalizedPocs,
    preppedBy: normalizedPreppedBy,
    verifiedBy: normalizedVerifiedBy,
    setup: normalizedSetup,
    updatedAt: updatedAt ?? null,
  };
}

/** Backward-compatible adapter for older callers during the assignment migration. */
export async function updateKitchenManualBwa(
  eventId: string,
  bwa: string,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedBwa = bwa.trim().replace(/\s+/g, " ");
  return updateKitchenManualAssignments(
    eventId,
    normalizedBwa ? [normalizedBwa] : [],
    [],
    options,
  );
}

function normalizeKitchenEventId(eventId: string) {
  const normalizedEventId = eventId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedEventId)) {
    throw new Error("Invalid kitchen event ID.");
  }
  return normalizedEventId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const KITCHEN_EVENT_ADD_ON_KEYS = new Set<string>(
  KITCHEN_EVENT_ADD_ON_FIELDS.map((field) => field.sourceKey),
);

function normalizeAddOnQuantity(
  key: string,
  value: unknown,
  maxSourceQuantity: number,
  sourceUnitLabel: string,
) {
  const quantityValue = isRecord(value) ? value.quantity : value;
  if (
    quantityValue === null ||
    quantityValue === undefined ||
    (typeof quantityValue === "string" && quantityValue.trim() === "")
  ) {
    return null;
  }

  let quantity: number;
  if (typeof quantityValue === "number") {
    quantity = quantityValue;
  } else if (
    typeof quantityValue === "string" &&
    /^\d+$/.test(quantityValue.trim())
  ) {
    quantity = Number(quantityValue.trim());
  } else {
    throw new Error(
      `Food add-on "${key}" quantity must be a positive whole number.`,
    );
  }

  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new Error(
      `Food add-on "${key}" quantity must be a positive whole number.`,
    );
  }
  if (quantity > maxSourceQuantity) {
    throw new Error(
      `Food add-on "${key}" cannot exceed ${maxSourceQuantity} ${sourceUnitLabel}.`,
    );
  }
  return quantity === 0 ? null : quantity;
}

export function normalizeKitchenEventAddOnFood(
  value: unknown,
): KitchenEventAddOnFood {
  if (!isRecord(value)) {
    throw new Error("Kitchen food add-ons must be an object.");
  }

  for (const key of Object.keys(value)) {
    if (!KITCHEN_EVENT_ADD_ON_KEYS.has(key)) {
      throw new Error(`Unknown kitchen food add-on key: ${key}.`);
    }
  }

  const normalized: KitchenEventAddOnFood = {};
  for (const field of KITCHEN_EVENT_ADD_ON_FIELDS) {
    if (!(field.sourceKey in value)) {
      continue;
    }
    const quantity = normalizeAddOnQuantity(
      field.sourceKey,
      value[field.sourceKey],
      field.maxSourceQuantity,
      field.sourceUnitLabel,
    );
    if (quantity !== null) {
      const rawValue = value[field.sourceKey];
      const panSize =
        isRecord(rawValue) &&
        (rawValue.panSize === "1/3" || rawValue.panSize === "1/2")
          ? rawValue.panSize
          : undefined;
      const notes = normalizeKitchenOrderNotes(isRecord(rawValue) ? rawValue.notes : undefined);
      normalized[field.sourceKey] = {
        quantity,
        ...(panSize ? { panSize } : {}),
        ...(notes ? { notes } : {}),
      };
    }
  }
  return normalized;
}

export async function getKitchenEventFoodAddOns(
  eventId: string,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);
  const stored = await (
    options.storage ?? getKitchenStorage()
  ).getFoodAddOns(normalizedEventId);
  if (stored && stored.eventId !== normalizedEventId) {
    throw new Error("Kitchen food add-ons did not match the requested event.");
  }
  return {
    eventId: normalizedEventId,
    food: stored
      ? normalizeKitchenEventAddOnFood(stored.food)
      : ({} satisfies KitchenEventAddOnFood),
    updatedAt: stored?.updatedAt ?? null,
    revision: stored?.revision ?? null,
  };
}

export async function getKitchenEventChecklist(
  eventId: string,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);
  const storage = options.storage ?? getKitchenStorage();
  const date = await storage.getEventDate(normalizedEventId);
  if (date === null) {
    throw new Error("Kitchen event was not found.");
  }
  const day = await storage.getDay(date);
  const checklist = day.events.find(
    (event) => String(event.event.eventId) === normalizedEventId,
  );
  if (!checklist) {
    throw new Error("Kitchen event was not found.");
  }
  return checklist;
}

export async function updateKitchenEventFoodAddOns(
  eventId: string,
  food: unknown,
  options: Pick<KitchenSyncDependencies, "storage"> & {
    expectedRevision?: unknown;
  } = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);
  const normalizedFood = normalizeKitchenEventAddOnFood(food);
  const storage = options.storage ?? getKitchenStorage();
  if ((await storage.getEventDate(normalizedEventId)) === null) {
    throw new Error("Kitchen event was not found.");
  }
  let expectedRevision: number | null;
  if (options.expectedRevision === undefined) {
    expectedRevision =
      (await storage.getFoodAddOns(normalizedEventId))?.revision ?? null;
  } else if (options.expectedRevision === null) {
    expectedRevision = null;
  } else if (
    typeof options.expectedRevision === "number" &&
    Number.isSafeInteger(options.expectedRevision) &&
    options.expectedRevision > 0
  ) {
    expectedRevision = options.expectedRevision;
  } else {
    throw new Error(
      "Kitchen food add-on revision must be null or a positive integer.",
    );
  }
  const stored = await storage.saveFoodAddOns(
    normalizedEventId,
    normalizedFood,
    expectedRevision,
  );
  if (stored.eventId !== normalizedEventId) {
    throw new Error("Kitchen food add-ons did not match the requested event.");
  }
  return {
    eventId: normalizedEventId,
    food: normalizeKitchenEventAddOnFood(stored.food),
    updatedAt: stored.updatedAt,
    revision: stored.revision,
  };
}

export async function updateKitchenItemReadiness(
  eventId: string,
  itemKey: string,
  ready: boolean,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);

  const normalizedItemKey = itemKey.trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(normalizedItemKey)) {
    throw new Error("Invalid kitchen item key.");
  }
  if (typeof ready !== "boolean") {
    throw new Error("Kitchen item readiness must be a boolean.");
  }

  await (options.storage ?? getKitchenStorage()).saveItemReadiness(
    normalizedEventId,
    normalizedItemKey,
    ready,
  );
  return {
    eventId: normalizedEventId,
    itemKey: normalizedItemKey,
    ready,
  };
}

export async function updateKitchenItemCompletion(
  eventId: string,
  itemKey: string,
  completed: boolean,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);

  const normalizedItemKey = itemKey.trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(normalizedItemKey)) {
    throw new Error("Invalid kitchen item key.");
  }
  if (typeof completed !== "boolean") {
    throw new Error("Kitchen item completion must be a boolean.");
  }

  await (options.storage ?? getKitchenStorage()).saveItemCompletion(
    normalizedEventId,
    normalizedItemKey,
    completed,
  );
  return {
    eventId: normalizedEventId,
    itemKey: normalizedItemKey,
    completed,
  };
}

export async function updateKitchenItemPrepped(
  eventId: string,
  itemKey: string,
  prepped: boolean,
  employeeName: string | null = null,
  options: Pick<KitchenSyncDependencies, "storage" | "now"> = {},
) {
  const normalizedEventId = normalizeKitchenEventId(eventId);
  const normalizedItemKey = itemKey.trim();
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(normalizedItemKey)) {
    throw new Error("Invalid kitchen item key.");
  }
  if (typeof prepped !== "boolean") {
    throw new Error("Kitchen item preparation state must be a boolean.");
  }
  const normalizedEmployeeName = employeeName?.trim().replace(/\s+/g, " ") ?? "";
  if (prepped && !normalizedEmployeeName) {
    throw new Error("Select the employee who prepped this item.");
  }
  if (
    normalizedEmployeeName &&
    !KITCHEN_STAFF_ROSTER.includes(
      normalizedEmployeeName as (typeof KITCHEN_STAFF_ROSTER)[number],
    )
  ) {
    throw new Error("Prepped by contains an employee outside the approved roster.");
  }
  const preppedUpdatedAt = (options.now ?? new Date()).toISOString();

  await (options.storage ?? getKitchenStorage()).saveItemPrepped(
    normalizedEventId,
    normalizedItemKey,
    prepped,
    prepped ? normalizedEmployeeName : null,
    preppedUpdatedAt,
  );
  return {
    eventId: normalizedEventId,
    itemKey: normalizedItemKey,
    prepped,
    employeeName: prepped ? normalizedEmployeeName : null,
    preppedAt: prepped ? preppedUpdatedAt : null,
  };
}
