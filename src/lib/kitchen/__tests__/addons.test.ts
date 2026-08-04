import { describe, expect, it } from "vitest";

import {
  KITCHEN_EVENT_ADD_ON_FIELDS,
  KITCHEN_EVENT_ADD_ON_SECTIONS,
  resolveKitchenLiveFoodAddOns,
  translateEventHostFoodAddOns,
} from "../addons";

describe("translateEventHostFoodAddOns", () => {
  it("exports the canonical Event Host entry fields and source units", () => {
    expect(
      KITCHEN_EVENT_ADD_ON_FIELDS.map(
        ({ sourceKey, foodName, sourceUnitLabel }) => ({
          sourceKey,
          foodName,
          sourceUnitLabel,
        }),
      ),
    ).toEqual([
      {
        sourceKey: "wings",
        foodName: "Wings",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "mozzarella-sticks",
        foodName: "Mozzarella Sticks",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "tater-kegs",
        foodName: "Tater Kegs",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "fry-platters",
        foodName: "Fries",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "chicken-tenders",
        foodName: "Chicken Tenders",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "veggie-tray",
        foodName: "Veggie Tray",
        sourceUnitLabel: "trays",
      },
      {
        sourceKey: "bbq-sauce",
        foodName: "BBQ Sauce",
        sourceUnitLabel: "bowls",
      },
      {
        sourceKey: "garlic-parm",
        foodName: "Garlic Parm",
        sourceUnitLabel: "bowls",
      },
      {
        sourceKey: "buffalo-sauce",
        foodName: "Buffalo Sauce",
        sourceUnitLabel: "bowls",
      },
      {
        sourceKey: "ranch",
        foodName: "Ranch",
        sourceUnitLabel: "bowls",
      },
      {
        sourceKey: "dessert-platter",
        foodName: "Dessert Platter",
        sourceUnitLabel: "platters",
      },
      {
        sourceKey: "taco-beef",
        foodName: "Beef",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-chicken",
        foodName: "Chicken",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-black-beans",
        foodName: "Black Beans",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-tortillas",
        foodName: "Tortillas",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-lettuce-wraps",
        foodName: "Lettuce Wraps",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-tomatoes",
        foodName: "Tomatoes",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-lettuce",
        foodName: "Lettuce",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-sour-cream",
        foodName: "Sour Cream",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-diced-onion",
        foodName: "Diced Onion",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-shredded-cheese",
        foodName: "Shredded Cheese",
        sourceUnitLabel: "requested units",
      },
      {
        sourceKey: "taco-salsa",
        foodName: "Salsa",
        sourceUnitLabel: "requested units",
      },
    ]);
    expect(KITCHEN_EVENT_ADD_ON_SECTIONS).toEqual([
      { key: "party-platters", label: "Party Platters" },
      { key: "sauces", label: "Sauces" },
      { key: "dessert", label: "Dessert" },
      { key: "taco-bar", label: "Taco Bar" },
    ]);
  });

  it("translates known add-ons in Event Host order with approved quantities and pan packing", () => {
    const sourceUpdatedAt = "2026-07-29T16:15:00.000Z";
    const addOns = translateEventHostFoodAddOns(
      {
        ranch: { quantity: "2", manualPrice: "" },
        "dessert-platter": { quantity: "2", manualPrice: "25" },
        "buffalo-sauce": { quantity: "2", manualPrice: "" },
        "garlic-parm": { quantity: "2", manualPrice: "" },
        "bbq-sauce": { quantity: "2", manualPrice: "" },
        "veggie-tray": { quantity: "2", manualPrice: "" },
        "chicken-tenders": { quantity: "2", manualPrice: "" },
        "fry-platters": { quantity: "2", manualPrice: "" },
        "tater-kegs": { quantity: "2", manualPrice: "" },
        "mozzarella-sticks": { quantity: "2", manualPrice: "" },
        wings: { quantity: "2", manualPrice: "" },
      },
      sourceUpdatedAt,
    );

    expect(addOns.map((item) => item.itemKey)).toEqual([
      "addon:wings",
      "addon:mozzarella-sticks",
      "addon:tater-kegs",
      "addon:fry-platters",
      "addon:chicken-tenders",
      "addon:veggie-tray",
      "addon:bbq-sauce",
      "addon:garlic-parm",
      "addon:buffalo-sauce",
      "addon:ranch",
      "addon:dessert-platter",
    ]);
    expect(addOns).toMatchObject([
      {
        quantity: 128,
        unit: "each",
        numberOfPans: 6,
        panSize: "1/3",
      },
      {
        quantity: 8,
        unit: "pounds",
        numberOfPans: 3,
        panSize: "1/3",
      },
      {
        quantity: 128,
        unit: "each",
        numberOfPans: 6,
        panSize: "1/3",
      },
      {
        quantity: 2,
        unit: "bags",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 100,
        unit: "each",
        numberOfPans: 4,
        panSize: "1/3",
      },
      {
        quantity: 2,
        unit: "pretzel plates",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 2,
        unit: "bowls",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 2,
        unit: "bowls",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 2,
        unit: "bowls",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 2,
        unit: "bowls",
        numberOfPans: null,
        panSize: null,
      },
      {
        quantity: 2,
        unit: "platters",
        numberOfPans: null,
        panSize: null,
      },
    ]);
    expect(addOns.every((item) => item.description.length > 0)).toBe(true);
    expect(addOns.every((item) => item.sourceUpdatedAt === sourceUpdatedAt)).toBe(
      true,
    );
  });

  it("accepts positive whole number values and ignores invalid or unknown entries", () => {
    const addOns = translateEventHostFoodAddOns(
      {
        wings: { quantity: 0 },
        "mozzarella-sticks": { quantity: "-1" },
        "tater-kegs": { quantity: "1.5" },
        "fry-platters": { quantity: "" },
        "chicken-tenders": { quantity: "not-a-number" },
        "veggie-tray": { quantity: null },
        "bbq-sauce": null,
        "garlic-parm": { quantity: Number.POSITIVE_INFINITY },
        "buffalo-sauce": { quantity: {} },
        ranch: { quantity: 2 },
        "dessert-platter": { quantity: Number.MAX_SAFE_INTEGER },
        "unknown-food": { quantity: 4 },
      },
      null,
    );

    expect(addOns).toEqual([
      {
        itemKey: "addon:ranch",
        foodName: "Ranch",
        description: "Bowl of ranch dressing.",
        quantity: 2,
        unit: "bowls",
        numberOfPans: null,
        panSize: null,
        sourceUpdatedAt: null,
      },
    ]);
  });

  it("rejects quantities whose translated kitchen amount would overflow", () => {
    const addOns = translateEventHostFoodAddOns(
      {
        wings: { quantity: Number.MAX_SAFE_INTEGER },
        ranch: { quantity: "1" },
      },
      null,
    );

    expect(addOns.map((item) => item.itemKey)).toEqual(["addon:ranch"]);
  });

  it("returns an empty list for malformed food JSON", () => {
    expect(translateEventHostFoodAddOns(null, null)).toEqual([]);
    expect(translateEventHostFoodAddOns([], null)).toEqual([]);
    expect(translateEventHostFoodAddOns("wings", null)).toEqual([]);
  });

  it("does not mutate the Event Host food JSON", () => {
    const wings = Object.freeze({ quantity: "1", manualPrice: "" });
    const food = Object.freeze({ wings });

    expect(() =>
      translateEventHostFoodAddOns(food, "2026-07-29T16:15:00.000Z"),
    ).not.toThrow();
    expect(food).toEqual({ wings: { quantity: "1", manualPrice: "" } });
  });

  it("resolves translated add-ons to their central calculation effects", () => {
    const translated = translateEventHostFoodAddOns(
      {
        wings: { quantity: 2 },
        ranch: { quantity: 3 },
        "dessert-platter": { quantity: 1 },
        "bbq-sauce": { quantity: 1 },
      },
      "2026-07-29T16:15:00.000Z",
    );

    expect(
      resolveKitchenLiveFoodAddOns(translated).map(
        ({ sourceKey, sourceQuantity, calculation }) => ({
          sourceKey,
          sourceQuantity,
          calculation,
        }),
      ),
    ).toEqual([
      {
        sourceKey: "wings",
        sourceQuantity: 2,
        calculation: {
          kind: "platter",
          platterKind: "platter:wings",
        },
      },
      {
        sourceKey: "bbq-sauce",
        sourceQuantity: 1,
        calculation: { kind: "display-only" },
      },
      {
        sourceKey: "ranch",
        sourceQuantity: 3,
        calculation: {
          kind: "approved-sauce",
          sauce: "ranch",
        },
      },
      {
        sourceKey: "dessert-platter",
        sourceQuantity: 1,
        calculation: { kind: "dessert" },
      },
    ]);
  });

  it("keeps Taco Bar add-ons separate and does not invent prep conversions", () => {
    const addOns = translateEventHostFoodAddOns(
      {
        "taco-beef": { quantity: 2 },
        "taco-tomatoes": { quantity: 3 },
        "taco-lettuce": { quantity: 4 },
        "taco-sour-cream": { quantity: 5 },
        "taco-diced-onion": { quantity: 6 },
        "taco-shredded-cheese": { quantity: 7 },
        "taco-salsa": { quantity: 8 },
      },
      "2026-07-29T16:15:00.000Z",
    );

    expect(
      addOns.map(
        ({ foodName, quantity, unit, numberOfPans, panSize }) => ({
          foodName,
          quantity,
          unit,
          numberOfPans,
          panSize,
        }),
      ),
    ).toEqual([
      {
        foodName: "Beef",
        quantity: 2,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Tomatoes",
        quantity: 3,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Lettuce",
        quantity: 4,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Sour Cream",
        quantity: 5,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Diced Onion",
        quantity: 6,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Shredded Cheese",
        quantity: 7,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
      {
        foodName: "Salsa",
        quantity: 8,
        unit: "requested units",
        numberOfPans: null,
        panSize: null,
      },
    ]);
    expect(
      resolveKitchenLiveFoodAddOns(addOns).every(
        (effect) =>
          effect.calculation.kind === "unresolved-taco-addon",
      ),
    ).toBe(true);
  });
});
