import { describe, expect, it } from "vitest";
import {
  distinctFloorPlanEventColor,
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
});
