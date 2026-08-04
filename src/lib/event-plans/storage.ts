import { getSupabaseSecret } from "../kitchen/storage";
import { isValidEventPlanDate } from "./horizon";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";
const SYNC_KEY = "rolling";
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type EventPlanDocument = Record<string, unknown>;

export type EventPlanWindow = {
  startDate: string;
  endDate: string;
};

export type EventPlanWrite = {
  eventId: string;
  eventDate: string;
  plan: EventPlanDocument;
  sourceSnapshot: EventPlanDocument;
  sourceUpdatedAt: string | null;
};

export type StoredEventPlan = EventPlanWrite & {
  syncedAt: string;
  active: boolean;
};

export type EventPlanSyncStatus = "running" | "success" | "error";

export type EventPlanSyncState = {
  windowStart: string;
  windowEnd: string;
  status: EventPlanSyncStatus;
  eventCount: number;
  startedAt: string;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errorMessage: string | null;
  updatedAt: string;
};

export interface EventPlanStorage {
  readonly persistence: "database" | "memory";
  replaceWindow(
    window: EventPlanWindow,
    plans: readonly EventPlanWrite[],
  ): Promise<void>;
  plansForWindow(window: EventPlanWindow): Promise<StoredEventPlan[]>;
  findById(eventId: string): Promise<StoredEventPlan | null>;
  getSyncState(): Promise<EventPlanSyncState | null>;
  start(window: EventPlanWindow): Promise<void>;
  finish(eventCount: number): Promise<void>;
  fail(errorMessage: string): Promise<void>;
}

type FetchImplementation = typeof fetch;

export type EventPlanStorageOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
};

type EventPlanRow = {
  event_id: string;
  event_date: string;
  plan: EventPlanDocument;
  source_snapshot: EventPlanDocument;
  source_updated_at: string | null;
  synced_at: string;
  active: boolean;
};

type EventPlanSyncRow = {
  sync_key: string;
  window_start: string;
  window_end: string;
  status: EventPlanSyncStatus;
  event_count: number | null;
  started_at: string;
  completed_at: string | null;
  last_successful_sync_at: string | null;
  error_message: string | null;
  updated_at: string;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isJwt(value: string) {
  return /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
}

function requiredEventId(eventId: string) {
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("Event-plan ID is invalid.");
  }
  return eventId;
}

function requiredWindow(window: EventPlanWindow) {
  if (
    !isValidEventPlanDate(window.startDate) ||
    !isValidEventPlanDate(window.endDate)
  ) {
    throw new Error("Event-plan window dates must use valid YYYY-MM-DD values.");
  }
  if (window.startDate > window.endDate) {
    throw new Error(
      "Event-plan window start date must be on or before its end date.",
    );
  }
  return window;
}

function requiredPlan(
  plan: EventPlanWrite,
  window: EventPlanWindow,
): EventPlanWrite {
  requiredEventId(plan.eventId);
  if (!isValidEventPlanDate(plan.eventDate)) {
    throw new Error("Event-plan date must use a valid YYYY-MM-DD value.");
  }
  if (
    plan.eventDate < window.startDate ||
    plan.eventDate > window.endDate
  ) {
    throw new Error("Event-plan date must be inside the replacement window.");
  }
  return plan;
}

function validatedPlans(
  plans: readonly EventPlanWrite[],
  window: EventPlanWindow,
) {
  const seen = new Set<string>();
  return plans.map((plan) => {
    const validated = requiredPlan(plan, window);
    if (seen.has(validated.eventId)) {
      throw new Error("Event-plan replacement contains a duplicate event ID.");
    }
    seen.add(validated.eventId);
    return validated;
  });
}

function requiredEventCount(eventCount: number) {
  if (!Number.isInteger(eventCount) || eventCount < 0) {
    throw new Error("Event-plan sync count must be a non-negative integer.");
  }
  return eventCount;
}

function requiredErrorMessage(errorMessage: string) {
  const normalized = errorMessage.trim();
  if (!normalized) {
    throw new Error("Event-plan sync error message is required.");
  }
  return normalized.slice(0, 2_000);
}

function rowFromPlan(
  plan: EventPlanWrite,
  syncedAt: string,
): EventPlanRow {
  return {
    event_id: plan.eventId,
    event_date: plan.eventDate,
    plan: clone(plan.plan),
    source_snapshot: clone(plan.sourceSnapshot),
    source_updated_at: plan.sourceUpdatedAt,
    synced_at: syncedAt,
    active: true,
  };
}

function planFromRow(row: EventPlanRow): StoredEventPlan {
  return {
    eventId: row.event_id,
    eventDate: row.event_date,
    plan: clone(row.plan),
    sourceSnapshot: clone(row.source_snapshot),
    sourceUpdatedAt: row.source_updated_at,
    syncedAt: row.synced_at,
    active: row.active,
  };
}

function syncFromRow(
  row: EventPlanSyncRow | undefined,
): EventPlanSyncState | null {
  return row
    ? {
        windowStart: row.window_start,
        windowEnd: row.window_end,
        status: row.status,
        eventCount: row.event_count ?? 0,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        lastSuccessfulSyncAt: row.last_successful_sync_at,
        errorMessage: row.error_message,
        updatedAt: row.updated_at,
      }
    : null;
}

