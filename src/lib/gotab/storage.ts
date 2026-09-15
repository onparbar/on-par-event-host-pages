import "server-only";

import { getSupabaseSecret } from "@/lib/kitchen/storage";
import type { GoTabCapabilityCheck } from "./client";
import type { NormalizedEventFoodItem } from "./event-food";

const DEFAULT_SUPABASE_URL = "https://tmnstuthbllnoqgepotn.supabase.co";

type FetchImplementation = typeof fetch;

export type ClaimedEventFoodDispatch = {
  id: string;
  request_id: string;
  idempotency_key: string;
  action: "DISPATCH" | "CORRECTION" | "CANCELLATION" | "TEST";
  status: "SENDING";
  attempt_count: number;
  sanitized_payload: Record<string, unknown> | null;
};

export type StoredEventFoodMapping = {
  id: string;
  canonical_product_key: string;
  source_system: "TRIPLESEAT" | "EVENT_HOST" | "VIP";
  source_product_key: string;
  source_product_name: string;
  aliases: string[];
  display_name: string;
  pan_size: string;
  preparation_station: string;
  gotab_product_uuid: string | null;
  mapping_status: "NEEDS_MAPPING" | "MAPPED" | "VERIFIED" | "DISABLED";
  verified_at: string | null;
  updated_at: string;
};

export type StoredEventFoodActivity = {
  id: string;
  event_id: string;
  event_name: string;
  source_type: string;
  display_name: string;
  pan_size: string;
  quantity: number;
  preparation_station: string;
  food_service_time: string;
  prep_due_at: string;
  requester_name: string | null;
  dispatch_status: string;
  gotab_order_uuid: string | null;
  retry_count: number;
  failure_reason: string | null;
  dispatched_at: string | null;
  created_at: string;
};

export type StoredEventFoodException = {
  id: string;
  event_id: string;
  source_type: string;
  source_version: number;
  item_key: string;
  food_name: string;
  reason: string;
  status: "OPEN" | "RESOLVED" | "IGNORED";
  created_at: string;
};

