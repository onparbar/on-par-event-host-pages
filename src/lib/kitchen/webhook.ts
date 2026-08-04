import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  getKitchenStorage,
  type KitchenStorage,
  type WebhookReceipt,
} from "./storage";
import { syncKitchenDay } from "./sync";
import {
  getTripleseatAdapter,
  isValidKitchenDate,
} from "./tripleseat";

const RELEVANT_TRIGGER_TYPES = new Set([
  "CREATE_EVENT",
  "UPDATE_EVENT",
  "DELETE_EVENT",
  "REASSIGN_EVENT_LOCATION",
  "REASSIGN_EVENT_AREAS",
  "STATUS_CHANGE_EVENT",
  "CHANGE_EVENT_GUEST_COUNTS",
  "CHANGE_EVENT_DATETIME",
  "REASSIGN_EVENT_OWNERSHIP",
  "REASSIGN_EVENT_CONTACT",
  "REASSIGN_EVENT_ACCOUNT",
  "CREATE_EVENT_DOCUMENT",
  "UPDATE_EVENT_DOCUMENT",
  "SHARED_DOCUMENT",
  "DOCUMENT_SIGNED",
  "CREATE_BOOKING",
  "DELETE_BOOKING",
  "CHANGE_BOOKING_DATES",
  "CREATE_BOOKING_DOCUMENT",
  "DELETE_BOOKING_DOCUMENT",
  "UPDATE_BOOKING_DOCUMENT",
  "SHARE_BOOKING_DOCUMENT",
  "CREATE_BOOKING_NOTE",
  "REASSIGN_BOOKING_LOCATION",
  "STATUS_CHANGE_BOOKING",
]);

type UnknownRecord = Record<string, unknown>;

export type WebhookVerificationResult =
  | {
      valid: true;
      timestamp: string;
      signature: string;
    }
  | {
      valid: false;
      reason: "missing-header" | "invalid-header" | "invalid-signature";
    };

export type ProcessWebhookOptions = {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  signingKey: string;
  storage?: KitchenStorage;
  syncDay?: (date: string) => Promise<unknown>;
  resolveEventDate?: (eventId: string) => Promise<string | null>;
  now?: () => Date;
};

export type ProcessWebhookResult = {
  ok: true;
  duplicate: boolean;
  ignored: boolean;
  receiptId: string;
  syncedDates: string[];
};

export class TripleseatWebhookError extends Error {
  readonly kind: "signature" | "payload" | "processing";

  constructor(
    kind: "signature" | "payload" | "processing",
    message: string,
  ) {
    super(message);
    this.name = "TripleseatWebhookError";
    this.kind = kind;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseSignatureHeader(value: string | null) {
  if (!value) {
    return null;
  }
  const values = new Map<string, string[]>();
  for (const item of value.split(",")) {
    const separator = item.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = item.slice(0, separator).trim();
    const parsedValue = item.slice(separator + 1).trim();
    if (!key || !parsedValue) {
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), parsedValue]);
  }
  const timestamp = values.get("t")?.[0] ?? null;
  const signatures = values.get("v1") ?? [];
  return timestamp && /^\d+$/.test(timestamp) && signatures.length > 0
    ? { timestamp, signatures }
    : null;
}

export function verifyTripleseatWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  signingKey: string,
): WebhookVerificationResult {
  if (!signatureHeader) {
    return { valid: false, reason: "missing-header" };
  }
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !signingKey) {
    return { valid: false, reason: "invalid-header" };
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    Buffer.from(rawBody),
  ]);
  const expected = createHmac("sha256", signingKey)
    .update(signedPayload)
    .digest();

  for (const signature of parsed.signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      continue;
    }
    const received = Buffer.from(signature, "hex");
    if (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    ) {
      return {
        valid: true,
        timestamp: parsed.timestamp,
        signature,
      };
    }
  }

  return { valid: false, reason: "invalid-signature" };
}

function normalizeDate(value: unknown) {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso && isValidKitchenDate(iso[1])) {
    return iso[1];
  }
  const us = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (!us) {
    return null;
  }
  const date = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return isValidKitchenDate(date) ? date : null;
}

function webhookDates(payload: UnknownRecord) {
  const dates = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record) {
      return;
    }

    for (const key of [
      "event_date_iso8601",
      "start_date",
      "event_date",
      "event_start_iso8601",
      "event_start",
    ]) {
      const date = normalizeDate(record[key]);
      if (date) {
        dates.add(date);
      }
    }

    for (const key of [
      "event",
      "events",
      "booking",
      "document_layout",
      "data",
    ]) {
      if (record[key] != null) {
        visit(record[key], depth + 1);
      }
    }
  };
  visit(payload, 0);
  return [...dates].sort();
}

