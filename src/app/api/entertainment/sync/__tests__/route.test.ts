import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncEventPlanWindow = vi.fn();
const syncEntertainmentDay = vi.fn();
const assertEntertainmentDate = vi.fn((date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
});

vi.mock("@/lib/event-plans/sync", () => ({ syncEventPlanWindow }));
vi.mock("@/lib/entertainment/sync", () => ({
  assertEntertainmentDate,
  syncEntertainmentDay,
  EntertainmentSyncError: class EntertainmentSyncError extends Error {},
}));

function request(body: string, origin = "https://example.test") {
  return new Request("https://example.test/api/entertainment/sync", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  });
}

describe("coordinated entertainment sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    syncEventPlanWindow.mockResolvedValue({ plans: [], sync: null });
    syncEntertainmentDay.mockResolvedValue({ date: "2026-10-26", reservations: [], conflicts: [] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refreshes the exact event date before reservations so other views receive current party times", async () => {
    const { POST } = await import("../route");
    const response = await POST(request(JSON.stringify({ date: "2026-10-26" })));
    expect(response.status).toBe(200);
    expect(syncEventPlanWindow).toHaveBeenCalledExactlyOnceWith(
      { startDate: "2026-10-26", endDate: "2026-10-26" }, { legacyPlans: [] },
    );
    expect(syncEntertainmentDay).toHaveBeenCalledExactlyOnceWith("2026-10-26");
    expect(syncEventPlanWindow.mock.invocationCallOrder[0]).toBeLessThan(syncEntertainmentDay.mock.invocationCallOrder[0]);
    await expect(response.json()).resolves.toMatchObject({ date: "2026-10-26", conflicts: [] });
  });

  it("reports an event refresh failure and does not claim a coherent reservation sync", async () => {
    syncEventPlanWindow.mockRejectedValueOnce(new Error("Private upstream failure"));
    const { POST } = await import("../route");
    const response = await POST(request(JSON.stringify({ date: "2026-10-26" })));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: expect.stringContaining("Entertainment was not rescheduled") });
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });

  it("reports reservation sync failure after source refresh instead of returning success", async () => {
    syncEntertainmentDay.mockRejectedValueOnce(new Error("Private reservation failure"));
    const { POST } = await import("../route");
    const response = await POST(request(JSON.stringify({ date: "2026-10-26" })));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Entertainment synchronization failed." });
  });

  it("keeps existing cross-origin protection ahead of both writes", async () => {
    const { POST } = await import("../route");
    const response = await POST(request(JSON.stringify({ date: "2026-10-26" }), "https://other.test"));
    expect(response.status).toBe(403);
    expect(syncEventPlanWindow).not.toHaveBeenCalled();
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });

  it.each(["{", JSON.stringify({ date: "not-a-date" })])("rejects invalid input before either sync", async (body) => {
    const { POST } = await import("../route");
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(syncEventPlanWindow).not.toHaveBeenCalled();
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });
});
