import { describe, expect, it } from "vitest";
import { floorPlanAreaAssignmentType, getFloorPlanArea } from "../configuration/areas";

describe("floor-plan editor assignment roles", () => {
  it.each(["vip1-food-table", "vip2-food-table", "karaoke-food", "karaoke-food-2"])("keeps dedicated %s as food even when the multi-select mode is off", (id) => {
    const area = getFloorPlanArea(id)!;
    expect(floorPlanAreaAssignmentType(area, false)).toBe("food-table");
    expect(floorPlanAreaAssignmentType(area, true)).toBe("food-table");
  });

  it.each(["ge-table-1", "ge-table-2", "ge-table-3", "main-rect-left-4", "main-rect-right-3"])("preserves both approved uses of %s", (id) => {
    const area = getFloorPlanArea(id)!;
    expect(floorPlanAreaAssignmentType(area, false)).toBe("seating");
    expect(floorPlanAreaAssignmentType(area, true)).toBe("food-table");
  });

  it.each(["vip1-extra-front-1", "main-round-left", "wat-table-1"])("does not mark unauthorized %s as food", (id) => {
    const area = getFloorPlanArea(id)!;
    expect(floorPlanAreaAssignmentType(area, false)).toBe("seating");
    expect(floorPlanAreaAssignmentType(area, true)).toBe("seating");
  });

  it.each(["vip1-extra-convo", "main-dining", "geg-tables", "level-up-seating", "vip-1", "vip1-conversation-wall"])("keeps %s as a section/room highlight without inventing seats", (id) => {
    const area = getFloorPlanArea(id)!;
    expect(floorPlanAreaAssignmentType(area, false)).toBe("room");
    expect(floorPlanAreaAssignmentType(area, true)).toBe("room");
  });

  it("classifies every object in a mixed selection independently of the shared toggle", () => {
    const ids = ["vip1-extra-front-1", "vip1-food-table", "vip1-extra-convo"];
    expect(ids.map((id) => floorPlanAreaAssignmentType(getFloorPlanArea(id)!, false))).toEqual(["seating", "food-table", "room"]);
  });
});
