import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "../route";
import { StaleSaveError } from "@/lib/stale-save";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: mocks.auth }));
vi.mock("@/lib/operations/workspace-storage", () => ({ loadWorkspaceSettings: mocks.load, saveWorkspaceSettings: mocks.save }));
afterEach(() => vi.resetAllMocks());
function request(body: unknown, origin = "https://example.test") { return new Request("https://example.test/api/admin/workspace-settings", { method: "PUT", headers: { origin }, body: JSON.stringify(body) }); }
describe("protected management reminder settings", () => {
  it("requires Admin for both reads and writes", async () => {
    expect((await GET()).status).toBe(401);
    expect((await PUT(request({}))).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reads settings without mutation and disables caching", async () => {
    mocks.auth.mockReturnValue(true);
    mocks.load.mockResolvedValue({ settings: { reminderLeadMinutes: 5 }, updatedAt: null });
    const response = await GET();
    expect(await response.json()).toMatchObject({ settings: { reminderLeadMinutes: 5 } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects cross-origin management changes and missing saved revision", async () => {
    mocks.auth.mockReturnValue(true);
    expect((await PUT(request({ settings: { reminderLeadMinutes: 10 }, expectedUpdatedAt: null }, "https://other.test"))).status).toBe(403);
    expect((await PUT(request({ settings: { reminderLeadMinutes: 10 } }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("passes the explicit revision and returns stale409 without blind retry", async () => {
    mocks.auth.mockReturnValue(true);
    mocks.save.mockRejectedValue(new StaleSaveError());
    const response = await PUT(request({ settings: { reminderLeadMinutes: 10 }, expectedUpdatedAt: null }));
    expect(response.status).toBe(409);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ reminderLeadMinutes: 10 }, null);
  });
});
