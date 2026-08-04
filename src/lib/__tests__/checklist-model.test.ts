import { describe, expect, it } from "vitest";
import {
  foodAddOns,
  foodUnitPrice,
  type FoodState,
} from "../checklist-model";
import { KITCHEN_EVENT_ADD_ON_FIELDS } from "../kitchen/addons";

const emptyFoodState: FoodState = {
  manualPrice: "",
  quantity: "",
};

describe("Event Host food add-ons", () => {
  it("uses the same food keys as the Kitchen live add-on rules", () => {
    expect(foodAddOns.map((item) => item.key)).toEqual(
      KITCHEN_EVENT_ADD_ON_FIELDS.map((field) => field.sourceKey),
    );
  });

  it("keeps Taco Bar items quantity-only instead of guessing prices", () => {
    const tacoItems = foodAddOns.filter((item) =>
      item.key.startsWith("taco-"),
    );

    expect(tacoItems).toHaveLength(11);
    expect(tacoItems.every((item) => item.kind === "quantity-only")).toBe(true);
    expect(
      tacoItems.every((item) => foodUnitPrice(item, emptyFoodState) === 0),
    ).toBe(true);
  });
});
