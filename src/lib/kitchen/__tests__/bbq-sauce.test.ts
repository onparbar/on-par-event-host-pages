import { describe, expect, it } from "vitest";
import { translateEventHostFoodAddOns } from "../addons";
import { KITCHEN_RULE_CONFIG } from "../config";
import { generateKitchenChecklist } from "../rules";
import type { KitchenChecklist, KitchenSourceEvent, KitchenSourceSelection } from "../types";

function event(selections: readonly KitchenSourceSelection[], guestCount = 25): KitchenSourceEvent {
  return {
    eventId: "bbq-rule-test", eventName: "Redacted sauce test", localDate: "2026-10-23",
    startTime: "17:00", endTime: "19:00", guestCount, status: "Definite", room: "VIP 1",
    selections, sourceUpdatedAt: "2026-10-23T12:00:00Z", sourceState: "fresh",
  };
}

function sauceRows(checklist: KitchenChecklist) {
  return checklist.sections.flatMap((section) => section.rows).filter((row) => row.category === "sauces");
}

function expectBbq(checklist: KitchenChecklist, quantity: number) {
  const rows = sauceRows(checklist).filter((row) => row.foodName === "BBQ Sauce");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    key: "sauce-bbq", quantity, unit: quantity === 1 ? "bowl" : "bowls",
    numberOfPans: null, panSize: null, prepTiming: { kind: "not-applicable" },
  });
  expect(checklist.warnings.filter((warning) => warning.itemKey === "sauce-bbq")).toEqual([]);
}

describe("approved included BBQ sauce", () => {
  for (const name of ["Wing Platter", "Chicken Tender Platter"]) {
    it.each([1, 2, 10])(`adds one BBQ bowl per ${name}, retaining ranch for %i platters`, (quantity) => {
      const checklist = generateKitchenChecklist(event([{ name, quantity, isFood: true }]));
      expectBbq(checklist, quantity);
      expect(sauceRows(checklist).find((row) => row.key === "sauce-ranch")).toMatchObject({ quantity });
    });

    it.each([0, -1, 11])(`does not manufacture BBQ for an unapproved ${name} count of %i`, (quantity) => {
      const checklist = generateKitchenChecklist(event([{ name, quantity, isFood: true }]));
      expect(sauceRows(checklist).some((row) => row.foodName === "BBQ Sauce")).toBe(false);
    });
  }

  for (const name of ["Appetizer Bar", "Wing Bar"]) {
    it.each([1, 25, 26, 100, 101, 200, 201, 250])(`adds one bowl per ${name}, not per guest group or table (%i guests)`, (guests) => {
      const checklist = generateKitchenChecklist(event([
        { name: "The Full Course", isFood: true }, { name, isFood: true },
      ], guests));
      expectBbq(checklist, 1);
      expect(sauceRows(checklist).some((row) => row.key === "sauce-ranch")).toBe(true);
      if (name === "Appetizer Bar") {
        expect(sauceRows(checklist).find((row) => row.key === "sauce-marinara")).toMatchObject({ quantity: 1 });
      }
    });
  }

  it("sums mixed platters and bars into one BBQ row without changing existing unresolved ranch", () => {
    const checklist = generateKitchenChecklist(event([
      { name: "The Full Course", isFood: true },
      { name: "Appetizer Bar", isFood: true }, { name: "Wing Bar", isFood: true },
      { name: "Wing Platter", quantity: 2, isFood: true },
      { name: "Chicken Tender Platter", quantity: 3, isFood: true },
    ]));
    expectBbq(checklist, 7);
    expect(sauceRows(checklist).find((row) => row.key === "sauce-ranch")).toMatchObject({ quantity: 6 });
    expect(checklist.warnings.some((warning) => warning.code === "UNRESOLVED_SAUCE_QUANTITY" && warning.itemKey === "sauce-ranch")).toBe(true);
  });

  it("does not count duplicate representations of the same bar twice", () => {
    const checklist = generateKitchenChecklist(event([
      { name: "The Full Course", isFood: true }, { name: "Wing Bar", isFood: true },
      { name: "Jumbo Wing Bar - Premium wings", isFood: true },
    ]));
    expectBbq(checklist, 1);
  });

  it("includes BBQ for both contracted and live Wing/Tender platters", () => {
    const live = translateEventHostFoodAddOns({ wings: { quantity: 3 }, "chicken-tenders": { quantity: 2 } }, null);
    const checklist = generateKitchenChecklist(event([{ name: "Wing Platter", quantity: 2, isFood: true }]), KITCHEN_RULE_CONFIG, live);
    expectBbq(checklist, 7);
    expect(sauceRows(checklist).find((row) => row.key === "sauce-ranch")).toMatchObject({ quantity: 7 });
    expect(checklist.liveFoodAddOns).toHaveLength(2);
  });

  it("retains separately requested BBQ add-ons and refills without inventing another default", () => {
    const live = translateEventHostFoodAddOns({
      "bbq-sauce": { quantity: 2 }, "appetizer-refill-bbq": { quantity: 1 }, "wing-refill-bbq": { quantity: 1 },
    }, null);
    const checklist = generateKitchenChecklist(event([]), KITCHEN_RULE_CONFIG, live);
    expect(sauceRows(checklist).some((row) => row.foodName === "BBQ Sauce")).toBe(false);
    expect(checklist.liveFoodAddOns).toHaveLength(3);
  });

  it.each(["Tater Keg Platter", "Mozzarella Stick Platter", "Veggie Tray", "Fry Platter", "Dessert Platter"])("does not add BBQ to %s", (name) => {
    const checklist = generateKitchenChecklist(event([{ name, quantity: 1, isFood: true }]));
    expect(sauceRows(checklist).some((row) => row.foodName === "BBQ Sauce")).toBe(false);
  });

  it("does not add BBQ to Taco Bar", () => {
    const checklist = generateKitchenChecklist(event([
      { name: "The Full Course", isFood: true }, { name: "Taco Bar", isFood: true },
    ]));
    expect(sauceRows(checklist).some((row) => row.foodName === "BBQ Sauce")).toBe(false);
  });
});
