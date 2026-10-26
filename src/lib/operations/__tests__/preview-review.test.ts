import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { isPreviewReviewOnly, previewReviewBlocksRequest } from "../preview-review";

afterEach(() => vi.unstubAllEnvs());
const review = { VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" };

describe("protected read-only Preview", () => {
  it("is opt-in per Preview deployment and cannot disable Production operations", () => {
    expect(isPreviewReviewOnly(review)).toBe(true);
    for (const env of [{}, { VERCEL_ENV: "preview" }, { ...review, VERCEL_ENV: "production" }, { ...review, VERCEL_ENV: "development" }]) {
      expect(isPreviewReviewOnly(env)).toBe(false);
      expect(previewReviewBlocksRequest("POST", "/api/vip-checkin", env)).toBe(false);
    }
  });
  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s before any operational handler", (method) => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    const response = proxy(new NextRequest("https://review.example/api/vip-checkin", { method }));
    expect(response.status).toBe(403);
  });
  it.each(["/api/gotab/reconcile", "/api/event-plans/sync", "/api/kitchen/oauth/start", "/api/kitchen/oauth/callback"])("blocks mutating GET %s", (pathname) => {
    expect(previewReviewBlocksRequest("GET", pathname, review)).toBe(true);
  });
  it.each(["/api/vip-checkin/health", "/api/vip-checkin", "/api/kitchen/day", "/api/entertainment/schedule", "/api/release-status"])("keeps read-only view %s available", (pathname) => {
    expect(previewReviewBlocksRequest("GET", pathname, review)).toBe(false);
  });
  it("keeps private JSON blocked independently of review mode", () => {
    expect(proxy(new NextRequest("https://review.example/data/event-plan-data.json")).status).toBe(404);
  });
});
