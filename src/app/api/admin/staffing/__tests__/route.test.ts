import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), refresh: vi.fn(), override: vi.fn(), load: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/staffing/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/staffing/service")>(),
  refreshStaffing: mocks.refresh, updateStaffingOverride: mocks.override, staffingSnapshotIsFresh: () => true,
}));
vi.mock("@/lib/staffing/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/staffing/storage")>(), loadStaffingState: mocks.load,
}));
import { GET, POST } from "../route";
import { createAdminSessionValue, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { StaleSaveError } from "@/lib/stale-save";

const origin = "https://events.example";
const fakeStaffCookie = "event-host-staff-session";
const state = { version: 1, failure: null, shifts: [{ shiftId: "111", notes: "raw shift notes" }], reconciliation: { lastSuccessfulSyncAt: "2026-11-10T15:00:00Z", reviews: ["admin only"] } };
const date = "2026-11-10";
const get = (query = `eventId=42&date=${date}`) => GET(new Request(`${origin}/api/admin/staffing?${query}`));
const focusEvent = { eventId: "42", eventName: "Synthetic event", date, startAt: `${date}T17:00:00Z`, endAt: `${date}T20:00:00Z` };
const otherEvent = { ...focusEvent, eventId: "43", eventName: "Unrelated event" };
const shift = { shiftId: "111", employeeId: "11", employeeName: "Synthetic One", startAt: `${date}T16:00:00Z`, endAt: `${date}T21:00:00Z`, notes: "private roster notes" };
const rosterState = {
  ...state, dailyScheduleComplete: true, events: [focusEvent, otherEvent],
  shifts: [shift, { ...shift, shiftId: "112", startAt: `${date}T18:00:00Z` },
    { ...shift, shiftId: "113", employeeId: "22", employeeName: "Synthetic Two" },
    { ...shift, shiftId: "999", employeeName: "Different-day employee", startAt: "2026-11-11T16:00:00Z", endAt: "2026-11-11T21:00:00Z" }],
  reconciliation: { ...state.reconciliation, dataStatus: "verified", window: { startDate: date }, assignments: [
    { eventId: "42", eventDate: date, employeeId: "22", shiftId: "113" },
    { eventId: "43", eventDate: date, employeeId: "11", shiftId: "111" },
  ] },
};
const post = (body: object, from = origin) => POST(new Request(`${origin}/api/admin/staffing`, {
  method: "POST", headers: { "content-type": "application/json", origin: from }, body: JSON.stringify(body),
}));
const admin = () => {
  const value = createAdminSessionValue()!;
  mocks.cookies.mockResolvedValue(new Map([[ADMIN_COOKIE_NAME, { name: ADMIN_COOKIE_NAME, value }]]));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
  vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
  vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "true");
  vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", origin);
  vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_PASSPHRASE", "test-only-local-admin-phrase");
  vi.stubEnv("EVENT_HOST_SESSION_SECRET", "test-only-admin-secret-with-32-characters");
  mocks.cookies.mockResolvedValue(new Map());
  mocks.refresh.mockResolvedValue(state);
  mocks.override.mockResolvedValue(state);
  mocks.load.mockResolvedValue(rosterState);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("inline staffing roster", () => {
  it("keeps the roster private when staffing is inactive or the request lacks Admin access", async () => {
    expect((await get()).status).toBe(401);
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "false");
    expect((await get()).status).toBe(503);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("returns only same-day shifts and exact selected IDs, with no notes or upstream calls", async () => {
    admin();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { notes: _notes, ...publicShift } = shift;
    expect(await response.json()).toEqual({ version: 1, selectedShiftIds: ["113"], shifts: [
      { ...publicShift, coversEvent: true, needsMove: true, conflict: false },
      { ...publicShift, shiftId: "112", startAt: `${date}T18:00:00Z`, coversEvent: false, needsMove: false, conflict: true },
      { ...publicShift, shiftId: "113", employeeId: "22", employeeName: "Synthetic Two", coversEvent: true, needsMove: false, conflict: false },
    ] });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.override).not.toHaveBeenCalled();
  });

  it("rejects malformed/VIP requests, unverifiable snapshots, and wrong or ambiguous event identities", async () => {
    admin();
    expect((await get(`eventId=vip-42&date=${date}`)).status).toBe(400);
    expect((await get("eventId=42&date=2026-11-40")).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
    expect((await get("eventId=42&date=2026-11-11")).status).toBe(404);
    mocks.load.mockResolvedValueOnce({ ...rosterState, events: [...rosterState.events, { ...focusEvent, date: "2026-11-11" }] });
    expect((await get()).status).toBe(404);
    mocks.load.mockResolvedValueOnce({ ...rosterState, dailyScheduleComplete: false });
    expect((await get()).status).toBe(422);
    vi.setSystemTime(new Date(`${date}T15:46:00Z`));
    expect((await get()).status).toBe(422);
  });
});

describe("staffing mutation and sync access", () => {
  it("denies staff sessions and cross-origin requests before exposing diagnostics or changing state", async () => {
    mocks.cookies.mockResolvedValue(new Map([[fakeStaffCookie, { name: fakeStaffCookie, value: "fake-staff-token" }]]));
    const staff = await post({ action: "sync" });
    expect(staff.status).toBe(401);
    expect(await staff.text()).not.toContain("admin only");
    admin();
    expect((await post({ action: "sync" }, "https://other.example")).status).toBe(403);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("allows Admin to sync and submit reviewed shift IDs, rejects unversioned and stale edits", async () => {
    admin();
    expect((await post({ action: "sync" })).status).toBe(400);
    expect(await (await post({ action: "sync", expectedVersion: 1 })).json()).toEqual({ state: { ...state, shifts: [{ shiftId: "111" }] }, fresh: true });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({}, 1);
    expect((await post({ action: "assign", eventId: "42", shiftId: "111" })).status).toBe(400);
    const change = { action: "assign", eventId: "42", shiftId: "111", expectedVersion: 1 };
    expect((await post(change)).status).toBe(200);
    expect(mocks.override).toHaveBeenCalledWith(change);
    mocks.override.mockRejectedValueOnce(new StaleSaveError());
    expect((await post(change)).status).toBe(409);
  });

  it("passes only explicit confirmations for moves and partial coverage", async () => {
    admin();
    const change = { action: "assign", eventId: "42", shiftId: "111", expectedVersion: 1 };
    expect((await post({ ...change, confirmMove: "true", confirmPartialCoverage: true })).status).toBe(200);
    expect(mocks.override).toHaveBeenCalledWith({ ...change, confirmPartialCoverage: true });
  });

  it("accepts one versioned batch, validates every entry and strips non-boolean confirmations", async () => {
    admin();
    const change = { action: "assign-many", eventId: "42", expectedVersion: 1 };
    for (const choices of [[], [null], [{ shiftId: "unsafe/id" }], [{ shiftId: "111" }, { shiftId: "111" }], Array.from({ length: 101 }, (_, id) => ({ shiftId: String(id) }))]) {
      expect((await post({ ...change, choices })).status).toBe(400);
    }
    expect(mocks.override).not.toHaveBeenCalled();
    expect((await post({ ...change, choices: [{ shiftId: "111", confirmMove: "true" }, { shiftId: "222", confirmPartialCoverage: true }] })).status).toBe(200);
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith({ ...change, choices: [{ shiftId: "111" }, { shiftId: "222", confirmPartialCoverage: true }] });
  });

  it("blocks even authorized Admin writes in a read-only Preview", async () => {
    admin();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    expect((await post({ action: "assign", eventId: "42", shiftId: "111", expectedVersion: 1 })).status).toBe(403);
    expect((await post({ action: "assign-many", eventId: "42", choices: [{ shiftId: "111" }], expectedVersion: 1 })).status).toBe(403);
    expect((await post({ action: "replace-team", eventId: "42", choices: [], expectedVersion: 1 })).status).toBe(403);
    expect((await post({ action: "sync", expectedVersion: 1 })).status).toBe(403);
    expect(mocks.override).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("allows standalone staffing only with a strong Admin session and no Staff Tools connection", async () => {
    vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "false");
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "false");
    vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
    vi.stubEnv("STAFF_TOOLS_ORIGIN", "");
    vi.stubEnv("STAFF_TOOLS_HANDOFF_SECRET", "");
    admin();
    expect((await post({ action: "sync", expectedVersion: 1 })).status).toBe(503);
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "true");
    expect((await post({ action: "sync", expectedVersion: 1 })).status).toBe(401);
    expect(mocks.refresh).not.toHaveBeenCalled();
    admin();
    expect((await post({ action: "sync", expectedVersion: 1 })).status).toBe(200);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("allows an empty versioned team replacement but rejects stale sync", async () => {
    admin();
    const change = { action: "replace-team", eventId: "42", choices: [], expectedVersion: 1 };
    expect((await post(change)).status).toBe(200);
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith(change);
    mocks.refresh.mockRejectedValueOnce(new StaleSaveError());
    expect((await post({ action: "sync", expectedVersion: 0 })).status).toBe(409);
  });

  it("passes the exact event date for inline replacement and returns only the new version", async () => {
    admin();
    const change = { action: "replace-team", eventId: "42", eventDate: date, choices: [{ shiftId: "111" }], expectedVersion: 1 };
    expect((await post({ ...change, eventDate: "2026-11-40" })).status).toBe(400);
    expect((await post({ ...change, eventId: "vip-42" })).status).toBe(400);
    expect(mocks.override).not.toHaveBeenCalled();
    mocks.override.mockResolvedValueOnce({ ...state, version: 2 });
    const response = await post(change);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 2 });
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith(change);
  });
});
