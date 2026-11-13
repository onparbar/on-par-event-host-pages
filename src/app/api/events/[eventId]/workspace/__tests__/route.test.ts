import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import { StaleSaveError } from "@/lib/stale-save";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/operations/workspace-storage", () => ({ loadEventWorkspace: mocks.load, saveEventWorkspaceAction: mocks.save }));
afterEach(() => vi.resetAllMocks());
const context = { params: Promise.resolve({ eventId: "77" }) };
const url = "https://example.test/api/events/77/workspace?date=2026-10-23";
function post(body: unknown, origin = "https://example.test") {
  const payload = body && typeof body === "object" ? { expectedSourceFingerprint: "sourcefingerprint", ...body } : body;
  return POST(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(payload) }), context);
}
describe("read-only shared workspace GET", () => {
  it("returns exact-event cached-read projection without invoking write services", async () => {
    mocks.load.mockResolvedValue({ event: { id: 77 }, activities: [] });
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("77", "2026-10-23");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not replace unavailable events with another event", async () => {
    mocks.load.mockResolvedValue(null);
    expect((await GET(new Request(url), context)).status).toBe(404);
  });
  it("rejects invalid dates and hides private upstream diagnostics", async () => {
    expect((await GET(new Request(url.replace("2026-10-23", "2026-02-31")), context)).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
    mocks.load.mockRejectedValue(new Error("private upstream details"));
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private upstream details");
  });
});
describe("scoped workspace POST", () => {
  it("sends only the validated action to its exact event/date", async () => {
    const action = { action: "FOOD_OUT", expectedUpdatedAt: null, employeeName: "BWA test", expectedSourceFingerprint: "sourcefingerprint" };
    mocks.save.mockResolvedValue({ event: { id: 77 }, record: {} });
    expect((await post(action)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith("77", "2026-10-23", action);
  });
  it("blocks cross-origin writes before reading or writing state", async () => {
    expect((await post({ action: "FOOD_OUT", expectedUpdatedAt: null }, "https://other.test")).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([{ action: "DELETE", expectedUpdatedAt: null }, { action: "FOOD_OUT" }, { action: "FOOD_OUT", expectedUpdatedAt: "not-a-date" }, { action: "FULFILL_REQUEST", requestId: "unsafe'", expectedUpdatedAt: null }])("rejects malformed or unapproved actions %j", async (action) => {
    expect((await post(action)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns HTTP409 with latest read-only state without retrying stale changes", async () => {
    mocks.save.mockRejectedValue(new StaleSaveError());
    mocks.load.mockResolvedValue({ event: { id: 77 }, record: { updatedAt: "latest" } });
    const response = await post({ action: "FOOD_OUT", expectedUpdatedAt: null });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ latest: { record: { updatedAt: "latest" } } });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("requires the displayed source fingerprint and keeps private write diagnostics off the wire", async () => {
    const noFingerprint = new Request(url, { method: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ action: "FOOD_OUT", expectedUpdatedAt: null }) });
    expect((await POST(noFingerprint, context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.save.mockRejectedValue(new Error("private upstream details"));
    const response = await post({ action: "FOOD_OUT", expectedUpdatedAt: null });
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private upstream details");
  });
});
