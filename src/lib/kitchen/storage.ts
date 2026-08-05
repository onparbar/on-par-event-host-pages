import { translateEventHostFoodAddOns } from "./addons";
import type { KitchenEventAddOnFood } from "./addons";
import { KITCHEN_RULE_CONFIG } from "./config";
import { quantityAwareReadinessKey } from "./readiness";
import { generateKitchenChecklist } from "./rules";
import type {
  KitchenAddOnActivity,
  KitchenAddOnCompletion,
  KitchenChecklist,
  KitchenLiveFoodAddOn,
  KitchenSourceEvent,
} from "./types";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";
const WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const WEBHOOK_DEDUPLICATION_WINDOW_MS = 10 * 60 * 1000;
const KITCHEN_BWA_ROSTER = [
  "Adrian",
  "Alanis",
  "Ashleigh",
  "Austin",
  "Cameron",
  "Chase",
  "Diana",
  "Emily",
  "Enrique",
  "Estuardo",
  "Jasmonica",
  "Julio",
  "Kaleb",
  "Karla",
  "Lindsey",
  "Molly",
  "Rocky",
  "Ryan",
  "Samantha",
  "Saul",
  "Selena",
  "Staci",
  "Taylor",
  "Veronica",
] as const;

export type KitchenSyncStatus = "running" | "success" | "error";

export type KitchenSyncState = {
  eventDate: string;
  status: KitchenSyncStatus;
  startedAt: string;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  eventCount: number;
  errorMessage: string | null;
};

export type StoredKitchenEvent = {
  sourceEvent: KitchenSourceEvent;
  checklist: KitchenChecklist;
};

export type StoredKitchenDay = {
  date: string;
  events: KitchenChecklist[];
  bwaOptions: string[];
  sync: KitchenSyncState | null;
  addOnActivity: KitchenAddOnActivity[];
  addOnCompletions: KitchenAddOnCompletion[];
};

export type WebhookReceipt = {
  receiptId: string;
  triggerType: string | null;
  sourceEventId: string | null;
  sourceEventDate: string | null;
  signatureTimestamp: string;
  payloadHash: string;
  receivedAt: string;
};

export type EncryptedTokenState = {
  encryptedTokens: string;
  expiresAt: string | null;
};

export type StoredKitchenFoodAddOns = {
  eventId: string;
  food: KitchenEventAddOnFood;
  updatedAt: string | null;
  revision: number;
};

export class KitchenFoodAddOnConflictError extends Error {
  constructor() {
    super("Kitchen food add-ons changed in another session.");
    this.name = "KitchenFoodAddOnConflictError";
  }
}

export interface KitchenStorage {
  readonly persistence: "database" | "memory";
  getDay(date: string): Promise<StoredKitchenDay>;
  getEventDate(eventId: string): Promise<string | null>;
  replaceDay(date: string, events: readonly StoredKitchenEvent[]): Promise<void>;
  saveManualBwa(eventId: string, bwa: string): Promise<void>;
  saveItemReadiness(
    eventId: string,
    itemKey: string,
    ready: boolean,
  ): Promise<void>;
  saveItemCompletion(
    eventId: string,
    itemKey: string,
    completed: boolean,
  ): Promise<void>;
  getFoodAddOns(eventId: string): Promise<StoredKitchenFoodAddOns | null>;
  saveFoodAddOns(
    eventId: string,
    food: KitchenEventAddOnFood,
    expectedRevision: number | null,
  ): Promise<StoredKitchenFoodAddOns>;
  startSync(date: string): Promise<void>;
  completeSync(date: string, eventCount: number): Promise<void>;
  failSync(date: string, errorMessage: string): Promise<void>;
  claimWebhook(receipt: WebhookReceipt): Promise<boolean>;
  completeWebhook(
    receiptId: string,
    status: "processed" | "ignored" | "failed",
    errorMessage?: string | null,
  ): Promise<void>;
  getEncryptedTokenState(): Promise<EncryptedTokenState | null>;
  saveEncryptedTokenState(state: EncryptedTokenState): Promise<void>;
}

type FetchImplementation = typeof fetch;

type StorageOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImplementation;
};

