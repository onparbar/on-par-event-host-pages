import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let GoTabClient: typeof import("../client").GoTabClient;
let eventKdsItemName: typeof import("../client").eventKdsItemName;

beforeAll(async () => {
  ({ GoTabClient, eventKdsItemName } = await import("../client"));
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

  it("reads the wrapped location response returned by GoTab", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/api/oauth/token")
        ? json({ token: "server-token", expiresIn: 86400 })
        : json({
            data: [{
              locationUuid: "location-2",
              locationId: "112479",
              name: "On Par",
              timezone: "America/New_York",
            }],
          }),
    );
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.verifyConfiguredLocation()).resolves.toMatchObject({
      locationUuid: "location-2",
      locationId: "112479",
      name: "On Par",
    });
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
            categoriesList: [{ categoryId: "105186", name: "Event Food" }],
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
    expect(String(graphRequest?.body)).toContain("locationUuid");
    expect(String(graphRequest?.body)).toContain("productsList(includeArchived: NO)");
  });

  it("creates an open zero-dollar Event Food order without payment data", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      if (url.includes("gotab.io/api/loc/")) {
        return json({
          data: {
            tabId: "82202236",
            tabUuid: "tab-1",
            status: "OPEN",
            orders: [{ orderId: "138102718" }],
            items: [{ orderId: "138102718", name: "Salsa Refill" }],
            payments: [],
          },
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
    })).resolves.toEqual({
      tabUuid: "tab-1",
      orderUuid: "138102718",
      itemUuid: null,
    });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("gotab.io/api/loc/"),
    )?.[1];
    expect(fetchImpl.mock.calls.some(
      ([url]) => String(url) === "https://gotab.io/api/loc/location-2/tabs",
    )).toBe(true);
    const body = JSON.parse(String(orderRequest?.body));
    expect(body).toMatchObject({
      openTab: true,
      spotUuid: "spot",
      phoneNumber: "+19377056024",
      items: [{ product: { productUuid: "prd_salsa" }, quantity: 2 }],
    });
    expect(body.items[0]).toEqual({
      externalId: "event:REFILL:salsa:1:DISPATCH",
      product: { productUuid: "prd_salsa" },
      quantity: 2,
      name: "EVENT-Salsa Refill",
      modifiers: [],
    });
    expect(body).not.toHaveProperty("payments");
  });

  it("rejects a successful GoTab response that stayed pending", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return json({
        data: {
          tabUuid: "tab-pending",
          status: "PENDING",
          orders: [{ orderId: "138102999" }],
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.createEventFoodTab({
      externalId: "event:REFILL:salsa:2:DISPATCH",
      ticketName: "[REFILL] Missing KDS Order",
      productUuid: "prd_salsa",
      quantity: 1,
      itemName: "Salsa Refill",
      itemNotes: {},
    })).rejects.toThrow("did not send it to the KDS");
  });

  it("uses a readable EVENT name within GoTab's 20-character KDS limit", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return json({
        data: {
          tabUuid: "tab-mozzarella",
          status: "OPEN",
          orders: [{ orderId: "138103000" }],
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await client.createEventFoodTab({
      externalId: "event:ADDON:mozzarella:1:DISPATCH",
      ticketName: "[FOOD ADD-ON] Event",
      productUuid: "prd_mozzarella",
      quantity: 1,
      itemName: "Mozzarella Sticks",
      itemNotes: {},
    });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("gotab.io/api/loc/"),
    )?.[1];
    const body = JSON.parse(String(orderRequest?.body));
    expect(body.items[0].name).toBe("EVENT-Mozz Sticks");
    expect(body.items[0].name.length).toBeLessThanOrEqual(20);
  });

  it.each([
    { selectedPanSize: "1/3" as const, expectedName: "EVENT-Mozz 1/3 PANS" },
    { selectedPanSize: "1/2" as const, expectedName: "EVENT-Mozz 1/2 PANS" },
  ])("shows an explicitly selected $selectedPanSize pan on the KDS item", async ({
    selectedPanSize,
    expectedName,
  }) => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return json({
        data: {
          tabUuid: `tab-${selectedPanSize}`,
          status: "OPEN",
          orders: [{ orderId: "138103010" }],
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await client.createEventFoodTab({
      externalId: `event:ADDON:mozzarella:${selectedPanSize}:DISPATCH`,
      ticketName: "[FOOD ADD-ON] Event",
      productUuid: "prd_mozzarella",
      quantity: 1,
      itemName: "Mozzarella Sticks",
      itemNotes: {},
      selectedPanSize,
    });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("gotab.io/api/loc/"),
    )?.[1];
    const body = JSON.parse(String(orderRequest?.body));
    expect(body.items[0].name).toBe(expectedName);
    expect(body.items[0].name.length).toBeLessThanOrEqual(20);
  });

  it("formats every add-on as an EVENT item within GoTab's KDS limit", () => {
    const foodNames = [
      "Wings",
      "Mozzarella Sticks",
      "Tater Kegs",
      "Fries",
      "Chicken Tenders",
      "Veggie Tray",
      "BBQ Sauce",
      "Garlic Parm",
      "Buffalo Sauce",
      "Ranch",
      "Dessert Platter",
      "Beef",
      "Chicken",
      "Black Beans",
      "Tortillas",
      "Lettuce Wraps",
      "Tomatoes",
      "Lettuce",
      "Sour Cream",
      "Diced Onion",
      "Shredded Cheese",
      "Salsa",
      "Marinara",
    ];

    for (const foodName of foodNames) {
      const automatic = eventKdsItemName(foodName);
      expect(automatic).toMatch(/^EVENT-/);
      expect(automatic).not.toContain("PANS");
      expect(automatic.length).toBeLessThanOrEqual(20);
      for (const panSize of ["1/3", "1/2"] as const) {
        const explicit = eventKdsItemName(foodName, panSize);
        expect(explicit).toMatch(/^EVENT-/);
        expect(explicit).toMatch(new RegExp(` ${panSize.replace("/", "\\/")} PANS$`));
        expect(explicit.length).toBeLessThanOrEqual(20);
      }
    }

    expect(eventKdsItemName("Tater Keg Platter", "1/2"))
      .toBe("EVENT-Tater 1/2 PANS");
  });

  it("assigns the unique matching GoTab employee to the KDS Server field", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      if (url.endsWith("/api/loc")) {
        return json([{
          locationUuid: "location-2",
          locationId: "112479",
          name: "On Par",
          urlName: "on-par",
        }]);
      }
      if (url.endsWith("/api/loc/on-par/users")) {
        return json({
          data: [{
            displayName: "Ryan Smith",
            userUuid: "user-ryan",
            customerId: "8001",
            acl: "labor:time-clock|server",
            hasPin: true,
            metadata: { firstName: "Ryan", lastName: "Smith" },
          }],
        });
      }
      return json({
        data: {
          tabUuid: "tab-server",
          status: "OPEN",
          orders: [{ orderId: "138103001" }],
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await client.createEventFoodTab({
      externalId: "event:ADDON:tater-kegs:1:DISPATCH",
      ticketName: "[FOOD ADD-ON] Event",
      productUuid: "prd_tater_kegs",
      quantity: 1,
      itemName: "Tater Kegs",
      itemNotes: {},
      serverName: "Ryan",
    });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("/api/loc/location-2/tabs"),
    )?.[1];
    expect(JSON.parse(String(orderRequest?.body))).toMatchObject({
      employeeId: "8001",
      items: [{ quantity: 1 }],
    });
  });

  it("does not guess the KDS Server when a POC name is ambiguous", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      if (url.endsWith("/api/loc")) {
        return json([{
          locationUuid: "location-2",
          locationId: "112479",
          name: "On Par",
          urlName: "on-par",
        }]);
      }
      if (url.endsWith("/api/loc/on-par/users")) {
        return json({
          data: [
            {
              displayName: "Julio One",
              customerId: "8002",
              acl: "server",
              hasPin: true,
              metadata: { firstName: "Julio", lastName: "One" },
            },
            {
              displayName: "Julio Two",
              customerId: "8003",
              acl: "server",
              hasPin: true,
              metadata: { firstName: "Julio", lastName: "Two" },
            },
          ],
        });
      }
      return json({
        data: {
          tabUuid: "tab-no-server",
          status: "OPEN",
          orders: [{ orderId: "138103002" }],
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await client.createEventFoodTab({
      externalId: "event:ADDON:tater-kegs:2:DISPATCH",
      ticketName: "[FOOD ADD-ON] Event",
      productUuid: "prd_tater_kegs",
      quantity: 1,
      itemName: "Tater Kegs",
      itemNotes: {},
      serverName: "Julio",
    });

    const orderRequest = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([url]) => url.includes("/api/loc/location-2/tabs"),
    )?.[1];
    expect(JSON.parse(String(orderRequest?.body))).not.toHaveProperty("employeeId");
  });

  it("accepts a closed-order response when GoTab omits the immediate item UUID", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return json({
        data: {
          tab: {
            tabUuid: "closed-tab-1",
            status: "OPEN",
            orders: [{ orderUuid: "placed-order-1" }],
          },
        },
      });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.createEventFoodTab({
      externalId: "event:REFILL:wings:3:DISPATCH",
      ticketName: "[REFILL] Wing Platter",
      productUuid: "prd_wings",
      quantity: 1,
      itemName: "Wing Platter",
      itemNotes: {},
    })).resolves.toEqual({
      tabUuid: "closed-tab-1",
      orderUuid: "placed-order-1",
      itemUuid: null,
    });
  });

  it("preserves GoTab's safe validation message for a rejected order", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return json({ message: "Spot is not available for this order." }, 422);
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.createEventFoodTab({
      externalId: "event:REFILL:wings:4:DISPATCH",
      ticketName: "[REFILL] Wing Platter",
      productUuid: "prd_wings",
      quantity: 1,
      itemName: "Wing Platter",
      itemNotes: {},
    })).rejects.toThrow(
      "GoTab could not create the Event Food order (HTTP 422): Spot is not available for this order.",
    );
  });

  it("preserves a plain-text validation message for a rejected order", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/oauth/token")) {
        return json({ token: "server-token", expiresIn: 86400 });
      }
      return new Response("productUuid is required", { status: 400 });
    });
    const client = new GoTabClient(configuration, fetchImpl as typeof fetch);

    await expect(client.createEventFoodTab({
      externalId: "event:REFILL:wings:5:DISPATCH",
      ticketName: "[REFILL] Wing Platter",
      productUuid: "prd_wings",
      quantity: 1,
      itemName: "Wing Platter",
      itemNotes: {},
    })).rejects.toThrow(
      "GoTab could not create the Event Food order (HTTP 400): productUuid is required",
    );
  });
});
