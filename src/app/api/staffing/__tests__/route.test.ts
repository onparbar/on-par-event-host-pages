import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), cookies: vi.fn(), admin: vi.fn(), strongAdmin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: mocks.admin, requiresStrongAdminSession: mocks.strongAdmin }));
vi.mock("@/lib/staffing/service", () => ({ StaffingReviewError: class StaffingReviewError extends Error {} }));
vi.mock("@/lib/staffing/operational", () => ({
  loadOperationalStaffingRoster: mocks.load, saveOperationalStaffingTeam: mocks.save,
  OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH: 2 * 1024 * 1024,
}));

import { GET, POST } from "../route";
import { StaffingReviewError } from "@/lib/staffing/service";
import { StaleSaveError } from "@/lib/stale-save";

const origin = "https://events.example";
const date = "2026-11-10";
const shift = { shiftId: "111", employeeId: "11", employeeName: "Synthetic One", startAt: `${date}T16:00:00Z`,
  endAt: `${date}T21:00:00Z`, coversEvent: true, needsMove: false, conflict: false };
const roster = { version: 1, selectedShiftIds: ["111"], shifts: [shift], reviewToken: "opaque-test-review" };
const change = { action: "replace-team", eventId: "42", eventDate: date, expectedVersion: 1, reviewToken: roster.reviewToken,
  choices: [{ shiftId: "111" }] };
const get = (query = `eventId=42&date=${date}`) => GET(new Request(`${origin}/api/staffing?${query}`));
const post = (body: unknown, from: string | null = origin, extraHeaders: Record<string, string> = {}) => POST(new Request(`${origin}/api/staffing`, {
  method: "POST", headers: { "content-type": "application/json", ...(from === null ? {} : { origin: from }), ...extraHeaders },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
  vi.stubEnv("EVENT_HOST_PUBLIC_STAFFING_ENABLED", "true");
  vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", origin);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "false");
  mocks.load.mockResolvedValue(roster);
  mocks.save.mockResolvedValue(2);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.useRealTimers(); });

describe("passwordless event staffing roster", () => {
  it.each([undefined, "", "false", "TRUE", " true "])("requires the exact explicit public staffing flag (%s)", async (value) => {
    vi.stubEnv("EVENT_HOST_PUBLIC_STAFFING_ENABLED", value);
    expect((await get()).status).toBe(503);
    expect((await post(change)).status).toBe(503);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns only the requested minimal roster without an Admin cookie or Admin checks", async () => {
    vi.stubEnv("EVENT_HOST_STAFFING_ADMIN_ENABLED", "false");
    mocks.load.mockResolvedValue({ ...roster, state: { secret: "private" }, reconciliation: { reviews: ["Admin only"] },
      shifts: [{ ...shift, notes: "private notes", upstreamPayload: "not public" }] });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(roster);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("42", date);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.strongAdmin).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(process.env.EVENT_HOST_STAFFING_ADMIN_ENABLED).toBe("false");
  });

  it.each(["", "eventId=vip-42&date=2026-11-10", "eventId=unsafe%2Fid&date=2026-11-10", "eventId=42&date=2026-11-40",
    "eventId=42&date=9999-12-31", `eventId=${"a".repeat(129)}&date=2026-11-10`])("rejects malformed, VIP or overflowing requests (%s)", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("keeps historical events closed and does not load their roster", async () => {
    const response = await get("eventId=42&date=2026-11-09");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Past event assignments cannot be changed." });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("allows a valid selected future date", async () => {
    expect((await get("eventId=42&date=2026-11-30")).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("42", "2026-11-30");
  });

  it("returns no verification metadata or provider details for missing, unverified or unavailable rosters", async () => {
    mocks.load.mockResolvedValueOnce(null);
    const missing = await get();
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "This event isn't in the verified staffing schedule for this date." });
    mocks.load.mockRejectedValueOnce(new StaffingReviewError("The published schedule must be verified."));
    const unverified = await get();
    expect(unverified.status).toBe(422);
    expect(await unverified.json()).toEqual({ error: "The published schedule must be verified." });
    mocks.load.mockRejectedValueOnce(new Error("private provider secret"));
    const unavailable = await get();
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
    expect(await unavailable.json()).toEqual({ error: "The staffing schedule could not be loaded." });
  });
});