type SnapshotRow = {
  event_id: string;
  booking_id: string | null;
  event_name: string;
  event_date: string;
  status: string | null;
  source_snapshot: KitchenSourceEvent;
  source_updated_at: string | null;
  synced_at: string;
};

type ChecklistRow = {
  event_id: string;
  event_date: string;
  checklist: KitchenChecklist;
  rule_version: string;
  source_updated_at: string | null;
  generated_at: string;
};

type ManualRow = {
  event_id: string;
  bwa: string | null;
};

type ItemReadinessRow = {
  event_id: string;
  item_key: string;
  ready: boolean;
  updated_at: string;
  completed: boolean;
  completed_updated_at: string | null;
};

type KitchenEventAddOnRow = {
  event_id: string;
  food: unknown;
  updated_at: string | null;
  revision: number;
};

type SyncRow = {
  event_date: string;
  status: KitchenSyncStatus;
  started_at: string;
  completed_at: string | null;
  last_successful_sync_at: string | null;
  event_count: number | null;
  error_message: string | null;
};

type TokenRow = {
  encrypted_tokens: string;
  expires_at: string | null;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function savedBwaOptions() {
  return [...KITCHEN_BWA_ROSTER].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function checklistForCurrentRules(
  sourceEvent: KitchenSourceEvent | undefined,
  storedChecklist: KitchenChecklist,
  liveFoodAddOns: readonly KitchenLiveFoodAddOn[],
): KitchenChecklist {
  if (
    sourceEvent &&
    (storedChecklist.ruleVersion !== KITCHEN_RULE_CONFIG.ruleVersion ||
      liveFoodAddOns.length > 0)
  ) {
    return generateKitchenChecklist(
      sourceEvent,
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );
  }
  return clone(storedChecklist);
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isJwt(value: string) {
  return /^eyJ[^.]*\.[^.]+\.[^.]+$/.test(value);
}

function parseSecretKeys(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    for (const candidate of Object.values(parsed)) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // A malformed fallback is treated as missing configuration.
  }

  return null;
}

export function getSupabaseSecret(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.SUPABASE_SECRET_KEY?.trim() ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    parseSecretKeys(env.SUPABASE_SECRET_KEYS)
  );
}

export function getMissingSupabaseEnvironmentVariables(
  env: NodeJS.ProcessEnv = process.env,
) {
  return getSupabaseSecret(env) ? [] : ["SUPABASE_SECRET_KEY"];
}

function sortChecklists(events: KitchenChecklist[]) {
  return events.sort((left, right) => {
    const leftValue = left.event.startTime ?? "";
    const rightValue = right.event.startTime ?? "";
    const leftTimestamp = Date.parse(leftValue);
    const rightTimestamp = Date.parse(rightValue);

    if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
      return leftTimestamp - rightTimestamp;
    }

    return leftValue.localeCompare(rightValue);
  });
}

type CurrentReadiness = {
  ready: boolean;
  updatedAt: string;
};

type CurrentCompletion = {
  completed: boolean;
  updatedAt: string;
};

function liveAddOnAlertMetadata(
  events: readonly KitchenChecklist[],
  addOnRecords: readonly {
    eventId: string;
    revision: number;
    updatedAt: string | null;
  }[],
  readinessByEvent: ReadonlyMap<
    string,
    ReadonlyMap<string, CurrentReadiness>
  >,
) {
  const eventById = new Map(
    events.map((checklist) => [
      String(checklist.event.eventId),
      checklist,
    ]),
  );
  const addOnActivity = addOnRecords.flatMap((record) => {
    const checklist = eventById.get(record.eventId);
    return checklist
      ? [
          {
            eventId: record.eventId,
            eventName: checklist.event.name,
            revision: record.revision,
            updatedAt: record.updatedAt,
            itemNames: checklist.liveFoodAddOns.map(
              (item) => item.foodName,
            ),
          },
        ]
      : [];
  });
  const addOnCompletions = events.flatMap((checklist) => {
    const eventId = String(checklist.event.eventId);
    const eventReadiness = readinessByEvent.get(eventId);
    return checklist.liveFoodAddOns.flatMap((item) => {
      const readinessKey = quantityAwareReadinessKey({
        ...item,
        ruleVersion: checklist.ruleVersion,
      });
      const readiness = eventReadiness?.get(readinessKey);
      return readiness?.ready
        ? [
            {
              eventId,
              eventName: checklist.event.name,
              itemKey: item.itemKey,
              foodName: item.foodName,
              readinessUpdatedAt: readiness.updatedAt,
            },
          ]
        : [];
    });
  });

  return { addOnActivity, addOnCompletions };
}

