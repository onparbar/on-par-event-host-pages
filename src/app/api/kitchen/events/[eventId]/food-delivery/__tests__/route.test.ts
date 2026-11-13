import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import type { EventFoodDelivery } from "@/lib/gotab/delivery";

const mocks = vi.hoisted(() => ({ listEventFoodDelivery: vi.fn() }));
vi.mock("@/lib/gotab/storage", () => ({ GoTabIntegrationStorage: class { listEventFoodDelivery = mocks.listEventFoodDelivery; } }));
afterEach(() => vi.resetAllMocks());
const order: EventFoodDelivery = { requestId: "request-1", eventId: "123", sourceKey: "addon:tater-kegs", foodName: "Tater kegs", quantity: 1, panSize: "HALF_PAN", status: "QUEUED", orderReference: null, acceptedAt: null, updatedAt: "2026-10-23T17:00:00Z", error: null };
function read(query = "requestIds=request-1", eventId = "123") {
  return GET(new Request(`https://example.test/api/kitchen/events/${encodeURIComponent(eventId)}/food-delivery?${query}`), { params: Promise.resolve({ eventId }) });
}
describe("read-only food-order delivery polling", () => {
  it("reads only the exact event and submitted IDs without invoking a worker or kitchen sync", async () => {
    mocks.listEventFoodDelivery.mockResolvedValue([order]);
    const response = await read("requestIds=request-1,request-1");
    expect(mocks.listEventFoodDelivery).toHaveBeenCalledExactlyOnceWith(["123"], ["request-1"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ status: "pending", requestIds: ["request-1"], error: null });
  });
  it("observes acceptance without resubmitting", async () => {
    mocks.listEventFoodDelivery.mockResolvedValueOnce([order]).mockResolvedValueOnce([{ ...order, status: "SENT", orderReference: "order-1" }]);
    expect((await (await read()).json()).status).toBe("pending");
    expect((await (await read()).json()).status).toBe("live");
    expect(mocks.listEventFoodDelivery).toHaveBeenCalledTimes(2);
  });
  it("keeps missing, held, and wrong-event evidence out of accepted results", async () => {
    mocks.listEventFoodDelivery.mockResolvedValue([{ ...order, eventId: "other" }]);
    const missing = await (await read()).json();
    expect(missing).toMatchObject({ status: "error", deliveries: [], accepted: 0 });
    mocks.listEventFoodDelivery.mockResolvedValue([{ ...order, status: "HELD" }]);
    expect((await (await read()).json()).status).toBe("error");
  });
  it.each(["requestIds=", "requestIds=unsafe%27", `requestIds=${Array.from({ length: 101 }, (_, index) => `request-${index}`).join(",")}`])("rejects invalid request scope %s before storage", async (query) => {
    expect((await read(query)).status).toBe(400);
    expect(mocks.listEventFoodDelivery).not.toHaveBeenCalled();
  });
  it("rejects invalid event scope before storage", async () => {
    expect((await read("", "event/unsafe")).status).toBe(400);
    expect(mocks.listEventFoodDelivery).not.toHaveBeenCalled();
  });
  it("can read event history without treating an empty history as sent", async () => {
    mocks.listEventFoodDelivery.mockResolvedValue([]);
    expect((await (await read("")).json()).status).toBe("not-required");
    expect(mocks.listEventFoodDelivery).toHaveBeenCalledExactlyOnceWith(["123"], undefined);
  });
  it("returns a safe error when the read fails", async () => {
    mocks.listEventFoodDelivery.mockRejectedValue(new Error("private database diagnostic"));
    const response = await read();
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private database diagnostic");
  });
});
