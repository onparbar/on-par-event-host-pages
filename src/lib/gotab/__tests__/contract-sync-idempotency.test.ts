import { describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import { synchronizeKitchenChecklistToEventFood } from "../sync-event-food";

vi.mock("server-only", () => ({}));

const env = {
  GOTAB_API_ACCESS_ID: "test-id", GOTAB_API_ACCESS_SECRET: "test-secret",
  GOTAB_LOCATION_UUID: "test-location", GOTAB_EVENT_SPOT_UUID: "test-spot",
  GOTAB_EVENT_CUSTOMER_PHONE: "test-phone", GOTAB_WEBHOOK_SECRET: "test-webhook",
  EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false", EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
};

function contract(name = "Wing Platter") {
  const checklist = generateKitchenChecklist({
    eventId: "contract-123", eventName: "Redacted contract", localDate: "2026-10-22",
    startTime: "18:00", guestCount: 20, status: "DEFINITE", room: "VIP 1",
    selections: [{ name, quantity: 1, sourceCategory: "Food Platters", isFood: true }],
    sourceUpdatedAt: "2026-10-22T12:00:00Z",
  });
  return { ...checklist, sections: checklist.sections.filter((section) => section.category === "platters") };
}

function storageFor(checklist: KitchenChecklist, previous: Array<{
  id: string; source_record_id: string; quantity: number; pan_size: string; dispatch_status: string;
}> = []) {
  return {
    listContractFoodRequests: vi.fn().mockResolvedValue(previous),
    listMappings: vi.fn().mockResolvedValue(checklist.sections.flatMap((section) => section.rows).map((row) => ({
      id: row.key, canonical_product_key: row.key, display_name: row.foodName, aliases: [],
      pan_size: row.panSize === "1/3" ? "THIRD_PAN" : row.panSize === "1/2" ? "HALF_PAN" : "TRAY",
      preparation_station: "HOT_LINE", gotab_product_uuid: `test-${row.key}`,
      mapping_status: "VERIFIED", verified_at: "2026-10-22T12:00:00Z",
    }))),
    saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
    enqueueRequest: vi.fn().mockResolvedValue({ request_id: "test-request", duplicate: false }),
  };
}

describe("contract sync across prep-rule revisions", () => {
  it.each(["SCHEDULED", "QUEUED_FOR_KITCHEN", "SENT", "CONFIRMED", "FAILED", "CANCELLED"])(
    "does not queue an already ordered contract item again: %s", async (dispatch_status) => {
      const checklist = contract("Veggie Tray");
      const storage = storageFor(checklist, [{
        id: "legacy-hash-version-request", source_record_id: "platter-veggie-tray",
        quantity: 1, pan_size: "TRAY", dispatch_status,
      }]);
      const result = await synchronizeKitchenChecklistToEventFood(checklist, { sourceVersion: 987654321, storage, env });
      expect(storage.listContractFoodRequests).toHaveBeenCalledWith("contract-123");
      expect(result).toMatchObject({ requestCount: 0, duplicateCount: 1, exceptionCount: 0 });
      expect(storage.enqueueRequest).not.toHaveBeenCalled();
    },
  );

  it("reports changed pan calculations without sending a second full order", async () => {
    const checklist = contract();
    expect(checklist.sections[0].rows[0]).toMatchObject({ numberOfPans: 4, panSize: "1/3" });
    const storage = storageFor(checklist, [{
      id: "legacy-request", source_record_id: "platter-wings", quantity: 1, pan_size: "THIRD_PAN", dispatch_status: "SCHEDULED",
    }]);
    const result = await synchronizeKitchenChecklistToEventFood(checklist, { sourceVersion: 987654321, storage, env });
    expect(result).toMatchObject({ requestCount: 0, duplicateCount: 1, exceptionCount: 1 });
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
    expect(storage.saveProjectionExceptions).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersion: 1,
      exceptions: [expect.objectContaining({ itemKey: "platter-wings", reason: expect.stringContaining("Review the existing order") })],
    }));
  });

  it("queues genuinely new contract items with a stable identity and no live add-on replay", async () => {
    const checklist = contract();
    checklist.liveFoodAddOns = [{
      itemKey: "addon:wings", foodName: "Wings", description: "Previously submitted add-on", quantity: 64,
      unit: "each", numberOfPans: 4, panSize: "1/3", sourceUpdatedAt: null,
    }];
    const storage = storageFor(checklist);
    const result = await synchronizeKitchenChecklistToEventFood(checklist, { sourceVersion: 987654321, storage, env });
    expect(result).toMatchObject({ requestCount: 1, exceptionCount: 0 });
    expect(storage.enqueueRequest).toHaveBeenCalledOnce();
    expect(storage.enqueueRequest).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "TRIPLESEAT_CONTRACT", sourceRecordId: "platter-wings", sourceVersion: 1, quantity: 4,
    }), expect.anything(), "SYSTEM");
  });

  it("uses the same database idempotency key during concurrent differing calculation revisions", async () => {
    const checklist = contract();
    const storage = storageFor(checklist);
    const seen = new Set<string>();
    storage.enqueueRequest.mockImplementation(async (request) => {
      const duplicate = seen.has(request.idempotencyKey);
      seen.add(request.idempotencyKey);
      return { request_id: "test-request", duplicate };
    });
    const results = await Promise.all([111, 222].map((sourceVersion) =>
      synchronizeKitchenChecklistToEventFood(checklist, { sourceVersion, storage, env })));
    expect(seen.size).toBe(1);
    expect(results.reduce((sum, result) => sum + result.duplicateCount, 0)).toBe(1);
  });

  it("fails closed if order history cannot be checked", async () => {
    const checklist = contract();
    const storage = storageFor(checklist);
    storage.listContractFoodRequests.mockRejectedValue(new Error("History unavailable"));
    await expect(synchronizeKitchenChecklistToEventFood(checklist, { sourceVersion: 111, storage, env }))
      .rejects.toThrow("History unavailable");
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
  });
});
