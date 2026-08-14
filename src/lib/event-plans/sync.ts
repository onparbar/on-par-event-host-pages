import { events as legacyEventPlans } from "@/lib/events";
import {
  confirmedContractEventPlanById,
  isConfirmedContractEventPlanId,
  mergeConfirmedContractEventPlans,
} from "@/lib/confirmed-contract-events";
import { getTripleseatAdapter, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";

import { buildEventPlan } from "./domain";
import { isValidEventPlanDate, rollingEventPlanHorizon } from "./horizon";
import {
  getEventPlanStorage,
  type EventPlanDocument,
  type EventPlanStorage,
  type EventPlanWindow,
} from "./storage";
import type {
  EventPlan,
  EventPlanSyncState,
  StoredEventPlanWindow,
  TripleseatEventPlanSource,
} from "./types";

export type EventPlanSyncOptions = {
  now?: Date;
  adapter?: TripleseatAdapter;
  storage?: EventPlanStorage;
  legacyPlans?: readonly EventPlan[];
};

export type EventPlanSyncResult = StoredEventPlanWindow & {
  sourceMode: "live";
};

function storageWindow(now: Date): EventPlanWindow {
  const horizon = rollingEventPlanHorizon(now);
  return {
    startDate: horizon.startDate,
    endDate: horizon.endDate,
  };
}

function validatedWindow(window: EventPlanWindow) {
  if (
    !isValidEventPlanDate(window.startDate) ||
    !isValidEventPlanDate(window.endDate) ||
    window.startDate > window.endDate
  ) {
    throw new Error("Event-plan sync window must use ordered YYYY-MM-DD dates.");
  }
  return window;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 2_000)
    : "Event-plan synchronization failed.";
}

function serializeDocument(value: EventPlan | TripleseatEventPlanSource) {
  return structuredClone(value) as unknown as EventPlanDocument;
}

function storedPlan(value: EventPlanDocument): EventPlan {
  return structuredClone(value) as unknown as EventPlan;
}

const EXCLUDED_OPERATIONAL_STATUSES = new Set(["LOST", "PROSPECT"]);

export function isOperationalEventStatus(status: unknown) {
  return !(
    typeof status === "string" &&
    EXCLUDED_OPERATIONAL_STATUSES.has(status.trim().toUpperCase())
  );
}

function storedPlanIsOperational(row: { sourceSnapshot: EventPlanDocument }) {
  return isOperationalEventStatus(row.sourceSnapshot.status);
}

function legacyPlansForWindow(
  window: EventPlanWindow,
  plans: readonly EventPlan[],
) {
  return plans
    .filter(
      (plan) =>
        plan.date >= window.startDate && plan.date <= window.endDate,
    )
    .map((plan) => structuredClone(plan))
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.time.localeCompare(right.time) ||
        left.name.localeCompare(right.name),
    );
}

function plansWithConfirmedContractEvidence(
  plans: readonly EventPlan[],
  window: EventPlanWindow,
  includeConfirmedContractEvidence: boolean,
  lastSuccessfulSyncAt?: string | null,
  syncCoverage?: EventPlanWindow | null,
) {
  if (!includeConfirmedContractEvidence) {
    return plans.map((plan) => structuredClone(plan));
  }
  return mergeConfirmedContractEventPlans(
    plans,
    window.startDate,
    window.endDate,
    lastSuccessfulSyncAt,
    syncCoverage,
  );
}

function syncStateFromStorage(
  state: Awaited<ReturnType<EventPlanStorage["getSyncState"]>>,
): EventPlanSyncState | null {
  return state
    ? {
        windowStart: state.windowStart,
        windowEnd: state.windowEnd,
        status: state.status,
        eventCount: state.eventCount,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
        errorMessage: state.errorMessage,
      }
    : null;
}

