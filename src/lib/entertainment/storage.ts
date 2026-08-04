import { randomUUID } from "node:crypto";
import { getSupabaseSecret } from "../kitchen/storage";
import type {
  EntertainmentAuditEntry,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
  EntertainmentSyncState,
} from "./types";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";

type FetchImplementation = typeof fetch;

type StorageOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImplementation;
};

export type StoredEntertainmentDay = {
  date: string;
  events: EntertainmentEventSnapshot[];
  reservations: EntertainmentReservation[];
  sync: EntertainmentSyncState | null;
};

export type SaveSyncInput = {
  date: string;
  events: EntertainmentEventSnapshot[];
  reservations: EntertainmentReservation[];
  existingReservations: EntertainmentReservation[];
  stats: {
    eventsProcessed: number;
    reservationsCreated: number;
    reservationsUpdated: number;
    warningsCreated: number;
    conflictsFound: number;
  };
};

export interface EntertainmentStorage {
  readonly persistence: "database" | "memory";
  getDay(date: string): Promise<StoredEntertainmentDay>;
  getReservation(reservationId: string): Promise<EntertainmentReservation | null>;
  getAudit(reservationId: string): Promise<EntertainmentAuditEntry[]>;
  startSync(date: string): Promise<void>;
  saveSync(input: SaveSyncInput): Promise<void>;
  failSync(date: string, message: string): Promise<void>;
  saveManualReservation(
    reservation: EntertainmentReservation,
    audit: EntertainmentAuditEntry,
  ): Promise<void>;
}

type EventRow = {
  event_id: string;
  local_event_id: string | null;
  tripleseat_event_id: string;
  tripleseat_booking_id: string | null;
  event_name: string;
  operating_date: string;
  event_start_at: string | null;
  event_end_at: string | null;
  event_color: string;
  color_source: EntertainmentEventSnapshot["colorSource"];
  floor_plan_asset_key: string | null;
  source_updated_at: string | null;
  needs_review: boolean;
  review_issues: EntertainmentEventSnapshot["reviewIssues"];
  source_snapshot: EntertainmentEventSnapshot["sourceSnapshot"];
  active: boolean;
  synced_at: string;
};

type ReservationRow = {
  id: string;
  sync_key: string | null;
  local_event_id: string | null;
  tripleseat_event_id: string | null;
  tripleseat_booking_id: string | null;
  event_name: string;
  operating_date: string;
  resource_id: string;
  resource_category: EntertainmentReservation["resourceCategory"];
  resource_name: string;
  start_at: string;
  end_at: string;
  source_start_at: string | null;
  source_end_at: string | null;
  source_resource_id: string | null;
  event_color: string;
  color_source: EntertainmentReservation["colorSource"];
  source: EntertainmentReservation["source"];
  source_reference: string | null;
  manual_override: boolean;
  has_source_update: boolean;
  needs_review: boolean;
  review_issues: EntertainmentReservation["reviewIssues"];
  auto_assigned: boolean;
  notes: string;
  source_updated_at: string | null;
  last_tripleseat_sync_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string;
};

type SyncRow = {
  operating_date: string;
  status: EntertainmentSyncState["status"];
  events_processed: number;
  reservations_created: number;
  reservations_updated: number;
  warnings_created: number;
  conflicts_found: number;
  error_summary: string | null;
  started_at: string;
  completed_at: string | null;
  last_successful_sync_at: string | null;
};

type AuditRow = {
  id: string;
  reservation_id: string;
  action: EntertainmentAuditEntry["action"];
  previous_value: EntertainmentAuditEntry["previousValue"];
  new_value: EntertainmentAuditEntry["newValue"];
  changed_by: string;
  change_source: EntertainmentAuditEntry["changeSource"];
  reason: string | null;
  intentional_conflict: boolean;
  created_at: string;
};

function eventToRow(event: EntertainmentEventSnapshot): EventRow {
  return {
    event_id: event.eventId,
    local_event_id: event.localEventId,
    tripleseat_event_id: event.tripleseatEventId,
    tripleseat_booking_id: event.tripleseatBookingId,
    event_name: event.eventName,
    operating_date: event.operatingDate,
    event_start_at: event.eventStartAt,
    event_end_at: event.eventEndAt,
    event_color: event.eventColor,
    color_source: event.colorSource,
    floor_plan_asset_key: event.floorPlanAssetKey,
    source_updated_at: event.sourceUpdatedAt,
    needs_review: event.needsReview,
    review_issues: event.reviewIssues,
    source_snapshot: event.sourceSnapshot,
    active: event.active,
    synced_at: event.syncedAt,
  };
}

