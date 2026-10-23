import { describe, expect, it } from "vitest";
import { KITCHEN_RULE_CONFIG } from "../config";
import { getPlatterPanAllocation } from "../platter-pans";

describe("approved platter pan formulas", () => {
  const formulas = [
    ["platter:tater-kegs", 64, 2, 3],
    ["platter:mozzarella-sticks", 4, 1, 2],
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

  it.each(["1/2", "1/3"] as const)("keeps zero mozzarella platters at zero %s pans", (panSize) => {
    const rule = KITCHEN_RULE_CONFIG.platter.rules["platter:mozzarella-sticks"];
    expect(rule.amountPerPlatter * 0).toBe(0);
    expect(getPlatterPanAllocation(rule, 0, panSize)).toEqual({ numberOfPans: 0, panSize });
  });

  it.each([1, 2, 10])("packs %i mozzarella platter(s) at 4 pounds per half pan or 2 pounds per third pan", (count) => {
    const rule = KITCHEN_RULE_CONFIG.platter.rules["platter:mozzarella-sticks"];
    const amount = rule.amountPerPlatter * count;
    expect(amount / getPlatterPanAllocation(rule, count, "1/2").numberOfPans!).toBe(4);
    expect(amount / getPlatterPanAllocation(rule, count, "1/3").numberOfPans!).toBe(2);
  });
});