function syncStateFromRow(row: SyncRow | undefined): KitchenSyncState | null {
  if (!row) {
    return null;
  }

  return {
    eventDate: row.event_date,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    eventCount: row.event_count ?? 0,
    errorMessage: row.error_message,
  };
}

export class SupabaseKitchenStorage implements KitchenStorage {
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
      throw new Error(`Kitchen database request failed (${response.status}).`);
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
      throw new Error(`Kitchen database request failed (${response.status}).`);
    }
  }

  async getDay(date: string): Promise<StoredKitchenDay> {
    const checklistParams = new URLSearchParams({
      select: "event_id,checklist",
      event_date: `eq.${date}`,
    });
    const snapshotParams = new URLSearchParams({
      select: "event_id,source_snapshot",
      event_date: `eq.${date}`,
    });
    const syncParams = new URLSearchParams({
      select:
        "event_date,status,started_at,completed_at,last_successful_sync_at,event_count,error_message",
      event_date: `eq.${date}`,
      limit: "1",
    });

    const [checklistRows, snapshotRows, manualRows, syncRows] =
      await Promise.all([
      this.jsonRequest<Pick<ChecklistRow, "event_id" | "checklist">[]>(
        "kitchen_checklists",
        checklistParams,
      ),
      this.jsonRequest<
        Pick<SnapshotRow, "event_id" | "source_snapshot">[]
      >("kitchen_event_snapshots", snapshotParams),
      this.jsonRequest<ManualRow[]>(
        "kitchen_manual_assignments",
        new URLSearchParams({ select: "event_id,bwa" }),
      ),
      this.jsonRequest<SyncRow[]>("kitchen_sync_runs", syncParams),
    ]);

    const visibleEventIds = checklistRows.map((row) => row.event_id);
    const queryableEventIds = visibleEventIds.filter((eventId) =>
      /^[A-Za-z0-9_-]{1,128}$/.test(eventId),
    );
    const [itemReadinessRows, addOnRows] = await Promise.all([
      queryableEventIds.length === 0
        ? Promise.resolve<ItemReadinessRow[]>([])
        : this.jsonRequest<ItemReadinessRow[]>(
            "kitchen_item_readiness",
            new URLSearchParams({
              select:
                "event_id,item_key,ready,updated_at,completed,completed_updated_at",
              event_id: `in.(${queryableEventIds.join(",")})`,
              or: "(ready.eq.true,completed.eq.true)",
            }),
          ),
      queryableEventIds.length === 0
        ? Promise.resolve<KitchenEventAddOnRow[]>([])
        : this.jsonRequest<KitchenEventAddOnRow[]>(
            "kitchen_event_add_ons",
            new URLSearchParams({
              select: "event_id,food,updated_at,revision",
              event_id: `in.(${queryableEventIds.join(",")})`,
            }),
          ),
    ]);

    const manualByEvent = new Map(
      manualRows.map((row) => [row.event_id, row.bwa ?? ""]),
    );
    const completedItemsByEvent = new Map<string, string[]>();
    const finalCompletedItemsByEvent = new Map<string, string[]>();
    const readinessByEvent = new Map<
      string,
      Map<string, CurrentReadiness>
    >();
    for (const row of itemReadinessRows) {
      if (row.completed) {
        const itemKeys =
          finalCompletedItemsByEvent.get(row.event_id) ?? [];
        itemKeys.push(row.item_key);
        finalCompletedItemsByEvent.set(row.event_id, itemKeys);
      }
      if (row.ready) {
        const itemKeys = completedItemsByEvent.get(row.event_id) ?? [];
        itemKeys.push(row.item_key);
        completedItemsByEvent.set(row.event_id, itemKeys);
        const eventReadiness =
          readinessByEvent.get(row.event_id) ??
          new Map<string, CurrentReadiness>();
        eventReadiness.set(row.item_key, {
          ready: row.ready,
          updatedAt: row.updated_at,
        });
        readinessByEvent.set(row.event_id, eventReadiness);
      }
    }
    const addOnsByEvent = new Map(
      addOnRows.map((row) => [
        row.event_id,
        translateEventHostFoodAddOns(row.food, row.updated_at),
      ]),
    );
    const sourceByEvent = new Map(
      snapshotRows.map((row) => [row.event_id, row.source_snapshot]),
    );
    const events = checklistRows.map((row) => {
      const liveFoodAddOns = addOnsByEvent.get(row.event_id) ?? [];
      const sourceEvent = sourceByEvent.get(row.event_id);
      const derivedChecklist = checklistForCurrentRules(
        sourceEvent,
        row.checklist,
        liveFoodAddOns,
      );
      return {
        ...derivedChecklist,
        foodRunnerOrBwa: manualByEvent.get(row.event_id) ?? "",
        completedItemKeys: (
          completedItemsByEvent.get(row.event_id) ?? []
        ).sort(),
        finalCompletedItemKeys: (
          finalCompletedItemsByEvent.get(row.event_id) ?? []
        ).sort(),
        liveFoodAddOns,
      };
    });

    const sortedEvents = sortChecklists(events);
    const alertMetadata = liveAddOnAlertMetadata(
      sortedEvents,
      addOnRows.map((row) => ({
        eventId: row.event_id,
        revision: row.revision,
        updatedAt: row.updated_at,
      })),
      readinessByEvent,
    );

    return {
      date,
      events: sortedEvents,
      bwaOptions: savedBwaOptions(),
      sync: syncStateFromRow(syncRows[0]),
      ...alertMetadata,
    };
  }

  async getEventDate(eventId: string) {
    const rows = await this.jsonRequest<
      Pick<SnapshotRow, "event_date">[]
    >(
      "kitchen_event_snapshots",
      new URLSearchParams({
        select: "event_date",
        event_id: `eq.${eventId}`,
        limit: "1",
      }),
    );
    return rows[0]?.event_date ?? null;
  }

  async replaceDay(date: string, events: readonly StoredKitchenEvent[]) {
    const now = new Date().toISOString();
    const snapshotRows: SnapshotRow[] = events.map(({ sourceEvent }) => ({
      event_id: String(sourceEvent.eventId),
      booking_id:
        sourceEvent.bookingId == null ? null : String(sourceEvent.bookingId),
      event_name: sourceEvent.eventName,
      event_date: date,
      status: sourceEvent.status,
      source_snapshot: sourceEvent,
      source_updated_at: sourceEvent.sourceUpdatedAt ?? null,
      synced_at: now,
    }));
    const checklistRows: ChecklistRow[] = events.map(
      ({ sourceEvent, checklist }) => ({
        event_id: String(sourceEvent.eventId),
        event_date: date,
        checklist,
        rule_version: checklist.ruleVersion,
        source_updated_at: sourceEvent.sourceUpdatedAt ?? null,
        generated_at: now,
      }),
    );

    if (snapshotRows.length > 0) {
      await this.emptyRequest(
        "kitchen_event_snapshots",
        new URLSearchParams({ on_conflict: "event_id" }),
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(snapshotRows),
        },
      );
      await this.emptyRequest(
        "kitchen_checklists",
        new URLSearchParams({ on_conflict: "event_id" }),
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(checklistRows),
        },
      );
    }

    const existingRows = await this.jsonRequest<
      Pick<SnapshotRow, "event_id">[]
    >(
      "kitchen_event_snapshots",
      new URLSearchParams({
        select: "event_id",
        event_date: `eq.${date}`,
      }),
    );
    const incomingIds = new Set(snapshotRows.map((row) => row.event_id));

    await Promise.all(
      existingRows
        .filter((row) => !incomingIds.has(row.event_id))
        .map((row) =>
          this.emptyRequest(
            "kitchen_event_snapshots",
            new URLSearchParams({ event_id: `eq.${row.event_id}` }),
            {
              method: "DELETE",
              headers: { Prefer: "return=minimal" },
            },
          ),
        ),
    );
  }

  async saveManualBwa(eventId: string, bwa: string) {
    await this.emptyRequest(
      "kitchen_manual_assignments",
      new URLSearchParams({ on_conflict: "event_id" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          event_id: eventId,
          bwa,
          updated_at: new Date().toISOString(),
        }),
      },
    );
  }

  async saveItemReadiness(
    eventId: string,
    itemKey: string,
    ready: boolean,
  ) {
    await this.emptyRequest(
      "kitchen_item_readiness",
      new URLSearchParams({ on_conflict: "event_id,item_key" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          event_id: eventId,
          item_key: itemKey,
          ready,
          updated_at: new Date().toISOString(),
        }),
      },
    );
  }

  async saveItemCompletion(
    eventId: string,
    itemKey: string,
    completed: boolean,
  ) {
    await this.emptyRequest(
      "kitchen_item_readiness",
      new URLSearchParams({ on_conflict: "event_id,item_key" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          event_id: eventId,
          item_key: itemKey,
          completed,
          completed_updated_at: new Date().toISOString(),
        }),
      },
    );
  }

  async getFoodAddOns(
    eventId: string,
  ): Promise<StoredKitchenFoodAddOns | null> {
    const rows = await this.jsonRequest<KitchenEventAddOnRow[]>(
      "kitchen_event_add_ons",
      new URLSearchParams({
        select: "event_id,food,updated_at,revision",
        event_id: `eq.${eventId}`,
        limit: "1",
      }),
    );
    const row = rows[0];
    return row
      ? {
          eventId: row.event_id,
          food: row.food as KitchenEventAddOnFood,
          updatedAt: row.updated_at,
          revision: row.revision,
        }
      : null;
  }

  async saveFoodAddOns(
    eventId: string,
    food: KitchenEventAddOnFood,
    expectedRevision: number | null,
  ): Promise<StoredKitchenFoodAddOns> {
    const updatedAt = new Date().toISOString();
    const revision = expectedRevision === null ? 1 : expectedRevision + 1;
    const params =
      expectedRevision === null
        ? new URLSearchParams({
            on_conflict: "event_id",
            select: "event_id,food,updated_at,revision",
          })
        : new URLSearchParams({
            select: "event_id,food,updated_at,revision",
            event_id: `eq.${eventId}`,
            revision: `eq.${expectedRevision}`,
          });
    const rows = await this.jsonRequest<KitchenEventAddOnRow[]>(
      "kitchen_event_add_ons",
      params,
      {
        method: expectedRevision === null ? "POST" : "PATCH",
        headers: {
          Prefer:
            expectedRevision === null
              ? "resolution=ignore-duplicates,return=representation"
              : "return=representation",
        },
        body: JSON.stringify({
          event_id: eventId,
          food,
          updated_at: updatedAt,
          revision,
        }),
      },
    );
    const row = rows[0];
    if (!row) {
      throw new KitchenFoodAddOnConflictError();
    }
    return {
      eventId: row.event_id,
      food: row.food as KitchenEventAddOnFood,
      updatedAt: row.updated_at,
      revision: row.revision,
    };
  }

  async startSync(date: string) {
    const now = new Date().toISOString();
    await this.emptyRequest(
      "kitchen_sync_runs",
      new URLSearchParams({ on_conflict: "event_date" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          event_date: date,
          status: "running",
          started_at: now,
          completed_at: null,
          error_message: null,
          updated_at: now,
        }),
      },
    );
  }

  async completeSync(date: string, eventCount: number) {
    const now = new Date().toISOString();
    await this.emptyRequest(
      "kitchen_sync_runs",
      new URLSearchParams({ event_date: `eq.${date}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "success",
          completed_at: now,
          last_successful_sync_at: now,
          event_count: eventCount,
          error_message: null,
          updated_at: now,
        }),
      },
    );
  }

  async failSync(date: string, errorMessage: string) {
    const now = new Date().toISOString();
    await this.emptyRequest(
      "kitchen_sync_runs",
      new URLSearchParams({ event_date: `eq.${date}` }),
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

  async claimWebhook(receipt: WebhookReceipt) {
    const response = await this.request("kitchen_webhook_receipts", undefined, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        receipt_id: receipt.receiptId,
        trigger_type: receipt.triggerType,
        source_event_id: receipt.sourceEventId,
        source_event_date: receipt.sourceEventDate,
        signature_timestamp: receipt.signatureTimestamp,
        payload_hash: receipt.payloadHash,
        status: "processing",
        received_at: receipt.receivedAt,
      }),
    });

    if (response.status === 409) {
      const receivedAt = Date.parse(receipt.receivedAt);
      const processingStaleBefore = new Date(
        receivedAt - WEBHOOK_PROCESSING_LEASE_MS,
      ).toISOString();
      const duplicateStaleBefore = new Date(
        receivedAt - WEBHOOK_DEDUPLICATION_WINDOW_MS,
      ).toISOString();
      const retryResponse = await this.request(
        "kitchen_webhook_receipts",
        new URLSearchParams({
          receipt_id: `eq.${receipt.receiptId}`,
          or: `(status.eq.failed,and(status.eq.processing,received_at.lt.${processingStaleBefore}),and(status.in.(processed,ignored),received_at.lt.${duplicateStaleBefore}))`,
          select: "receipt_id",
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            trigger_type: receipt.triggerType,
            source_event_id: receipt.sourceEventId,
            source_event_date: receipt.sourceEventDate,
            signature_timestamp: receipt.signatureTimestamp,
            payload_hash: receipt.payloadHash,
            status: "processing",
            error_message: null,
            processed_at: null,
            received_at: receipt.receivedAt,
          }),
        },
      );
      if (!retryResponse.ok) {
        throw new Error(
          `Kitchen database request failed (${retryResponse.status}).`,
        );
      }
      const retried = (await retryResponse.json()) as {
        receipt_id: string;
      }[];
      return retried.length > 0;
    }
    if (!response.ok) {
      throw new Error(`Kitchen database request failed (${response.status}).`);
    }
    return true;
  }

  async completeWebhook(
    receiptId: string,
    status: "processed" | "ignored" | "failed",
    errorMessage: string | null = null,
  ) {
    await this.emptyRequest(
      "kitchen_webhook_receipts",
      new URLSearchParams({ receipt_id: `eq.${receiptId}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status,
          error_message: errorMessage,
          processed_at: new Date().toISOString(),
        }),
      },
    );
  }

  async getEncryptedTokenState() {
    const rows = await this.jsonRequest<TokenRow[]>(
      "kitchen_oauth_token_state",
      new URLSearchParams({
        select: "encrypted_tokens,expires_at",
        provider: "eq.tripleseat",
        limit: "1",
      }),
    );
    const row = rows[0];
    return row
      ? {
          encryptedTokens: row.encrypted_tokens,
          expiresAt: row.expires_at,
        }
      : null;
  }

  async saveEncryptedTokenState(state: EncryptedTokenState) {
    await this.emptyRequest(
      "kitchen_oauth_token_state",
      new URLSearchParams({ on_conflict: "provider" }),
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          provider: "tripleseat",
          encrypted_tokens: state.encryptedTokens,
          encryption_version: 1,
          expires_at: state.expiresAt,
          updated_at: new Date().toISOString(),
        }),
      },
    );
  }
}

