import { describe, expect, it } from "vitest";
import { KITCHEN_RULE_CONFIG } from "../config";
import { getPlatterPanAllocation } from "../platter-pans";

describe("approved October 22 platter pan formulas", () => {
  const formulas = [
    ["platter:tater-kegs", 64, 2, 3],
    ["platter:mozzarella-sticks", 2, 1, 2],
    ["platter:chicken-tenders", 64, 2, 4],
    ["platter:wings", 64, 2, 4],
    ["platter:fries", 1, 1, null],
  ] as const;

  for (const [kind, amountPerPlatter, halfPans, thirdPans] of formulas) {
    it.each([1, 2, 10])(`multiplies ${kind} by %i ordered platters in either pan size`, (count) => {
      const rule = KITCHEN_RULE_CONFIG.platter.rules[kind];
      expect(rule.amountPerPlatter * count).toBe(amountPerPlatter * count);
      expect(getPlatterPanAllocation(rule, count, "1/2")).toEqual({
        numberOfPans: halfPans * count,
        panSize: "1/2",
      });
      expect(getPlatterPanAllocation(rule, count, "1/3")).toEqual({
        numberOfPans: (thirdPans ?? halfPans) * count,
        panSize: thirdPans === null ? "1/2" : "1/3",
      });
    });
  }

  it("does not assign hot pans to veggie trays", () => {
    expect(getPlatterPanAllocation(KITCHEN_RULE_CONFIG.platter.rules["platter:veggie-tray"], 2, "1/3"))
      .toEqual({ numberOfPans: null, panSize: null });
  });
});
