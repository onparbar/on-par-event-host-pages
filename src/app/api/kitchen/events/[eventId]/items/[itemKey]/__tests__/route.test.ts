import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";

const syncMocks = vi.hoisted(() => ({
  updateKitchenItemCompletion: vi.fn(),
  updateKitchenItemPrepped: vi.fn(),
  updateKitchenItemReadiness: vi.fn(),
}));
vi.mock("@/lib/kitchen/sync", () => syncMocks);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function request(body: unknown, origin = "https://example.test") {
  return new Request(
    "https://example.test/api/kitchen/events/preview-alpha/items/taco-beef",
    {
      method: "PATCH",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    },
  );
}

const context = {
  params: Promise.resolve({
    eventId: "preview-alpha",
    itemKey: "taco-beef",
  }),
};

describe("kitchen item state API", () => {
  it("rejects cross-origin changes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await PATCH(
      request({ completed: true }, "https://malicious.example"),
      context,
    );

    expect(response.status).toBe(403);
    expect(syncMocks.updateKitchenItemCompletion).not.toHaveBeenCalled();
  });

  it("persists Ready and Completed as separate item states", async () => {
    syncMocks.updateKitchenItemReadiness.mockResolvedValue({
      eventId: "preview-alpha",
      itemKey: "taco-beef",
      ready: true,
    });
    syncMocks.updateKitchenItemCompletion.mockResolvedValue({
      eventId: "preview-alpha",
      itemKey: "taco-beef",
      completed: true,
    });

    const readyResponse = await PATCH(request({ ready: true }), context);
    const completedResponse = await PATCH(
      request({ completed: true }),
      context,
    );

    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.json()).toMatchObject({ ready: true });
    expect(completedResponse.status).toBe(200);
    expect(await completedResponse.json()).toMatchObject({
      completed: true,
    });
    expect(syncMocks.updateKitchenItemReadiness).toHaveBeenCalledWith(
      "preview-alpha",
      "taco-beef",
      true,
    );
    expect(syncMocks.updateKitchenItemCompletion).toHaveBeenCalledWith(
      "preview-alpha",
      "taco-beef",
      true,
    );
  });

  it("persists Prepped with the selected employee and server audit timestamp", async () => {
    syncMocks.updateKitchenItemPrepped.mockResolvedValue({
      eventId: "preview-alpha",
      itemKey: "taco-beef",
      prepped: true,
      employeeName: "Diana",
      preppedAt: "2026-08-14T16:05:00.000Z",
    });

    const response = await PATCH(
      request({ prepped: true, preppedBy: "Diana" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      prepped: true,
      employeeName: "Diana",
      preppedAt: "2026-08-14T16:05:00.000Z",
    });
    expect(syncMocks.updateKitchenItemPrepped).toHaveBeenCalledWith(
      "preview-alpha",
      "taco-beef",
      true,
      "Diana",
    );
  });

  it("requires an employee when marking an item Prepped", async () => {
    const missingEmployee = await PATCH(
      request({ prepped: true }),
      context,
    );
    const invalidEmployee = await PATCH(
      request({ prepped: true, preppedBy: 42 }),
      context,
    );

    expect(missingEmployee.status).toBe(400);
    expect(invalidEmployee.status).toBe(400);
    expect(syncMocks.updateKitchenItemPrepped).not.toHaveBeenCalled();
  });

  it("requires exactly one boolean state", async () => {
    const neither = await PATCH(request({}), context);
    const both = await PATCH(
      request({ ready: true, completed: true }),
      context,
    );
    const invalid = await PATCH(request({ completed: "yes" }), context);

    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(syncMocks.updateKitchenItemReadiness).not.toHaveBeenCalled();
    expect(syncMocks.updateKitchenItemCompletion).not.toHaveBeenCalled();
  });
});
