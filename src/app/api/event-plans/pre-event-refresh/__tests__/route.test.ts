import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshUpcomingTripleseatEvents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/event-plans/pre-event-refresh", () => ({ refreshUpcomingTripleseatEvents }));

import { GET } from "../route";

const result = { dueDates: 1, refreshedDates: ["2026-11-05"], failedDates: [] };
const request = (authorization?: string) => new Request("https://example.test/api/event-plans/pre-event-refresh", {
  headers: authorization ? { authorization } : undefined,
});

describe("scheduled pre-event refresh route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    refreshUpcomingTripleseatEvents.mockReset().mockResolvedValue(result);
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "Bearer wrong", "Bearer test-cron-secrex", "Basic test-cron-secret"])(
    "rejects invalid authorization without running the worker (%s)", async (authorization) => {
      const response = await GET(request(authorization));

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ error: "Unauthorized." });
      expect(refreshUpcomingTripleseatEvents).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", "  "])("fails closed when the cron secret is not configured (%s)", async (secret) => {
    vi.stubEnv("CRON_SECRET", secret);

    const response = await GET(request("Bearer test-cron-secret"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(refreshUpcomingTripleseatEvents).not.toHaveBeenCalled();
  });

  it("returns the worker's date summary for the configured bearer token", async () => {
    vi.stubEnv("CRON_SECRET", " test-cron-secret ");

    const response = await GET(request("Bearer test-cron-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(result);
    expect(refreshUpcomingTripleseatEvents).toHaveBeenCalledExactlyOnceWith();
  });

  it("returns 502 and only the date summary for a partially failed refresh", async () => {
    const summary = { dueDates: 2, refreshedDates: ["2026-11-05"], failedDates: ["2026-11-06"] };
    refreshUpcomingTripleseatEvents.mockResolvedValueOnce(summary);

    const response = await GET(request("Bearer test-cron-secret"));

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(summary);
    expect(refreshUpcomingTripleseatEvents).toHaveBeenCalledOnce();
  });

  it("returns a generic 502 without upstream details or credentials if the worker throws", async () => {
    refreshUpcomingTripleseatEvents.mockRejectedValueOnce(new Error("Private upstream failure: test-cron-secret"));

    const response = await GET(request("Bearer test-cron-secret"));

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Scheduled Tripleseat refresh could not complete." });
    expect(refreshUpcomingTripleseatEvents).toHaveBeenCalledOnce();
  });
});
