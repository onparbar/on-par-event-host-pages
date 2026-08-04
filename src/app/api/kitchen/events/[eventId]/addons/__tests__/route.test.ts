import { afterEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { GET, PUT } from "../route";
import { KitchenFoodAddOnConflictError } from "@/lib/kitchen/storage";

const syncMocks = vi.hoisted(() => ({
  getKitchenEventFoodAddOns: vi.fn(),
  updateKitchenEventFoodAddOns: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  hasAdminSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/kitchen/sync", () => syncMocks);
vi.mock("@/lib/admin-auth", () => authMocks);

afterEach(() => {
  vi.clearAllMocks();
});

describe("kitchen event add-on API", () => {
  it("requires the signed Event Host admin session", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    authMocks.hasAdminSession.mockReturnValue(false);

    const response = await GET(
      new Request("https://example.test/api/kitchen/events/123/addons"),
      { params: Promise.resolve({ eventId: "123" }) },
    );

    expect(response.status).toBe(401);
    expect(syncMocks.getKitchenEventFoodAddOns).not.toHaveBeenCalled();
  });

  it("gets and replaces an exact event's normalized add-on snapshot", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    authMocks.hasAdminSession.mockReturnValue(true);
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
          headers: { "content-type": "application/json" },
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
    });
    expect(syncMocks.updateKitchenEventFoodAddOns).toHaveBeenCalledWith(
      "preview-alpha",
      { ranch: { quantity: "1", manualPrice: "5" } },
      { expectedRevision: 2 },
    );
  });

  it("returns the current revision when another staff session wins the write", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    authMocks.hasAdminSession.mockReturnValue(true);
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
          headers: { "content-type": "application/json" },
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
