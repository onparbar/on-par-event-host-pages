import { describe, expect, it } from "vitest";
import { SupabaseEntertainmentStorage } from "../storage";

function json(rows: unknown[], range?: string) {
  return new Response(JSON.stringify(rows), {
    headers: {
      "content-type": "application/json",
      ...(range ? { "content-range": range } : {}),
    },
  });
}

function storage(page: (offset: number) => Response, requests: URL[] = []) {
  return new SupabaseEntertainmentStorage({
    env: {
      NODE_ENV: "test",
      SUPABASE_URL: "https://database.example.test",
      SUPABASE_SECRET_KEY: "test-only",
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("entertainment_sync_runs")) return json([]);
      expect(new Headers(init?.headers).get("prefer")).toBe("count=exact");
      expect(url.searchParams.get("operating_date")).toBe("eq.2026-10-12");
      if (url.pathname.endsWith("entertainment_reservations"))
        return json([], "*/0");
      return page(Number(url.searchParams.get("offset")));
    },
  });
}

describe("entertainment saved schedule pagination", () => {
  it("reads past a server-imposed row cap instead of treating the first page as complete", async () => {
    const requests: URL[] = [];
    const result = await storage(
      (offset) =>
        json([{ event_id: `event-${offset}` }], `${offset}-${offset}/3`),
      requests,
    ).getDay("2026-10-12");
    expect(result.events.map((event) => event.eventId)).toEqual([
      "event-0",
      "event-1",
      "event-2",
    ]);
    expect(
      requests
        .filter((url) => url.pathname.endsWith("entertainment_event_snapshots"))
        .map((url) => url.searchParams.get("offset")),
    ).toEqual(["0", "1", "2"]);
  });

  it.each([undefined, "0-0/*", "1-1/1", "0-1/1", "0-0/10001"])(
    "rejects unverifiable content range %s",
    async (range) => {
      await expect(
        storage(() => json([{ event_id: "event-0" }], range)).getDay(
          "2026-10-12",
        ),
      ).rejects.toThrow("pagination could not be verified");
    },
  );

  it.each(["changed count", "duplicate row", "missing page"])(
    "rejects %s during traversal",
    async (failure) => {
      const source = storage((offset) =>
        offset === 0
          ? json([{ event_id: "event-0" }], "0-0/2")
          : failure === "changed count"
            ? json([{ event_id: "event-1" }], "1-1/3")
            : failure === "duplicate row"
              ? json([{ event_id: "event-0" }], "1-1/2")
              : json([], "*/2"),
      );
      await expect(source.getDay("2026-10-12")).rejects.toThrow(
        "pagination could not be verified",
      );
    },
  );

  it("accepts a proved empty date", async () => {
    const result = await storage(() => json([], "*/0")).getDay("2026-10-12");
    expect(result.events).toEqual([]);
    expect(result.reservations).toEqual([]);
    expect(result.sync).toBeNull();
  });
});
