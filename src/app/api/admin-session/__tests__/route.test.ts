import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE_NAME, createAdminSessionValue, hasAdminSession } from "@/lib/admin-auth";
import { DELETE, POST } from "../route";

vi.mock("server-only", () => ({}));

const origin = "https://event-host.test";
const passphrase = "synthetic-local-admin-password";
const syntheticDatabase = "https://isolated.test";
const serviceKey = "sb_secret_synthetic_test_value";
const fetchMock = vi.fn<typeof fetch>();

function request(body: Record<string, string>, from = origin) {
  return new Request(`${origin}/api/admin-session`, {
    method: "POST", headers: { origin: from, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "true");
  vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");
  vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", origin);
  vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_PASSPHRASE", passphrase);
  vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
  vi.stubEnv("EVENT_HOST_SESSION_SECRET", "test-only-long-standalone-session-secret");
  vi.stubEnv("SUPABASE_URL", syntheticDatabase);
  vi.stubEnv("SUPABASE_SECRET_KEY", serviceKey);
  vi.stubEnv("VERCEL", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json(true));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("standalone staffing Admin session", () => {
  it("keeps legacy Admin independent and unchanged while staffing is off", async () => {
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "false");
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
    vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", "");
    const response = await POST(request({ pin: "1234" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=43200");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "true");
    expect(hasAdminSession({ get: () => response.cookies.get(ADMIN_COOKIE_NAME) })).toBe(false);
  });

  it("rejects a cross-origin sign-in before using the private database", async () => {
    expect((await POST(request({ passphrase }, "https://other.test"))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a PIN attempt but never accepts legacy access when staffing is on", async () => {
    expect((await POST(request({ pin: "1234" }))).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("issues a short, server-only Admin cookie only after the private counter permits it", async () => {
    const response = await POST(request({ passphrase }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${syntheticDatabase}/rest/v1/rpc/record_event_host_staffing_admin_attempt`);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(new Headers(init?.headers).get("apikey")).toBe(serviceKey);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body)).p_attempt_key).toMatch(/^[a-f0-9]{64}$/);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("Max-Age=7200");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(hasAdminSession({ get: () => response.cookies.get(ADMIN_COOKIE_NAME) })).toBe(true);
  });

  it("rejects expired cookies and invalidates existing cookies when the passphrase changes", () => {
    const started = 1_800_000_000_000;
    const value = createAdminSessionValue(started)!;
    const cookies = { get: () => ({ name: ADMIN_COOKIE_NAME, value }) };
    expect(hasAdminSession(cookies, started + 7199_000)).toBe(true);
    expect(hasAdminSession(cookies, started + 7200_000)).toBe(false);
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_PASSPHRASE", "different-synthetic-admin-passphrase");
    expect(hasAdminSession(cookies, started)).toBe(false);
  });

  it("fails closed on throttling, an unavailable database, or missing dedicated session secret", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(false));
    const throttled = await POST(request({ passphrase }));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("900");
    expect(throttled.cookies.get(ADMIN_COOKIE_NAME)).toBeUndefined();

    fetchMock.mockResolvedValueOnce(Response.json({ invalid: true }));
    expect((await POST(request({ passphrase }))).status).toBe(503);

    vi.stubEnv("EVENT_HOST_SESSION_SECRET", "");
    expect((await POST(request({ passphrase }))).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows same-origin sign-out but rejects cross-origin sign-out", async () => {
    expect((await DELETE(new Request(`${origin}/api/admin-session`, { method: "DELETE" }))).status).toBe(403);
    const response = await DELETE(new Request(`${origin}/api/admin-session`, { method: "DELETE", headers: { origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
