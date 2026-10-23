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

describe("contract food history", () => {
  it("reads only the selected event's contract rows across all rule versions without writing", async () => {
    const contract = {
      id: "legacy-contract-request", source_record_id: "platter-wings",
      quantity: 1, pan_size: "THIRD_PAN", dispatch_status: "SENT_TO_GOTAB",
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([
      contract,
      { ...contract, id: "legacy-misclassified-add-on", source_record_id: "addon:wings" },
    ]));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    expect(await storage.listContractFoodRequests("event-123")).toEqual([contract]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/rest/v1/event_food_requests");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      select: "id,source_record_id,quantity,pan_size,dispatch_status",
      event_id: "eq.event-123", source_type: "eq.TRIPLESEAT_CONTRACT", limit: "1000",
    });
    expect(requestUrl.searchParams.has("source_version")).toBe(false);
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    expect(init.body).toBeUndefined();
  });

  it("does not treat failed contract-history reads as an event with no prior food orders", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    await expect(storage.listContractFoodRequests("event-123")).rejects.toThrow("database request failed (503)");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed if contract history may be truncated by the database row limit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(Array.from({ length: 1000 }, (_, index) => ({
      id: `request-${index}`, source_record_id: "platter-wings",
      quantity: 1, pan_size: "THIRD_PAN", dispatch_status: "SENT_TO_GOTAB",
    }))));
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    await expect(storage.listContractFoodRequests("event-123")).rejects.toThrow("too large to verify completely");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("contract food dispatch guard", () => {
  it("allows only the earliest request when legacy rule versions queued the same item twice", async () => {
    const requests = [
      { id: "request-first", created_at: "2026-10-21T19:10:09Z" },
      { id: "request-second", created_at: "2026-10-22T14:04:50Z" },
    ];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(requests))
      .mockResolvedValueOnce(Response.json([
        { request_id: "request-first", status: "SCHEDULED" },
        { request_id: "request-second", status: "SENDING" },
      ]));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    await expect(storage.getContractFoodDispatchDecision({
      requestId: "request-second", eventId: "event-123", sourceRecordId: "taco-beef",
    })).resolves.toEqual({ allowed: false, reason: "EARLIER_REQUEST_EXISTS" });
    const requestUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      select: "id,created_at", event_id: "eq.event-123",
      source_type: "eq.TRIPLESEAT_CONTRACT", source_record_id: "eq.taco-beef",
      order: "created_at.asc,id.asc", limit: "1000",
    });
  });

  it("blocks every unsent duplicate after any sibling request was accepted by GoTab", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json([
        { id: "request-first", created_at: "2026-10-21T19:10:09Z" },
        { id: "request-second", created_at: "2026-10-22T14:04:50Z" },
      ]))
      .mockResolvedValueOnce(Response.json([
        { request_id: "request-first", status: "SENT" },
        { request_id: "request-second", status: "SENDING" },
      ]));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    await expect(storage.getContractFoodDispatchDecision({
      requestId: "request-second", eventId: "event-123", sourceRecordId: "taco-beef",
    })).resolves.toEqual({ allowed: false, reason: "ALREADY_SENT" });
  });

  it("fails closed when the claimed request is missing from its logical history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json([
      { id: "different-request", created_at: "2026-10-21T19:10:09Z" },
    ]));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    await expect(storage.getContractFoodDispatchDecision({
      requestId: "missing-request", eventId: "event-123", sourceRecordId: "taco-beef",
    })).rejects.toThrow("could not be verified");
  });
});
