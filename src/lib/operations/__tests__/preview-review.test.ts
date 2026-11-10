import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isPreviewReviewOnly, isPreviewStaffAuthRehearsal, previewReviewBlocksRequest } from "../preview-review";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());
const review = { VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" };
const rehearsal = { ...review, EVENT_HOST_STAFF_LOGIN_REQUIRED: "true", EVENT_HOST_STAFF_AUTH_REHEARSAL: "true" };

describe("protected read-only Preview", () => {
  it("is opt-in per Preview deployment and cannot disable Production operations", () => {
    expect(isPreviewReviewOnly(review)).toBe(true);
    for (const env of [{}, { VERCEL_ENV: "preview" }, { ...review, VERCEL_ENV: "production" }, { ...review, VERCEL_ENV: "development" }]) {
      expect(isPreviewReviewOnly(env)).toBe(false);
      expect(previewReviewBlocksRequest("POST", "/api/vip-checkin", env)).toBe(false);
    }
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s before any operational handler", async (method) => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    const response = await proxy(new NextRequest("https://review.example/api/vip-checkin", { method }));
    expect(response.status).toBe(403);
  });
  it.each(["/api/gotab/reconcile", "/api/event-plans/sync", "/api/event-plans/pre-event-refresh", "/api/checklists/auto-submit", "/api/staffing/sync", "/api/kitchen/oauth/start", "/api/kitchen/oauth/callback"])("blocks mutating GET %s", (pathname) => {
    expect(previewReviewBlocksRequest("GET", pathname, review)).toBe(true);
    expect(previewReviewBlocksRequest("GET", pathname, rehearsal)).toBe(true);
  });
  it.each(["/api/vip-checkin/health", "/api/vip-checkin", "/api/kitchen/day", "/api/entertainment/schedule", "/api/release-status"])("keeps read-only view %s available", (pathname) => {
    expect(previewReviewBlocksRequest("GET", pathname, review)).toBe(false);
  });
  it("keeps private JSON blocked independently of review mode", async () => {
    expect((await proxy(new NextRequest("https://review.example/data/event-plan-data.json"))).status).toBe(404);
  });
});

describe("read-only Preview staff auth rehearsal", () => {
  it("requires Preview, read-only review, staff login, and the explicit rehearsal flag", () => {
    expect(isPreviewStaffAuthRehearsal(rehearsal)).toBe(true);
    for (const env of [review, { ...rehearsal, VERCEL_ENV: "production" }, { ...rehearsal, VERCEL_ENV: "development" },
      { ...rehearsal, EVENT_HOST_REVIEW_ONLY: "false" }, { ...rehearsal, EVENT_HOST_STAFF_LOGIN_REQUIRED: "false" },
      { ...rehearsal, EVENT_HOST_STAFF_AUTH_REHEARSAL: "false" }]) {
      expect(isPreviewStaffAuthRehearsal(env)).toBe(false);
    }
  });

  it.each(["start", "exchange", "logout", "revoke"])("allows only the exact %s session POST past the rehearsal proxy", async (action) => {
    const path = `/api/staff-auth/${action}`;
    expect(previewReviewBlocksRequest("POST", path, review)).toBe(true);
    expect(previewReviewBlocksRequest("POST", path, { ...rehearsal, EVENT_HOST_STAFF_LOGIN_REQUIRED: "false" })).toBe(true);
    expect(previewReviewBlocksRequest("PUT", path, rehearsal)).toBe(true);
    expect(previewReviewBlocksRequest("POST", `${path}/other`, rehearsal)).toBe(true);
    for (const [key, value] of Object.entries(rehearsal)) vi.stubEnv(key, value);
    const response = await proxy(new NextRequest(`https://review.example${path}`, { method: "POST" }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/api/vip-checkin", "/api/admin-session", "/api/checklists", "/api/floor-plans/planning-month", "/api/admin/staffing"])("still blocks POST %s before the operational handler", async (path) => {
    for (const [key, value] of Object.entries(rehearsal)) vi.stubEnv(key, value);
    const response = await proxy(new NextRequest(`https://review.example${path}`, { method: "POST" }));
    expect(response.status).toBe(403);
  });
});
