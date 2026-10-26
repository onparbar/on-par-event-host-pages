import { describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipInitialFoodSnapshot } from "@/lib/vip-checkin/release-snapshot";
import { vipPrepKitchenEvents, type VipPrepReservation } from "@/lib/vip-prep/client";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { zonedDateTimeToIso } from "@/lib/entertainment/time";

vi.mock("server-only", () => ({}));
const { processGoTabDispatches } = await import("../worker");

const reservation: VipPrepReservation = { ...vipPrepPayload.reservations[0], id: "sanitized-booking" };
const checkin = { reservation_id: reservation.id, booking_date: reservation.operatingDate,
  employee_name: "Tina", checked_in_at: "2026-08-15T20:00:00Z" };
const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
const ready = checklist.timing.foodReadyBy!.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/)!;
const serviceAt = zonedDateTimeToIso(ready[1], Number(ready[2]), Number(ready[3]));
const environment = {
  GOTAB_API_ACCESS_ID: "test-id", GOTAB_API_ACCESS_SECRET: "test-secret", GOTAB_LOCATION_UUID: "test-location",
  GOTAB_EVENT_SPOT_UUID: "test-spot", GOTAB_EVENT_CUSTOMER_PHONE: "+15555550100", GOTAB_WEBHOOK_SECRET: "test-webhook",
  EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false", EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
};

function setup(current: VipPrepReservation = reservation, snapshot: unknown = vipInitialFoodSnapshot(reservation, checkin)) {
  const dispatch = { id: "dispatch-test", request_id: "request-test", idempotency_key: "vip:test:DISPATCH",
    action: "DISPATCH", status: "SENDING", attempt_count: 1,
    sanitized_payload: { eventName: "Redacted VIP", product: "Wings", gotabProductUuid: "test-product",
      quantity: 2, eventArea: "VIP 2", ...(snapshot === undefined ? {} : { vipReleaseSnapshot: snapshot }) },
  };
  const storage = {
    claimDueDispatches: vi.fn().mockResolvedValue([dispatch]),
    getDispatchRequestContext: vi.fn().mockResolvedValue({ event_id: `vip-${reservation.id}`,
      source_record_id: "platter-wings", source_type: "VIP_ADDON", food_service_time: serviceAt }),
    getVipCheckin: vi.fn().mockResolvedValue(checkin),
    getVipInitialFoodRelease: vi.fn().mockResolvedValue({ status: "PENDING", expected_item_count: 1 }),
    listVipBookingFoodRequests: vi.fn().mockResolvedValue([{ id: "request-test", source_record_id: "platter-wings", quantity: 2 }]),
    listVipInitialFoodDispatches: vi.fn().mockResolvedValue([]),
    getKitchenFoodRunner: vi.fn().mockResolvedValue("Lex"),
    saveVipDispatchReleaseSnapshot: vi.fn().mockResolvedValue(true),
    finishDispatch: vi.fn().mockResolvedValue(undefined),
  };
  const createEventFoodTab = vi.fn().mockResolvedValue({ tabUuid: "tab-test", orderUuid: "order-test", itemUuid: "item-test" });
  const vipPrepClient = { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [current] }) };
  return { dispatch, storage, createEventFoodTab, vipPrepClient,
    run: () => processGoTabDispatches({ storage: storage as never, client: { createEventFoodTab }, vipPrepClient, env: environment,
      workerId: "test-worker", requestIds: ["request-test"] }),
  };
}