export class MemoryKitchenStorage implements KitchenStorage {
  readonly persistence = "memory" as const;
  private readonly days = new Map<string, StoredKitchenEvent[]>();
  private readonly manualBwa = new Map<string, string>();
  private readonly itemReadiness = new Map<
    string,
    Map<string, CurrentReadiness>
  >();
  private readonly itemCompletion = new Map<
    string,
    Map<string, CurrentCompletion>
  >();
  private readonly foodAddOns = new Map<string, StoredKitchenFoodAddOns>();
  private readonly syncRuns = new Map<string, KitchenSyncState>();
  private readonly webhookReceipts = new Map<
    string,
    WebhookReceipt & {
      status: "processing" | "processed" | "ignored" | "failed";
      errorMessage: string | null;
    }
  >();
  private tokenState: EncryptedTokenState | null = null;

  async getDay(date: string): Promise<StoredKitchenDay> {
    const stored = this.days.get(date) ?? [];
    const events = stored.map(({ sourceEvent, checklist }) => {
      const eventId = String(checklist.event.eventId);
      const storedAddOns = this.foodAddOns.get(eventId);
      const liveFoodAddOns = storedAddOns
        ? translateEventHostFoodAddOns(
            storedAddOns.food,
            storedAddOns.updatedAt,
          )
        : [];
      const derivedChecklist = checklistForCurrentRules(
        sourceEvent,
        checklist,
        liveFoodAddOns,
      );
      return {
        ...derivedChecklist,
        foodRunnerOrBwa: this.manualBwa.get(eventId) ?? "",
        completedItemKeys: [
          ...(this.itemReadiness.get(eventId)?.entries() ?? []),
        ]
          .filter(([, readiness]) => readiness.ready)
          .map(([itemKey]) => itemKey)
          .sort(),
        finalCompletedItemKeys: [
          ...(this.itemCompletion.get(eventId)?.entries() ?? []),
        ]
          .filter(([, completion]) => completion.completed)
          .map(([itemKey]) => itemKey)
          .sort(),
        liveFoodAddOns,
      };
    });

    const sortedEvents = sortChecklists(events);
    const addOnRecords = [...this.foodAddOns.values()].filter((record) =>
      sortedEvents.some(
        (checklist) =>
          String(checklist.event.eventId) === record.eventId,
      ),
    );
    const alertMetadata = liveAddOnAlertMetadata(
      sortedEvents,
      addOnRecords,
      this.itemReadiness,
    );

    return {
      date,
      events: sortedEvents,
      bwaOptions: savedBwaOptions(),
      sync: clone(this.syncRuns.get(date) ?? null),
      ...alertMetadata,
    };
  }

