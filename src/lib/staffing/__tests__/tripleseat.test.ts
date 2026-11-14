import { describe, expect, it, vi } from "vitest";
import { createMemoryKitchenStorage } from "@/lib/kitchen/storage";
import { encryptTripleseatTokenState, LiveTripleseatAdapter } from "@/lib/kitchen/tripleseat";

const start = "2026-11-10", end = "2026-11-16";
const now = Date.parse(`${start}T12:00:00Z`);
const key = "12345678901234567890123456789012";
const storedAccessToken = "stored-access";
const detail = { id: 91, name: "Redacted party", status: "DEFINITE", location_id: 26059, event_date_iso8601: start,
  event_start_iso8601: "2026-11-10T17:00:00-05:00", event_end_iso8601: "2026-11-10T20:00:00-05:00" };

function storedToken(expiresAt: number | null = now + 60_000) {
  return { encryptedTokens: encryptTripleseatTokenState({ accessToken: storedAccessToken, refreshToken: "stored-refresh", expiresAt }, key),
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString() };
}

function adapter(fetchImpl: typeof fetch, options: {
  token?: ReturnType<typeof storedToken> | null;
  now?: () => number;
  encryptionKey?: string;
} = {}) {
  const storage = createMemoryKitchenStorage();
  const getToken = vi.spyOn(storage, "getEncryptedTokenState").mockResolvedValue(options.token === undefined ? storedToken() : options.token);
  const saveToken = vi.spyOn(storage, "saveEncryptedTokenState");
  const client = new LiveTripleseatAdapter({ fetchImpl, storage, now: options.now ?? (() => now), env: {
    NODE_ENV: "test", TRIPLESEAT_CLIENT_ID: "test-client", TRIPLESEAT_CLIENT_SECRET: "test-secret",
    TRIPLESEAT_ACCESS_TOKEN: "test-access", TRIPLESEAT_REFRESH_TOKEN: "test-refresh", TRIPLESEAT_LOCATION_ID: "26059",
    TRIPLESEAT_TOKEN_ENCRYPTION_KEY: options.encryptionKey ?? key,
  } });
  return { client, getToken, saveToken };
}

describe("strict Tripleseat staffing reads", () => {
  it("completes venue/date pagination, reads only scoped metadata, and skips lost bookings", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${storedAccessToken}`);
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      if (url.pathname.endsWith("/events/search")) {
        expect(url.searchParams.get("event_start_date")).toBe("11/10/2026");
        expect(url.searchParams.get("event_end_date")).toBe("11/16/2026");
        expect(url.searchParams.get("location_ids")).toBe("26059");
        expect(url.searchParams.has("status")).toBe(false);
        return Response.json({ total_pages: 2, results: url.searchParams.get("page") === "1" ? [{ id: 91 }, { id: 92, status: "LOST" }] : [{ id: 93 }, { id: 94, location_id: 999 }] });
      }
      expect(url.search).toBe("");
      if (url.pathname.endsWith("/events/91")) return Response.json({ event: { ...detail, confidential_contact: "private fixture" } });
      if (url.pathname.endsWith("/events/93")) return Response.json({ event: { ...detail, id: 93, status: "LOST" } });
      throw new Error("Unexpected Tripleseat staffing request");
    });
    const { client, getToken, saveToken } = adapter(request);
    expect(await client.fetchStaffingEventsForRange(start, end)).toEqual([{ eventId: "91", eventName: "Redacted party", localDate: start,
      eventStartAt: detail.event_start_iso8601, eventEndAt: detail.event_end_iso8601 }]);
    expect(request).toHaveBeenCalledTimes(4);
    expect(getToken).toHaveBeenCalledOnce();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it.each([{ results: [], total_pages: 2 }, { results: [{ id: 91 }], total_pages: 2 }, { error: "malformed" }])("fails rather than treating a partial page as authoritative (%o)", async (secondPage) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ id: 91 }], total_pages: 2 })).mockResolvedValueOnce(Response.json(secondPage));
    await expect(adapter(request).client.fetchStaffingEventsForRange(start, end)).rejects.toThrow(/staffing search/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("accepts an explicit empty result without an unverified status fallback", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ results: [], total_pages: 0 }));
    await expect(adapter(request).client.fetchStaffingEventsForRange(start, end)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", { token: null }], ["missing encryption key", { encryptionKey: "" }],
    ["unknown expiration", { token: storedToken(null) }], ["expired", { token: storedToken(now - 1) }],
    ["too close to expiry", { token: storedToken(now + 30_000) }],
    ["mismatched expiration", { token: { ...storedToken(), expiresAt: new Date(now + 50_000).toISOString() } }],
    ["invalid encrypted state", { token: { ...storedToken(), encryptedTokens: "invalid-envelope" } }],
  ] as const)("stops without provider reads, fallback or persistence when stored authorization is %s", async (_condition, options) => {
    const request = vi.fn();
    const { client, saveToken } = adapter(request, options);
    await expect(client.fetchStaffingEventsForRange(start, end)).rejects.toThrow("existing unexpired Tripleseat access token");
    expect(request).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it.each([401, 403, 302])("stops on HTTP %s without retrying or refreshing", async (status) => {
    const request = vi.fn().mockResolvedValue(Response.json({}, { status }));
    const { client, getToken, saveToken } = adapter(request);
    await expect(client.fetchStaffingEventsForRange(start, end)).rejects.toThrow(`failed (${status})`);
    expect(request).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/events/search?"),
      expect.objectContaining({ method: "GET", redirect: "error" }));
    expect(getToken).toHaveBeenCalledOnce();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it("stops before the next GET if the same token expires during pagination", async () => {
    let clock = now;
    const request = vi.fn(async () => {
      clock += 31_000;
      return Response.json({ results: [{ id: 91 }], total_pages: 2 });
    });
    const { client, getToken, saveToken } = adapter(request, { now: () => clock });
    await expect(client.fetchStaffingEventsForRange(start, end)).rejects.toThrow("existing unexpired Tripleseat access token");
    expect(request).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledOnce();
    expect(saveToken).not.toHaveBeenCalled();
  });
});
