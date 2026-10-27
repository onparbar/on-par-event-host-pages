import { describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipInitialFoodSnapshot } from "@/lib/vip-checkin/release-snapshot";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";

vi.mock("server-only", () => ({}));
const { synchronizeVipBookingFoodToEventFood } = await import("../sync-event-food");
const reservation = vipPrepPayload.reservations[0];
const env = { GOTAB_API_ACCESS_ID: "test-id", GOTAB_API_ACCESS_SECRET: "test-secret", GOTAB_LOCATION_UUID: "test-location",
  GOTAB_EVENT_SPOT_UUID: "test-spot", GOTAB_EVENT_CUSTOMER_PHONE: "+15555550100", GOTAB_WEBHOOK_SECRET: "test-webhook",
  EVENT_KDS_ENABLED: "false", EVENT_KDS_DRY_RUN: "true", EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60" };

function sourceStorage() {
  const queued = new Map<string, { id: string; source_record_id: string; quantity: number; pan_size: string; dispatch_status: string }>();
  const storage = {
    listVipBookingFoodRequests: vi.fn(async () => [...queued.values()]),
    listMappings: vi.fn().mockResolvedValue(["THIRD_PAN", "HALF_PAN"].map((pan_size) => ({ id: `test-${pan_size}`,
      canonical_product_key: "platter-wings", display_name: "Wings", aliases: [], pan_size, preparation_station: "HOT_LINE",
      gotab_product_uuid: "test-product", mapping_status: "VERIFIED", verified_at: "2026-08-11T12:00:00Z" }))),
    saveProjectionExceptions: vi.fn(), performAdministrativeAction: vi.fn(), listContractFoodRequests: vi.fn(),
    enqueueRequest: vi.fn(async (request, _preview, _actor) => {
      const prior = queued.get(request.sourceRecordId);
      const id = prior?.id ?? `request-${request.sourceRecordId}`;
      queued.set(request.sourceRecordId, { id, source_record_id: request.sourceRecordId, quantity: request.quantity,
        pan_size: request.panSize, dispatch_status: "SCHEDULED" });
      return { request_id: id, duplicate: Boolean(prior) };
    }),
  };
  return { storage, queued };
}

describe("VIP initial food projection evidence", () => {
  it("preserves purchased platter quantities, schedules prep, and snapshots the actual check-in employee", async () => {
    const { storage } = sourceStorage();
    const releaseSnapshot = vipInitialFoodSnapshot(reservation, { employee_name: "Lex", checked_in_at: "2026-08-15T20:00:00Z" });
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const result = await synchronizeVipBookingFoodToEventFood(checklist, { storage: storage as never, env, releaseSnapshot });
    expect(result).toMatchObject({ requestCount: 1, exceptionCount: 0, requestIds: ["request-platter-wings"] });
    const [request, payload, actor] = storage.enqueueRequest.mock.calls[0];
    expect(request).toMatchObject({ quantity: 2, sourceRecordId: "platter-wings", sourceVersion: 1 });
    expect(payload).toHaveProperty("vipReleaseSnapshot", releaseSnapshot);
    expect(actor).toBe("VIP_CHECK_IN:Lex"); expect(storage.enqueueRequest.mock.calls[0]).toHaveLength(3);
    expect(JSON.stringify([request, payload])).not.toMatch(/unitPriceCents|totalCents/);
  });

  it("exposes unknown source codes and exact labels instead of guessing a known item from the label", async () => {
    const { storage } = sourceStorage();
    const unknown = { code: "unverified:code", label: "Chicken Tender Platter", quantity: 1, unitPriceCents: 12000, totalCents: 12000 };
    const current = { ...reservation, foodPrep: [unknown] };
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([current])[0]);
    const result = await synchronizeVipBookingFoodToEventFood(checklist, { storage: storage as never, env,
      releaseSnapshot: vipInitialFoodSnapshot(current, { employee_name: "Tina", checked_in_at: "2026-08-15T20:00:00Z" }) });
    expect(result.requestCount).toBe(0); expect(result.exceptionCount).toBe(1);
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
    expect(storage.saveProjectionExceptions).toHaveBeenCalledWith(expect.objectContaining({ exceptions: [expect.objectContaining({
      foodName: "Chicken Tender Platter", reason: expect.stringContaining("no verified kitchen mapping"),
    })] }));
  });

  it("two concurrent first-arrival projections share the existing immutable request identity", async () => {
    const { storage, queued } = sourceStorage();
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const releaseSnapshot = vipInitialFoodSnapshot(reservation, { employee_name: "Tina", checked_in_at: "2026-08-15T20:00:00Z" });
    const results = await Promise.all([1, 2].map(() => synchronizeVipBookingFoodToEventFood(checklist, { storage: storage as never, env, releaseSnapshot })));
    expect(queued.size).toBe(1);
    expect(results[0].requestIds).toEqual(results[1].requestIds);
    expect(storage.enqueueRequest.mock.calls.every(([request]) => request.sourceVersion === 1)).toBe(true);
  });
});
