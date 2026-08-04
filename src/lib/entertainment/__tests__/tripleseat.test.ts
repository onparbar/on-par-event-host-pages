import { describe, expect, it } from "vitest";
import { createMemoryKitchenStorage } from "../../kitchen/storage";
import { LiveTripleseatAdapter } from "../../kitchen/tripleseat";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function testAdapter(
  detail: Record<string, unknown>,
  requestedUrls: string[],
) {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/events/search?")) {
      return json({ results: [{ id: 9001 }], total_pages: 1 });
    }
    if (url.includes("/events/9001?")) {
      return json({ event: detail });
    }
    if (url.includes("/menu_item_selections")) {
      return json({ menu_item_selections: [] });
    }
    if (url.includes("/notes?")) {
      return json({ notes: [] });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  return new LiveTripleseatAdapter({
    env: {
      NODE_ENV: "test",
      TRIPLESEAT_CLIENT_ID: "test-client",
      TRIPLESEAT_CLIENT_SECRET: "test-secret",
      TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
      TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
      TRIPLESEAT_LOCATION_ID: "26059",
    },
    fetchImpl,
    storage: createMemoryKitchenStorage(),
  });
}

describe("Tripleseat entertainment projection", () => {
  it("reads safe structured entertainment, room, and timing fields only", async () => {
    const requestedUrls: string[] = [];
    const adapter = testAdapter(
      {
        id: 9001,
        booking_id: 7001,
        name: "Redacted Event",
        event_date_iso8601: "2026-07-28",
        event_start_iso8601: "2026-07-28T17:00:00-04:00",
        event_end_iso8601: "2026-07-28T19:00:00-04:00",
        status: "DEFINITE",
        location_id: 26059,
        updated_at: "2026-07-28T16:00:00Z",
        contact_email: "private@example.com",
        rooms: [{ id: 8, name: "The Ocean Room" }],
        documents: [
          {
            id: 44,
            line_items: [
              {
                id: 501,
                description: "Bowling Lanes 5-6",
                quantity: 2,
                category: { name: "Bowling" },
                start_at: "2026-07-28T17:00:00-04:00",
                end_at: "2026-07-28T18:00:00-04:00",
              },
            ],
          },
        ],
      },
      requestedUrls,
    );
    const events = await adapter.fetchEntertainmentEventsForDate(
      "2026-07-28",
    );
    expect(events).toEqual([
      expect.objectContaining({
        tripleseatEventId: "9001",
        tripleseatBookingId: "7001",
        eventName: "Redacted Event",
        rooms: [{ id: "8", name: "The Ocean Room" }],
        items: [
          expect.objectContaining({
            name: "Bowling Lanes 5-6",
            quantity: 2,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private@example.com");
    expect(
      requestedUrls.some((url) => url.includes("/bookings/")),
    ).toBe(false);
  });

  it("filters non-definite events even when search returns one", async () => {
    const adapter = testAdapter(
      {
        id: 9001,
        name: "Canceled Event",
        event_date_iso8601: "2026-07-28",
        status: "LOST",
        location_id: 26059,
      },
      [],
    );
    expect(
      await adapter.fetchEntertainmentEventsForDate("2026-07-28"),
    ).toEqual([]);
  });
});
