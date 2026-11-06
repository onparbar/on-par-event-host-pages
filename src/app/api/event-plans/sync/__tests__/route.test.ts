import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncRollingEventPlans = vi.fn();
const maintainTwoWeekFloorPlanHorizon = vi.fn();
const ensureConfirmedContractFloorPlanWindow = vi.fn();
const syncEntertainmentDay = vi.fn();

vi.mock("@/lib/event-plans/sync", () => ({
  syncRollingEventPlans,
}));
vi.mock("@/lib/floor-plans/service", () => ({
  ensureConfirmedContractFloorPlanWindow,
  maintainTwoWeekFloorPlanHorizon,
}));
vi.mock("@/lib/entertainment/sync", () => ({ syncEntertainmentDay }));
describe("event-plan sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    syncRollingEventPlans.mockResolvedValue({
      sourceMode: "live",
      plans: [{ id: 1, date: "2026-08-05" }, { id: 2, date: "2026-08-18" }],
      sync: {
        windowStart: "2026-07-30",
        windowEnd: "2026-08-30",
        status: "success",
        eventCount: 2,
      },
    });
    syncEntertainmentDay.mockResolvedValue({ conflicts: [] });
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
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });

  it("refreshes unique active-plan dates beyond the floor-plan horizon without duplicating covered dates", async () => {
    syncRollingEventPlans.mockResolvedValueOnce({
      sourceMode: "live",
      plans: [
        { id: 1, date: "2026-08-05" },
        { id: 2, date: "2026-08-18" },
        { id: 3, date: "2026-08-19" },
        { id: 4, date: "2026-08-19" },
        { id: 5, date: "2026-08-29" },
        { id: 6, date: "2026-09-01" },
        { id: 7, date: "2026-07-29" },
      ],
      sync: { windowStart: "2026-07-30", windowEnd: "2026-08-30", status: "success" },
    });
    const { POST } = await import("../route");
    const response = await POST(new Request("https://example.test/api/event-plans/sync", {
      method: "POST", headers: { origin: "https://example.test" },
    }));

    expect(response.status).toBe(200);
    expect(syncEntertainmentDay.mock.calls).toEqual([["2026-08-19"], ["2026-08-29"]]);
    expect(syncRollingEventPlans.mock.invocationCallOrder[0]).toBeLessThan(maintainTwoWeekFloorPlanHorizon.mock.invocationCallOrder[0]);
    expect(maintainTwoWeekFloorPlanHorizon.mock.invocationCallOrder[0]).toBeLessThan(syncEntertainmentDay.mock.invocationCallOrder[0]);
    await expect(response.json()).resolves.toMatchObject({
      entertainment: [
        { date: "2026-08-19", status: "success", conflictsFound: 0 },
        { date: "2026-08-29", status: "success", conflictsFound: 0 },
      ],
    });
  });

  it("keeps per-date entertainment failures and floor-plan warnings visible while continuing other dates", async () => {
    syncRollingEventPlans.mockResolvedValueOnce({
      sourceMode: "live",
      plans: [{ id: 1, date: "2026-08-19" }, { id: 2, date: "2026-08-20" }],
      sync: { windowStart: "2026-07-30", windowEnd: "2026-08-30", status: "success" },
    });
    maintainTwoWeekFloorPlanHorizon.mockResolvedValueOnce({
      startDate: "2026-08-04", endDate: "2026-08-18",
      results: [{ date: "2026-08-05", status: "error", eventCount: 0, message: "Floor-plan source unavailable." }],
    });
    syncEntertainmentDay.mockRejectedValueOnce(new Error("Private upstream failure"));
    syncEntertainmentDay.mockResolvedValueOnce({ conflicts: [{ id: "redacted-conflict" }] });
    const { POST } = await import("../route");
    const response = await POST(new Request("https://example.test/api/event-plans/sync", {
      method: "POST", headers: { origin: "https://example.test" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(syncEntertainmentDay.mock.calls).toEqual([["2026-08-19"], ["2026-08-20"]]);
    expect(body.floorPlans.results[0]).toMatchObject({ status: "error", message: "Floor-plan source unavailable." });
    expect(body.entertainment).toEqual([
      { date: "2026-08-19", status: "error", message: expect.stringContaining("last saved reservations") },
      { date: "2026-08-20", status: "success", conflictsFound: 1 },
    ]);
    expect(body.warning).toContain("Floor-plan source unavailable.");
    expect(body.warning).toContain("2026-08-19");
    expect(body.warning).toContain("2026-08-20: 1 entertainment resource conflict requires review.");
    expect(body.warning).not.toContain("Private upstream failure");
  });

  it("surfaces warning-only entertainment failures inside the existing floor-plan horizon", async () => {
    const warning = "The latest Tripleseat sync failed. The last saved schedule remains visible.";
    maintainTwoWeekFloorPlanHorizon.mockResolvedValueOnce({
      startDate: "2026-08-04", endDate: "2026-08-18",
      results: [{ date: "2026-08-05", status: "generated", eventCount: 1, warnings: [warning] }],
    });
    const { POST } = await import("../route");
    const response = await POST(new Request("https://example.test/api/event-plans/sync", {
      method: "POST", headers: { origin: "https://example.test" },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.floorPlans.results[0].warnings).toEqual([warning]);
    expect(body.warning).toContain(`2026-08-05: ${warning}`);
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
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
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
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
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });
});
