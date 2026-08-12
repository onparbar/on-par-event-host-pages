import { describe, expect, it } from "vitest";
import {
  buildGoTabKdsPreview,
  assertPaymentFreeGoTabPayload,
  eventFoodIdempotencyKey,
  normalizeEventFoodItem,
} from "../event-food";

const context = {
  id: "request-1",
  eventId: "event-1",
  tripleseatEventId: "ts-1",
  tripleseatBookingId: "booking-1",
  sourceType: "EVENT_HOST_ADDON" as const,
  sourceRecordId: "addon-1",
  sourceVersion: 1,
  originalSourceName: "Mozzarella Sticks",
  eventName: "OPE KDS Integration Test",
  eventArea: "VIP 1",
  foodServiceAt: "2026-08-15T22:00:00.000Z",
  prepDueAt: "2026-08-15T21:00:00.000Z",
  requesterName: "Test Staff",
  requestNotes: null,
  dietaryNotes: null,
  allergyNotes: null,
};

const mapping = {
  id: "mapping-1",
  canonicalProductKey: "mozzarella-sticks",
  displayName: "Mozzarella Sticks",
  aliases: ["Mozz Sticks"],
  panSize: "HALF_PAN" as const,
  preparationStation: "FRYER" as const,
  gotabProductUuid: "product-uuid",
  verifiedAt: null,
};

describe("normalized Event Food", () => {
  it("reuses the calculated Event Host pan count and mapping", () => {
    const result = normalizeEventFoodItem({
      key: "platter-mozzarella-sticks",
      foodName: "Mozzarella Sticks",
      description: "Existing Event Host rule output",
      quantity: 8,
      unit: "pounds",
      numberOfPans: 2,
      panSize: "1/2",
    }, context, mapping);
    expect(result).toMatchObject({
      quantity: 2,
      panSize: "HALF_PAN",
      preparationStation: "FRYER",
      dispatchStatus: "SCHEDULED",
      idempotencyKey: "event-1:EVENT_HOST_ADDON:addon-1:1:DISPATCH",
    });
  });

  it("holds unmapped food instead of silently dropping it", () => {
    const result = normalizeEventFoodItem({
      key: "unknown",
      foodName: "Unknown Food",
      description: "",
      quantity: 1,
      unit: "each",
      numberOfPans: null,
      panSize: null,
    }, context, null);
    expect(result).toMatchObject({
      dispatchStatus: "NEEDS_PRODUCT_MAPPING",
      gotabProductUuid: null,
    });
  });

  it("preserves Event Host one-third-pan calculations", () => {
    const thirdPanMapping = {
      ...mapping,
      panSize: "THIRD_PAN" as const,
    };
    const result = normalizeEventFoodItem({
      key: "platter-mozzarella-sticks",
      foodName: "Mozzarella Sticks",
      description: "Odd platter packing",
      quantity: 4,
      unit: "pounds",
      numberOfPans: 3,
      panSize: "1/3",
    }, context, thirdPanMapping);
    expect(result).toMatchObject({ quantity: 3, panSize: "THIRD_PAN" });
  });

  it("keeps repeated refill requests distinct by source record ID", () => {
    expect(eventFoodIdempotencyKey("event-1", "REFILL", "refill-1", 1, "DISPATCH"))
      .not.toBe(eventFoodIdempotencyKey("event-1", "REFILL", "refill-2", 1, "DISPATCH"));
  });

  it("safely encodes add-on source keys without changing their identity", () => {
    expect(eventFoodIdempotencyKey("event-1", "EVENT_HOST_ADDON", "addon:mozzarella-sticks", 2, "DISPATCH"))
      .toBe("event-1:EVENT_HOST_ADDON:addon%3Amozzarella-sticks:2:DISPATCH");
  });

  it("marks a dry-run preview clearly", () => {
    const request = normalizeEventFoodItem({
      key: "platter-mozzarella-sticks",
      foodName: "Mozzarella Sticks",
      description: "",
      quantity: 8,
      unit: "pounds",
      numberOfPans: 2,
      panSize: "1/2",
    }, context, mapping);
    expect(buildGoTabKdsPreview(request, context.eventName, { enabled: false, dryRun: true }).warnings)
      .toEqual(expect.arrayContaining([
        "GoTab dispatch is disabled.",
        "DRY-RUN MODE — no KDS ticket will be created.",
      ]));
  });

  it("rejects payment information anywhere in a GoTab Event Food payload", () => {
    expect(() => assertPaymentFreeGoTabPayload({ order: { paymentMethod: "card" } }))
      .toThrow("Payment data is prohibited");
    expect(() => assertPaymentFreeGoTabPayload({ product: "Wings", quantity: 2 }))
      .not.toThrow();
  });
});