function comparePlans(left: StoredEventPlan, right: StoredEventPlan) {
  return (
    left.eventDate.localeCompare(right.eventDate) ||
    left.eventId.localeCompare(right.eventId)
  );
}

export class SupabaseEventPlanStorage implements EventPlanStorage {
  readonly persistence = "database" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchImplementation;
  private readonly now: () => Date;

  constructor(options: EventPlanStorageOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private get secret() {
    const secret = getSupabaseSecret(this.env);
    if (!secret) {
      throw new Error(
        "Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in Vercel.",
      );
    }
    return secret;
  }

  private tableUrl(table: string, params?: URLSearchParams) {
    const baseUrl = cleanBaseUrl(
      this.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL,
    );
    const query = params?.toString();
    return `${baseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`;
  }

  private async request(
    table: string,
    params?: URLSearchParams,
    init?: RequestInit,
  ) {
    const secret = this.secret;
    const headers = new Headers(init?.headers);
    headers.set("apikey", secret);
    headers.set("content-type", "application/json");
    if (isJwt(secret)) {
      headers.set("authorization", `Bearer ${secret}`);
    } else {
      headers.delete("authorization");
    }
    return this.fetchImpl(this.tableUrl(table, params), {
      ...init,
      headers,
      cache: "no-store",
    });
  }

  private async jsonRequest<T>(
    table: string,
    params?: URLSearchParams,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.request(table, params, init);
    if (!response.ok) {
      throw new Error(
        `Event-plan database request failed (${response.status}).`,
      );
    }
    return response.json() as Promise<T>;
  }

  private async emptyRequest(
    table: string,
    params?: URLSearchParams,
    init?: RequestInit,
  ) {
    const response = await this.request(table, params, init);
    if (!response.ok) {
      throw new Error(
        `Event-plan database request failed (${response.status}).`,
      );
    }
  }

  async replaceWindow(
    requestedWindow: EventPlanWindow,
    requestedPlans: readonly EventPlanWrite[],
  ) {
    const window = requiredWindow(requestedWindow);
    const plans = validatedPlans(requestedPlans, window);
    const syncedAt = this.now().toISOString();
    const rows = plans.map((plan) => rowFromPlan(plan, syncedAt));

    if (rows.length > 0) {
      await this.emptyRequest(
        "event_host_event_plans",
        new URLSearchParams({ on_conflict: "event_id" }),
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(rows),
        },
      );
    }

    const staleParams = new URLSearchParams({
      active: "eq.true",
    });
    staleParams.append("event_date", `gte.${window.startDate}`);
    staleParams.append("event_date", `lte.${window.endDate}`);
    if (rows.length > 0) {
      staleParams.set(
        "event_id",
        `not.in.(${rows.map((row) => row.event_id).join(",")})`,
      );
    }
    await this.emptyRequest("event_host_event_plans", staleParams, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        active: false,
        synced_at: syncedAt,
      }),
    });
  }

  async plansForWindow(requestedWindow: EventPlanWindow) {
    const window = requiredWindow(requestedWindow);
    const params = new URLSearchParams({
      select:
        "event_id,event_date,plan,source_snapshot,source_updated_at,synced_at,active",
      active: "eq.true",
      order: "event_date.asc,event_id.asc",
    });
    params.append("event_date", `gte.${window.startDate}`);
    params.append("event_date", `lte.${window.endDate}`);
    const rows = await this.jsonRequest<EventPlanRow[]>(
      "event_host_event_plans",
      params,
    );
    return rows
      .map(planFromRow)
      .sort(comparePlans);
  }

  async findById(requestedEventId: string) {
    const eventId = requiredEventId(requestedEventId);
    const rows = await this.jsonRequest<EventPlanRow[]>(
      "event_host_event_plans",
      new URLSearchParams({
        select:
          "event_id,event_date,plan,source_snapshot,source_updated_at,synced_at,active",
        event_id: `eq.${eventId}`,
        limit: "1",
      }),
    );
    return rows[0] ? planFromRow(rows[0]) : null;
  }

  async getSyncState() {
    const rows = await this.jsonRequest<EventPlanSyncRow[]>(
      "event_host_event_plan_sync",
      new URLSearchParams({
        select:
          "sync_key,window_start,window_end,status,event_count,started_at,completed_at,last_successful_sync_at,error_message,updated_at",
        sync_key: `eq.${SYNC_KEY}`,
        limit: "1",
      }),
    );
    return syncFromRow(rows[0]);
  }

  async start(requestedWindow: EventPlanWindow) {
    const window = requiredWindow(requestedWindow);
    const previous = await this.getSyncState();
    const now = this.now().toISOString();
    await this.emptyRequest(
      "event_host_event_plan_sync",
      new URLSearchParams({ on_conflict: "sync_key" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          sync_key: SYNC_KEY,
          window_start: window.startDate,
          window_end: window.endDate,
          status: "running",
          event_count: previous?.eventCount ?? 0,
          started_at: now,
          completed_at: null,
          last_successful_sync_at:
            previous?.lastSuccessfulSyncAt ?? null,
          error_message: null,
          updated_at: now,
        }),
      },
    );
  }

  async finish(requestedEventCount: number) {
    const eventCount = requiredEventCount(requestedEventCount);
    const now = this.now().toISOString();
    await this.emptyRequest(
      "event_host_event_plan_sync",
      new URLSearchParams({ sync_key: `eq.${SYNC_KEY}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "success",
          event_count: eventCount,
          completed_at: now,
          last_successful_sync_at: now,
          error_message: null,
          updated_at: now,
        }),
      },
    );
  }

  async fail(requestedErrorMessage: string) {
    const errorMessage = requiredErrorMessage(requestedErrorMessage);
    const now = this.now().toISOString();
    await this.emptyRequest(
      "event_host_event_plan_sync",
      new URLSearchParams({ sync_key: `eq.${SYNC_KEY}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "error",
          completed_at: now,
          error_message: errorMessage,
          updated_at: now,
        }),
      },
    );
  }
}

