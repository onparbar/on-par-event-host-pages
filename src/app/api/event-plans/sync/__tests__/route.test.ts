import { beforeEach, describe, expect, it, vi } from "vitest";

const syncRollingEventPlans = vi.fn();
const hasAdminSession = vi.fn();
const cookies = vi.fn();

vi.mock("@/lib/event-plans/sync", () => ({
  syncRollingEventPlans,
}));
vi.mock("@/lib/admin-auth", () => ({
  hasAdminSession,
}));
vi.mock("next/headers", () => ({
  cookies,
}));

describe("event-plan sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    cookies.mockResolvedValue({ get: vi.fn() });
    syncRollingEventPlans.mockResolvedValue({
      sourceMode: "live",
      plans: [{ id: 1 }, { id: 2 }],
      sync: {
        windowStart: "2026-07-30",
        windowEnd: "2026-08-30",
        status: "success",
        eventCount: 2,
      },
    });
  });

  it("allows Vercel Cron with the configured bearer secret", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://example.test/api/event-plans/sync", {
        headers: {
          authorization: "Bearer test-cron-secret",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceMode: "live",
      eventCount: 2,
    });
    expect(syncRollingEventPlans).toHaveBeenCalledOnce();
  });

  it("rejects a missing or incorrect cron secret", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://example.test/api/event-plans/sync", {
        headers: { authorization: "Bearer incorrect" },
      }),
    );

    expect(response.status).toBe(401);
    expect(syncRollingEventPlans).not.toHaveBeenCalled();
  });

  it("allows an authenticated manual refresh", async () => {
    hasAdminSession.mockReturnValue(true);
    const { POST } = await import("../route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(syncRollingEventPlans).toHaveBeenCalledOnce();
  });

  it("rejects an unauthenticated manual refresh", async () => {
    hasAdminSession.mockReturnValue(false);
    const { POST } = await import("../route");
    const response = await POST();

    expect(response.status).toBe(401);
    expect(syncRollingEventPlans).not.toHaveBeenCalled();
  });
});