  async getEventDate(eventId: string) {
    for (const events of this.days.values()) {
      const event = events.find(
        ({ sourceEvent }) => String(sourceEvent.eventId) === eventId,
      );
      if (event) {
        return event.sourceEvent.localDate;
      }
    }
    return null;
  }

  async replaceDay(date: string, events: readonly StoredKitchenEvent[]) {
    const previousEventIds = new Set(
      (this.days.get(date) ?? []).map(({ sourceEvent }) =>
        String(sourceEvent.eventId),
      ),
    );
    const nextEventIds = new Set(
      events.map(({ sourceEvent }) => String(sourceEvent.eventId)),
    );
    for (const [storedDate, storedEvents] of this.days) {
      if (storedDate === date) {
        continue;
      }
      const eventsWithoutMovedIds = storedEvents.filter(
        ({ sourceEvent }) =>
          !nextEventIds.has(String(sourceEvent.eventId)),
      );
      if (eventsWithoutMovedIds.length !== storedEvents.length) {
        this.days.set(storedDate, eventsWithoutMovedIds);
      }
    }
    for (const eventId of previousEventIds) {
      if (!nextEventIds.has(eventId)) {
        const stillStored = [...this.days.entries()].some(
          ([storedDate, storedEvents]) =>
            storedDate !== date &&
            storedEvents.some(
              ({ sourceEvent }) =>
                String(sourceEvent.eventId) === eventId,
            ),
        );
        if (!stillStored) {
          this.foodAddOns.delete(eventId);
          this.itemReadiness.delete(eventId);
          this.itemCompletion.delete(eventId);
        }
      }
    }
    this.days.set(date, clone([...events]));
  }

