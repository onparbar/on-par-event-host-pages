import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "../route";
import { KitchenFoodAddOnConflictError } from "@/lib/kitchen/storage";

const syncMocks = vi.hoisted(() => ({
  getKitchenEventChecklist: vi.fn(),
  getKitchenEventFoodAddOns: vi.fn(),
  updateKitchenEventFoodAddOns: vi.fn(),
}));
const gotabMocks = vi.hoisted(() => ({
  synchronizeKitchenLiveAddOnsToEventFood: vi.fn(),
  processGoTabDispatches: vi.fn(),
}));
vi.mock("@/lib/kitchen/sync", () => syncMocks);
vi.mock("@/lib/gotab/sync-event-food", () => ({
  synchronizeKitchenLiveAddOnsToEventFood:
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood,
}));
vi.mock("@/lib/gotab/worker", () => ({
  processGoTabDispatches: gotabMocks.processGoTabDispatches,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("kitchen event add-on API", () => {
  it("allows anonymous operational reads", async () => {
    syncMocks.getKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "123",
      food: {},
      updatedAt: "2026-07-29T14:00:00Z",
      revision: 0,
    });

    const response = await GET(
      new Request("https://example.test/api/kitchen/events/123/addons"),
      { params: Promise.resolve({ eventId: "123" }) },
    );

    expect(response.status).toBe(200);
    expect(syncMocks.getKitchenEventFoodAddOns).toHaveBeenCalledWith("123");
  });

  it("rejects cross-origin replacements in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await PUT(
      new Request("https://example.test/api/kitchen/events/123/addons", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.example",
        },
        body: JSON.stringify({ food: {}, expectedRevision: 0 }),
      }),
      { params: Promise.resolve({ eventId: "123" }) },
    );

    expect(response.status).toBe(403);
    expect(syncMocks.updateKitchenEventFoodAddOns).not.toHaveBeenCalled();
  });

  it("gets and replaces an exact event's normalized add-on snapshot", async () => {
    syncMocks.getKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "preview-alpha",
      food: { wings: { quantity: 2 } },
      updatedAt: "2026-07-29T14:00:00Z",
      revision: 2,
    });
    syncMocks.updateKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "preview-alpha",
      food: { ranch: { quantity: 1 } },
      updatedAt: "2026-07-29T14:01:00Z",
      revision: 3,
    });
    syncMocks.getKitchenEventChecklist.mockResolvedValue({
      event: { eventId: "preview-alpha", name: "Preview event" },
      sections: [],
      liveFoodAddOns: [],
    });
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood.mockResolvedValue({
      requestCount: 1,
      exceptionCount: 0,
      duplicateCount: 0,
    });
    gotabMocks.processGoTabDispatches.mockResolvedValue({
      claimed: 1,
      sent: 1,
    });
    const context = {
      params: Promise.resolve({ eventId: "preview-alpha" }),
    };

    const getResponse = await GET(
      new Request(
        "https://example.test/api/kitchen/events/preview-alpha/addons",
      ),
      context,
    );
    const putResponse = await PUT(
      new Request(
        "https://example.test/api/kitchen/events/preview-alpha/addons",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            origin: "https://example.test",
          },
          body: JSON.stringify({
            food: { ranch: { quantity: "1", manualPrice: "5" } },
            expectedRevision: 2,
          }),
        },
      ),
      context,
    );

    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      eventId: "preview-alpha",
      food: { wings: { quantity: 2 } },
      updatedAt: "2026-07-29T14:00:00Z",
      revision: 2,
    });
    expect(syncMocks.getKitchenEventFoodAddOns).toHaveBeenCalledWith(
      "preview-alpha",
    );
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual({
      eventId: "preview-alpha",
      food: { ranch: { quantity: 1 } },
      updatedAt: "2026-07-29T14:01:00Z",
      revision: 3,
      kds: {
        queued: 1,
        exceptions: 0,
        duplicates: 0,
        changedSourceKeys: ["wings", "ranch"],
        dispatch: { claimed: 1, sent: 1 },
      },
    });
    expect(syncMocks.updateKitchenEventFoodAddOns).toHaveBeenCalledWith(
      "preview-alpha",
      { ranch: { quantity: "1", manualPrice: "5" } },
      { expectedRevision: 2 },
    );
    expect(
      gotabMocks.synchronizeKitchenLiveAddOnsToEventFood,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ eventId: "preview-alpha" }),
      }),
      {
        sourceVersion: 3,
        changedSourceKeys: ["wings", "ranch"],
      },
    );
    expect(gotabMocks.processGoTabDispatches).toHaveBeenCalledOnce();
  });

  it("returns the current revision when another staff session wins the write", async () => {
    syncMocks.updateKitchenEventFoodAddOns.mockRejectedValue(
      new KitchenFoodAddOnConflictError(),
    );
    syncMocks.getKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "preview-alpha",
      food: { wings: { quantity: 3 } },
      updatedAt: "2026-07-29T14:02:00Z",
      revision: 4,
    });

    const response = await PUT(
      new Request(
        "https://example.test/api/kitchen/events/preview-alpha/addons",
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            origin: "https://example.test",
          },
          body: JSON.stringify({
            food: { ranch: { quantity: 1 } },
            expectedRevision: 3,
          }),
        },
      ),
      { params: Promise.resolve({ eventId: "preview-alpha" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      eventId: "preview-alpha",
      food: { wings: { quantity: 3 } },
      revision: 4,
    });
  });
});