function eventFromRow(row: EventRow): EntertainmentEventSnapshot {
  return {
    eventId: row.event_id,
    localEventId: row.local_event_id,
    tripleseatEventId: row.tripleseat_event_id,
    tripleseatBookingId: row.tripleseat_booking_id,
    eventName: row.event_name,
    operatingDate: row.operating_date,
    eventStartAt: row.event_start_at,
    eventEndAt: row.event_end_at,
    eventColor: row.event_color,
    colorSource: row.color_source,
    floorPlanAssetKey: row.floor_plan_asset_key,
    sourceUpdatedAt: row.source_updated_at,
    needsReview: row.needs_review,
    reviewIssues: row.review_issues ?? [],
    sourceSnapshot: row.source_snapshot,
    active: row.active,
    syncedAt: row.synced_at,
  };
}

function reservationToRow(
  reservation: EntertainmentReservation,
): ReservationRow {
  return {
    id: reservation.id,
    sync_key: reservation.syncKey,
    local_event_id: reservation.localEventId,
    tripleseat_event_id: reservation.tripleseatEventId,
    tripleseat_booking_id: reservation.tripleseatBookingId,
    event_name: reservation.eventName,
    operating_date: reservation.operatingDate,
    resource_id: reservation.resourceId,
    resource_category: reservation.resourceCategory,
    resource_name: reservation.resourceName,
    start_at: reservation.startAt,
    end_at: reservation.endAt,
    source_start_at: reservation.sourceStartAt,
    source_end_at: reservation.sourceEndAt,
    source_resource_id: reservation.sourceResourceId,
    event_color: reservation.eventColor,
    color_source: reservation.colorSource,
    source: reservation.source,
    source_reference: reservation.sourceReference,
    manual_override: reservation.manualOverride,
    has_source_update: reservation.hasSourceUpdate,
    needs_review: reservation.needsReview,
    review_issues: reservation.reviewIssues,
    auto_assigned: reservation.autoAssigned,
    notes: reservation.notes,
    source_updated_at: reservation.sourceUpdatedAt,
    last_tripleseat_sync_at: reservation.lastTripleseatSyncAt,
    active: reservation.active,
    created_at: reservation.createdAt,
    updated_at: reservation.updatedAt,
    updated_by: reservation.updatedBy,
  };
}

