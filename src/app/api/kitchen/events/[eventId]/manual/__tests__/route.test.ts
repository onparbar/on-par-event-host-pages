import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";

const NOW = "2026-10-21T17:00:00.000Z";
const selections = { foodRunners: ["Lex"], pocs: ["Tina"], preppedBy: "Carlos", verifiedBy: "Daniel", setup: ["Brooke"] };
const context = () => ({ params: Promise.resolve({ eventId: "event-a" }) });
function request(body: unknown, origin = "https://example.test") {
  return new Request("https://example.test/api/kitchen/events/event-a/manual", {
    method: "PATCH", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW);
  setKitchenStorageForTests(createMemoryKitchenStorage());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setKitchenStorageForTests(null);
});

describe("kitchen manual assignment API revision protection", () => {
  it.each([undefined, 0, false, {}, []])("rejects missing or incorrectly typed revision %s", async (revision) => {
    const body = revision === undefined ? selections : { ...selections, expectedUpdatedAt: revision };
    const response = await PATCH(request(body), context());
    expect(response.status).toBe(400);
    const valid = await PATCH(request({ ...selections, expectedUpdatedAt: null }), context());
    expect(valid.status).toBe(200);
  });

  it("accepts a first-save null revision without login and rejects a duplicate creation with 409", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = await PATCH(request({ ...selections, expectedUpdatedAt: null }), context());
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ eventId: "event-a", foodRunners: ["Lex"], updatedAt: NOW });
    const duplicate = await PATCH(request({ ...selections, foodRunners: ["Derek"], expectedUpdatedAt: null }), context());
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/Another employee changed/);
  });

  it("returns a new revision and rejects a stale update without discarding the winning assignments", async () => {
    const first = await PATCH(request({ ...selections, expectedUpdatedAt: null }), context());
    const original = await first.json();
    const updated = await PATCH(request({ ...selections, foodRunners: ["Daniel"], expectedUpdatedAt: original.updatedAt }), context());
    expect(updated.status).toBe(200);
    const saved = await updated.json();
    expect(saved).toMatchObject({ foodRunners: ["Daniel"], updatedAt: "2026-10-21T17:00:00.001Z" });
    const stale = await PATCH(request({ ...selections, foodRunners: ["Derek"], expectedUpdatedAt: original.updatedAt }), context());
    expect(stale.status).toBe(409);
    const latest = await PATCH(request({ ...selections, expectedUpdatedAt: saved.updatedAt }), context());
    expect(latest.status).toBe(200);
  });

  it("rejects malformed or missing-zone revision values without saving", async () => {
    for (const expectedUpdatedAt of ["invalid", "2026-10-21T17:00:00", "eq.unsafe"]) {
      const response = await PATCH(request({ ...selections, expectedUpdatedAt }), context());
      expect(response.status).toBe(400);
    }
    expect((await PATCH(request({ ...selections, expectedUpdatedAt: null }), context())).status).toBe(200);
  });

  it("continues rejecting cross-origin writes with or without a valid revision", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const denied = await PATCH(request({ ...selections, expectedUpdatedAt: null }, "https://other.test"), context());
    expect(denied.status).toBe(403);
    expect((await PATCH(request({ ...selections, expectedUpdatedAt: null }), context())).status).toBe(200);
  });
});
