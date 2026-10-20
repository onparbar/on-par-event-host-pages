import { describe, expect, it, vi } from "vitest";
import { GoTabIntegrationStorage } from "../storage";

vi.mock("server-only", () => ({}));

describe("GoTab kitchen staff lookup", () => {
  it.each([
    { rows: [{ food_runners: [" ", " Carlos ", "Brooke"] }], expected: "Carlos" },
    { rows: [{ food_runners: [] }], expected: null },
    { rows: [{ food_runners: null }], expected: null },
    { rows: [{ food_runners: null, bwa: " Carlos " }], expected: "Carlos" },
    { rows: [{ food_runners: ["Brooke"], bwa: "Carlos" }], expected: "Brooke" },
    { rows: [{ food_runners: [], bwa: '__kitchen_roles__:{"preppedBy":"Carlos"}' }], expected: null },
    { rows: [], expected: null },
  ])("reads only the selected event's current Food Runner: $expected", async ({ rows, expected }) => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(rows));
    const storage = new GoTabIntegrationStorage({
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "test-secret",
    }, fetchImpl);

    expect(await storage.getKitchenFoodRunner("vip-reservation-1")).toBe(expected);
    const [url, init] = fetchImpl.mock.calls[0];
    const requestUrl = new URL(url);
    expect(requestUrl.pathname).toBe("/rest/v1/kitchen_manual_assignments");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      select: "bwa,food_runners", event_id: "eq.vip-reservation-1", limit: "1",
    });
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("does not treat a failed staff lookup as an unassigned event", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const storage = new GoTabIntegrationStorage({ NODE_ENV: "test", SUPABASE_SECRET_KEY: "test-secret" }, fetchImpl);
    await expect(storage.getKitchenFoodRunner("event-1")).rejects.toThrow("database request failed (503)");
  });
});