function reservationFromRow(
  row: ReservationRow,
): EntertainmentReservation {
  return {
    id: row.id,
    syncKey: row.sync_key,
    localEventId: row.local_event_id,
    tripleseatEventId: row.tripleseat_event_id,
    tripleseatBookingId: row.tripleseat_booking_id,
    eventName: row.event_name,
    operatingDate: row.operating_date,
    resourceId: row.resource_id,
    resourceCategory: row.resource_category,
    resourceName: row.resource_name,
    startAt: row.start_at,
    endAt: row.end_at,
    sourceStartAt: row.source_start_at,
    sourceEndAt: row.source_end_at,
    sourceResourceId: row.source_resource_id,
    eventColor: row.event_color,
    colorSource: row.color_source,
    source: row.source,
    sourceReference: row.source_reference,
    manualOverride: row.manual_override,
    hasSourceUpdate: row.has_source_update,
    needsReview: row.needs_review,
    reviewIssues: row.review_issues ?? [],
    autoAssigned: row.auto_assigned,
    notes: row.notes,
    sourceUpdatedAt: row.source_updated_at,
    lastTripleseatSyncAt: row.last_tripleseat_sync_at,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function syncFromRow(row: SyncRow | undefined): EntertainmentSyncState | null {
  return row
    ? {
        operatingDate: row.operating_date,
        status: row.status,
        eventsProcessed: row.events_processed ?? 0,
        reservationsCreated: row.reservations_created ?? 0,
        reservationsUpdated: row.reservations_updated ?? 0,
        warningsCreated: row.warnings_created ?? 0,
        conflictsFound: row.conflicts_found ?? 0,
        errorSummary: row.error_summary,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        lastSuccessfulSyncAt: row.last_successful_sync_at,
      }
    : null;
}

function auditToRow(audit: EntertainmentAuditEntry): AuditRow {
  return {
    id: audit.id,
    reservation_id: audit.reservationId,
    action: audit.action,
    previous_value: audit.previousValue,
    new_value: audit.newValue,
    changed_by: audit.changedBy,
    change_source: audit.changeSource,
    reason: audit.reason,
    intentional_conflict: audit.intentionalConflict,
    created_at: audit.createdAt,
  };
}

function auditFromRow(row: AuditRow): EntertainmentAuditEntry {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    action: row.action,
    previousValue: row.previous_value,
    newValue: row.new_value,
    changedBy: row.changed_by,
    changeSource: row.change_source,
    reason: row.reason,
    intentionalConflict: row.intentional_conflict,
    createdAt: row.created_at,
  };
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isJwt(value: string) {
  return /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
}

function materialReservationValue(reservation: EntertainmentReservation) {
  return JSON.stringify({
    resourceId: reservation.resourceId,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    eventColor: reservation.eventColor,
    sourceStartAt: reservation.sourceStartAt,
    sourceEndAt: reservation.sourceEndAt,
    sourceResourceId: reservation.sourceResourceId,
    manualOverride: reservation.manualOverride,
    hasSourceUpdate: reservation.hasSourceUpdate,
    needsReview: reservation.needsReview,
    reviewIssues: reservation.reviewIssues,
    autoAssigned: reservation.autoAssigned,
    active: reservation.active,
  });
}

export class SupabaseEntertainmentStorage implements EntertainmentStorage {
  readonly persistence = "database" as const;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: FetchImplementation;

  constructor(options: StorageOptions = {}) {
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
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
  ) {
    const response = await this.request(table, params, init);
    if (!response.ok) {
      throw new Error(
        `Entertainment database request failed (${response.status}).`,
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
        `Entertainment database request failed (${response.status}).`,
      );
    }
  }

  async getDay(date: string): Promise<StoredEntertainmentDay> {
    const [eventRows, reservationRows, syncRows] = await Promise.all([
      this.jsonRequest<EventRow[]>(
        "entertainment_event_snapshots",
        new URLSearchParams({
          select: "*",
          operating_date: `eq.${date}`,
          active: "eq.true",
          order: "event_start_at.asc.nullslast,event_name.asc",
        }),
      ),
      this.jsonRequest<ReservationRow[]>(
        "entertainment_reservations",
        new URLSearchParams({
          select: "*",
          operating_date: `eq.${date}`,
          order: "start_at.asc,resource_id.asc",
        }),
      ),
      this.jsonRequest<SyncRow[]>(
        "entertainment_sync_runs",
        new URLSearchParams({
          select: "*",
          operating_date: `eq.${date}`,
          limit: "1",
        }),
      ),
    ]);
    return {
      date,
      events: eventRows.map(eventFromRow),
      reservations: reservationRows.map(reservationFromRow),
      sync: syncFromRow(syncRows[0]),
    };
  }

  async getReservation(reservationId: string) {
    const rows = await this.jsonRequest<ReservationRow[]>(
      "entertainment_reservations",
      new URLSearchParams({
        select: "*",
        id: `eq.${reservationId}`,
        limit: "1",
      }),
    );
    return rows[0] ? reservationFromRow(rows[0]) : null;
  }

  async getAudit(reservationId: string) {
    const rows = await this.jsonRequest<AuditRow[]>(
      "entertainment_reservation_audits",
      new URLSearchParams({
        select: "*",
        reservation_id: `eq.${reservationId}`,
        order: "created_at.desc",
      }),
    );
    return rows.map(auditFromRow);
  }

  async startSync(date: string) {
    const now = new Date().toISOString();
    await this.emptyRequest(
      "entertainment_sync_runs",
      new URLSearchParams({ on_conflict: "operating_date" }),
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          operating_date: date,
          status: "running",
          started_at: now,
          completed_at: null,
          error_summary: null,
          updated_at: now,
        }),
      },
    );
  }

  async saveSync(input: SaveSyncInput) {
    const eventRows = input.events.map(eventToRow);
    const reservationRows = input.reservations.map(reservationToRow);
    if (eventRows.length > 0) {
      await this.emptyRequest(
        "entertainment_event_snapshots",
        new URLSearchParams({ on_conflict: "event_id" }),
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(eventRows),
        },
      );
    }
    if (reservationRows.length > 0) {
      await this.emptyRequest(
        "entertainment_reservations",
        new URLSearchParams({ on_conflict: "id" }),
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(reservationRows),
        },
      );
    }

    const currentEventRows = await this.jsonRequest<
      Pick<EventRow, "event_id">[]
    >(
      "entertainment_event_snapshots",
      new URLSearchParams({
        select: "event_id",
        operating_date: `eq.${input.date}`,
        active: "eq.true",
      }),
    );
    const incomingEventIds = new Set(input.events.map((event) => event.eventId));
    await Promise.all(
      currentEventRows
        .filter((row) => !incomingEventIds.has(row.event_id))
        .map((row) =>
          this.emptyRequest(
            "entertainment_event_snapshots",
            new URLSearchParams({ event_id: `eq.${row.event_id}` }),
            {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ active: false, synced_at: new Date().toISOString() }),
            },
          ),
        ),
    );

    const existingById = new Map(
      input.existingReservations.map((reservation) => [
        reservation.id,
        reservation,
      ]),
    );
    const audits: EntertainmentAuditEntry[] = [];
    for (const reservation of input.reservations) {
      const existing = existingById.get(reservation.id);
      if (!existing) {
        if (reservation.active && reservation.source !== "manual") {
          audits.push({
            id: randomUUID(),
            reservationId: reservation.id,
            action: "sync-create",
            previousValue: null,
            newValue: reservation,
            changedBy: "tripleseat-sync",
            changeSource: "tripleseat-sync",
            reason: null,
            intentionalConflict: false,
            createdAt: reservation.updatedAt,
          });
        }
      } else if (
        materialReservationValue(existing) !==
        materialReservationValue(reservation)
      ) {
        audits.push({
          id: randomUUID(),
          reservationId: reservation.id,
          action:
            existing.active && !reservation.active
              ? "sync-deactivate"
              : "sync-update",
          previousValue: existing,
          newValue: reservation,
          changedBy: "tripleseat-sync",
          changeSource: "tripleseat-sync",
          reason: null,
          intentionalConflict: false,
          createdAt: reservation.updatedAt,
        });
      }
    }
    if (audits.length > 0) {
      await this.emptyRequest("entertainment_reservation_audits", undefined, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(audits.map(auditToRow)),
      });
    }

    const now = new Date().toISOString();
    await this.emptyRequest(
      "entertainment_sync_runs",
      new URLSearchParams({ operating_date: `eq.${input.date}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "success",
          ...{
            events_processed: input.stats.eventsProcessed,
            reservations_created: input.stats.reservationsCreated,
            reservations_updated: input.stats.reservationsUpdated,
            warnings_created: input.stats.warningsCreated,
            conflicts_found: input.stats.conflictsFound,
          },
          error_summary: null,
          completed_at: now,
          last_successful_sync_at: now,
          updated_at: now,
        }),
      },
    );
  }

  async failSync(date: string, message: string) {
    const now = new Date().toISOString();
    await this.emptyRequest(
      "entertainment_sync_runs",
      new URLSearchParams({ operating_date: `eq.${date}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "error",
          error_summary: message,
          completed_at: now,
          updated_at: now,
        }),
      },
    );
  }

  async saveManualReservation(
    reservation: EntertainmentReservation,
    audit: EntertainmentAuditEntry,
  ) {
    await this.emptyRequest(
      "entertainment_reservations",
      new URLSearchParams({ on_conflict: "id" }),
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(reservationToRow(reservation)),
      },
    );
    await this.emptyRequest("entertainment_reservation_audits", undefined, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(auditToRow(audit)),
    });
  }
}

