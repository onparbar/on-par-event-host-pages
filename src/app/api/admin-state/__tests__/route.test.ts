import { beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.fn();
const hasAdminSession = vi.fn();
const loadAdminStateSnapshot = vi.fn();
const loadAdminStateVersion = vi.fn();

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/admin-state", () => ({
  buildAdminStateRequest: vi.fn(),
  loadAdminStateSnapshot,
  loadAdminStateVersion,
}));
vi.mock("@/lib/checklist-storage", () => ({
  saveChecklist: vi.fn(),
}));

describe("admin-state live-sync route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: vi.fn() });
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
});
