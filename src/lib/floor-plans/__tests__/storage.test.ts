import { describe, expect, it } from "vitest";
import { floorPlanStorageAtVersion, MemoryFloorPlanStorage, SupabaseFloorPlanStorage } from "../storage";
import type { FloorPlanDocument } from "../types";

const draft: FloorPlanDocument = {
  id: "floor-plan-2026-08-06",
  eventDate: "2026-08-06",
  status: "Draft",
  version: 0,
  ruleVersion: "floor-plan-v1.0.0",
  lastTripleseatSyncAt: null,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  approvedAt: null,
  approvedBy: null,
  events: [],
  reservations: [],
};

describe("floor-plan persistence", () => {
  it("reopens saved plans and records revision history", async () => {
    const storage = new MemoryFloorPlanStorage();
    const saved = await storage.save(draft, "Created plan");
    await storage.save({ ...saved, status: "Needs Review" }, "Validated plan");

    await expect(storage.get("2026-08-06")).resolves.toMatchObject({
      status: "Needs Review",
      version: 2,
    });
    await expect(storage.revisions(draft.id)).resolves.toHaveLength(2);
  });

  it("allows only one of two stale clients to save and retains the winner's revision", async () => {
    const storage = new MemoryFloorPlanStorage();
    await storage.save(draft, "Created plan");
    const first = (await storage.get(draft.eventDate))!;
    const second = (await storage.get(draft.eventDate))!;
    const results = await Promise.allSettled([
      storage.save({ ...first, status: "Needs Review" }, "Tablet one"),
      storage.save({ ...second, status: "Approved" }, "Stale tablet two"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    await expect(storage.get(draft.eventDate)).resolves.toMatchObject({ version: 2, status: "Needs Review" });
    await expect(storage.revisions(draft.id)).resolves.toHaveLength(2);
  });

  it("protects the first save when two tablets both loaded an unsaved plan", async () => {
    const storage = new MemoryFloorPlanStorage();
    const results = await Promise.allSettled([storage.save(draft, "First"), storage.save(draft, "Second")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(storage.revisions(draft.id)).resolves.toHaveLength(1);
  });

  it("uses only the checked RPC and returns409 without falling back to an unchecked write", async () => {
    const requests: string[] = [];
    const storage = new SupabaseFloorPlanStorage({
      env: { NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test" },
      fetchImpl: async (url) => { requests.push(String(url)); return Response.json({ code: "PT409" }, { status: 409 }); },
    });
    await expect(storage.save(draft, "Stale")).rejects.toMatchObject({ status: 409 });
    expect(requests).toEqual(["https://example.supabase.co/rest/v1/rpc/save_event_host_floor_plan_checked"]);
  });

  it("fails closed when the checked database function is missing", async () => {
    const storage = new SupabaseFloorPlanStorage({
      env: { NODE_ENV: "test", SUPABASE_SECRET_KEY: "sb_secret_test" },
      fetchImpl: async () => Response.json({ code: "PGRST202" }, { status: 404 }),
    });
    await expect(storage.save(draft, "Pending migration")).rejects.toThrow("migration is not installed");
  });

  it("binds approval/generation reads to the tablet's reviewed revision", async () => {
    const storage = new MemoryFloorPlanStorage();
    const reviewed = await storage.save(draft, "Version one");
    const bound = floorPlanStorageAtVersion(storage, reviewed.version);
    await storage.save({ ...reviewed, status: "Needs Review" }, "Another tablet's change");
    await expect(bound.get(draft.eventDate)).rejects.toMatchObject({ status: 409 });
    await expect(bound.save({ ...reviewed, status: "Approved" }, "Stale approval")).rejects.toMatchObject({ status: 409 });
    await expect(storage.get(draft.eventDate)).resolves.toMatchObject({ version: 2, status: "Needs Review" });
  });
});