export class MemoryEntertainmentStorage implements EntertainmentStorage {
  readonly persistence = "memory" as const;
  private readonly events = new Map<string, EntertainmentEventSnapshot[]>();
  private readonly reservations = new Map<string, EntertainmentReservation[]>();
  private readonly sync = new Map<string, EntertainmentSyncState>();
  private readonly audits = new Map<string, EntertainmentAuditEntry[]>();

  async getDay(date: string): Promise<StoredEntertainmentDay> {
    return structuredClone({
      date,
      events: (this.events.get(date) ?? []).filter((event) => event.active),
      reservations: this.reservations.get(date) ?? [],
      sync: this.sync.get(date) ?? null,
    });
  }

  async getReservation(reservationId: string) {
    for (const reservations of this.reservations.values()) {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (reservation) {
        return structuredClone(reservation);
      }
    }
    return null;
  }

  async getAudit(reservationId: string) {
    return structuredClone(this.audits.get(reservationId) ?? []);
  }

  async startSync(date: string) {
    const now = new Date().toISOString();
    const previous = this.sync.get(date);
    this.sync.set(date, {
      operatingDate: date,
      status: "running",
      eventsProcessed: previous?.eventsProcessed ?? 0,
      reservationsCreated: previous?.reservationsCreated ?? 0,
      reservationsUpdated: previous?.reservationsUpdated ?? 0,
      warningsCreated: previous?.warningsCreated ?? 0,
      conflictsFound: previous?.conflictsFound ?? 0,
      errorSummary: null,
      startedAt: now,
      completedAt: null,
      lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
    });
  }

