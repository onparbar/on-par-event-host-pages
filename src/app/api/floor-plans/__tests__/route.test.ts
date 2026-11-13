import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  generateFloorPlan,
  approveFloorPlan,
  getFloorPlanDay,
  hasAdminSession,
  refreshFloorPlanEvent,
  refreshFloorPlanSources,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  generateFloorPlan: vi.fn(),
  approveFloorPlan: vi.fn(),
  getFloorPlanDay: vi.fn(),
  hasAdminSession: vi.fn(),
  refreshFloorPlanEvent: vi.fn(),
  refreshFloorPlanSources: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/floor-plans/service", () => ({
  approveFloorPlan,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanEvent,
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
      plan: { eventDate: "2026-08-06", events: [], reservations: [], status: "Conflict" },
      warnings: ["ADMIN_ONLY source failure"],
      floorPlanConflicts: [{ id: "ADMIN_ONLY table clash" }],
      entertainmentConflicts: [], entertainmentReservations: [],
      validation: [{ status: "Failed", message: "ADMIN_ONLY capacity" }],
      revisions: [{ description: "ADMIN_ONLY old assignment" }],
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
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ incomplete: true, plan: { eventDate: "2026-08-06", status: "Draft" } });
    expect(JSON.stringify(body)).not.toContain("ADMIN_ONLY");
    expect(refreshFloorPlanSources).toHaveBeenCalledWith("2026-08-06", undefined, undefined);
  });

  it("returns raw review details only with the existing Admin session", async () => {
    hasAdminSession.mockReturnValue(true);
    const response = await POST(new Request("https://example.test/api/floor-plans", {
      method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "refresh", date: "2026-08-06" }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toContain("ADMIN_ONLY table clash");
  });

  it("does not return private exception messages to staff refresh requests", async () => {
    hasAdminSession.mockReturnValue(false);
    refreshFloorPlanSources.mockRejectedValueOnce(new Error("ADMIN_ONLY private error"));
    const response = await POST(new Request("https://example.test/api/floor-plans", {
      method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "refresh", date: "2026-08-06" }),
    }));
    expect(response.ok).toBe(false);
    expect(await response.text()).not.toContain("ADMIN_ONLY");
  });

  it("refreshes one event only for an Admin with a reviewed version", async () => {
    const refreshEvent = (expectedVersion?: number) => new Request("https://example.test/api/floor-plans", {
      method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "refresh-event", date: "2026-08-06", selectedEventId: "event-1", expectedVersion }),
    });
    hasAdminSession.mockReturnValue(false);
    expect((await POST(refreshEvent(7))).status).toBe(401);
    expect(refreshFloorPlanEvent).not.toHaveBeenCalled();
    hasAdminSession.mockReturnValue(true);
    expect((await POST(refreshEvent())).status).toBe(400);
    expect(refreshFloorPlanEvent).not.toHaveBeenCalled();
    refreshFloorPlanEvent.mockResolvedValue({ plan: { version: 8 }, warnings: ["ADMIN_ONLY proposed change"] });
    const response = await POST(refreshEvent(7));
    expect(response.status).toBe(200);
    expect(refreshFloorPlanEvent).toHaveBeenCalledOnce();
    expect(await response.text()).toContain("ADMIN_ONLY proposed change");
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

  it("passes only the selected event and reviewed revision to seating repair", async () => {
    hasAdminSession.mockReturnValue(true);
    generateFloorPlan.mockResolvedValue({ plan: { version: 8 } });
    const response = await POST(new Request("https://example.test/api/floor-plans", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ date: "2026-08-06", action: "generate", mode: "fill-missing", selectedEventId: "event-1", expectedVersion: 7 }) }));
    expect(response.status).toBe(200);
    expect(generateFloorPlan).toHaveBeenCalledWith("2026-08-06", "fill-missing", undefined, 7, "event-1");
  });

  it.each(["", " ", null, 12])("rejects invalid event-only scope %j rather than generating for the whole date", async (selectedEventId) => {
    hasAdminSession.mockReturnValue(true);
    const response = await POST(new Request("https://example.test/api/floor-plans", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ date: "2026-08-06", action: "generate", mode: "fill-missing", selectedEventId, expectedVersion: 7 }) }));
    expect(response.status).toBe(400);
    expect(generateFloorPlan).not.toHaveBeenCalled();
  });
});