export async function syncEventPlanWindow(
  requestedWindow: EventPlanWindow,
  options: EventPlanSyncOptions = {},
): Promise<EventPlanSyncResult> {
  const now = options.now ?? new Date();
  const window = validatedWindow(requestedWindow);
  const adapter = options.adapter ?? getTripleseatAdapter();
  const storage = options.storage ?? getEventPlanStorage();
  const legacyPlans = options.legacyPlans ?? legacyEventPlans;

  if (
    adapter.sourceMode !== "live" ||
    !adapter.fetchEventPlansForRange
  ) {
    throw new Error(
      "Live Tripleseat event-plan synchronization is unavailable.",
    );
  }

  await storage.start(window);
  try {
    const sources = (
      await adapter.fetchEventPlansForRange(window.startDate, window.endDate)
    ).filter((source) => isOperationalEventStatus(source.status));
    const syncedAt = now.toISOString();
    const plans = sources.map((source) => ({
      ...buildEventPlan(source, legacyPlans),
      synced_at: syncedAt,
    }));
    await storage.replaceWindow(
      window,
      plans.map((plan, index) => ({
        eventId: String(plan.id),
        eventDate: plan.date,
        plan: serializeDocument(plan),
        sourceSnapshot: serializeDocument(sources[index]),
        sourceUpdatedAt: sources[index].sourceUpdatedAt,
      })),
    );
    await storage.finish(plans.length);
    return {
      plans,
      sync: syncStateFromStorage(await storage.getSyncState()),
      sourceMode: "live",
    };
  } catch (error) {
    try {
      await storage.fail(errorMessage(error));
    } catch {
      // Preserve the original synchronization error.
    }
    throw error;
  }
}

export async function syncRollingEventPlans(
  options: EventPlanSyncOptions = {},
): Promise<EventPlanSyncResult> {
  const now = options.now ?? new Date();
  return syncEventPlanWindow(storageWindow(now), { ...options, now });
}

export async function loadEventPlanWindow(
  options: Pick<
    EventPlanSyncOptions,
    "now" | "storage" | "legacyPlans"
  > = {},
): Promise<StoredEventPlanWindow> {
  const now = options.now ?? new Date();
  const window = storageWindow(now);
  const storage = options.storage ?? getEventPlanStorage();
  const legacyPlans = options.legacyPlans ?? legacyEventPlans;
  const includeConfirmedContractEvidence =
    options.legacyPlans == null ||
    legacyPlans.some((plan) => isConfirmedContractEventPlanId(plan.id));

  try {
    const [rows, syncState] = await Promise.all([
      storage.plansForWindow(window),
      storage.getSyncState(),
    ]);
    if (rows.length > 0 || syncState?.status === "success") {
      return {
        plans: plansWithConfirmedContractEvidence(
          rows
            .filter(storedPlanIsOperational)
            .map((row) => storedPlan(row.plan)),
          window,
          includeConfirmedContractEvidence,
          syncState?.lastSuccessfulSyncAt,
          syncState
            ? {
                startDate: syncState.windowStart,
                endDate: syncState.windowEnd,
              }
            : null,
        ),
        sync: syncStateFromStorage(syncState),
      };
    }
  } catch {
    // Static, redacted exact-ID plans keep the existing portal available
    // until the server-only event-plan table has been initialized.
  }

  return {
    plans: plansWithConfirmedContractEvidence(
      legacyPlansForWindow(window, legacyPlans),
      window,
      includeConfirmedContractEvidence,
    ),
    sync: null,
  };
}

export async function findEventPlanById(
  eventId: number,
  options: Pick<EventPlanSyncOptions, "storage" | "legacyPlans"> = {},
) {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    return null;
  }
  const storage = options.storage ?? getEventPlanStorage();
  const legacyPlans = options.legacyPlans ?? legacyEventPlans;

  try {
    const row = await storage.findById(String(eventId));
    if (row?.active && storedPlanIsOperational(row)) {
      return storedPlan(row.plan);
    }
  } catch {
    // Fall through to an exact-ID redacted legacy plan.
  }
  const legacy =
    legacyPlans.find((plan) => plan.id === eventId) ??
    (options.legacyPlans == null
      ? confirmedContractEventPlanById(eventId)
      : null);
  if (!legacy) return null;
  try {
    const [syncState, matchingRows] = await Promise.all([
      storage.getSyncState(),
      storage.plansForWindow({
        startDate: legacy.date,
        endDate: legacy.date,
      }),
    ]);
    const visible = plansWithConfirmedContractEvidence(
      matchingRows
        .filter(storedPlanIsOperational)
        .map((row) => storedPlan(row.plan)),
      { startDate: legacy.date, endDate: legacy.date },
      true,
      syncState?.lastSuccessfulSyncAt,
      syncState
        ? {
            startDate: syncState.windowStart,
            endDate: syncState.windowEnd,
          }
        : null,
    ).some((plan) => plan.id === legacy.id);
    if (isConfirmedContractEventPlanId(legacy.id) && !visible) {
      return null;
    }
  } catch {
    // The exact contract-evidence fallback remains available before migration.
  }
  return structuredClone(legacy);
}