export class MemoryEventPlanStorage implements EventPlanStorage {
  readonly persistence = "memory" as const;
  private readonly plans = new Map<string, StoredEventPlan>();
  private readonly now: () => Date;
  private syncState: EventPlanSyncState | null = null;

  constructor(options: Pick<EventPlanStorageOptions, "now"> = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async replaceWindow(
    requestedWindow: EventPlanWindow,
    requestedPlans: readonly EventPlanWrite[],
  ) {
    const window = requiredWindow(requestedWindow);
    const plans = validatedPlans(requestedPlans, window);
    const incomingIds = new Set(plans.map((plan) => plan.eventId));
    const syncedAt = this.now().toISOString();

    for (const [eventId, stored] of this.plans) {
      if (
        stored.active &&
        stored.eventDate >= window.startDate &&
        stored.eventDate <= window.endDate &&
        !incomingIds.has(eventId)
      ) {
        this.plans.set(eventId, {
          ...stored,
          active: false,
          syncedAt,
        });
      }
    }
    for (const plan of plans) {
      this.plans.set(plan.eventId, {
        ...clone(plan),
        syncedAt,
        active: true,
      });
    }
  }

  async plansForWindow(requestedWindow: EventPlanWindow) {
    const window = requiredWindow(requestedWindow);
    return [...this.plans.values()]
      .filter(
        (plan) =>
          plan.active &&
          plan.eventDate >= window.startDate &&
          plan.eventDate <= window.endDate,
      )
      .sort(comparePlans)
      .map(clone);
  }

  async findById(requestedEventId: string) {
    const eventId = requiredEventId(requestedEventId);
    return clone(this.plans.get(eventId) ?? null);
  }

  async getSyncState() {
    return clone(this.syncState);
  }

  async start(requestedWindow: EventPlanWindow) {
    const window = requiredWindow(requestedWindow);
    const now = this.now().toISOString();
    this.syncState = {
      windowStart: window.startDate,
      windowEnd: window.endDate,
      status: "running",
      eventCount: this.syncState?.eventCount ?? 0,
      startedAt: now,
      completedAt: null,
      lastSuccessfulSyncAt: this.syncState?.lastSuccessfulSyncAt ?? null,
      errorMessage: null,
      updatedAt: now,
    };
  }

  async finish(requestedEventCount: number) {
    const eventCount = requiredEventCount(requestedEventCount);
    if (!this.syncState) {
      throw new Error("Event-plan sync has not started.");
    }
    const now = this.now().toISOString();
    this.syncState = {
      ...this.syncState,
      status: "success",
      eventCount,
      completedAt: now,
      lastSuccessfulSyncAt: now,
      errorMessage: null,
      updatedAt: now,
    };
  }

  async fail(requestedErrorMessage: string) {
    const errorMessage = requiredErrorMessage(requestedErrorMessage);
    if (!this.syncState) {
      throw new Error("Event-plan sync has not started.");
    }
    const now = this.now().toISOString();
    this.syncState = {
      ...this.syncState,
      status: "error",
      completedAt: now,
      errorMessage,
      updatedAt: now,
    };
  }
}

export function createSupabaseEventPlanStorage(
  options: EventPlanStorageOptions = {},
) {
  return new SupabaseEventPlanStorage(options);
}

export function createMemoryEventPlanStorage(
  options: Pick<EventPlanStorageOptions, "now"> = {},
) {
  return new MemoryEventPlanStorage(options);
}

let defaultStorage: EventPlanStorage | null = null;

export function getEventPlanStorage(
  env: NodeJS.ProcessEnv = process.env,
): EventPlanStorage {
  if (!defaultStorage) {
    defaultStorage =
      !getSupabaseSecret(env) && env.NODE_ENV !== "production"
        ? createMemoryEventPlanStorage()
        : createSupabaseEventPlanStorage({ env });
  }
  return defaultStorage;
}

export function setEventPlanStorageForTests(
  storage: EventPlanStorage | null,
) {
  defaultStorage = storage;
}