  async saveManualBwa(eventId: string, bwa: string) {
    this.manualBwa.set(eventId, bwa);
  }

  async saveItemReadiness(
    eventId: string,
    itemKey: string,
    ready: boolean,
  ) {
    const readiness = this.itemReadiness.get(eventId) ?? new Map();
    readiness.set(itemKey, {
      ready,
      updatedAt: new Date().toISOString(),
    });
    this.itemReadiness.set(eventId, readiness);
  }

  async saveItemCompletion(
    eventId: string,
    itemKey: string,
    completed: boolean,
  ) {
    const completion = this.itemCompletion.get(eventId) ?? new Map();
    completion.set(itemKey, {
      completed,
      updatedAt: new Date().toISOString(),
    });
    this.itemCompletion.set(eventId, completion);
  }

  async getFoodAddOns(eventId: string) {
    return clone(this.foodAddOns.get(eventId) ?? null);
  }

  async saveFoodAddOns(
    eventId: string,
    food: KitchenEventAddOnFood,
    expectedRevision: number | null,
  ): Promise<StoredKitchenFoodAddOns> {
    if ((await this.getEventDate(eventId)) === null) {
      throw new Error("Kitchen event was not found.");
    }
    const current = this.foodAddOns.get(eventId);
    if (
      (expectedRevision === null && current) ||
      (expectedRevision !== null &&
        current?.revision !== expectedRevision)
    ) {
      throw new KitchenFoodAddOnConflictError();
    }
    const record = {
      eventId,
      food: clone(food),
      updatedAt: new Date().toISOString(),
      revision: expectedRevision === null ? 1 : expectedRevision + 1,
    };
    this.foodAddOns.set(eventId, record);
    return clone(record);
  }

