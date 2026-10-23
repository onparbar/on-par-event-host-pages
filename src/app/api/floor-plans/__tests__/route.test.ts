import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  generateFloorPlan,
  approveFloorPlan,
  getFloorPlanDay,
  hasAdminSession,
  refreshFloorPlanSources,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  generateFloorPlan: vi.fn(),
  approveFloorPlan: vi.fn(),
  getFloorPlanDay: vi.fn(),
  hasAdminSession: vi.fn(),
  refreshFloorPlanSources: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/floor-plans/service", () => ({
  approveFloorPlan,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanSources,
  saveFloorPlanEdits: vi.fn(),
  validateAndSaveFloorPlan: vi.fn(),
}));

import { GET, POST } from "../route";

describe("floor-plan live-sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    cookies.mockResolvedValue({ get: vi.fn() });
    refreshFloorPlanSources.mockResolvedValue({
      date: "2026-08-06",
      plan: { events: [] },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a same-origin live sync without an access-code session", async () => {
    hasAdminSession.mockReturnValue(false);

    const response = await POST(
      new Request("https://example.test/api/floor-plans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({
          action: "refresh",
          date: "2026-08-06",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(refreshFloorPlanSources).toHaveBeenCalledWith("2026-08-06", undefined, undefined);
  });

  it("keeps non-refresh floor-plan mutations behind Admin access", async () => {
    hasAdminSession.mockReturnValue(false);

    const response = await POST(
      new Request("https://example.test/api/floor-plans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({
          action: "generate",
          date: "2026-08-06",
          mode: "fill-missing",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(generateFloorPlan).not.toHaveBeenCalled();
  });

  it("keeps floor-plan reads behind Admin access", async () => {
    hasAdminSession.mockReturnValue(false);

    const response = await GET(
      new Request("https://example.test/api/floor-plans?date=2026-08-06"),
    );

    expect(response.status).toBe(401);
    expect(getFloorPlanDay).not.toHaveBeenCalled();
  });

  it("rejects cross-origin floor-plan mutations", async () => {
    hasAdminSession.mockReturnValue(true);

    const response = await POST(
      new Request("https://example.test/api/floor-plans", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.test",
        },
        body: JSON.stringify({
          action: "refresh",
          date: "2026-08-06",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(refreshFloorPlanSources).not.toHaveBeenCalled();
  });

  it("will not approve or regenerate a version the tablet did not identify", async () => {
    hasAdminSession.mockReturnValue(true);
    for (const action of ["approve", "generate", "validate"]) {
      const response = await POST(new Request("https://example.test/api/floor-plans", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ date: "2026-08-06", action, mode: "reset-event" }) }));
      expect(response.status).toBe(400);
    }
    expect(approveFloorPlan).not.toHaveBeenCalled();
    expect(generateFloorPlan).not.toHaveBeenCalled();
  });

  it("passes the reviewed revision to the approval service", async () => {
    hasAdminSession.mockReturnValue(true);
    approveFloorPlan.mockResolvedValue({ plan: { version: 8 } });
    const response = await POST(new Request("https://example.test/api/floor-plans", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ date: "2026-08-06", action: "approve", expectedVersion: 7, acknowledgeWarnings: true }) }));
    expect(response.status).toBe(200);
    expect(approveFloorPlan).toHaveBeenCalledWith("2026-08-06", true, undefined, 7);
  });
});
