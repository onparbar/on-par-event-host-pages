import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncRollingEventPlans = vi.fn();
const maintainTwoWeekFloorPlanHorizon = vi.fn();
const ensureConfirmedContractFloorPlanWindow = vi.fn();

vi.mock("@/lib/event-plans/sync", () => ({
  syncRollingEventPlans,
}));
vi.mock("@/lib/floor-plans/service", () => ({
  ensureConfirmedContractFloorPlanWindow,
  maintainTwoWeekFloorPlanHorizon,
}));
describe("event-plan sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
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
    maintainTwoWeekFloorPlanHorizon.mockResolvedValue({
      startDate: "2026-08-04",
      endDate: "2026-08-18",
      results: [
        {
          date: "2026-08-05",
          status: "generated",
          eventCount: 1,
          planStatus: "Needs Review",
        },
      ],
    });
    ensureConfirmedContractFloorPlanWindow.mockResolvedValue({
      startDate: "2026-08-14",
      endDate: "2026-08-28",
      results: [
        {
          date: "2026-08-21",
          status: "generated",
          eventCount: 1,
          planStatus: "Needs Review",
        },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      floorPlans: {
        startDate: "2026-08-04",
        endDate: "2026-08-18",
      },
    });
    expect(syncRollingEventPlans).toHaveBeenCalledOnce();
    expect(maintainTwoWeekFloorPlanHorizon).toHaveBeenCalledOnce();
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
    expect(maintainTwoWeekFloorPlanHorizon).not.toHaveBeenCalled();
  });

  it("allows a same-origin manual refresh without an access-code session", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://example.test/api/event-plans/sync", {
        method: "POST",
        headers: { origin: "https://example.test" },
      }),
    );

    expect(response.status).toBe(200);
    expect(syncRollingEventPlans).toHaveBeenCalledOnce();
    expect(maintainTwoWeekFloorPlanHorizon).toHaveBeenCalledOnce();
  });

  it("still prepares confirmed floor plans when Tripleseat refresh fails", async () => {
    syncRollingEventPlans.mockRejectedValueOnce(
      new Error("Tripleseat OAuth refresh was rejected (400)."),
    );
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/event-plans/sync", {
        method: "POST",
        headers: { origin: "https://example.test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceMode: "contract-evidence",
      eventCount: 1,
      warning: expect.stringContaining("Tripleseat could not refresh"),
    });
    expect(ensureConfirmedContractFloorPlanWindow).toHaveBeenCalledOnce();
    expect(maintainTwoWeekFloorPlanHorizon).not.toHaveBeenCalled();
  });

  it("does not report success when only an unrelated fallback floor plan exists", async () => {
    syncRollingEventPlans.mockRejectedValueOnce(
      new Error("Tripleseat OAuth refresh was rejected (400)."),
    );
    ensureConfirmedContractFloorPlanWindow.mockResolvedValueOnce({
      startDate: "2026-08-14",
      endDate: "2026-08-28",
      results: [
        {
          date: "2026-08-20",
          status: "generated",
          eventCount: 1,
        },
      ],
    });
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/event-plans/sync", {
        method: "POST",
        headers: { origin: "https://example.test" },
      }),
    );

    expect(response.status).toBe(502);
  });

  it("rejects a cross-origin manual refresh", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://example.test/api/event-plans/sync", {
        method: "POST",
        headers: { origin: "https://malicious.test" },
      }),
    );

    expect(response.status).toBe(403);
    expect(syncRollingEventPlans).not.toHaveBeenCalled();
    expect(maintainTwoWeekFloorPlanHorizon).not.toHaveBeenCalled();
  });
});
