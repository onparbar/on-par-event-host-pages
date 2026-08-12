import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let GoTabClient: typeof import("../client").GoTabClient;

beforeAll(async () => {
  ({ GoTabClient } = await import("../client"));
});

const configuration = {
  apiAccessId: "redacted-id",
  apiAccessSecret: "redacted-secret",
  locationUuid: "location-2",
  eventSpotUuid: "spot",
  eventCustomerPhone: "+19377056024",
  webhookSecret: "webhook",
  enabled: false,
  dryRun: true,
  defaultPrepLeadMinutes: 60,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoTab server client", () => {
  it("uses the documented client-credentials flow and caches the token", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", tokenType: "Bearer", expiresIn: 86400 });
      }
      return json([
        { locationUuid: "location-1", locationId: 1, name: "Other" },
        { locationUuid: "location-2", locationId: 2, name: "On Par" },
      ]);
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch, () => 1_000);

    await expect(client.verifyConfiguredLocation()).resolves.toMatchObject({ name: "On Par" });
    await expect(client.verifyConfiguredLocation()).resolves.toMatchObject({ locationUuid: "location-2" });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith("/api/oauth/token"))).toHaveLength(1);
    const authRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    expect(JSON.parse(String(authRequest.body))).toEqual({
      grant_type: "client_credentials",
      api_access_id: "redacted-id",
      api_access_secret: "redacted-secret",
    });
  });

  it("does not silently select the first authorized location", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/api/oauth/token")
        ? json({ access_token: "server-token", expires_in: 86400 })
        : json([{ locationUuid: "location-1", locationId: 1, name: "Other" }]),
    );
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);
    await expect(client.verifyConfiguredLocation()).rejects.toThrow(
      "do not have access to the configured On Par Entertainment location",
    );
  });

  it("returns sanitized authentication errors", async () => {
    const fetchImpl = vi.fn(async () => json({ detail: "secret response" }, 401));
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);
    await expect(client.getAuthorizedLocations()).rejects.toThrow(
      "GoTab authentication failed. Verify the server-side Vercel credentials.",
    );
  });

  it("reads hidden products from the Event Food category", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      if (url.endsWith("/api/loc")) {
        return json([{ locationUuid: "location-2", locationId: 2, name: "On Par" }]);
      }
      return json({
        data: {
          location: {
            categoriesList: [{ categoryId: "105186", label: "Event Food" }],
            productsList: [
              { productId: "1", productUuid: "prd_ranch", name: "Ranch", categoryId: "105186" },
              { productId: "2", productUuid: "prd_other", name: "Other", categoryId: "200" },
            ],
          },
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.getEventFoodProducts()).resolves.toEqual([
      { productId: "1", productUuid: "prd_ranch", name: "Ranch" },
    ]);
    const graphRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.endsWith("/api/graph"),
    )?.[1];
    expect(String(graphRequest?.body)).toContain("productsList(includeArchived: NO)");
  });

  it("creates an open zero-dollar Event Food tab without payment fields", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      if (url.includes("gotab.io/api/loc/")) {
        return json({
          tabUuid: "tab-1",
          orders: [{ orderUuid: "order-1", items: [{ itemUuid: "item-1" }] }],
        });
      }
      return json([]);
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.createEventFoodTab({
      externalId: "event:REFILL:salsa:1:DISPATCH",
      ticketName: "[REFILL] OPE KDS Integration Test",
      productUuid: "prd_salsa",
      quantity: 2,
      itemName: "Salsa Refill",
      itemNotes: { eventName: "OPE KDS Integration Test" },
    })).resolves.toEqual({ tabUuid: "tab-1", orderUuid: "order-1", itemUuid: "item-1" });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("gotab.io/api/loc/"),
    )?.[1];
    const body = JSON.parse(String(orderRequest?.body));
    expect(body).toMatchObject({
      openTab: true,
      spotUuid: "spot",
      phoneNumber: "+19377056024",
      items: [{ productUuid: "prd_salsa", quantity: 2 }],
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain("payment");
  });
});
