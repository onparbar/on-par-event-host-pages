export const EVENT_FOOD_SOURCE_TYPES = [
  "TRIPLESEAT_CONTRACT",
  "EVENT_HOST_ADDON",
  "VIP_ADDON",
  "REFILL",
  "CORRECTION",
  "CANCELLATION",
] as const;

export type EventFoodSourceType = (typeof EVENT_FOOD_SOURCE_TYPES)[number];

export const EVENT_FOOD_PAN_SIZES = [
  "THIRD_PAN",
  "HALF_PAN",
  "FULL_PAN",
  "TRAY",
  "EACH",
  "DOZEN",
  "BOWL",
  "REFILL",
  "NOT_APPLICABLE",
] as const;

export type EventFoodPanSize = (typeof EVENT_FOOD_PAN_SIZES)[number];
export type EventFoodStation = "EXPO" | "FRYER" | "GRILL" | "COLD_PREP";
export type EventFoodApprovalStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "HELD"
  | "CANCELLED";
export type EventFoodDispatchStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "HELD"
  | "QUEUED_FOR_KITCHEN"
  | "SENDING"
  | "SENT_TO_GOTAB"
  | "CONFIRMED_BY_GOTAB"
  | "FAILED"
  | "NEEDS_PRODUCT_MAPPING"
  | "NEEDS_REVIEW"
  | "CORRECTED"
  | "CANCELLED";

export type EventFoodProductMapping = {
  id: string;
  canonicalProductKey: string;
  displayName: string;
  aliases: string[];
  panSize: EventFoodPanSize;
  preparationStation: EventFoodStation;
  gotabProductUuid: string | null;
  verifiedAt: string | null;
};

export type EventFoodSourceItem = {
  key: string;
  foodName: string;
  description: string;
  quantity: number | null;
  unit: string;
  numberOfPans: number | null;
  panSize: "1/3" | "1/2" | null;
};

export type EventFoodContext = {
  id: string;
  eventId: string;
  tripleseatEventId: string | null;
  tripleseatBookingId: string | null;
  sourceType: EventFoodSourceType;
  sourceRecordId: string;
  sourceVersion: number;
  originalSourceName: string;
  eventName: string;
  eventArea: string | null;
  foodServiceAt: string;
  prepDueAt: string;
  requesterName: string | null;
  requestNotes: string | null;
  dietaryNotes: string | null;
  allergyNotes: string | null;
};

export type NormalizedEventFoodItem = {
  id: string;
  eventId: string;
  eventName: string;
  tripleseatEventId: string | null;
  tripleseatBookingId: string | null;
  sourceType: EventFoodSourceType;
  sourceRecordId: string;
  sourceVersion: number;
  canonicalProductKey: string;
  originalSourceName: string;
  displayName: string;
  panSize: EventFoodPanSize;
  quantity: number;
  preparationStation: EventFoodStation;
  eventArea: string | null;
  foodServiceAt: string;
  prepDueAt: string;
  requesterName: string | null;
  requestNotes: string | null;
  dietaryNotes: string | null;
  allergyNotes: string | null;
  approvalStatus: EventFoodApprovalStatus;
  dispatchStatus: EventFoodDispatchStatus;
  gotabProductUuid: string | null;
  externalId: string;
  idempotencyKey: string;
};