function sourceEventId(payload: UnknownRecord) {
  const event = asRecord(payload.event);
  if (event) {
    return asString(event.id);
  }
  const document = asRecord(payload.document_layout);
  return document ? asString(document.event_id) : null;
}

function triggerType(payload: UnknownRecord) {
  const value =
    asString(payload.webhook_trigger_type) ||
    asString(payload.trigger_type) ||
    asString(payload.type);
  return value?.toUpperCase().slice(0, 100) ?? null;
}

function receiptFor(
  rawBody: Uint8Array,
  timestamp: string,
  payload: UnknownRecord,
  now: Date,
): WebhookReceipt {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const receiptId = payloadHash;
  const dates = webhookDates(payload);
  return {
    receiptId,
    triggerType: triggerType(payload),
    sourceEventId: sourceEventId(payload)?.slice(0, 128) ?? null,
    sourceEventDate: dates[0] ?? null,
    signatureTimestamp: timestamp,
    payloadHash,
    receivedAt: now.toISOString(),
  };
}

export async function processTripleseatWebhook(
  options: ProcessWebhookOptions,
): Promise<ProcessWebhookResult> {
  const verified = verifyTripleseatWebhookSignature(
    options.rawBody,
    options.signatureHeader,
    options.signingKey,
  );
  if (!verified.valid) {
    throw new TripleseatWebhookError(
      "signature",
      "Invalid Tripleseat webhook signature.",
    );
  }

  let payload: UnknownRecord;
  try {
    const parsed = JSON.parse(Buffer.from(options.rawBody).toString("utf8"));
    const record = asRecord(parsed);
    if (!record) {
      throw new Error("Webhook body must be an object.");
    }
    payload = record;
  } catch {
    throw new TripleseatWebhookError(
      "payload",
      "Invalid Tripleseat webhook payload.",
    );
  }

  const storage = options.storage ?? getKitchenStorage();
  const receipt = receiptFor(
    options.rawBody,
    verified.timestamp,
    payload,
    (options.now ?? (() => new Date()))(),
  );
  const claimed = await storage.claimWebhook(receipt);
  if (!claimed) {
    return {
      ok: true,
      duplicate: true,
      ignored: false,
      receiptId: receipt.receiptId,
      syncedDates: [],
    };
  }

  const trigger = receipt.triggerType;
  if (!trigger || !RELEVANT_TRIGGER_TYPES.has(trigger)) {
    await storage.completeWebhook(receipt.receiptId, "ignored");
    return {
      ok: true,
      duplicate: false,
      ignored: true,
      receiptId: receipt.receiptId,
      syncedDates: [],
    };
  }

  const syncDay =
    options.syncDay ??
    ((date: string) => syncKitchenDay(date, { storage }));
  try {
    const dates = new Set(webhookDates(payload));
    let currentEventDate: string | null = null;
    if (receipt.sourceEventId) {
      const storedDate = await storage.getEventDate(
        receipt.sourceEventId,
      );
      if (storedDate && isValidKitchenDate(storedDate)) {
        dates.add(storedDate);
      }

      if (trigger === "CHANGE_EVENT_DATETIME" || dates.size === 0) {
        const resolveEventDate =
          options.resolveEventDate ??
          ((eventId: string) =>
            getTripleseatAdapter().fetchEventDateById(eventId));
        const resolvedDate = await resolveEventDate(
          receipt.sourceEventId,
        );
        if (resolvedDate && isValidKitchenDate(resolvedDate)) {
          currentEventDate = resolvedDate;
          dates.add(resolvedDate);
        }
      }
    }

    if (dates.size === 0) {
      throw new Error("No event date could be resolved.");
    }

    const sortedDates = [...dates].sort();
    const datesToSync = currentEventDate
      ? [
          currentEventDate,
          ...sortedDates.filter((date) => date !== currentEventDate),
        ]
      : sortedDates;
    for (const date of datesToSync) {
      await syncDay(date);
    }
    await storage.completeWebhook(receipt.receiptId, "processed");
    return {
      ok: true,
      duplicate: false,
      ignored: false,
      receiptId: receipt.receiptId,
      syncedDates: datesToSync,
    };
  } catch {
    await storage.completeWebhook(
      receipt.receiptId,
      "failed",
      "Kitchen webhook refresh failed.",
    );
    throw new TripleseatWebhookError(
      "processing",
      "Kitchen webhook refresh failed.",
    );
  }
}