export class GoTabIntegrationStorage {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  private async request(
    table: string,
    params: URLSearchParams | null,
    init: RequestInit,
  ) {
    const secret = getSupabaseSecret(this.env);
    if (!secret) throw new Error("GoTab integration database is not configured.");
    const baseUrl = (this.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
    const headers = new Headers(init.headers);
    headers.set("apikey", secret);
    headers.set("content-type", "application/json");
    if (/^eyJ[^.]*\.[^.]+\.[^.]+$/.test(secret)) {
      headers.set("authorization", `Bearer ${secret}`);
    }
    const query = params?.toString();
    const response = await this.fetchImpl(
      `${baseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`,
      { ...init, headers, cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`GoTab integration database request failed (${response.status}).`);
    }
    return response;
  }

  async saveCapabilityCheck(check: GoTabCapabilityCheck, dryRun: boolean, enabled: boolean) {
    await this.request("gotab_integration_status", null, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        singleton: true,
        connection_status: check.connected ? "CONNECTED" : "ERROR",
        configured_location_uuid: check.configuredLocationUuid,
        matched_location_name: check.matchedLocation?.name ?? null,
        matched_location_uuid: check.matchedLocation?.locationUuid ?? null,
        product_read_permission: check.catalogRead.toUpperCase().replace("-", "_"),
        product_write_permission: check.productWrite.toUpperCase().replace("-", "_"),
        order_create_permission: check.orderCreate.toUpperCase().replace("-", "_"),
        spot_read_permission: check.spotRead.toUpperCase().replace("-", "_"),
        station_read_permission: check.stationRead.toUpperCase().replace("-", "_"),
        webhook_status: "CONFIGURED",
        dry_run: dryRun,
        live_dispatch_enabled: enabled,
        last_successful_connection_at: check.connected ? check.checkedAt : null,
        last_error: check.lastError,
        updated_at: check.checkedAt,
      }),
    });
  }

  async claimWebhook(receipt: {
    receiptId: string;
    eventType: string;
    targetUuid: string | null;
    locationUuid: string | null;
    payloadHash: string;
    receivedAt: string;
  }) {
    const response = await this.request("gotab_webhook_receipts", null, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        receipt_id: receipt.receiptId,
        event_type: receipt.eventType,
        target_uuid: receipt.targetUuid,
        location_uuid: receipt.locationUuid,
        payload_hash: receipt.payloadHash,
        status: "PROCESSING",
        received_at: receipt.receivedAt,
      }),
    });
    const rows = (await response.json().catch(() => [])) as unknown[];
    return rows.length > 0;
  }

  async completeWebhook(
    receiptId: string,
    status: "PROCESSED" | "IGNORED" | "FAILED",
    errorMessage: string | null = null,
  ) {
    await this.request(
      "gotab_webhook_receipts",
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

  async claimDueDispatches(workerId: string, limit = 25) {
    if (!workerId.trim()) throw new Error("GoTab worker ID is required.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("GoTab dispatch claim limit must be between 1 and 100.");
    }
    const response = await this.request("rpc/claim_event_food_dispatches", null, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ p_worker_id: workerId, p_limit: limit }),
    });
    return response.json() as Promise<ClaimedEventFoodDispatch[]>;
  }

  async finishDispatch(
    dispatchId: string,
    result: {
      status: "DRY_RUN" | "FAILED" | "HELD" | "SENT";
      nextAttemptAt?: string;
      sanitizedResponse?: Record<string, unknown>;
      lastError?: string;
      tabUuid?: string | null;
      orderUuid?: string | null;
      itemUuid?: string | null;
    },
  ) {
    await this.request(
      "event_food_dispatches",
      new URLSearchParams({ id: `eq.${dispatchId}` }),
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: result.status,
          next_attempt_at: result.nextAttemptAt,
          sanitized_response: result.sanitizedResponse ?? null,
          gotab_tab_uuid: result.tabUuid ?? null,
          gotab_order_uuid: result.orderUuid ?? null,
          gotab_item_uuid: result.itemUuid ?? null,
          last_error: result.lastError ?? null,
          sent_at: result.status === "SENT" ? new Date().toISOString() : undefined,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
  }

  async listMappings() {
    const response = await this.request(
      "event_food_product_mappings",
      new URLSearchParams({
        select: "*",
        order: "source_product_name.asc,pan_size.asc",
      }),
      { method: "GET" },
    );
    return response.json() as Promise<StoredEventFoodMapping[]>;
  }

  async updateMapping(
    id: string,
    update: {
      gotabProductUuid: string | null;
      preparationStation: string;
      panSize: string;
      mappingStatus: StoredEventFoodMapping["mapping_status"];
    },
  ) {
    const response = await this.request(
      "event_food_product_mappings",
      new URLSearchParams({ id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          gotab_product_uuid: update.gotabProductUuid,
          preparation_station: update.preparationStation,
          pan_size: update.panSize,
          mapping_status: update.mappingStatus,
          verified_at: update.mappingStatus === "VERIFIED" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const rows = await response.json() as StoredEventFoodMapping[];
    if (!rows[0]) throw new Error("GoTab product mapping was not found.");
    return rows[0];
  }

  async listActivity(limit = 100) {
    const response = await this.request(
      "event_food_requests",
      new URLSearchParams({
        select: "id,event_id,event_name,source_type,display_name,pan_size,quantity,preparation_station,food_service_time,prep_due_at,requester_name,dispatch_status,gotab_order_uuid,retry_count,failure_reason,dispatched_at,created_at",
        order: "created_at.desc",
        limit: String(limit),
      }),
      { method: "GET" },
    );
    return response.json() as Promise<StoredEventFoodActivity[]>;
  }

  async listExceptions(limit = 100) {
    const response = await this.request(
      "event_food_exceptions",
      new URLSearchParams({
        select: "id,event_id,source_type,source_version,item_key,food_name,reason,status,created_at",
        status: "eq.OPEN",
        order: "created_at.desc",
        limit: String(limit),
      }),
      { method: "GET" },
    );
    return response.json() as Promise<StoredEventFoodException[]>;
  }

  async saveProjectionExceptions(input: {
    eventId: string;
    sourceType: string;
    sourceVersion: number;
    exceptions: Array<{ itemKey: string; foodName: string; reason: string }>;
  }) {
    if (!input.exceptions.length) return;
    await this.request(
      "event_food_exceptions",
      new URLSearchParams({ on_conflict: "event_id,source_type,source_version,item_key,reason" }),
      {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(input.exceptions.map((item) => ({
          event_id: input.eventId,
          source_type: input.sourceType,
          source_version: input.sourceVersion,
          item_key: item.itemKey,
          food_name: item.foodName,
          reason: item.reason,
          status: "OPEN",
        }))),
      },
    );
  }

  async enqueueRequest(
    request: NormalizedEventFoodItem,
    preview: Record<string, unknown>,
    actor: string,
    options: { immediate?: boolean } = {},
  ) {
    const scheduledAt = options.immediate
      ? new Date().toISOString()
      : request.prepDueAt;
    const status = Date.parse(scheduledAt) <= Date.now() ? "QUEUED" : "SCHEDULED";
    const response = await this.request("rpc/enqueue_event_food_request", null, {
      method: "POST",
      body: JSON.stringify({
        p_request: {
          event_id: request.eventId,
          event_name: request.eventName,
          tripleseat_event_id: request.tripleseatEventId,
          tripleseat_booking_id: request.tripleseatBookingId,
          source_type: request.sourceType,
          source_record_id: request.sourceRecordId,
          source_version: request.sourceVersion,
          canonical_product_key: request.canonicalProductKey,
          original_source_name: request.originalSourceName,
          display_name: request.displayName,
          pan_size: request.panSize,
          quantity: request.quantity,
          preparation_station: request.preparationStation,
          event_area: request.eventArea,
          food_service_time: request.foodServiceAt,
          prep_due_at: request.prepDueAt,
          requester_name: request.requesterName,
          request_notes: request.requestNotes,
          dietary_notes: request.dietaryNotes,
          allergy_notes: request.allergyNotes,
          approval_status: request.approvalStatus,
          dispatch_status: request.dispatchStatus,
          gotab_product_uuid: request.gotabProductUuid,
          external_id: request.externalId,
          idempotency_key: request.idempotencyKey,
        },
        p_dispatch: {
          idempotency_key: request.idempotencyKey,
          action: "DISPATCH",
          status,
          scheduled_at: scheduledAt,
          next_attempt_at: scheduledAt,
          sanitized_payload: preview,
        },
        p_actor: actor,
        p_reason: "Normalized from Event Host kitchen rules.",
      }),
    });
    return response.json() as Promise<{ request_id: string; dispatch_id: string; duplicate: boolean }>;
  }

  async performAdministrativeAction(input: {
    requestId: string;
    action: "HOLD" | "SEND_NOW" | "RETRY" | "CANCEL";
    actor: string;
    reason: string;
  }) {
    const response = await this.request("rpc/admin_event_food_dispatch_action", null, {
      method: "POST",
      body: JSON.stringify({
        p_request_id: input.requestId,
        p_action: input.action,
        p_actor: input.actor,
        p_reason: input.reason,
      }),
    });
    return response.json() as Promise<{ request_id: string; action: string }>;
  }
}
