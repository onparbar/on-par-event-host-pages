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
  it("processes only the newly submitted refill even with more than 25 older due orders", async () => {
    const fresh = {
      id: "fresh-dispatch", request_id: "fresh-request", idempotency_key: "event:REFILL:wings:1:DISPATCH",
      action: "DISPATCH", status: "SENDING", attempt_count: 1,
      sanitized_payload: { eventName: "Training event", product: "Wings", gotabProductUuid: "prd_wings", quantity: 1 },
    };
    const backlog = Array.from({ length: 30 }, (_, index) => ({ ...fresh, id: `old-dispatch-${index}`, request_id: `old-request-${index}` }));
    const storage = {
      claimDueDispatches: vi.fn().mockImplementation(async (_workerId, _limit, requestIds) =>
        requestIds ? [fresh].filter((row) => requestIds.includes(row.request_id)) : backlog.slice(0, 25)),
      getDispatchRequestContext: vi.fn().mockResolvedValue({ event_id: "event-1", source_record_id: "addon:wings" }),
      getKitchenFoodRunner: vi.fn().mockResolvedValue(null),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const createEventFoodTab = vi.fn().mockResolvedValue({ tabUuid: "tab-1", orderUuid: "order-1", itemUuid: "item-1" });
    const result = await processGoTabDispatches({
      storage: storage as never, workerId: "staff-worker", requestIds: ["fresh-request"],
      client: { createEventFoodTab }, env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
    });
    expect(storage.claimDueDispatches).toHaveBeenCalledWith("staff-worker", 1, ["fresh-request"]);
    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    expect(createEventFoodTab).toHaveBeenCalledOnce();
    expect(storage.finishDispatch).toHaveBeenCalledWith("fresh-dispatch", expect.objectContaining({ status: "SENT" }));
  });

  it("does not turn an empty immediate request scope into an unscoped cron run", async () => {
    const storage = { claimDueDispatches: vi.fn().mockResolvedValue([]) };
    const result = await processGoTabDispatches({ storage: storage as never, workerId: "staff-worker", requestIds: [], env: environment() });
    expect(storage.claimDueDispatches).toHaveBeenCalledWith("staff-worker", 25, []);
    expect(result.claimed).toBe(0);
  });

  it("holds a duplicate contract item before any GoTab write", async () => {
    const createEventFoodTab = vi.fn();
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "duplicate-dispatch", request_id: "duplicate-request",
        idempotency_key: "event:TRIPLESEAT_CONTRACT:taco-beef:old-version:DISPATCH",
        action: "DISPATCH", status: "SENDING", attempt_count: 1,
        sanitized_payload: {
          eventName: "Redacted Event", product: "Taco Bar Beef",
          gotabProductUuid: "prd_beef", quantity: 1,
        },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "event-123", source_type: "TRIPLESEAT_CONTRACT",
        source_record_id: "taco-beef", food_service_time: "2026-10-23T16:00:00Z",
      }),
      getContractFoodDispatchDecision: vi.fn().mockResolvedValue({
        allowed: false, reason: "ALREADY_SENT",
      }),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processGoTabDispatches({
      storage: storage as never,
      client: { createEventFoodTab },
      env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
    });

    expect(result).toMatchObject({ held: 1, sent: 0, failed: 0 });
    expect(createEventFoodTab).not.toHaveBeenCalled();
    expect(storage.finishDispatch).toHaveBeenCalledWith("duplicate-dispatch", {
      status: "HELD",
      lastError: "Duplicate contract order blocked because this event item was already sent to GoTab.",
    });
  });

  it.each([
    { scenario: "a timeout after possible order acceptance", status: null },
    { scenario: "a server error after possible order acceptance", status: 500 },
  ])("holds a non-VIP order for review after $scenario without scheduling a blind retry", async ({ status }) => {
    const { GoTabApiError } = await import("../client");
    const createEventFoodTab = vi.fn().mockRejectedValue(new GoTabApiError("temporary", "Vendor response unavailable", status));
    const storage = {
      getKitchenFoodRunner: vi.fn().mockResolvedValue(null),
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "uncertain-order", request_id: "uncertain-request", idempotency_key: "event:ADDON:wings:1:DISPATCH",
        action: "DISPATCH", status: "SENDING", attempt_count: 1,
        sanitized_payload: { eventName: "Training event", product: "Wings", gotabProductUuid: "prd_wings", quantity: 1 },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({ event_id: "event-1", source_record_id: "addon:1" }),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const result = await processGoTabDispatches({ storage: storage as never, client: { createEventFoodTab }, env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }) });
    expect(result).toMatchObject({ held: 1, failed: 0, sent: 0 });
    expect(createEventFoodTab).toHaveBeenCalledOnce();
    expect(storage.finishDispatch).toHaveBeenCalledWith("uncertain-order", { status: "HELD", lastError: "Food order delivery status is uncertain. Review before retrying." });
    expect(storage.finishDispatch.mock.calls[0][1]).not.toHaveProperty("nextAttemptAt");
  });

  it("holds a missing Food Runner mapping with its actionable no-order-sent reason", async () => {
    const { GoTabApiError } = await import("../client");
    const lastError = "The selected Kitchen Food Runner could not be uniquely matched to an active GoTab employee. No order was sent. Review the staff assignment.";
    const createEventFoodTab = vi.fn().mockRejectedValue(new GoTabApiError("response", lastError));
    const storage = {
      getKitchenFoodRunner: vi.fn().mockResolvedValue("Unmapped Staff"),
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "mapping-order", request_id: "mapping-request", idempotency_key: "event:ADDON:wings:1:DISPATCH",
        action: "DISPATCH", status: "SENDING", attempt_count: 1,
        sanitized_payload: { eventName: "Training event", product: "Wings", gotabProductUuid: "prd_wings", quantity: 1 },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({ event_id: "event-1", source_record_id: "addon:1" }),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const result = await processGoTabDispatches({ storage: storage as never, client: { createEventFoodTab }, env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }) });
    expect(result).toMatchObject({ held: 1, failed: 0, lastError });
    expect(storage.finishDispatch).toHaveBeenCalledWith("mapping-order", { status: "HELD", lastError });
  });

  it("can safely retry an eligibility read failure before any external order write", async () => {
    const createEventFoodTab = vi.fn();
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{ id: "preflight-order", request_id: "preflight-request", attempt_count: 1 }]),
      getDispatchRequestContext: vi.fn().mockRejectedValue(new Error("Read unavailable")),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };
    const result = await processGoTabDispatches({ storage: storage as never, client: { createEventFoodTab }, env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }) });
    expect(createEventFoodTab).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, held: 0, sent: 0 });
    expect(storage.finishDispatch).toHaveBeenCalledWith("preflight-order", expect.objectContaining({ status: "FAILED", nextAttemptAt: expect.any(String), lastError: "Food dispatch eligibility could not be verified." }));
  });

  it("sends the active synthetic VIP retest but does not require it in the live booking feed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-23T18:15:00Z");
    try {
      const createEventFoodTab = vi.fn().mockResolvedValue({
        tabUuid: "test-tab", orderUuid: "test-order", itemUuid: "test-item",
      });
      const storage = {
        getKitchenFoodRunner: vi.fn().mockResolvedValue("Carlos"),
        claimDueDispatches: vi.fn().mockResolvedValue([{
          id: "test-dispatch",
          request_id: "test-request",
          idempotency_key: "vip-retest:VIP_ADDON:chicken:1:DISPATCH",
          action: "DISPATCH",
          status: "SENDING",
          attempt_count: 1,
          sanitized_payload: {
            eventName: "VIP KDS RETEST — DO NOT PREPARE",
            product: "Chicken Tenders",
            gotabProductUuid: "prd_chicken",
            quantity: 1,
          },
        }]),
        getDispatchRequestContext: vi.fn().mockResolvedValue({
          event_id: "vip-event-host-kds-retest-20260923",
          source_record_id: "platter-chicken-tenders",
          food_service_time: "2026-09-23T17:30:00Z",
        }),
        getVipCheckin: vi.fn().mockResolvedValue({
          reservation_id: "event-host-kds-retest-20260923", booking_date: "2026-09-23",
        }),
        getVipInitialFoodRelease: vi.fn().mockResolvedValue({ status: "PENDING" }),
        finishDispatch: vi.fn().mockResolvedValue(undefined),
      };
      const vipPrepClient = {
        configured: true,
        fetchRange: vi.fn().mockResolvedValue({ reservations: [] }),
      };
      const result = await processGoTabDispatches({
        storage: storage as never,
        env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
        client: { createEventFoodTab },
        vipPrepClient,
      });
      expect(result.sent).toBe(1);
      expect(vipPrepClient.fetchRange).not.toHaveBeenCalled();
      expect(createEventFoodTab).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the superseded synthetic VIP test from reaching GoTab", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-23T18:15:00Z");
    try {
      const createEventFoodTab = vi.fn();
      const storage = {
        claimDueDispatches: vi.fn().mockResolvedValue([{
          id: "old-test-dispatch",
          request_id: "old-test-request",
          idempotency_key: "vip-old-test:VIP_ADDON:chicken:1:DISPATCH",
          action: "DISPATCH",
          status: "SENDING",
          attempt_count: 1,
          sanitized_payload: { eventName: "VIP KDS TEST", product: "Chicken Tenders", gotabProductUuid: "prd_chicken", quantity: 1 },
        }]),
        getDispatchRequestContext: vi.fn().mockResolvedValue({
          event_id: "vip-event-host-kds-test-20260923",
          source_record_id: "platter-chicken-tenders",
          food_service_time: "2026-09-23T17:30:00Z",
        }),
        getVipCheckin: vi.fn().mockResolvedValue({
          reservation_id: "event-host-kds-test-20260923", booking_date: "2026-09-23",
        }),
        getVipInitialFoodRelease: vi.fn().mockResolvedValue({ status: "PENDING" }),
        finishDispatch: vi.fn().mockResolvedValue(undefined),
      };
      const result = await processGoTabDispatches({
        storage: storage as never,
        env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
        client: { createEventFoodTab },
        vipPrepClient: { configured: true, fetchRange: vi.fn().mockResolvedValue({ reservations: [] }) },
      });
      expect(result.held).toBe(1);
      expect(createEventFoodTab).not.toHaveBeenCalled();
      expect(storage.finishDispatch).toHaveBeenCalledWith("old-test-dispatch", {
        status: "HELD", lastError: "VIP reservation is cancelled or no longer active.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it.each(["Carlos", null])("uses the current Food Runner (%s), not the queued staff snapshot", async (foodRunner) => {
    const createEventFoodTab = vi.fn().mockResolvedValue({
      tabUuid: "tab-1",
      orderUuid: "order-1",
      itemUuid: "item-1",
    });
    const storage = {
      getKitchenFoodRunner: vi.fn().mockResolvedValue(foodRunner),
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
      serverName: foodRunner,
      selectedPanSize: "1/2",
    }));
    expect(storage.getKitchenFoodRunner).toHaveBeenCalledWith("event-2");
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

  it("does not send an order with stale staff when the current assignment cannot be read", async () => {
    const createEventFoodTab = vi.fn();
    const storage = {
      claimDueDispatches: vi.fn().mockResolvedValue([{
        id: "staff-unavailable", request_id: "request-staff", idempotency_key: "event:REFILL:staff:1:DISPATCH",
        action: "DISPATCH", status: "SENDING", attempt_count: 1,
        sanitized_payload: {
          eventName: "Redacted Event", product: "Wings", gotabProductUuid: "prd_wings", quantity: 1,
          requesterName: "Old Assignment",
        },
      }]),
      getDispatchRequestContext: vi.fn().mockResolvedValue({
        event_id: "event-staff", source_record_id: "addon:1", food_service_time: "2026-10-20T18:00:00Z",
      }),
      getKitchenFoodRunner: vi.fn().mockRejectedValue(new Error("Kitchen staff lookup failed.")),
      finishDispatch: vi.fn(),
    };
    const result = await processGoTabDispatches({
      storage: storage as never,
      env: environment({ EVENT_KDS_ENABLED: "true", EVENT_KDS_DRY_RUN: "false" }),
      client: { createEventFoodTab },
    });
    expect(result.failed).toBe(1);
    expect(createEventFoodTab).not.toHaveBeenCalled();
    expect(storage.finishDispatch).toHaveBeenCalledWith("staff-unavailable", expect.objectContaining({
      status: "FAILED", nextAttemptAt: expect.any(String),
      lastError: "The current Kitchen Food Runner could not be read. No order was sent.",
    }));
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
      getKitchenFoodRunner: vi.fn().mockResolvedValue("Brooke"),
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
      serverName: "Brooke",
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