  async saveSync(input: SaveSyncInput) {
    const now = new Date().toISOString();
    const existingById = new Map(
      input.existingReservations.map((reservation) => [
        reservation.id,
        reservation,
      ]),
    );
    for (const reservation of input.reservations) {
      const existing = existingById.get(reservation.id);
      const action =
        !existing && reservation.active && reservation.source !== "manual"
          ? "sync-create"
          : existing &&
              materialReservationValue(existing) !==
                materialReservationValue(reservation)
            ? existing.active && !reservation.active
              ? "sync-deactivate"
              : "sync-update"
            : null;
      if (action) {
        this.audits.set(reservation.id, [
          {
            id: randomUUID(),
            reservationId: reservation.id,
            action,
            previousValue: existing ?? null,
            newValue: reservation,
            changedBy: "tripleseat-sync",
            changeSource: "tripleseat-sync",
            reason: null,
            intentionalConflict: false,
            createdAt: reservation.updatedAt,
          },
          ...(this.audits.get(reservation.id) ?? []),
        ]);
      }
    }
    this.events.set(input.date, structuredClone(input.events));
    this.reservations.set(input.date, structuredClone(input.reservations));
    const previous = this.sync.get(input.date);
    this.sync.set(input.date, {
      operatingDate: input.date,
      status: "success",
      ...input.stats,
      errorSummary: null,
      startedAt: previous?.startedAt ?? now,
      completedAt: now,
      lastSuccessfulSyncAt: now,
    });
  }

  async failSync(date: string, message: string) {
    const now = new Date().toISOString();
    const previous = this.sync.get(date);
    this.sync.set(date, {
      operatingDate: date,
      status: "error",
      eventsProcessed: previous?.eventsProcessed ?? 0,
      reservationsCreated: previous?.reservationsCreated ?? 0,
      reservationsUpdated: previous?.reservationsUpdated ?? 0,
      warningsCreated: previous?.warningsCreated ?? 0,
      conflictsFound: previous?.conflictsFound ?? 0,
      errorSummary: message,
      startedAt: previous?.startedAt ?? now,
      completedAt: now,
      lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
    });
  }

  async saveManualReservation(
    reservation: EntertainmentReservation,
    audit: EntertainmentAuditEntry,
  ) {
    for (const [date, reservations] of this.reservations) {
      const remaining = reservations.filter(
        (item) => item.id !== reservation.id,
      );
      if (remaining.length !== reservations.length) {
        this.reservations.set(date, remaining);
      }
    }
    const values = this.reservations.get(reservation.operatingDate) ?? [];
    values.push(structuredClone(reservation));
    this.reservations.set(reservation.operatingDate, values);
    this.audits.set(reservation.id, [
      structuredClone(audit),
      ...(this.audits.get(reservation.id) ?? []),
    ]);
  }
}

let defaultStorage: EntertainmentStorage | null = null;

export function getMissingEntertainmentEnvironmentVariables(
  env: NodeJS.ProcessEnv = process.env,
) {
  return getSupabaseSecret(env) ? [] : ["SUPABASE_SECRET_KEY"];
}

export function getEntertainmentStorage(
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!defaultStorage) {
    defaultStorage =
      !getSupabaseSecret(env) && env.NODE_ENV !== "production"
        ? new MemoryEntertainmentStorage()
        : new SupabaseEntertainmentStorage({ env });
  }
  return defaultStorage;
}

export function createMemoryEntertainmentStorage() {
  return new MemoryEntertainmentStorage();
}

export function setEntertainmentStorageForTests(
  storage: EntertainmentStorage | null,
) {
  defaultStorage = storage;
}
