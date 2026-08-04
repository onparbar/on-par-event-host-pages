import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookies, hasAdminSession, refreshFloorPlanSources } = vi.hoisted(() => ({
  cookies: vi.fn(),
  hasAdminSession: vi.fn(),
  refreshFloorPlanSources: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/floor-plans/service", () => ({
  approveFloorPlan: vi.fn(),
  generateFloorPlan: vi.fn(),
  getFloorPlanDay: vi.fn(),
  refreshFloorPlanSources,
  saveFloorPlanEdits: vi.fn(),
  validateAndSaveFloorPlan: vi.fn(),
}));

import { POST } from "../route";

describe("floor-plan live-sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: vi.fn() });
    refreshFloorPlanSources.mockResolvedValue({
      date: "2026-08-06",
      plan: { events: [] },
    });
  });

  it("rejects live sync without the signed admin session", async () => {
    hasAdminSession.mockReturnValue(false);

    const response = await POST(
      new Request("https://example.test/api/floor-plans", {
        method: "POST",
        body: JSON.stringify({
          action: "refresh",
          date: "2026-08-06",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(refreshFloorPlanSources).not.toHaveBeenCalled();
  });

  it("allows an authenticated Admin live sync for one date", async () => {
    hasAdminSession.mockReturnValue(true);

    const response = await POST(
      new Request("https://example.test/api/floor-plans", {
        method: "POST",
        body: JSON.stringify({
          action: "refresh",
          date: "2026-08-06",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(refreshFloorPlanSources).toHaveBeenCalledWith("2026-08-06");
  });
});
