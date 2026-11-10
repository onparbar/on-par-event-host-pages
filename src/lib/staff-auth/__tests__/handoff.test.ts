import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as begin } from "@/app/api/staff-auth/start/route";
import { POST as exchange } from "@/app/api/staff-auth/exchange/route";
import { POST as logout } from "@/app/api/staff-auth/logout/route";
import { POST as revoke } from "@/app/api/staff-auth/revoke/route";
import { POST as adminLogin } from "@/app/api/admin-session/route";
import { ADMIN_COOKIE_NAME, createAdminSessionValue, hasAdminSession, STRONG_ADMIN_SESSION_SECONDS } from "@/lib/admin-auth";
import { proxy } from "@/proxy";
import { HANDOFF_COOKIE, isStaffSessionProof, makeHandoffState, opaqueId, signHandoff, STAFF_COOKIE, staffBridge, tokenHash, verifyHandoff } from "../protocol";
import { readStaffSession } from "../session";

vi.mock("server-only", () => ({}));

const staffTools = "https://staff-tools.example";
const host = "https://event-host.example";
const user = { employeeId: "12345", name: "Test Employee", active: true };
const testSecret = "fake-bridge-secret-at-least-32-characters";
const testPassphrase = "local-only-long-test-admin-passphrase";
type Row = { token_hash: string; handoff_hash: string; employee_id: string; staff_session: string; expires_at: string; revoked_at?: string };
let rows: Row[];
let revokedGroups: Set<string>;
let active: boolean;
let identityAvailable: boolean;
let groupCheckAvailable: boolean;
let attempts: number;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const [key, value] of Object.entries({
    EVENT_HOST_STAFF_LOGIN_REQUIRED: "true", EVENT_HOST_ORIGIN: host, STAFF_TOOLS_ORIGIN: staffTools,
    STAFF_TOOLS_HANDOFF_SECRET: testSecret, SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "fake-local-server-value",
    EVENT_HOST_ADMIN_PASSPHRASE: testPassphrase, EVENT_HOST_SESSION_SECRET: "fake-admin-session-key-separate-from-staff",
  })) vi.stubEnv(key, value);
  rows = [];
  revokedGroups = new Set();
  active = true;
  identityAvailable = true;
  groupCheckAvailable = true;
  attempts = 0;
  network = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.href === `${staffTools}/api/event-host/identity`) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${testSecret}`);
      expect(body).toEqual({ employeeId: user.employeeId, staffSession: expect.any(String) });
      expect(isStaffSessionProof(body.staffSession)).toBe(true);
      if (!identityAvailable) return Response.json({});
      return Response.json({ ...user, active });
    }
    if (url.pathname.endsWith("/record_event_host_auth_attempt")) return Response.json(++attempts <= 8);
    if (url.pathname.endsWith("/create_event_host_staff_session")) {
      if (revokedGroups.has(tokenHash(body.p_staff_session)) || rows.some((row) => row.handoff_hash === body.p_handoff_hash)) return Response.json(false);
      rows.push({ token_hash: body.p_token_hash, handoff_hash: body.p_handoff_hash, employee_id: body.p_employee_id,
        staff_session: body.p_staff_session, expires_at: body.p_expires_at });
      return Response.json(true);
    }
    if (url.pathname.endsWith("/find_event_host_staff_session")) {
      if (!groupCheckAvailable) return Response.json({}, { status: 503 });
      const row = rows.find((candidate) => body.p_token_hash === candidate.token_hash && !candidate.revoked_at &&
        !revokedGroups.has(tokenHash(candidate.staff_session)));
      return Response.json(row ? [row] : []);
    }
    if (url.pathname.endsWith("/event_host_staff_session_revocations") && init?.method === "POST") {
      expect(body).toEqual({ staff_session_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
      revokedGroups.add(body.staff_session_hash);
      return new Response(null, { status: 201 });
    }
    if (url.pathname.endsWith("/event_host_staff_sessions") && init?.method === "PATCH") {
      const row = rows.find((candidate) => url.searchParams.get("token_hash") === `eq.${candidate.token_hash}` && !candidate.revoked_at);
      if (row) row.revoked_at = body.revoked_at;
      return new Response(null, { status: 204 });
    }
    throw new Error("Unconfigured test endpoint");
  });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function exchangeRequest(assertion: string, stateCookie: string, origin = staffTools) {
  return new NextRequest(`${host}/api/staff-auth/exchange`, {
    method: "POST", headers: { origin, cookie: `${HANDOFF_COOKIE}=${stateCookie}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ assertion }),
  });
}

const loginProof = () => `${opaqueId()}.${opaqueId()}`;