describe("passwordless event team replacement", () => {
  it("saves one reviewed team without Admin sign-in and returns only the version", async () => {
    const response = await post(change);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ version: 2 });
    const { action: _action, ...saved } = change;
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(saved);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.strongAdmin).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("blocks read-only Preview writes before the feature flag, origins or body parsing", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    vi.stubEnv("EVENT_HOST_PUBLIC_STAFFING_ENABLED", "false");
    const request = new Request(`${origin}/api/staffing`, { method: "POST", body: "not json" });
    const json = vi.spyOn(request, "json");
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This Preview is read-only. No staffing changes were saved." });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["https://other.example", "https://events.example/path", null])("rejects requests without the exact configured origin (%s)", async (from) => {
    expect((await post(change, from)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("requires both same-origin and configured-origin checks, including forwarded hosts", async () => {
    expect((await post(change, origin, { "x-forwarded-host": "other.example" })).status).toBe(403);
    vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", "https://other.example");
    expect((await post(change)).status).toBe(403);
    vi.stubEnv("EVENT_HOST_STAFFING_ORIGIN", "");
    expect((await post(change)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON or non-object payloads", async () => {
    expect((await POST(new Request(`${origin}/api/staffing`, { method: "POST", headers: { origin }, body: "not json" }))).status).toBe(400);
    for (const body of [null, [], "replace-team", 1]) expect((await post(body)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["sync", "assign", "assign-many", "policy", "keep-clear", "remove-manual", ""])("does not expose the Admin action %s", async (action) => {
    expect((await post({ ...change, action })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([{ eventId: "vip-42" }, { eventId: "unsafe/id" }, { eventId: "" }, { eventDate: "2026-11-40" }, { eventDate: "9999-12-31" },
    { eventDate: null }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedVersion: "1" },
    { reviewToken: "" }, { reviewToken: null }, { reviewToken: "x".repeat(2 * 1024 * 1024 + 1) }, { choices: null }, { choices: [null] },
    { choices: [{ shiftId: "unsafe/id" }] }, { choices: [{ shiftId: "111" }, { shiftId: "111" }] },
    { choices: Array.from({ length: 101 }, (_, index) => ({ shiftId: String(index) })) }])("rejects invalid event, revision, token or choices (%#)", async (patch) => {
    expect((await post({ ...change, ...patch })).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects historical event edits without touching staffing state", async () => {
    expect((await post({ ...change, eventDate: "2026-11-09" })).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("allows clearing a team and strips unknown fields and non-boolean confirmations", async () => {
    expect((await post({ ...change, choices: [] })).status).toBe(200);
    const { action: _action, ...saved } = change;
    expect(mocks.save).toHaveBeenLastCalledWith({ ...saved, choices: [] });
  });

  it("forwards only explicit move and partial-coverage confirmations", async () => {
    expect((await post({ ...change, policy: "ignored", choices: [
      { shiftId: "111", confirmMove: "true", confirmPartialCoverage: true, employeeName: "ignored" },
      { shiftId: "112", confirmMove: true, confirmPartialCoverage: false },
    ] })).status).toBe(200);
    const { action: _action, ...saved } = change;
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...saved, choices: [
      { shiftId: "111", confirmPartialCoverage: true }, { shiftId: "112", confirmMove: true },
    ] });
  });

  it("maps rejected review tokens, stale versions and storage failures without exposing private details", async () => {
    mocks.save.mockRejectedValueOnce(new StaffingReviewError("Reload the staffing choices before saving."));
    const review = await post({ ...change, reviewToken: "tampered-review-token" });
    expect(review.status).toBe(422);
    expect(await review.json()).toEqual({ error: "Reload the staffing choices before saving." });
    mocks.save.mockRejectedValueOnce(new StaleSaveError());
    expect((await post(change)).status).toBe(409);
    mocks.save.mockRejectedValueOnce(new Error("private database secret"));
    const unavailable = await post(change);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
    expect(await unavailable.json()).toEqual({ error: "Staffing could not be updated. Reload the schedule or check the published shift before trying again." });
  });
});
