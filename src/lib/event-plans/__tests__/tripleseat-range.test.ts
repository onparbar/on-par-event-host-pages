import { describe, expect, it } from "vitest";
import { createMemoryKitchenStorage } from "@/lib/kitchen/storage";
import { LiveTripleseatAdapter } from "@/lib/kitchen/tripleseat";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Tripleseat rolling event-plan source", () => {
  it("uses one date-range search and imports sanitized notes for every event", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);

      if (url.includes("/events/search?")) {
        const requestUrl = new URL(url);
        expect(requestUrl.searchParams.get("event_start_date")).toBe(
          "07/30/2026",
        );
        expect(requestUrl.searchParams.get("event_end_date")).toBe(
          "08/30/2026",
        );
        expect(requestUrl.searchParams.get("location_ids")).toBe("26059");
        expect(requestUrl.searchParams.has("status")).toBe(false);
        return json({ results: [{ id: 91 }], total_pages: 1 });
      }
      if (url.includes("/events/91?")) {
        return json({
          event: {
            id: 91,
            booking_id: 501,
            name: "<strong>Redacted Event</strong>",
            event_date_iso8601: "2026-08-15",
            event_start_iso8601: "2026-08-15T17:00:00-04:00",
            event_end_iso8601: "2026-08-15T20:00:00-04:00",
            guest_count: 50,
            status: "DEFINITE",
            location_id: 26059,
            rooms: [{ id: 1, name: "VIP 1" }],
            updated_at: "2026-07-30T16:00:00Z",
            documents: [
              {
                id: 700,
                line_items: [
                  {
                    id: 701,
                    description: "Tater Keg Platter",
                    quantity: 1,
                    category: { name: "Food Platters" },
                  },
                  {
                    id: 702,
                    description: "Duckpin Bowling",
                    quantity: 2,
                    category: { name: "Entertainment" },
                    start_at: "2026-08-15T18:00:00-04:00",
                    end_at: "2026-08-15T19:00:00-04:00",
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
              id: 801,
              display_name: "Tater Keg Platter",
              quantity: 1,
              category: { name: "Food Platters" },
            },
          ],
        });
      }
      if (url.includes("/events/91/notes?")) {
        return json({
          notes: [
            {
              id: 901,
              body:
                "<p>Set up three tables near the stage.</p><p>Call host@example.com or 937-555-0199 before guest arrival.</p>",
              created_at: "2026-07-29T15:00:00Z",
              updated_at: "2026-07-30T15:00:00Z",
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
        TRIPLESEAT_CLIENT_SECRET: "test-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
        TRIPLESEAT_LOCATION_ID: "26059",
      },
      fetchImpl,
      storage: createMemoryKitchenStorage(),
    });

    const plans = await adapter.fetchEventPlansForRange(
      "2026-07-30",
      "2026-08-30",
    );

    expect(plans).toEqual([
      expect.objectContaining({
        eventId: "91",
        bookingId: "501",
        eventName: "Redacted Event",
        localDate: "2026-08-15",
        guestCount: 50,
        rooms: ["VIP 1"],
        operationalNotesAvailable: true,
        operationalNotesTruncated: false,
        omittedOperationalNoteFragmentCount: 0,
        shortenedOperationalNoteFragmentCount: 0,
      }),
    ]);
    expect(plans[0].selections).toEqual([
      expect.objectContaining({
        name: "Tater Keg Platter",
        quantity: 1,
      }),
    ]);
    expect(plans[0].documentItems.map((item) => item.name)).toEqual([
      "Tater Keg Platter",
      "Duckpin Bowling",
    ]);
    expect(plans[0].operationalNotes).toEqual([
      expect.objectContaining({
        source: "event-note",
        sourceId: "901",
        sourceCreatedAt: "2026-07-29T15:00:00Z",
        sourceUpdatedAt: "2026-07-30T15:00:00Z",
        text: "Set up three tables near the stage.",
      }),
      expect.objectContaining({
        sourceId: "901",
        text:
          "Call [email redacted] or [phone redacted] before guest arrival.",
      }),
    ]);
    expect(JSON.stringify(plans)).not.toContain("host@example.com");
    expect(JSON.stringify(plans)).not.toContain("937-555");
    expect(
      urls.filter((url) => url.includes("/events/search?")),
    ).toHaveLength(1);
    expect(
      urls.filter((url) => url.includes("/events/91/notes?")),
    ).toHaveLength(1);
  });

  it("rejects a reversed range before making a request", async () => {
    const adapter = new LiveTripleseatAdapter({
      env: {
        NODE_ENV: "test",
        TRIPLESEAT_CLIENT_ID: "test-client",
        TRIPLESEAT_CLIENT_SECRET: "test-secret",
        TRIPLESEAT_ACCESS_TOKEN: "test-access-token",
        TRIPLESEAT_REFRESH_TOKEN: "test-refresh-token",
      },
      fetchImpl: async () => {
        throw new Error("Request should not run.");
      },
      storage: createMemoryKitchenStorage(),
    });

    await expect(
      adapter.fetchEventPlansForRange("2026-08-30", "2026-07-30"),
    ).rejects.toThrow("ordered YYYY-MM-DD");
  });

  it("distinguishes an unavailable Notes endpoint from no notes", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/events/search?")) {
        return json({ results: [{ id: 92 }], total_pages: 1 });
      }
      if (url.includes("/events/92?")) {
        return json({
          event: {
            id: 92,
            name: "Redacted Notes-Unavailable Event",
            event_date_iso8601: "2026-08-16",
            event_start_iso8601: "2026-08-16T17:00:00-04:00",
            event_end_iso8601: "2026-08-16T19:00:00-04:00",
            guest_count: 20,
            status: "DEFINITE",
            location_id: 26059,
            rooms: [{ name: "VIP 1" }],
            updated_at: "2026-07-30T16:00:00Z",
          },
        });
      }
      if (url.includes("/menu_item_selections")) {
        return json({ menu_item_selections: [] });
      }
      if (url.includes("/events/92/notes?")) {
        return json({ error: "not found" }, 404);
      }
      throw new Error(`Unexpected test request: ${url}`);
    };
    const adapter = new LiveTripleseatAdapter({
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

    const [plan] = await adapter.fetchEventPlansForRange(
      "2026-07-30",
      "2026-08-30",
    );

    expect(plan.operationalNotes).toEqual([]);
    expect(plan.operationalNotesAvailable).toBe(false);
  });
});
