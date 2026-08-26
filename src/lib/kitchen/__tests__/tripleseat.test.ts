import { describe, expect, it } from "vitest";
import { generateKitchenChecklist } from "../rules";
import { createMemoryKitchenStorage } from "../storage";
import { getKitchenDay } from "../sync";
import {
  createTripleseatAdapter,
  encryptTripleseatTokenState,
  LiveTripleseatAdapter,
} from "../tripleseat";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Tripleseat adapter security and normalization", () => {
  it("loads all active Tripleseat statuses for Floor Plans without changing the definite-only kitchen search", async () => {
    const storage = createMemoryKitchenStorage();
    const searchUrls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        searchUrls.push(url);
        return json({ results: [{ id: 45 }, { id: 46 }], total_pages: 1 });
      }
      if (url.includes("/events/45?")) {
        return json({
          event: {
            id: 45,
            name: "Redacted Closed Event",
            event_date_iso8601: "2026-08-06",
            event_start_iso8601: "2026-08-06T12:30:00-04:00",
            event_end_iso8601: "2026-08-06T15:30:00-04:00",
            guest_count: 12,
            status: "CLOSED",
            location_id: 26059,
            rooms: [{ id: 1, name: "VIP 1" }],
            updated_at: "2026-08-03T16:00:00Z",
          },
        });
      }
      if (url.includes("/events/46?")) {
        return json({
          event: {
            id: 46,
            name: "Redacted Prospect Event",
            event_date_iso8601: "2026-08-06",
            event_start_iso8601: "2026-08-06T18:00:00-04:00",
            event_end_iso8601: "2026-08-06T21:00:00-04:00",
            guest_count: 30,
            status: "PROSPECT",
            location_id: 26059,
            rooms: [{ id: 2, name: "Main Dining Room" }],
            updated_at: "2026-08-03T17:00:00Z",
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({ menu_item_selections: [] });
      }
      if (url.includes("/notes?")) {
        return json({ notes: [] });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const plans = await adapter.fetchEventPlansForRange(
      "2026-08-06",
      "2026-08-06",
    );

    expect(searchUrls).toHaveLength(1);
    expect(new URL(searchUrls[0]).searchParams.has("status")).toBe(false);
    expect(plans.map((plan) => plan.status)).toEqual(["CLOSED", "PROSPECT"]);
    expect(plans.map((plan) => plan.rooms)).toEqual([
      ["VIP 1"],
      ["Main Dining Room"],
    ]);
  });

  it("reports a rejected refresh token as a Tripleseat reconnection requirement", async () => {
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "expired-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "expired-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl: async (input) =>
        String(input).endsWith("/oauth2/token")
          ? json({ error: "invalid_grant" }, 400)
          : json({ error: "unauthorized" }, 401),
      storage: createMemoryKitchenStorage(),
    });

    await expect(adapter.fetchEventsForDate("2026-08-06")).rejects.toThrow(
      "Reconnect Tripleseat",
    );
  });

  it("refreshes on 401, prioritizes structured selections, and only merges Food document lines", async () => {
    const storage = createMemoryKitchenStorage();
    const urls: string[] = [];
    let searchAttempts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);

      if (url.endsWith("/oauth2/token")) {
        return json({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 7200,
        });
      }
      if (url.includes("/events/search?")) {
        searchAttempts += 1;
        if (searchAttempts === 1) {
          expect(
            new Headers(init?.headers).get("authorization"),
          ).toBe("Bearer expired-access-token");
          return json({ error: "unauthorized" }, 401);
        }
        expect(
          new Headers(init?.headers).get("authorization"),
        ).toBe("Bearer rotated-access-token");
        return json({ results: [{ id: 42 }], total_pages: 1 });
      }
      if (url.includes("/events/42?")) {
        return json({
          event: {
            id: 42,
            booking_id: 7,
            name: "Redacted Event",
            event_date_iso8601: "2026-07-28",
            event_start_iso8601: "2026-07-28T17:00:00-04:00",
            event_end_iso8601: "2026-07-28T19:00:00-04:00",
            guest_count: 48,
            status: "DEFINITE",
            location_id: 26059,
            rooms: [{ name: "Room A" }],
            updated_at: "2026-07-28T16:00:00Z",
            description:
              "Call (937) 555-0110 or chef@example.com about service.",
            documents: [
              {
                id: 99,
                title: "Event Order",
                document_template_id: 12,
                views: [{ name: "Kitchen Sheet", url: "https://secret" }],
                line_items: [
                  {
                    id: 501,
                    description: "Taco Bar",
                    quantity: 1,
                    category: { name: "Food Packages" },
                  },
                  {
                    id: 502,
                    description: "Bowling",
                    quantity: 2,
                    category: { name: "Bowling" },
                  },
                  {
                    id: 503,
                    description: "Tater Keg Platter",
                    quantity: 2,
                    category: { name: "Food Platters" },
                  },
                  {
                    id: 504,
                    description: "Cookies — Premium, generously sized cookies designed to be shared.",
                    quantity: 48,
                    category: { name: "Dessert" },
                  },
                  {
                    id: 505,
                    description: "Prepare one gluten-free meal for the guest.",
                    category: { name: "Special Instructions" },
                    updated_at: "2026-07-28T15:45:00Z",
                  },
                ],
              },
            ],
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({
          menu_item_selections: [
            {
              id: 400,
              display_name: "The Full Course",
              quantity: 1,
              menu_modifier_selections: [
                {
                  id: 401,
                  display_name: "Taco Bar",
                  quantity: 1,
                },
              ],
            },
            {
              id: 402,
              display_name: "Tater Keg Platter",
              quantity: null,
            },
            {
              id: 403,
              display_name: "Darts",
              quantity: 2,
              category: { name: "Darts" },
            },
          ],
        });
      }
      if (url.includes("/bookings/7?show_financial=true")) {
        return json({
          booking: {
            id: 7,
            event_ids: [42],
            documents: [
              {
                id: 100,
                title: "Booking Food Contract",
                line_items: [
                  {
                    id: 506,
                    description: "Fry Platter",
                    quantity: 1,
                    category: { name: "Food Platters" },
                  },
                ],
              },
            ],
          },
        });
      }
      if (url.includes("/notes?")) {
        return json({
          notes: [
            {
              id: 1,
              body:
                "Ask planner@example.org or 937-555-0199 about the gluten-free meal.",
              updated_at: "2026-07-28T15:30:00Z",
            },
          ],
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };

    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "expired-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "initial-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
        TRIPLESEAT_TOKEN_ENCRYPTION_KEY: "12345678901234567890123456789012",
      },
      fetchImpl,
      storage,
      tokenUrl: "https://api.tripleseat.com/oauth2/token",
    });

    const events = await adapter.fetchEventsForDate("2026-07-28");

    expect(events).toHaveLength(1);
    expect(events[0].selections.map((selection) => selection.name)).toEqual([
      "The Full Course",
      "Taco Bar",
      "Tater Keg Platter",
      "Darts",
      "Cookies — Premium, generously sized cookies designed to be shared.",
      "Fry Platter",
    ]);
    expect(events[0].selections[2]).toMatchObject({
      quantity: 2,
      sourceCategory: "Food Platters",
      isFood: true,
    });
    expect(
      events[0].selections.some((selection) => selection.name === "Bowling"),
    ).toBe(false);
    const checklist = generateKitchenChecklist(events[0]);
    expect(
      checklist.normalizedSelections.find(
        (selection) => selection.originalName === "Darts",
      )?.isFood,
    ).toBe(false);
    expect(
      checklist.warnings.some(
        (warning) =>
          warning.code === "UNKNOWN_FOOD_ITEM" &&
          warning.selectionName === "Darts",
      ),
    ).toBe(false);
    expect(
      checklist.sections
        .flatMap((section) => section.rows)
        .find((row) => row.key === "dessert-platter"),
    ).toMatchObject({
      foodName: "Assorted Desserts",
      quantity: 2,
      unit: "pretzel plates",
    });
    expect(
      checklist.sections
        .flatMap((section) => section.rows)
        .find((row) => row.key === "platter-fries"),
    ).toMatchObject({
      foodName: "Fries",
      quantity: 1,
    });
    expect(events[0].specialNotes).toEqual([]);
    expect(events[0].foodNotes).toEqual([
      expect.objectContaining({
        text: "Prepare one gluten-free meal for the guest.",
        source: "event-document",
        sourceId: "505",
        sourceUpdatedAt: "2026-07-28T15:45:00Z",
      }),
    ]);
    expect(urls.some((url) => url.includes("/notes?"))).toBe(false);
    expect(events[0].documentMetadata).toEqual([
      {
        id: "99",
        title: "Event Order",
        documentTemplateId: "12",
        viewNames: ["Kitchen Sheet"],
      },
      {
        id: "100",
        title: "Booking Food Contract",
        documentTemplateId: null,
        viewNames: [],
      },
    ]);
    expect(urls.some((url) => url.includes("/api/v1/"))).toBe(false);
    expect(urls.some((url) => url.includes(".json"))).toBe(false);
    expect(
      urls.some((url) =>
        url.endsWith("/v1/bookings/7?show_financial=true"),
      ),
    ).toBe(true);

    const encrypted = await storage.getEncryptedTokenState();
    expect(encrypted?.encryptedTokens).not.toContain("rotated-access-token");
    expect(encrypted?.encryptedTokens).not.toContain("rotated-refresh-token");
  });

  it("verifies booking contract notes even when a known menu selection exists", async () => {
    const storage = createMemoryKitchenStorage();
    let bookingRequested = false;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 43 }], total_pages: 1 });
      }
      if (url.includes("/events/43?")) {
        return json({
          event: {
            id: 43,
            booking_id: 8,
            name: "Redacted Structured Event",
            event_date_iso8601: "2026-07-28",
            event_start_iso8601: "2026-07-28T17:00:00-04:00",
            guest_count: 48,
            status: "DEFINITE",
            location_id: 26059,
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({
          menu_item_selections: [
            {
              id: 410,
              display_name: "Tater Keg Platter",
              quantity: 1,
            },
          ],
        });
      }
      if (url.includes("/notes?")) {
        return json({ notes: [] });
      }
      if (url.includes("/bookings/8?show_financial=true")) {
        bookingRequested = true;
        return json({ error: "forbidden" }, 403);
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const [event] = await adapter.fetchEventsForDate("2026-07-28");

    expect(bookingRequested).toBe(true);
    expect(event.selections).toEqual([
      expect.objectContaining({
        name: "Tater Keg Platter",
        quantity: 1,
      }),
    ]);
    expect(event.specialNotes).toEqual([
      "Needs Review: Tripleseat booking contract data could not be verified. Review the source event.",
    ]);
  });

  it("imports exact categoryless top-level platter products without importing their modifiers", async () => {
    const storage = createMemoryKitchenStorage();
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 60558000 }], total_pages: 1 });
      }
      if (url.includes("/events/60558000?")) {
        return json({
          event: {
            id: 60558000,
            booking_id: 57128424,
            name: "Redacted Birthday Party",
            event_date_iso8601: "2026-09-05",
            event_start_iso8601: "2026-09-05T14:00:00-04:00",
            event_end_iso8601: "2026-09-05T17:00:00-04:00",
            guest_count: 25,
            status: "DEFINITE",
            location_id: 26059,
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({
          menu_item_selections: [
            {
              id: 3066969,
              display_name: "Mozzarella Sticks",
              quantity: 3,
            },
            {
              id: 3066970,
              display_name: "Wings",
              quantity: 2,
              menu_modifier_selections: [
                {
                  id: 4114171,
                  display_name:
                    "Jumbo Bone-In Wings — Big, bold, and built for sharing with the whole group.",
                },
              ],
            },
            {
              id: 3066971,
              display_name: "Chicken Tenders",
              quantity: 2,
              menu_modifier_selections: [
                {
                  id: 4114172,
                  display_name:
                    "Crispy Chicken Tenders — A crowd-favorite choice, designed for everyone.",
                },
              ],
            },
            {
              id: 3066972,
              display_name: "Fries",
              quantity: 4,
              menu_modifier_selections: [
                {
                  id: 4114173,
                  display_name:
                    "Crispy Seasoned Fries — A classic shareable favorite.",
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/bookings/57128424?show_financial=true")) {
        return json({ error: "forbidden" }, 403);
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const [event] = await adapter.fetchEventsForDate("2026-09-05");
    const checklist = generateKitchenChecklist(event);
    const rows = new Map(
      checklist.sections
        .flatMap((section) => section.rows)
        .map((item) => [item.key, item]),
    );

    expect(
      event.selections.filter((selection) => selection.isFood === true),
    ).toEqual([
      expect.objectContaining({ name: "Mozzarella Sticks", quantity: 3 }),
      expect.objectContaining({ name: "Wings", quantity: 2 }),
      expect.objectContaining({ name: "Chicken Tenders", quantity: 2 }),
      expect.objectContaining({ name: "Fries", quantity: 4 }),
    ]);
    expect(rows.get("platter-mozzarella-sticks")).toMatchObject({
      quantity: 12,
      unit: "pounds",
      numberOfPans: 3,
      panSize: "1/2",
    });
    expect(rows.get("platter-wings")).toMatchObject({
      quantity: 128,
      unit: "each",
      numberOfPans: 2,
      panSize: "1/2",
    });
    expect(rows.get("platter-chicken-tenders")).toMatchObject({
      quantity: 128,
      unit: "each",
      numberOfPans: 2,
      panSize: "1/2",
    });
    expect(rows.get("platter-fries")).toMatchObject({
      quantity: 4,
      unit: "bags",
      numberOfPans: 4,
      panSize: "1/2",
    });
    expect(rows.get("sauce-marinara")).toMatchObject({
      quantity: 3,
      unit: "bowls",
    });
    expect(rows.get("sauce-ranch")).toMatchObject({
      quantity: 4,
      unit: "bowls",
    });
    expect(checklist.chafingDishes).toEqual({
      bars: 0,
      hotPlatters: 6,
      total: 6,
    });
    expect(event.specialNotes).toEqual([
      "Needs Review: Tripleseat booking contract data could not be verified. Review the source event.",
    ]);
  });

  it("uses booking contract selections and Special Instructions while excluding booking notes", async () => {
    const storage = createMemoryKitchenStorage();
    let bookingRequested = false;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 44 }], total_pages: 1 });
      }
      if (url.includes("/events/44?")) {
        return json({
          event: {
            id: 44,
            booking_id: 9,
            name: "Redacted Non-food Structured Event",
            event_date_iso8601: "2026-07-28",
            event_start_iso8601: "2026-07-28T17:00:00-04:00",
            guest_count: 40,
            status: "DEFINITE",
            location_id: 26059,
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({
          menu_item_selections: [
            {
              id: 420,
              display_name: "Darts",
              quantity: 2,
              category: { name: "Darts" },
            },
          ],
        });
      }
      if (url.includes("/bookings/9/notes?")) {
        return json({
          notes: [
            {
              id: 421,
              body: "Guest has a shellfish allergy.",
              updated_at: "2026-07-28T16:30:00Z",
            },
          ],
        });
      }
      if (url.includes("/notes?")) {
        return json({ notes: [] });
      }
      if (url.includes("/bookings/9?show_financial=true")) {
        bookingRequested = true;
        return json({
          booking: {
            id: 9,
            event_ids: [44],
            documents: [
              {
                id: 810,
                title: "Booking Food Contract",
                line_items: [
                  {
                    id: 920,
                    description: "Tater Keg Platter",
                    quantity: 1,
                    category: { internal_name: "Food Platters" },
                  },
                  {
                    id: 921,
                    description: "Guest has a shellfish allergy.",
                    category: { internal_name: "Special Instructions" },
                    updated_at: "2026-07-28T16:45:00Z",
                  },
                ],
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const [event] = await adapter.fetchEventsForDate("2026-07-28");
    const checklist = generateKitchenChecklist(event);

    expect(bookingRequested).toBe(true);
    expect(event.selections.map((selection) => selection.name)).toEqual([
      "Darts",
      "Tater Keg Platter",
    ]);
    expect(
      checklist.sections
        .flatMap((section) => section.rows)
        .find((row) => row.key === "platter-tater-kegs"),
    ).toMatchObject({
      quantity: 64,
      numberOfPans: 3,
      panSize: "1/3",
    });
    const warningCodes = checklist.warnings.map((warning) => warning.code);
    expect(warningCodes).not.toContain("UNKNOWN_FOOD_ITEM");
    expect(warningCodes).not.toContain("NO_FOOD_SELECTIONS");
    expect(event.foodNotes).toEqual([
      {
        text: "Guest has a shellfish allergy.",
        source: "booking-document",
        sourceId: "921",
        sourceUpdatedAt: "2026-07-28T16:45:00Z",
      },
    ]);
    expect(warningCodes).toContain("SPECIAL_NOTE_REQUIRES_REVIEW");
  });

  it("imports a single-event booking contract as a fallback, deduplicates its lines, and excludes booking PII", async () => {
    const storage = createMemoryKitchenStorage();
    const taterKegs =
      "Tater Keg PlatterSuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives.";
    const wings =
      "Wing PlatterDeep fried traditional wings served with celery and served with ranch.";
    const tenders =
      "Chicken Tender PlatterFried chicken tenders with ranch dipping sauce.";
    const veggies =
      "Veggie TrayAssorted fresh vegetables served with ranch dressing.";
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 178 }], total_pages: 1 });
      }
      if (url.includes("/events/178?")) {
        return json({
          event: {
            id: 178,
            booking_id: 501,
            name: "Redacted Contract Event",
            event_date_iso8601: "2026-07-30",
            event_start_iso8601: "2026-07-30T17:00:00-04:00",
            guest_count: 50,
            status: "DEFINITE",
            location_id: 26059,
            documents: [
              {
                id: 800,
                title: "Event Document",
                document_template_id: 12,
                views: [{ name: "Kitchen" }],
              },
            ],
          },
        });
      }
      if (url.includes("/bookings/501?show_financial=true")) {
        return json({
          booking: {
            id: 501,
            event_ids: [178],
            customer: { name: "SENTINEL_CUSTOMER_PII" },
            contacts: [
              {
                email: "SENTINEL_CONTACT@example.invalid",
                phone: "SENTINEL_PHONE",
              },
            ],
            financials: { total: "SENTINEL_FINANCIAL" },
            documents: [
              {
                id: 801,
                title: "Booking Contract",
                document_template_id: 13,
                url: "https://SENTINEL_DOCUMENT_URL.invalid",
                views: [
                  {
                    name: "Kitchen Contract",
                    url: "https://SENTINEL_VIEW_URL.invalid",
                  },
                ],
                line_items: [
                  taterKegs,
                  taterKegs,
                  wings,
                  tenders,
                  veggies,
                ].map((description, index) => ({
                  id: 901 + index,
                  description,
                  quantity: 1,
                  category: {
                    name: "Party Platters",
                    internal_name: " Food Platters ",
                  },
                })),
              },
            ],
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({ menu_item_selections: [] });
      }
      if (url.includes("/notes?")) {
        return json({ notes: [] });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const [event] = await adapter.fetchEventsForDate("2026-07-30");

    expect(event.selections).toHaveLength(4);
    expect(
      event.selections.map(({ name, quantity }) => ({ name, quantity })),
    ).toEqual([
      { name: taterKegs, quantity: 1 },
      { name: wings, quantity: 1 },
      { name: tenders, quantity: 1 },
      { name: veggies, quantity: 1 },
    ]);
    expect(event.selections.map((item) => item.sourceCategory)).toEqual(
      ["Party Platters", "Party Platters", "Party Platters", "Party Platters"],
    );
    expect(event.documentMetadata).toEqual([
      {
        id: "800",
        title: "Event Document",
        documentTemplateId: "12",
        viewNames: ["Kitchen"],
      },
      {
        id: "801",
        title: "Booking Contract",
        documentTemplateId: "13",
        viewNames: ["Kitchen Contract"],
      },
    ]);
    expect(JSON.stringify(event)).not.toContain("SENTINEL");
  });

  it("refuses to assign booking contract lines from a multi-event booking", async () => {
    const storage = createMemoryKitchenStorage();
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 178 }], total_pages: 1 });
      }
      if (url.includes("/events/178?")) {
        return json({
          event: {
            id: 178,
            booking_id: 502,
            name: "Redacted Multi-event Booking",
            event_date_iso8601: "2026-07-30",
            event_start_iso8601: "2026-07-30T17:00:00-04:00",
            guest_count: 50,
            status: "DEFINITE",
            location_id: 26059,
          },
        });
      }
      if (url.includes("/bookings/502?show_financial=true")) {
        return json({
          booking: {
            id: 502,
            event_ids: [178, 179],
            documents: [
              {
                id: 802,
                title: "Shared Contract",
                line_items: [
                  {
                    id: 910,
                    description: "Tater Keg Platter",
                    quantity: 1,
                    category: { internal_name: "Food Platters" },
                  },
                ],
              },
            ],
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({ menu_item_selections: [] });
      }
      if (url.includes("/notes?")) {
        return json({ notes: [] });
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage,
    });

    const [event] = await adapter.fetchEventsForDate("2026-07-30");

    expect(event.selections).toEqual([]);
    expect(event.documentMetadata).toEqual([]);
    expect(event.specialNotes).toEqual([
      "Needs Review: Tripleseat booking documents were not imported because they could not be assigned to exactly one matching event. Review the source event.",
    ]);
  });

  it.each([403, 404])(
    "marks booking contract data for review when booking detail returns %s",
    async (status) => {
      const storage = createMemoryKitchenStorage();
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("/events/search?")) {
          return json({ results: [{ id: 178 }], total_pages: 1 });
        }
        if (url.includes("/events/178?")) {
          return json({
            event: {
              id: 178,
              booking_id: 503,
              name: "Redacted Booking",
              event_date_iso8601: "2026-07-30",
              event_start_iso8601: "2026-07-30T17:00:00-04:00",
              guest_count: 50,
              status: "DEFINITE",
              location_id: 26059,
            },
          });
        }
        if (url.includes("/bookings/503?show_financial=true")) {
          return json({ error: "unavailable" }, status);
        }
        if (url.includes("/menu_item_selections")) {
          return json({ menu_item_selections: [] });
        }
        if (url.includes("/notes?")) {
          return json({ notes: [] });
        }
        throw new Error(`Unexpected test request: ${url}`);
      };
      const adapter = new LiveTripleseatAdapter({
        env: {
          NODE_ENV: "test",
          TRIPLESEAT_CLIENT_ID: "test-client",
          TRIPLESEAT_CLIENT_SECRET: "test-client-secret",
          TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
          TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
          TRIPLESEAT_LOCATION_ID: "26059",
        },
        fetchImpl,
        storage,
      });

      const [event] = await adapter.fetchEventsForDate("2026-07-30");

      expect(event.selections).toEqual([]);
      expect(event.specialNotes).toEqual([
        "Needs Review: Tripleseat booking contract data could not be verified. Review the source event.",
      ]);
    },
  );

  it("never includes OAuth tokens or client secrets in the public day payload", async () => {
    const storage = createMemoryKitchenStorage();
    const accessToken = "sentinel-access-token";
    const refreshToken = "sentinel-refresh-token";
    const clientSecret = "sentinel-client-secret";
    const adapter = createTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: clientSecret,
        TRIPLESEAT_ACCESS_TOKEN: accessToken,
        TRIPLESEAT_REFRESH_TOKEN: refreshToken,
      },
      storage,
      fetchImpl: async () => json({}),
    });

    const payload = await getKitchenDay("2026-07-28", {
      adapter,
      storage,
      now: new Date("2026-07-28T12:00:00-04:00"),
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(accessToken);
    expect(serialized).not.toContain(refreshToken);
    expect(serialized).not.toContain(clientSecret);
    expect(serialized).not.toMatch(
      /access_token|refresh_token|client_secret/i,
    );
  });

  it.each(["TRIPLESEAT_MOCK", "TRIPLESEAT_MOCK_MODE"])(
    "supports the %s mock-mode flag",
    (variableName) => {
      const adapter = createTripleseatAdapter({
        env: {
          NODE_ENV: "test",
          [variableName]: "true",
        },
        storage: createMemoryKitchenStorage(),
      });

      expect(adapter.sourceMode).toBe("mock");
    },
  );

  it("uses the compatibility mock flag when the primary flag is empty", () => {
    const adapter = createTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_MOCK: "",
        TRIPLESEAT_MOCK_MODE: "true",
      },
      storage: createMemoryKitchenStorage(),
    });

    expect(adapter.sourceMode).toBe("mock");
  });

  it("restores encrypted tokens when environment token values are absent", async () => {
    const storage = createMemoryKitchenStorage();
    const key = "12345678901234567890123456789012";
    await storage.saveEncryptedTokenState({
      encryptedTokens: encryptTripleseatTokenState(
        {
          accessToken: "persisted-access-token",
          refreshToken: "persisted-refresh-token",
          expiresAt: Date.now() + 60_000,
        },
        key,
      ),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    let requested = false;
    const adapter = createTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-secret",
        TRIPLESEAT_TOKEN_ENCRYPTION_KEY: key,
      },
      storage,
      fetchImpl: async (_input, init) => {
        requested = true;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer persisted-access-token",
        );
        return json({ results: [], total_pages: 1 });
      },
    });

    expect(adapter.sourceMode).toBe("live");
    await expect(
      adapter.fetchEventsForDate("2026-07-28"),
    ).resolves.toEqual([]);
    expect(requested).toBe(true);
  });

  it("reloads encrypted tokens after an initially empty token store", async () => {
    const storage = createMemoryKitchenStorage();
    const key = "12345678901234567890123456789012";
    const adapter = createTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-secret",
        TRIPLESEAT_TOKEN_ENCRYPTION_KEY: key,
      },
      storage,
      fetchImpl: async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer newly-persisted-access-token",
        );
        return json({ results: [], total_pages: 1 });
      },
    });

    await expect(
      adapter.fetchEventsForDate("2026-07-28"),
    ).rejects.toThrow("TRIPLESEAT_REFRESH_TOKEN");

    await storage.saveEncryptedTokenState({
      encryptedTokens: encryptTripleseatTokenState(
        {
          accessToken: "newly-persisted-access-token",
          refreshToken: "newly-persisted-refresh-token",
          expiresAt: Date.now() + 60_000,
        },
        key,
      ),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      adapter.fetchEventsForDate("2026-07-28"),
    ).resolves.toEqual([]);
  });
});
