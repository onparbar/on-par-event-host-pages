import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { prepare, reconcile, hasAdminSession } = vi.hoisted(() => ({ prepare: vi.fn(), reconcile: vi.fn(), hasAdminSession: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn() }) }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/floor-plans/planning-month", () => ({ DECEMBER_PLANNING_MONTH: "2026-12", prepareDecemberFloorPlanDrafts: prepare }));
vi.mock("@/lib/floor-plans/december-owner-holds", () => ({ reconcileDecemberOwnerHoldDrafts: reconcile }));
import { POST } from "../route";
import { previewReviewBlocksRequest } from "@/lib/operations/preview-review";

function request(body: unknown = { month: "2026-12" }, origin: string | null = "https://example.test") {
  return new Request("https://example.test/api/floor-plans/planning-month", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "production"); hasAdminSession.mockReturnValue(false); prepare.mockResolvedValue({ month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", results: [] }); reconcile.mockResolvedValue({ month: "2026-12", results: [] }); });
afterEach(() => vi.unstubAllEnvs());

describe("December planning route", () => {
  it("allows the bounded same-origin staff preparation request", async () => {
    expect((await POST(request())).status).toBe(200); expect(prepare).toHaveBeenCalledExactlyOnceWith(undefined); expect(reconcile).not.toHaveBeenCalled();
  });
  it("allows only an authenticated Admin to fill seating on existing drafts", async () => {
    hasAdminSession.mockReturnValue(true);
    expect((await POST(request())).status).toBe(200);
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ fillMissingSeating: true });
  });
  it("runs only the explicit December owner-hold reconciliation action without preparing or synchronizing sources", async () => {
    const response = await POST(request({ month: "2026-12", action: "release-owner-holds" }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ month: "2026-12", results: [] });
    expect(reconcile).toHaveBeenCalledOnce(); expect(prepare).not.toHaveBeenCalled();
  });
  it.each([{ month: "2026-11", action: "release-owner-holds" }, { month: "2027-12", action: "release-owner-holds" }, { month: "2026-12", action: "replace-all" }])("rejects an unapproved reconciliation month or action: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(reconcile).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
  it("requires same origin for owner-hold reconciliation and returns generic source errors", async () => {
    expect((await POST(request({ month: "2026-12", action: "release-owner-holds" }, "https://other.test"))).status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
    reconcile.mockRejectedValueOnce(new Error("PRIVATE source diagnostic"));
    const response = await POST(request({ month: "2026-12", action: "release-owner-holds" }));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("PRIVATE");
  });
  it.each(["https://other.test", null])("rejects untrusted or missing Origin: %s", async (origin) => {
    expect((await POST(request(undefined, origin))).status).toBe(403); expect(prepare).not.toHaveBeenCalled();
  });
  it.each([{ month: "2026-11" }, { month: "2027-12" }, { month: "2026-12-01" }, {}, null, []])("rejects every body except the exact approved month: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(prepare).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON before starting preparation", async () => {
    const bad = new Request("https://example.test/api/floor-plans/planning-month", { method: "POST", headers: { origin: "https://example.test" }, body: "not json" });
    expect((await POST(bad)).status).toBe(400); expect(prepare).not.toHaveBeenCalled();
  });
  it("keeps source failures generic without returning credentials or private source details", async () => {
    prepare.mockRejectedValue(new Error("PRIVATE_TOKEN source diagnostic"));
    const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("PRIVATE_TOKEN");
  });
  it("returns partial date failures without hiding successfully created drafts", async () => {
    prepare.mockResolvedValue({ month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", results: [{ date: "2026-12-05", status: "created", eventCount: 2 }, { date: "2026-12-06", status: "error", eventCount: 0 }] });
    const response = await POST(request());
    expect(response.status).toBe(200); expect((await response.json()).results).toHaveLength(2);
  });
  it.each([false, true])("returns review messages only to an authenticated Admin (%s)", async (isAdmin) => {
    hasAdminSession.mockReturnValue(isAdmin);
    prepare.mockResolvedValue({ month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", results: [
      { date: "2026-12-05", status: "created", eventCount: 2, planStatus: "Needs Review", message: "ADMIN_ONLY preparation detail" },
    ] });
    const response = await POST(request());
    const body = await response.text();
    expect(body.includes("ADMIN_ONLY")).toBe(isAdmin);
    expect(body.includes("Needs Review")).toBe(isAdmin);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("has no exception to the existing read-only Preview middleware", () => {
    expect(previewReviewBlocksRequest("POST", "/api/floor-plans/planning-month", { VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" })).toBe(true);
  });
});
