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
    });
    expect(storage.finishDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "DRY_RUN" }),
    );
  });

  it("sends a documented payment-free catalog order only when live dispatch is enabled", async () => {
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
        },
      }]),
      finishDispatch: vi.fn().mockResolvedValue(undefined),
    };

    const result = await processGoTabDispatches({
      storage: storage as never,
      workerId: "test-worker",
      env: environment({
        EVENT_KDS_ENABLED: "true",
        EVENT_KDS_DRY_RUN: "false",
      }),
      client: {
        createEventFoodTab: vi.fn().mockResolvedValue({
          tabUuid: "tab-1",
          orderUuid: "order-1",
          itemUuid: "item-1",
        }),
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
  });
});
