import { beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.fn();
const hasAdminSession = vi.fn();
const loadAdminStateSnapshot = vi.fn();
const loadAdminStateVersion = vi.fn();
const saveChecklist = vi.fn();
const buildAdminStateRequest = vi.fn();

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/admin-state", () => ({
  buildAdminStateRequest,
  loadAdminStateSnapshot,
  loadAdminStateVersion,
}));
vi.mock("@/lib/checklist-storage", () => ({
  saveChecklist,
}));

describe("admin-state live-sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: vi.fn() });
    buildAdminStateRequest.mockImplementation((state) => ({ action: "save", eventId: 99990001, checklist: { tasks: { adminState: state } } }));
    saveChecklist.mockResolvedValue({ updatedAt: "2026-10-21T16:00:00Z" });
    loadAdminStateSnapshot.mockResolvedValue({
      state: {
        archivedAssetKeys: [],
        archivedEventIds: [],
        overlaysByAsset: {},
      },
      updatedAt: "2026-07-30T17:00:00.000Z",
    });
    loadAdminStateVersion.mockResolvedValue(
      "2026-07-30T17:00:00.000Z",
    );
  });

  it("rejects anonymous admin-state revision checks", async () => {
    hasAdminSession.mockReturnValue(false);
    const { HEAD } = await import("../route");

    const response = await HEAD();

    expect(response.status).toBe(401);
    expect(loadAdminStateVersion).not.toHaveBeenCalled();
  });

  it("returns only the current revision for an authenticated HEAD request", async () => {
    hasAdminSession.mockReturnValue(true);
    const { HEAD } = await import("../route");

    const response = await HEAD();

    expect(response.status).toBe(204);
    expect(
      response.headers.get("x-event-host-admin-state-version"),
    ).toBe("2026-07-30T17:00:00.000Z");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(loadAdminStateVersion).toHaveBeenCalledOnce();
  });

  it("returns the protected initial snapshot with its revision", async () => {
    hasAdminSession.mockReturnValue(true);
    const { GET } = await import("../route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updatedAt: "2026-07-30T17:00:00.000Z",
      state: { archivedAssetKeys: [] },
    });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("fails closed when the revision lookup is unavailable", async () => {
    hasAdminSession.mockReturnValue(true);
    loadAdminStateVersion.mockRejectedValue(
      new Error("database unavailable"),
    );
    const { HEAD } = await import("../route");

    const response = await HEAD();

    expect(response.status).toBe(502);
    expect(
      response.headers.get("x-event-host-admin-state-version"),
    ).toBeNull();
  });

  it("rejects unauthenticated itinerary writes without touching storage", async () => {
    hasAdminSession.mockReturnValue(false);
    const { PUT } = await import("../route");
    const response = await PUT(new Request("http://localhost/api/admin-state", { method: "PUT", body: JSON.stringify({ state: {} }) }));
    expect(response.status).toBe(401);
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("persists itinerary edits with the expected Admin revision and preserves other Admin state", async () => {
    hasAdminSession.mockReturnValue(true);
    const { PUT } = await import("../route");
    const edit = { updatedAt: "2026-10-21T15:00:00Z", sourceUpdatedAt: null, fields: { food: ["Dessert Platter: 1"] } };
    const state = { archivedAssetKeys: ["old.png"], archivedEventIds: [456], overlaysByAsset: {}, itineraryEditsByEvent: { 123: edit } };
    const response = await PUT(new Request("http://localhost/api/admin-state", { method: "PUT", body: JSON.stringify({ state, expectedUpdatedAt: "2026-10-21T14:00:00Z" }) }));
    expect(response.status).toBe(200);
    expect(buildAdminStateRequest).toHaveBeenCalledWith(state);
    expect(saveChecklist).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: "2026-10-21T14:00:00Z", checklist: { tasks: { adminState: state } } }));
  });

  it("rejects stale saves and retains the current database copy", async () => {
    hasAdminSession.mockReturnValue(true);
    const { StaleSaveError } = await import("@/lib/stale-save");
    saveChecklist.mockRejectedValue(new StaleSaveError());
    const { PUT } = await import("../route");
    const response = await PUT(new Request("http://localhost/api/admin-state", { method: "PUT", body: JSON.stringify({ state: {}, expectedUpdatedAt: "2026-10-21T14:00:00Z" }) }));
    expect(response.status).toBe(409);
  });

  it("rejects invalid itinerary edits before storage", async () => {
    hasAdminSession.mockReturnValue(true);
    const { PUT } = await import("../route");
    const response = await PUT(new Request("http://localhost/api/admin-state", { method: "PUT", body: JSON.stringify({ state: { itineraryEditsByEvent: { 123: { fields: { guest_count: -1 } } } }, expectedUpdatedAt: null }) }));
    expect(response.status).toBe(400);
    expect(saveChecklist).not.toHaveBeenCalled();
  });
});
