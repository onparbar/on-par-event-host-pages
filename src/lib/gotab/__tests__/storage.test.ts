import { describe, expect, it, vi } from "vitest";
import { GoTabIntegrationStorage } from "../storage";

vi.mock("server-only", () => ({}));

describe("GoTab kitchen staff lookup", () => {
  it.each([
    { rows: [{ food_runners: [" ", " Carlos ", "Brooke"] }], expected: "Carlos" },
    { rows: [{ food_runners: [] }], expected: null },
    { rows: [{ food_runners: null }], expected: null },
    { rows: [{ food_runners: null, bwa: " Carlos " }], expected: "Carlos" },
    { rows: [{ food_runners: ["Brooke"], bwa: "Carlos" }], expected: "Brooke" },
    { rows: [{ food_runners: [], bwa: '__kitchen_roles__:{"preppedBy":"Carlos"}' }], expected: null },
    { rows: [], expected: null },
  ])("reads only the selected event's current Food Runner: $expected", async ({ rows, expected }) => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(rows));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    expect(await storage.getKitchenFoodRunner("vip-reservation-1")).toBe(expected);
    const [url, init] = fetchImpl.mock.calls[0];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/rest/v1/kitchen_manual_assignments");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      select: "bwa,food_runners", event_id: "eq.vip-reservation-1", limit: "1",
    });
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("does not treat a failed staff lookup as an unassigned event", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    await expect(storage.getKitchenFoodRunner("event-1")).rejects.toThrow("database request failed (503)");
  });
});

describe("scoped food-order delivery", () => {
  it("reads only submitted requests and resolves their latest dispatch result", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json([{ id: "request-1", event_id: "event-1", source_record_id: "addon:wings", display_name: "Wings", quantity: 1, pan_size: "HALF_PAN", dispatch_status: "QUEUED_FOR_KITCHEN" }]))
      .mockResolvedValueOnce(Response.json([{ request_id: "request-1", status: "SENT", gotab_order_uuid: "order-1", sent_at: "2026-10-21T17:00:00Z", last_error: null, updated_at: "2026-10-21T17:00:00Z" }]));
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    expect(await storage.listEventFoodDelivery(["event-1"], ["request-1"])).toMatchObject([{ requestId: "request-1", status: "SENT", orderReference: "order-1" }]);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("event_id")).toBe("in.(event-1)");
    expect(url.searchParams.get("id")).toBe("in.(request-1)");
  });
  it("does not issue an unscoped query for empty or invalid event IDs", async () => {
    const fetchImpl = vi.fn();
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    expect(await storage.listEventFoodDelivery([])).toEqual([]);
    await expect(storage.listEventFoodDelivery(["event),or(true)"])).rejects.toThrow("Invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