  async startSync(date: string) {
    const now = new Date().toISOString();
    const previous = this.syncRuns.get(date);
    this.syncRuns.set(date, {
      eventDate: date,
      status: "running",
      startedAt: now,
      completedAt: null,
      lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
      eventCount: previous?.eventCount ?? 0,
      errorMessage: null,
    });
  }

  async completeSync(date: string, eventCount: number) {
    const now = new Date().toISOString();
    const previous = this.syncRuns.get(date);
    this.syncRuns.set(date, {
      eventDate: date,
      status: "success",
      startedAt: previous?.startedAt ?? now,
      completedAt: now,
      lastSuccessfulSyncAt: now,
      eventCount,
      errorMessage: null,
    });
  }

  async failSync(date: string, errorMessage: string) {
    const now = new Date().toISOString();
    const previous = this.syncRuns.get(date);
    this.syncRuns.set(date, {
      eventDate: date,
      status: "error",
      startedAt: previous?.startedAt ?? now,
      completedAt: now,
      lastSuccessfulSyncAt: previous?.lastSuccessfulSyncAt ?? null,
      eventCount: previous?.eventCount ?? 0,
      errorMessage,
    });
  }

  async claimWebhook(receipt: WebhookReceipt) {
    const existing = this.webhookReceipts.get(receipt.receiptId);
    if (existing) {
      const currentReceivedAt = Date.parse(receipt.receivedAt);
      const previousReceivedAt = Date.parse(existing.receivedAt);
      const processingLeaseActive =
        existing.status === "processing" &&
        Number.isFinite(currentReceivedAt) &&
        Number.isFinite(previousReceivedAt) &&
        currentReceivedAt - previousReceivedAt <
          WEBHOOK_PROCESSING_LEASE_MS;
      const duplicateWindowActive =
        (existing.status === "processed" ||
          existing.status === "ignored") &&
        Number.isFinite(currentReceivedAt) &&
        Number.isFinite(previousReceivedAt) &&
        currentReceivedAt - previousReceivedAt <
          WEBHOOK_DEDUPLICATION_WINDOW_MS;
      if (
        duplicateWindowActive ||
        processingLeaseActive
      ) {
        return false;
      }
    }
    this.webhookReceipts.set(receipt.receiptId, {
      ...clone(receipt),
      status: "processing",
      errorMessage: null,
    });
    return true;
  }

