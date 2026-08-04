import { describe, expect, it } from "vitest";
import { localHighlightIdsForDeletion } from "../presentation";
import type { FloorPlanDocument } from "../types";

const plan = {
  id: "floor-plan-redacted",
  eventDate: "2026-08-05",
  status: "Needs Review",
  version: 1,
  ruleVersion: "floor-plan-v1.2.0",
  lastTripleseatSyncAt: null,
  createdAt: "2026-08-04T16:00:00.000Z",
  updatedAt: "2026-08-04T16:00:00.000Z",
  approvedAt: null,
  approvedBy: null,
  events: [],
  reservations: [
    {
      id: "room-highlight",
      floorPlanEventId: "event-1",
      areaId: "vip-1",
      reservationType: "room",
      startAt: null,
      endAt: null,
      label: "VIP 1",
      source: "manual",
      lockedByUser: true,
    },
    {
      id: "custom-highlight",
      floorPlanEventId: "event-1",
      areaId: "vip-1",
      reservationType: "custom",
      startAt: null,
      endAt: null,
      label: "Welcome table",
      source: "manual",
      lockedByUser: true,
      customGeometry: { x: 10, y: 10, width: 100, height: 40 },
    },
  ],
} satisfies FloorPlanDocument;

describe("floor-plan highlight editing", () => {
  it("deletes the exact selected custom highlight without deleting the room", () => {
    expect(
      localHighlightIdsForDeletion(
        plan,
        "event-1",
        ["vip-1"],
        "custom-highlight",
      ),
    ).toEqual(["custom-highlight"]);
  });

  it("deletes permanent-area highlights when no custom highlight is selected", () => {
    expect(
      localHighlightIdsForDeletion(plan, "event-1", ["vip-1"], ""),
    ).toEqual(["room-highlight"]);
  });
});