function revokeRequest(staffSession: string, authorization = `Bearer ${testSecret}`) {
  return new NextRequest(`${host}/api/staff-auth/revoke`, {
    method: "POST", headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ staffSession }),
  });
}

async function signedIn(staffSession = loginProof()) {
  const initial = begin(new Request(`${host}/api/staff-auth/start`));
  const location = new URL(initial.headers.get("location")!);
  const stateCookie = initial.cookies.get(HANDOFF_COOKIE)!;
  expect(initial.status).toBe(303);
  expect(location.origin).toBe(staffTools);
  expect(initial.headers.get("set-cookie")).toContain("SameSite=none");
  const assertion = signHandoff(staffBridge()!, user.employeeId, location.searchParams.get("state")!, staffSession);
  const result = await exchange(exchangeRequest(assertion, stateCookie.value));
  expect(result.status).toBe(303);
  expect(result.headers.get("location")).toBe(`${host}/`);
  expect(result.headers.get("set-cookie")).toContain("HttpOnly");
  return { token: result.cookies.get(STAFF_COOKIE)!.value, assertion, stateCookie: stateCookie.value, staffSession };
}

describe("Staff Tools to Event Host handoff (simulated signed-in issuer)", () => {
  it("refuses live aliases in Vercel preview and rejects dotted origin spellings", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("STAFF_TOOLS_ORIGIN", "https://on-par.vercel.app:444");
    expect(staffBridge()).toBeNull();
    vi.stubEnv("STAFF_TOOLS_ORIGIN", staffTools);
    vi.stubEnv("EVENT_HOST_ORIGIN", "https://eventhost-opal.vercel.app.");
    expect(staffBridge()).toBeNull();
  });
  it("recognizes a stable employee once, with neither Punch ID nor handoff assertion in the browser URL or session storage", async () => {
    const { token, assertion, stateCookie } = await signedIn();
    expect(await readStaffSession(token)).toEqual({ employeeId: user.employeeId, name: user.name });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(assertion);
    expect(rows[0].employee_id).toBe(user.employeeId);
    expect((await exchange(exchangeRequest(assertion, stateCookie))).status).toBe(401);
  });

  it("rejects cross-origin, expired, incorrect state and tampered handoffs", async () => {
    const bridge = staffBridge()!;
    const now = Date.now();
    const original = makeHandoffState(bridge, now);
    const signature = signHandoff(bridge, user.employeeId, original.state, loginProof(), now);
    expect((await exchange(exchangeRequest(signature, original.cookie, "https://other.example"))).status).toBe(403);
    expect(verifyHandoff(signature, original.cookie, bridge, now + 61_000)).toBeNull();
    expect(verifyHandoff(signature, makeHandoffState(bridge, now).cookie, bridge, now)).toBeNull();
    expect(verifyHandoff(`x${signature}`, original.cookie, bridge, now)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects correctly signed assertions without the required Staff Tools login proof", async () => {
    const bridge = staffBridge()!;
    const state = makeHandoffState(bridge);
    const [payload] = signHandoff(bridge, user.employeeId, state.state, loginProof()).split(".");
    const unsigned = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    for (const invalid of [undefined, "not-a-proof", "A".repeat(982) + "." + opaqueId()]) {
      const data = Buffer.from(JSON.stringify({ ...unsigned, staffSession: invalid })).toString("base64url");
      const sig = createHmac("sha256", bridge.secret).update(`event-host-handoff-v1:${data}`).digest("base64url");
      expect((await exchange(exchangeRequest(`${data}.${sig}`, state.cookie))).status).toBe(401);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("denies deactivated employees and expired sessions before the next protected request", async () => {
    const { token } = await signedIn();
    const request = () => new NextRequest(`${host}/api/checklists`, { headers: { cookie: `${STAFF_COOKIE}=${token}` } });
    expect((await proxy(request())).headers.get("x-middleware-next")).toBe("1");
    active = false;
    expect((await proxy(request())).status).toBe(401);
    active = true;
    rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await proxy(request())).status).toBe(401);
  });

  it("fails closed on a malformed upstream identity without revoking a still-active employee", async () => {
    const { token } = await signedIn();
    identityAvailable = false;
    expect(await readStaffSession(token)).toBeNull();
    expect(rows[0].revoked_at).toBeUndefined();
    identityAvailable = true;
    expect((await readStaffSession(token))?.name).toBe(user.name);
  });

  it("revokes the Event Host session, clears Admin on a shared device, and requests a fresh upstream employee", async () => {
    const { token } = await signedIn();
    const result = await logout(new NextRequest(`${host}/api/staff-auth/logout?switch=1`, {
      method: "POST", headers: { origin: host, cookie: `${STAFF_COOKIE}=${token}` },
    }));
    expect(result.cookies.get(STAFF_COOKIE)?.maxAge).toBe(0);
    expect(result.cookies.get(ADMIN_COOKIE_NAME)?.maxAge).toBe(0);
    expect(result.headers.get("location")).toBe(`${host}/api/staff-auth/start?switch=1`);
    expect(await readStaffSession(token)).toBeNull();
    const fresh = begin(new Request(result.headers.get("location")!));
    expect(new URL(fresh.headers.get("location")!).searchParams.get("switch")).toBe("1");
  });

  it("revokes all Event Host sessions for one Staff Tools sign-in, without affecting another sign-in for the same employee", async () => {
    const first = await signedIn();
    const sameSignIn = await signedIn(first.staffSession);
    const independent = await signedIn();
    expect((await proxy(revokeRequest(first.staffSession))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(new NextRequest(`${host}/api/staff-auth/revoke`))).status).toBe(401);
    expect((await revoke(revokeRequest(first.staffSession, "Bearer wrong"))).status).toBe(401);
    expect((await revoke(revokeRequest("not-a-proof"))).status).toBe(400);
    expect(await readStaffSession(first.token)).not.toBeNull();
    expect((await revoke(revokeRequest(first.staffSession))).status).toBe(204);
    expect((await revoke(revokeRequest(first.staffSession))).status).toBe(204);
    expect(await readStaffSession(first.token)).toBeNull();
    expect(await readStaffSession(sameSignIn.token)).toBeNull();
    expect(await readStaffSession(independent.token)).toEqual({ employeeId: user.employeeId, name: user.name });
    expect([...revokedGroups]).toEqual([tokenHash(first.staffSession)]);
  });

  it("retains a tombstone before any exchange and fails closed even if a concurrently inserted row remains", async () => {
    const staffSession = loginProof();
    const bridge = staffBridge()!;
    const state = makeHandoffState(bridge);
    const assertion = signHandoff(bridge, user.employeeId, state.state, staffSession);
    expect((await revoke(revokeRequest(staffSession))).status).toBe(204);
    expect(rows).toHaveLength(0);
    expect((await exchange(exchangeRequest(assertion, state.cookie))).status).toBe(401);
    const token = opaqueId();
    rows.push({ token_hash: tokenHash(token), handoff_hash: tokenHash(opaqueId()), employee_id: user.employeeId, staff_session: staffSession,
      expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await readStaffSession(token)).toBeNull();
  });

  it("does not treat a failed group check as active or revoke the employee", async () => {
    const { token } = await signedIn();
    groupCheckAvailable = false;
    expect(await readStaffSession(token)).toBeNull();
    expect(rows[0].revoked_at).toBeUndefined();
    groupCheckAvailable = true;
    expect(await readStaffSession(token)).not.toBeNull();
  });

  it("blocks protected pages, APIs and customer assets without a staff session", async () => {
    for (const path of ["/", "/floor-plans", "/itinerary-pdfs/test.pdf", "/_next/image?url=%2Fbrand%2F..%2Ffloor-plans%2Ftest.png&w=512&q=75"]) {
      expect((await proxy(new NextRequest(`${host}${path}`))).headers.get("location")).toBe(`${host}/staff-sign-in`);
    }
    const logo = new NextRequest(`${host}/_next/image?url=%2Fbrand%2Fon-par-logo-white-transparent.png&w=256&q=75`);
    expect((await proxy(logo)).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(new NextRequest(`${host}/api/floor-plans`))).status).toBe(401);
    expect((await proxy(new NextRequest(`${host}/api/admin/staffing`))).status).toBe(401);
  });

  it("does not promote a staff cookie, refuses repeated Admin attempts, and expires the distinct Admin cookie", async () => {
    const { token } = await signedIn();
    expect(hasAdminSession({ get: () => ({ name: ADMIN_COOKIE_NAME, value: token }) })).toBe(false);
    const post = (passphrase: string) => adminLogin(new Request(`${host}/api/admin-session`, {
      method: "POST", headers: { origin: host, "content-type": "application/json" }, body: JSON.stringify({ passphrase }),
    }));
    for (let i = 0; i < 8; i++) expect((await post("incorrect")).status).toBe(401);
    expect((await post(testPassphrase)).status).toBe(429);
    attempts = 0;
    const result = await post(testPassphrase);
    expect(result.status).toBe(200);
    const cookie = result.cookies.get(ADMIN_COOKIE_NAME)!;
    expect(hasAdminSession({ get: () => cookie })).toBe(true);
    expect(hasAdminSession({ get: () => cookie }, Date.now() + STRONG_ADMIN_SESSION_SECONDS * 1000)).toBe(false);
    expect(createAdminSessionValue()).not.toBe(cookie.value);
  });
});