function isoTimestamp(value: string, field: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} is invalid.`);
  return new Date(timestamp).toISOString();
}

function normalizedPanSize(source: EventFoodSourceItem) {
  if (source.panSize === "1/3") return "THIRD_PAN" as const;
  if (source.panSize === "1/2") return "HALF_PAN" as const;
  if (source.numberOfPans != null && source.numberOfPans > 0) {
    throw new Error(`${source.foodName} uses an unsupported pan size.`);
  }
  const unit = source.unit.toLowerCase();
  if (unit.includes("pretzel plate") || unit.includes("tray")) return "TRAY" as const;
  if (unit.includes("bowl")) return "BOWL" as const;
  if (unit.includes("dozen")) return "DOZEN" as const;
  if (unit === "each") return "EACH" as const;
  return "NOT_APPLICABLE" as const;
}

export function eventFoodIdempotencyKey(
  eventId: string,
  sourceType: EventFoodSourceType,
  sourceRecordId: string,
  sourceVersion: number,
  action: string,
) {
  const parts = [eventId, sourceType, sourceRecordId, String(sourceVersion), action];
  if (parts.some((part) => !part.trim())) {
    throw new Error("Event Food idempotency fields must be non-empty.");
  }
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

export function normalizeEventFoodItem(
  source: EventFoodSourceItem,
  context: EventFoodContext,
  mapping: EventFoodProductMapping | null,
): NormalizedEventFoodItem {
  if (!Number.isSafeInteger(source.quantity) || source.quantity == null || source.quantity <= 0) {
    throw new Error(`${source.foodName} requires a positive whole quantity.`);
  }
  if (source.numberOfPans != null && (!Number.isSafeInteger(source.numberOfPans) || source.numberOfPans <= 0)) {
    throw new Error(`${source.foodName} requires a positive whole pan count.`);
  }
  const sourcePanSize = normalizedPanSize(source);
  if (mapping && mapping.panSize !== sourcePanSize) {
    throw new Error(`${source.foodName} does not match the mapped pan-size behavior.`);
  }
  const idempotencyKey = eventFoodIdempotencyKey(
    context.eventId,
    context.sourceType,
    context.sourceRecordId,
    context.sourceVersion,
    "DISPATCH",
  );
  return {
    id: context.id,
    eventId: context.eventId,
    eventName: context.eventName,
    tripleseatEventId: context.tripleseatEventId,
    tripleseatBookingId: context.tripleseatBookingId,
    sourceType: context.sourceType,
    sourceRecordId: context.sourceRecordId,
    sourceVersion: context.sourceVersion,
    canonicalProductKey: mapping?.canonicalProductKey ?? source.key,
    originalSourceName: context.originalSourceName,
    displayName: mapping?.displayName ?? source.foodName,
    panSize: sourcePanSize,
    quantity: source.numberOfPans ?? source.quantity,
    preparationStation: mapping?.preparationStation ?? "EXPO",
    eventArea: context.eventArea,
    foodServiceAt: isoTimestamp(context.foodServiceAt, "Food service time"),
    prepDueAt: isoTimestamp(context.prepDueAt, "Prep due time"),
    requesterName: context.requesterName,
    requestNotes: context.requestNotes,
    dietaryNotes: context.dietaryNotes,
    allergyNotes: context.allergyNotes,
    approvalStatus: mapping ? "AWAITING_APPROVAL" : "DRAFT",
    dispatchStatus: mapping ? "SCHEDULED" : "NEEDS_PRODUCT_MAPPING",
    gotabProductUuid: mapping?.gotabProductUuid ?? null,
    externalId: context.id,
    idempotencyKey,
  };
}

export type GoTabKdsPreview = {
  ticketName: string;
  eventName: string;
  eventArea: string | null;
  requestType: EventFoodSourceType;
  product: string;
  panSize: EventFoodPanSize;
  quantity: number;
  preparationStation: EventFoodStation;
  foodServiceAt: string;
  requesterName: string | null;
  notes: string | null;
  allergyNotes: string | null;
  gotabProductUuid: string | null;
  warnings: string[];
};

const FORBIDDEN_PAYMENT_FIELDS = new Set([
  "amount",
  "card",
  "cardnumber",
  "charge",
  "payment",
  "paymentmethod",
  "refund",
  "token",
]);

export function assertPaymentFreeGoTabPayload(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPaymentFreeGoTabPayload(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    if (FORBIDDEN_PAYMENT_FIELDS.has(normalizedKey)) {
      throw new Error(`Payment data is prohibited in GoTab Event Food ${path}.`);
    }
    assertPaymentFreeGoTabPayload(nested, `${path}.${key}`);
  }
}

const SOURCE_LABELS: Record<EventFoodSourceType, string> = {
  TRIPLESEAT_CONTRACT: "EVENT",
  EVENT_HOST_ADDON: "FOOD ADD-ON",
  VIP_ADDON: "VIP FOOD",
  REFILL: "REFILL",
  CORRECTION: "CORRECTION",
  CANCELLATION: "CANCEL ITEM",
};

export function buildGoTabKdsPreview(
  request: NormalizedEventFoodItem,
  eventName: string,
  dispatch: { enabled: boolean; dryRun: boolean },
): GoTabKdsPreview {
  const warnings: string[] = [];
  if (!request.gotabProductUuid) warnings.push("Product mapping is missing.");
  if (!dispatch.enabled) warnings.push("GoTab dispatch is disabled.");
  if (dispatch.dryRun) warnings.push("DRY-RUN MODE — no KDS ticket will be created.");
  const preview = {
    ticketName: `[${SOURCE_LABELS[request.sourceType]}] ${eventName}`.slice(0, 80),
    eventName,
    eventArea: request.eventArea,
    requestType: request.sourceType,
    product: request.displayName,
    panSize: request.panSize,
    quantity: request.quantity,
    preparationStation: request.preparationStation,
    foodServiceAt: request.foodServiceAt,
    requesterName: request.requesterName,
    notes: request.requestNotes,
    allergyNotes: request.allergyNotes,
    gotabProductUuid: request.gotabProductUuid,
    warnings,
  };
  assertPaymentFreeGoTabPayload(preview);
  return preview;
}
