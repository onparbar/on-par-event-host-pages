import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: false, cookies: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: () => mocks.admin }));
vi.mock("@/lib/floor-plans/day-highlights-storage", () => ({ loadFloorPlanHighlights: mocks.load, saveFloorPlanHighlights: mocks.save }));
import { GET, PUT } from "../route";
import { floorPlanHighlightKey, FloorPlanHighlightValidationError, validateFloorPlanHighlights } from "@/lib/floor-plans/day-highlights";
import { StaleSaveError } from "@/lib/stale-save";

const origin = "https://events.example", date = "2026-12-03", stamp = "2026-11-25T15:00:00Z";
const highlights = validateFloorPlanHighlights([{ id: "trivia", kind: "highlight", x: 5, y: 10, width: 20, height: 15, text: "Trivia", fill: "#297025" }]);
const snapshot = { date, highlights, updatedAt: stamp };
const get = (query = `date=${date}`) => GET(new Request(`${origin}/api/admin/floor-plan-highlights?${query}`));
const put = (body: unknown = { date, highlights, expectedUpdatedAt: stamp }, from: string | null = origin) => PUT(new Request(`${origin}/api/admin/floor-plan-highlights`, {
  method: "PUT", headers: { "content-type": "application/json", ...(from ? { origin: from } : {}) }, body: JSON.stringify(body),
}));

beforeEach(() => {
  mocks.admin = false; mocks.cookies.mockResolvedValue(new Map());
  mocks.load.mockImplementation(async (date: string) => { floorPlanHighlightKey(date); return snapshot; });
  mocks.save.mockResolvedValue(snapshot);
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Route tests must never contact providers or databases."); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("Admin day-only floor-plan highlight API", () => {
  it("requires an Admin session before reading or saving", async () => {
    expect((await get()).status).toBe(401); expect((await put()).status).toBe(401);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns only the exact date snapshot with private no-store cookie-vary headers", async () => {
    mocks.admin = true;
    const response = await get();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(date);
  });

  it("saves only the supplied date highlight slice and ignores unrelated top-level Admin payloads", async () => {
    mocks.admin = true;
    const response = await put({ date, highlights, expectedUpdatedAt: stamp, state: { archivedEventIds: ["never accepted"] }, plan: { status: "Approved" } });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(snapshot);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ date, highlights, expectedUpdatedAt: stamp });
  });

  it.each(["https://other.example", null])("blocks cross-origin or missing-origin production saves from %s", async (from) => {
    mocks.admin = true;
    expect((await put(undefined, from)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("denies writes in read-only Preview while allowing signed-in reads", async () => {
    mocks.admin = true; vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("EVENT_HOST_REVIEW_ONLY", "true");
    expect((await put()).status).toBe(403); expect((await get()).status).toBe(200);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects missing/invalid dates and malformed bodies", async () => {
    mocks.admin = true;
    expect((await get("date=2026-02-29")).status).toBe(400); expect((await get("")).status).toBe(400);
    for (const body of [null, [], "notes", { highlights }, { date: 123 }]) expect((await put(body)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("maps field validation failures to 400 and stale revisions to 409 without retrying", async () => {
    mocks.admin = true;
    mocks.save.mockRejectedValueOnce(new FloorPlanHighlightValidationError("Invalid safe highlight."));
    expect((await put()).status).toBe(400);
    mocks.save.mockRejectedValueOnce(new StaleSaveError());
    const conflict = await put(); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: expect.stringContaining("Reload") });
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });

  it("does not expose private storage error details", async () => {
    mocks.admin = true; mocks.load.mockRejectedValueOnce(new Error("secret provider failure"));
    const response = await get(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret provider"); expect(mocks.save).not.toHaveBeenCalled();
  });
});
