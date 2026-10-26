import { afterEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/operations/checklist-auto-submit-service", () => ({ autoSubmitChecklists: calls.run }));
import { GET } from "../route";
const request = (token?: string) => new Request("https://example.test/api/checklists/auto-submit", { headers: token ? { authorization: token } : {} });
const success = { enabled: true, reason: "", considered: 1, due: 1, submitted: 1, skipped: 0, conflicts: 0, failed: 0, sourceErrors: [] };
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe("authenticated automatic checklist cron", () => {
  it.each([undefined, "Bearer wrong", "Basic test-cron"])("rejects an unauthorized request without touching any checklist: %s", async (token) => {
    vi.stubEnv("CRON_SECRET", "test-cron");
    expect((await GET(request(token))).status).toBe(401);
    expect(calls.run).not.toHaveBeenCalled();
  });
  it("does not authorize an empty configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(calls.run).not.toHaveBeenCalled();
  });
  it("runs only the closeout service after authentication, with no-store output", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron"); calls.run.mockResolvedValue(success);
    const response = await GET(request("Bearer test-cron"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(success); expect(calls.run).toHaveBeenCalledOnce();
  });
  it.each([
    { ...success, enabled: false, reason: "invalid-activation" },
    { ...success, failed: 1 }, { ...success, sourceErrors: ["Source unavailable"] },
  ])("surfaces an incomplete pass for cron diagnostics", async (result) => {
    vi.stubEnv("CRON_SECRET", "test-cron"); calls.run.mockResolvedValue(result);
    expect((await GET(request("Bearer test-cron"))).status).toBe(503);
  });
  it("keeps a disabled deployment inert and sanitizes unexpected errors", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron"); calls.run.mockResolvedValue({ ...success, enabled: false, reason: "disabled" });
    expect((await GET(request("Bearer test-cron"))).status).toBe(200);
    calls.run.mockRejectedValue(new Error("private database data"));
    const response = await GET(request("Bearer test-cron"));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private database data");
  });
});
