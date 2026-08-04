import {
  KITCHEN_EVENT_ADD_ON_FIELDS,
  type KitchenEventAddOnFood,
} from "./addons";
import { activeKitchenChecklists } from "./lifecycle";
import { generateKitchenChecklist } from "./rules";
import {
  getKitchenStorage,
  getMissingSupabaseEnvironmentVariables,
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
} from "./types";

export type KitchenDayPayload = {
  date: string;
  events: KitchenChecklist[];
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
};

export type KitchenSyncDependencies = {
  adapter?: TripleseatAdapter;
  storage?: KitchenStorage;
  now?: Date;
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

function markSourceWarning(
  events: KitchenChecklist[],
  code: "SOURCE_STALE" | "SOURCE_SYNC_FAILED",
  message: string,
) {
  return events.map((event) => {
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
  const { adapter, storage } = dependencies(options);
  const [stored, diagnostics] = await Promise.all([
    storage.getDay(date),
    Promise.resolve(adapter.getDiagnostics()),
  ]);
  const databaseMissing =
    options.storage == null
      ? getMissingSupabaseEnvironmentVariables()
      : [];
  const liveSourceUnavailable =
    adapter.sourceMode === "mock" &&
    storage.persistence === "database";
  const eventsWithSourceStatus =
    stored.sync?.status === "error"
      ? markSourceWarning(
          stored.events,
          "SOURCE_SYNC_FAILED",
          "The latest Tripleseat sync failed; this stored checklist may be stale.",
        )
      : liveSourceUnavailable
        ? markSourceWarning(
            stored.events,
            "SOURCE_STALE",
            "Live Tripleseat configuration is unavailable; this stored checklist may be stale.",
          )
      : stored.events;
  const events = activeKitchenChecklists(
    eventsWithSourceStatus,
    options.now ?? new Date(),
  );
  const activeEventIds = new Set(
    events.map((event) => String(event.event.eventId)),
  );

  return {
    date,
    events,
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
    warnings: diagnostics.warnings,
    missingEnvironmentVariables: unique([
      ...diagnostics.missingEnvironmentVariables,
      ...databaseMissing,
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
    const sourceEvents = await adapter.fetchEventsForDate(date);
    const storedEvents = sourceEvents.map((sourceEvent) => ({
      sourceEvent,
      checklist: generateKitchenChecklist(sourceEvent),
    }));
    await storage.replaceDay(date, storedEvents);
    await storage.completeSync(date, storedEvents.length);
    return getKitchenDay(date, {
      adapter,
      storage,
      now: options.now,
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

export async function updateKitchenManualBwa(
  eventId: string,
  bwa: string,
  options: Pick<KitchenSyncDependencies, "storage"> = {},
) {
  const normalizedEventId = eventId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedEventId)) {
    throw new Error("Invalid kitchen event ID.");
  }
  const normalizedBwa = bwa.trim().replace(/\s+/g, " ");
  if (normalizedBwa.length > 120) {
    throw new Error("Food Runner or BWA must be 120 characters or fewer.");
  }

  await (options.storage ?? getKitchenStorage()).saveManualBwa(
    normalizedEventId,
    normalizedBwa,
  );
  return { eventId: normalizedEventId, bwa: normalizedBwa };
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
      normalized[field.sourceKey] = { quantity };
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
