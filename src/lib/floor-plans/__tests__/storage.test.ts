import { describe, expect, it } from "vitest";
import { MemoryFloorPlanStorage } from "../storage";
import type { FloorPlanDocument } from "../types";

const draft: FloorPlanDocument = {
  id: "floor-plan-2026-08-06",
  eventDate: "2026-08-06",
  status: "Draft",
  version: 1,
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
});
