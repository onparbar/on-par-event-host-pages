import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

async function processGoTabDispatches(
  options: Parameters<typeof import("../worker").processGoTabDispatches>[0],
) {
  const worker = await import("../worker");
  return worker.processGoTabDispatches(options);
}

function environment(overrides: Record<string, string> = {}) {
  return {
    GOTAB_API_ACCESS_ID: "access-id",
    GOTAB_API_ACCESS_SECRET: "access-secret",
    GOTAB_LOCATION_UUID: "location-uuid",
    GOTAB_EVENT_SPOT_UUID: "spot-uuid",
    GOTAB_EVENT_CUSTOMER_PHONE: "+19377056024",
    GOTAB_WEBHOOK_SECRET: "webhook-secret",
    EVENT_KDS_ENABLED: "false",
    EVENT_KDS_DRY_RUN: "true",
    EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
    ...overrides,
  };
}

describe("GoTab dispatch worker", () => {
  it("completes due requests as dry-run without a GoTab write", async () => {
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "dispatch-1",
        request_id: "request-1",
        idempotency_key: "event:REFILL:refill:1:DISPATCH",
        action: "DISPATCH",
        status: "SENDING",
        attempt_count: 1,
        sanitized_payload: { product: "Salsa" },
      }]),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "event-1", source_record_id: "refill:1", food_service_time: "2026-09-23T18:00:00Z",
      }),
    };

    const result = await processGoTabDispatches({
      storage: storage as never,
      workerId: "test-worker",
      env: environment(),
    });

    expect(result).toEqual({
      claimed: 1,
      dryRunCompleted: 1,
      held: 0,
      liveDispatchBlocked: 0,
      sent: 0,
      failed: 0,
      lastError: null,
    });
    expect(storage.finishDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "DRY_RUN" }),
    );
  });

  it("sends a documented payment-free catalog order only when live dispatch is enabled", async () => {
    const createEventFoodTab = vi.fn().mockResolvedValue({
      tabUuid: "tab-1",
      orderUuid: "order-1",
      itemUuid: "item-1",
    });
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "dispatch-2",
        request_id: "request-2",
        idempotency_key: "event:VIP_ADDON:vip:1:DISPATCH",
        action: "DISPATCH",
        status: "SENDING",
        attempt_count: 1,
        sanitized_payload: {
          ticketName: "[VIP FOOD] OPE KDS Integration Test",
          product: "Wings",
          gotabProductUuid: "prd_wings",
          quantity: 2,
          requesterName: "Ryan",
          selectedPanSize: "1/2",
        },
      }]),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "event-2", source_record_id: "addon:1", food_service_time: "2026-09-23T18:00:00Z",
      }),
    };

    const result = await processGoTabDispatches({
      storage: storage as never,
      workerId: "test-worker",
      env: environment({
        EVENT_KDS_ENABLED: "true",
        EVENT_KDS_DRY_RUN: "false",
      }),
      client: {
        createEventFoodTab,
      },
    });

    expect(result.sent).toBe(1);
    expect(storage.finishDispatch).toHaveBeenCalledWith(
      "dispatch-2",
      expect.objectContaining({
        status: "SENT",
        orderUuid: "order-1",
      }),
    );
    expect(createEventFoodTab).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 2,
      serverName: "Ryan",
      selectedPanSize: "1/2",
    }));
  });

  it("holds a VIP order without check-in even when live dispatch is enabled", async () => {
    const createEventFoodTab = vi.fn();
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "vip-dispatch-1",
        request_id: "vip-request-1",
        idempotency_key: "vip-1:VIP_ADDON:wings:1:DISPATCH",
        action: "DISPATCH",
        status: "SENDING",
        attempt_count: 1,
        sanitized_payload: {
          ticketName: "VIP Party",
          product: "Wings",
          gotabProductUuid: "prd_wings",
          quantity: 1,
        },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "vip-1", source_record_id: "platter-wings", food_service_time: "2026-09-23T18:00:00Z",
      }),
      getVipCheckin: vi.fn().mockResolvedValue(null),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processGoTabDispatches({
      storage: storage as never,
      env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
      client: { createEventFoodTab },
    });

    expect(result.held).toBe(1);
    expect(storage.finishDispatch).toHaveBeenCalledWith("vip-dispatch-1", {
      status: "HELD", lastError: "VIP check-in required.",
    });
    expect(createEventFoodTab).not.toHaveBeenCalled();
  });

  it("holds food for a VIP reservation that was cancelled after check-in", async () => {
    const createEventFoodTab = vi.fn();
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "vip-dispatch-2",
        request_id: "vip-request-2",
        idempotency_key: "vip-2:VIP_ADDON:wings:1:DISPATCH",
        action: "DISPATCH",
        status: "SENDING",
        attempt_count: 1,
        sanitized_payload: {
          ticketName: "VIP Party",
          product: "Wings",
          gotabProductUuid: "prd_wings",
          quantity: 1,
        },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "vip-2", source_record_id: "platter-wings", food_service_time: "2026-09-23T18:00:00Z",
      }),
      getVipCheckin: vi.fn().mockResolvedValue({ reservation_id: "2", booking_date: "2026-09-23" }),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({ status: "PENDING" }),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const result = await processGoTabDispatches({
      storage: storage as never,
      env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
      client: { createEventFoodTab },
      vipPrepClient: {
        configured: true,
        fetchRange: vi.fn().mockResolvedValue({ reservations: [] }),
      },
    });
    expect(result.held).toBe(1);
    expect(createEventFoodTab).not.toHaveBeenCalled();
    expect(storage.finishDispatch).toHaveBeenCalledWith("vip-dispatch-2", {
      status: "HELD", lastError: "VIP reservation is cancelled or no longer active.",
    });
  });

  it("sends a checked-in VIP's food to GoTab with its saved ticket details", async () => {
    const createEventFoodTab = vi.fn().mockResolvedValue({
      tabUuid: "vip-tab", orderUuid: "vip-order", itemUuid: "vip-item",
    });
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "vip-dispatch-3",
        request_id: "vip-request-3",
        idempotency_key: "vip-3:VIP_ADDON:wings:1:DISPATCH",
        action: "DISPATCH",
        status: "SENDING",
        attempt_count: 1,
        sanitized_payload: {
          eventName: "Redacted VIP",
          product: "Wings",
          gotabProductUuid: "prd_wings",
          quantity: 2,
          eventArea: "VIP 2",
          notes: "Reservation time: 6:00 PM",
        },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "vip-3", source_record_id: "platter-wings", food_service_time: "2026-09-23T18:00:00Z",
      }),
      getVipCheckin: vi.fn().mockResolvedValue({ reservation_id: "3", booking_date: "2026-09-23" }),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({ status: "PENDING" }),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const result = await processGoTabDispatches({
      storage: storage as never,
      env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
      client: { createEventFoodTab },
      vipPrepClient: {
        configured: true,
        fetchRange: vi.fn().mockResolvedValue({ reservations: [{ id: "3" }] }),
      },
    });
    expect(result.sent).toBe(1);
    expect(createEventFoodTab).toHaveBeenCalledWith(expect.objectContaining({
      ticketName: "Redacted VIP",
      quantity: 2,
      itemNotes: expect.objectContaining({
        eventArea: "VIP 2", notes: "Reservation time: 6:00 PM",
      }),
    }));
    expect(storage.finishDispatch).toHaveBeenCalledWith("vip-dispatch-3", expect.objectContaining({
      status: "SENT", orderUuid: "vip-order",
    }));
  });
});
