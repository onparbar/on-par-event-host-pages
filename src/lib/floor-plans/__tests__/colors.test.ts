import { describe, expect, it } from "vitest";
import {
  distinctFloorPlanEventColor,
  ensureDistinctFloorPlanEventColors,
  floorPlanEventColorsAreDistinct,
} from "../configuration/colors";

describe("floor-plan event colors", () => {
  it("treats similar greens as the same visual event color", () => {
    expect(
      floorPlanEventColorsAreDistinct("#0F766E", "#047857"),
    ).toBe(false);
  });

  it("replaces a preferred color when another event already looks similar", () => {
    const color = distinctFloorPlanEventColor(
      "#047857",
      1,
      ["#0F766E"],
    );

    expect(color).not.toBe("#047857");
    expect(floorPlanEventColorsAreDistinct(color, "#0F766E")).toBe(true);
  });

  it("gives every party a distinct color when saved colors are duplicated", () => {
    const events = ensureDistinctFloorPlanEventColors([
      { name: "Wedding", color: "#BE123C" },
      { name: "Anniversary", color: "#BE123C" },
      { name: "Team building", color: "#BE123C" },
      { name: "Company outing", color: "#BE123C" },
    ]);

    expect(events[0].color).toBe("#BE123C");
    for (const [index, event] of events.entries()) {
      for (const previous of events.slice(0, index)) {
        expect(
          floorPlanEventColorsAreDistinct(event.color, previous.color),
        ).toBe(true);
      }
    }
  });
});