describe("VIP dispatch revalidation under the existing claim", () => {
  it("revalidates the exact active preorder and its saved employee before recording GoTab acceptance", async () => {
    const test = setup();
    expect(await test.run()).toMatchObject({ sent: 1, held: 0 });
    expect(test.vipPrepClient.fetchRange).toHaveBeenCalledExactlyOnceWith(reservation.operatingDate, reservation.operatingDate);
    expect(test.createEventFoodTab).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, ticketName: "Redacted VIP", serverName: "Lex" }));
    expect(test.storage.finishDispatch).toHaveBeenCalledWith("dispatch-test", expect.objectContaining({ status: "SENT", orderUuid: "order-test" }));
  });

  it("does not treat the source booking's checked_in flag as Event Host staff authority", async () => {
    const test = setup({ ...reservation, status: "checked_in" });
    test.storage.getVipCheckin.mockResolvedValue(null);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
    expect(test.storage.finishDispatch).toHaveBeenCalledWith("dispatch-test", { status: "HELD", lastError: "VIP check-in required." });
  });

  it.each([
    { label: "purchased quantity", current: { ...reservation, foodPrep: [{ ...reservation.foodPrep[0], quantity: 3 }] } },
    { label: "reserved area", current: { ...reservation, resource: { code: "VIPS" as const, name: "VIP 1" } } },
    { label: "exact start time", current: { ...reservation, startAt: "2026-08-15T22:30:00Z" } },
    { label: "operating date", current: { ...reservation, operatingDate: "2026-08-16" } },
    { label: "cancelled status", current: { ...reservation, status: "cancelled" as const } },
  ])("holds source amendments to $label without resending or charging", async ({ current }) => {
    const test = setup(current);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
    expect(test.storage.finishDispatch).toHaveBeenCalledWith("dispatch-test", expect.objectContaining({ status: "HELD" }));
  });

  it("allows refresh timestamp changes alone without replaying or changing the purchased food", async () => {
    const test = setup({ ...reservation, updatedAt: "2026-08-15T21:00:00Z" });
    expect(await test.run()).toMatchObject({ sent: 1, held: 0 });
    expect(test.createEventFoodTab).toHaveBeenCalledOnce();
  });

  it("safely seals a matching legacy initial request under its sending claim", async () => {
    const test = setup();
    delete (test.dispatch.sanitized_payload as Record<string, unknown>).vipReleaseSnapshot;
    expect(await test.run()).toMatchObject({ sent: 1, held: 0 });
    expect(test.storage.saveVipDispatchReleaseSnapshot).toHaveBeenCalledWith("dispatch-test", test.dispatch.sanitized_payload,
      expect.objectContaining({ sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), checkedInBy: "Tina", checkedInAt: checkin.checked_in_at }));
  });

  it("does not release a mismatched legacy request without a source revision snapshot", async () => {
    const test = setup();
    delete (test.dispatch.sanitized_payload as Record<string, unknown>).vipReleaseSnapshot;
    test.dispatch.sanitized_payload.eventArea = "VIP 1";
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.storage.saveVipDispatchReleaseSnapshot).not.toHaveBeenCalled();
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
  });

  it("does not send if immutable release evidence could not be saved under the claim", async () => {
    const test = setup();
    delete (test.dispatch.sanitized_payload as Record<string, unknown>).vipReleaseSnapshot;
    test.storage.saveVipDispatchReleaseSnapshot.mockResolvedValue(false);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [{ id: "request-test", source_record_id: "platter-wings", quantity: 1 }],
    [{ id: "request-test", source_record_id: "platter-wings", quantity: 2 }, { id: "duplicate-version", source_record_id: "platter-wings", quantity: 2 }],
    [{ id: "request-test", source_record_id: "platter-wings", quantity: 2 }, { id: "removed-item", source_record_id: "platter-fries", quantity: 1 }],
  ])("holds snapshotless legacy food when its complete saved item set cannot be verified", async (...previous) => {
    const test = setup();
    delete (test.dispatch.sanitized_payload as Record<string, unknown>).vipReleaseSnapshot;
    test.storage.listVipBookingFoodRequests.mockResolvedValue(previous);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
    expect(test.storage.saveVipDispatchReleaseSnapshot).not.toHaveBeenCalled();
  });

  it("does not seal unchanged legacy wings while a different purchased item was added", async () => {
    const test = setup({ ...reservation, foodPrep: [...reservation.foodPrep,
      { code: "fry-platters", label: "Fry Platter", quantity: 1, unitPriceCents: 12000, totalCents: 12000 }] });
    delete (test.dispatch.sanitized_payload as Record<string, unknown>).vipReleaseSnapshot;
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
  });

  it("still gates a VIP add-on on its Event Host check-in without comparing it to the prepaid initial quantity", async () => {
    const test = setup();
    test.storage.getDispatchRequestContext.mockResolvedValue({ event_id: `vip-${reservation.id}`, source_type: "VIP_ADDON",
      source_record_id: "addon:wings", food_service_time: serviceAt });
    test.dispatch.sanitized_payload.quantity = 1;
    expect(await test.run()).toMatchObject({ sent: 1, held: 0 });
    expect(test.createEventFoodTab).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });

  it("concurrent scoped workers honor the existing single-claim boundary for the same VIP request", async () => {
    const test = setup();
    let claimed = false;
    test.storage.claimDueDispatches.mockImplementation(async () => {
      if (claimed) return [];
      claimed = true; return [test.dispatch];
    });
    const results = await Promise.all([test.run(), test.run()]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(test.createEventFoodTab).toHaveBeenCalledOnce();
  });

  it("holds a second initial source revision instead of treating amended food as a new eligible order", async () => {
    const test = setup();
    test.storage.listVipInitialFoodDispatches.mockResolvedValue([{ source_fingerprint: "a".repeat(64) }]);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).not.toHaveBeenCalled();
    expect(test.storage.finishDispatch).toHaveBeenCalledWith("dispatch-test", expect.objectContaining({ status: "HELD",
      lastError: expect.stringContaining("different preorder revisions") }));
  });

  it("retains accepted GoTab identifiers and uncertainty if saving SENT fails, without retrying the order", async () => {
    const test = setup();
    test.storage.finishDispatch.mockRejectedValueOnce(new Error("Database write unavailable")).mockResolvedValue(undefined);
    expect(await test.run()).toMatchObject({ sent: 0, held: 1 });
    expect(test.createEventFoodTab).toHaveBeenCalledOnce();
    expect(test.storage.finishDispatch).toHaveBeenLastCalledWith("dispatch-test", expect.objectContaining({ status: "HELD",
      tabUuid: "tab-test", orderUuid: "order-test", itemUuid: "item-test",
      lastError: expect.stringContaining("Delivery status is uncertain"),
      sanitizedResponse: { accepted: true, finalStatusSaveFailed: true } }));
    expect(test.storage.finishDispatch.mock.lastCall?.[1]).not.toHaveProperty("nextAttemptAt");
  });
});