  async completeWebhook(
    receiptId: string,
    status: "processed" | "ignored" | "failed",
    errorMessage: string | null = null,
  ) {
    const receipt = this.webhookReceipts.get(receiptId);
    if (receipt) {
      receipt.status = status;
      receipt.errorMessage = errorMessage;
    }
  }

  async getEncryptedTokenState() {
    return clone(this.tokenState);
  }

  async saveEncryptedTokenState(state: EncryptedTokenState) {
    this.tokenState = clone(state);
  }
}

let defaultStorage: KitchenStorage | null = null;

export function createSupabaseKitchenStorage(options: StorageOptions = {}) {
  return new SupabaseKitchenStorage(options);
}

export function createMemoryKitchenStorage() {
  return new MemoryKitchenStorage();
}

function mockStorageRequested(env: NodeJS.ProcessEnv = process.env) {
  return /^(1|true|yes)$/i.test(
    env.TRIPLESEAT_MOCK?.trim() ||
      env.TRIPLESEAT_MOCK_MODE?.trim() ||
      "",
  );
}

export function getKitchenStorage(): KitchenStorage {
  if (!defaultStorage) {
    const missing = getMissingSupabaseEnvironmentVariables();
    defaultStorage =
      mockStorageRequested() ||
      (missing.length > 0 && process.env.NODE_ENV !== "production")
        ? createMemoryKitchenStorage()
        : createSupabaseKitchenStorage();
  }
  return defaultStorage;
}

export function setKitchenStorageForTests(storage: KitchenStorage | null) {
  defaultStorage = storage;
}
