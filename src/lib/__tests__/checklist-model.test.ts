import { describe, expect, it } from "vitest";
import {
  foodAddOns,
  foodUnitPrice,
  appetizerBarRefillAddOns,
  entertainmentAddOns,
  entertainmentUnitPrice,
  standardFoodAddOns,
  tacoBarRefillAddOns,
  wingBarRefillAddOns,
  type FoodState,
} from "../checklist-model";
import { KITCHEN_EVENT_ADD_ON_FIELDS } from "../kitchen/addons";

const emptyFoodState: FoodState = {
  manualPrice: "",
  quantity: "",
};

describe("Event Host food add-ons", () => {
  it("prices each dessert platter at $120 even when an old draft has a manual price", () => {
    const dessert = foodAddOns.find((item) => item.key === "dessert-platter")!;
    expect(dessert.kind).toBe("fixed-price");
    expect(foodUnitPrice(dessert, { quantity: "2", manualPrice: "25" })).toBe(120);
  });

  it("prices mini golf by the entered guest count", () => {
    const miniGolf = entertainmentAddOns.find((item) => item.key === "mini-golf")!;
    expect(miniGolf.unitLabel).toBe("guests");
    expect(entertainmentUnitPrice(miniGolf, {
      quantity: "20",
      selectedRateKey: "",
      manualPrice: "",
    }) * 20).toBe(180);
  });

  it("prices pool tables by the selected weekday rate", () => {
    const pool = entertainmentAddOns.find((item) => item.key === "pool-tables")!;
    expect(entertainmentUnitPrice(pool, {
      quantity: "2",
      selectedRateKey: "sun-thu",
      manualPrice: "",
    })).toBe(12);
    expect(entertainmentUnitPrice(pool, {
      quantity: "2",
      selectedRateKey: "fri-sat",
      manualPrice: "",
    })).toBe(18);
  });

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

  it("separates Taco Bar refills from the standard Food tab without changing saved keys", () => {
    expect(tacoBarRefillAddOns).toHaveLength(11);
    expect(tacoBarRefillAddOns.every((item) => item.key.startsWith("taco-"))).toBe(true);
    expect(standardFoodAddOns.every((item) => !item.key.startsWith("taco-"))).toBe(true);
    expect(appetizerBarRefillAddOns).toHaveLength(5);
    expect(wingBarRefillAddOns).toHaveLength(6);
    expect([
      ...standardFoodAddOns,
      ...tacoBarRefillAddOns,
      ...appetizerBarRefillAddOns,
      ...wingBarRefillAddOns,
    ].map((item) => item.key).sort()).toEqual(
      foodAddOns.map((item) => item.key).sort(),
    );
  });
});
