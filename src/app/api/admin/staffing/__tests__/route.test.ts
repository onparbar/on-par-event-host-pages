import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), refresh: vi.fn(), override: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/staffing/service", () => ({
  refreshStaffing: mocks.refresh, updateStaffingOverride: mocks.override, staffingSnapshotIsFresh: () => true,
}));
import { POST } from "../route";
import { GET as runCron } from "../../../staffing/sync/route";
import { createAdminSessionValue, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { STAFF_COOKIE } from "@/lib/staff-auth/protocol";
import { StaleSaveError } from "@/lib/stale-save";

const origin = "https://events.example";
const state = { version: 1, failure: null, shifts: [{ shiftId: "111", notes: "raw shift notes" }], reconciliation: { lastSuccessfulSyncAt: "2026-11-10T15:00:00Z", reviews: ["admin only"] } };
const post = (body: object, from = origin) => POST(new Request(`${origin}/api/admin/staffing`, {
  method: "POST", headers: { "content-type": "application/json", origin: from }, body: JSON.stringify(body),
}));
const admin = () => {
  const value = createAdminSessionValue()!;
  mocks.cookies.mockResolvedValue(new Map([[ADMIN_COOKIE_NAME, { name: ADMIN_COOKIE_NAME, value }]]));
};

beforeEach(() => {
  vi.stubEnv("EVENT_HOST_STAFF_LOGIN_REQUIRED", "true");
  vi.stubEnv("EVENT_HOST_ORIGIN", origin);
  vi.stubEnv("EVENT_HOST_ADMIN_PASSPHRASE", "test-only-local-admin-phrase");
  vi.stubEnv("EVENT_HOST_SESSION_SECRET", "test-only-admin-secret-with-32-characters");
  mocks.cookies.mockResolvedValue(new Map());
  mocks.refresh.mockResolvedValue(state);
  mocks.override.mockResolvedValue(state);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("staffing mutation and sync access", () => {
  it("denies staff sessions and cross-origin requests before exposing diagnostics or changing state", async () => {
    mocks.cookies.mockResolvedValue(new Map([[STAFF_COOKIE, { name: STAFF_COOKIE, value: "fake-staff-token" }]]));
    const staff = await post({ action: "sync" });
    expect(staff.status).toBe(401);
    expect(await staff.text()).not.toContain("admin only");
    admin();
    expect((await post({ action: "sync" }, "https://other.example")).status).toBe(403);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("allows Admin to sync and submit reviewed shift IDs, rejects unversioned and stale edits", async () => {
    admin();
    expect(await (await post({ action: "sync" })).json()).toEqual({ state: { ...state, shifts: [{ shiftId: "111" }] }, fresh: true });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect((await post({ action: "assign", eventId: "42", shiftId: "111" })).status).toBe(400);
    const change = { action: "assign", eventId: "42", shiftId: "111", expectedVersion: 1 };
    expect((await post(change)).status).toBe(200);
    expect(mocks.override).toHaveBeenCalledWith(change);
    mocks.override.mockRejectedValueOnce(new StaleSaveError());
    expect((await post(change)).status).toBe(409);
  });

  it("keeps cron off until rollout and returns only sanitized sync metadata", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-only");
    const cron = (token?: string) => runCron(new Request(`${origin}/api/staffing/sync`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }));
    expect((await cron()).status).toBe(401);
    expect((await cron("test-cron-only")).status).toBe(204);
    expect(mocks.refresh).not.toHaveBeenCalled();
    vi.stubEnv("EVENT_HOST_STAFFING_SYNC_ENABLED", "true");
    expect(await (await cron("test-cron-only")).json()).toEqual({ ok: true, lastSuccessfulSyncAt: state.reconciliation.lastSuccessfulSyncAt });
  });
});
