import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { contractSetup } from "../setup";
import { APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE, buildSetupLayout, SERVING_CART_SETUP_STATION, SETUP_FURNITURE_DIMENSIONS, SETUP_TEMPLATES, TACO_BAR_SETUP_TEMPLATE } from "../setup-layout";

const event: EventPlan = {
  id: 42, name: "Redacted Taco Bar event", date: "2026-11-03", day: "Tuesday",
  time: "5:30 PM - 8:30 PM", guest_count: 50, rooms: ["VIP 1"], color: "#18332F",
  food: ["50 × The Full Course + Taco Bar"], drink_options: [], entertainment: [],
  verification_status: "Verified redacted source", source_updated_at: "2026-11-03T14:00:00Z",
};

describe("read-only event setup drafts", () => {
  it("uses the exact measured table and paired carts without assuming equipment fit", () => {
    const dimensions = SETUP_FURNITURE_DIMENSIONS;
    expect(dimensions.table).toEqual({ lengthInches: 96, widthInches: 36 });
    expect(dimensions.cart).toEqual({ lengthInches: 21.5, widthInches: 15.5, count: 2, combinedLengthInches: 21.5, combinedWidthInches: 31 });
    expect(dimensions.cart.combinedWidthInches).toBe(dimensions.cart.widthInches * dimensions.cart.count);
    expect(dimensions.cart.combinedLengthInches).toBe(dimensions.cart.lengthInches);
    expect(Object.isFrozen(dimensions)).toBe(true);
    expect(Object.isFrozen(dimensions.table)).toBe(true);
    expect(Object.isFrozen(dimensions.cart)).toBe(true);
    const layout = buildSetupLayout(event);
    expect(layout.stations[0].instructions).toContain("2 marble serving carts side by side");
    expect(layout.review.join(" ")).toContain("Furniture dimensions are confirmed");
    expect(layout.review.join(" ")).toContain("physical fit is not approved");
    expect(layout.review.join(" ")).not.toContain("measurements have not been confirmed");
    expect(layout.food).toEqual(contractSetup(event).food);
    expect(layout.chafingDishes).toBe(contractSetup(event).chafingDishes);
  });

  it("recognizes the canonical Taco Bar package without treating the picture as a calculation", () => {
    const layout = buildSetupLayout(event);
    const setup = contractSetup(event);
    expect(layout).toMatchObject({ templateId: "taco-bar", tableCount: setup.foodTables, mirrored: setup.mirrored,
      chafingDishes: setup.chafingDishes, servingChafingDishes: null, purchasedFood: event.food, food: setup.food });
    expect(layout.status).toBe("needs-review");
    expect(layout.stations.map((station) => station.id)).toEqual(["service-cart", "tortillas", "lettuce-wraps", "hot-food", "cold-sides"]);
    expect(layout.review.join(" ")).toContain("not to scale");
    for (const warning of setup.review) expect(layout.review).toContain(warning);
  });

  it.each([100, 101, 200, 201])("reuses the existing %i-guest table/equipment boundary without multiplying purchased food", (guests) => {
    const plan = { ...event, guest_count: guests, food: [`${guests} × The Full Course + Taco Bar`] };
    const setup = contractSetup(plan);
    const layout = buildSetupLayout(plan);
    expect(layout.tableCount).toBe(guests > 100 ? 2 : 1);
    expect(layout.mirrored).toBe(guests > 100);
    expect(layout.chafingDishes).toBe(setup.chafingDishes);
    expect(layout.food).toEqual(setup.food);
    expect(layout.purchasedFood).toEqual(plan.food);
    expect(layout.status).not.toBe("approved");
  });

  it("lists extra platters separately without inventing their placement or changing serving/prep counts", () => {
    const plan = { ...event, guest_count: 17, food: ["17 × The Full Course", "Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"] };
    const layout = buildSetupLayout(plan);
    expect(layout.templateId).toBe("taco-bar");
    expect(layout.additionalFood).toEqual(["1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"]);
    expect(layout.chafingDishes).toBe(3);
    expect(layout.servingChafingDishes).toBe(2);
    expect(layout.review.join(" ")).toContain("has not been assigned an approved table position");
    expect(layout.review.join(" ")).toContain("existing calculation calls for 2");
    expect(layout.food).toEqual(contractSetup(plan).food);
  });

  it("flags the illustration/count mismatch above the large-event boundary rather than using its one chafer", () => {
    const layout = buildSetupLayout({ ...event, guest_count: 201, food: ["201 × The Full Course + Taco Bar"] });
    expect(layout.tableCount).toBe(2);
    expect(layout.chafingDishes).toBe(contractSetup({ ...event, guest_count: 201, food: ["201 × The Full Course + Taco Bar"] }).chafingDishes);
    expect(layout.review.join(" ")).toContain("illustration does not replace the calculated count");
  });

  it.each([
    ["50 × The Full Course + Wing Bar"],
    ["50 × The Full Course + Appetizer Bar"],
    ["50 × The Full Course + Taco Bar + Wing Bar"],
    ["50 × The Full Course + Taco Bar", "1 × Unknown feast"],
    ["1 × Wing Platter"],
    ["50 × The Full Course"],
  ].map((food) => ({ food })))("does not substitute a Taco Bar template for unsupported or unknown food: $food", ({ food }) => {
    const layout = buildSetupLayout({ ...event, food });
    expect(layout.templateId).toBeNull();
    expect(layout.stations).toEqual([]);
    expect(layout.status).toBe("needs-review");
    expect(layout.review.join(" ")).toContain("No complete setup template");
    expect(layout.additionalFood).toEqual(food);
  });

  it("retains missing-platter-quantity warnings and refuses to guess quantities", () => {
    const plan = { ...event, food: ["50 × The Full Course + Taco Bar", "Chicken Tender Platter"] };
    const setup = contractSetup(plan);
    const layout = buildSetupLayout(plan);
    expect(layout.status).toBe("needs-review");
    expect(layout.chafingDishes).toBeNull();
    expect(layout.food).toEqual(setup.food);
    expect(layout.review).toContain("A purchased platter quantity is missing or invalid; tongs need review.");
    expect(layout.additionalFood).toContain("Chicken Tender Platter");
  });

  it.each([[], ["No food"], ["none"]].map((food) => ({ food })))("keeps a no-food event free of a fabricated layout: $food", ({ food }) => {
    const layout = buildSetupLayout({ ...event, food });
    expect(layout.status).toBe("no-food");
    expect(layout.tableCount).toBe(0);
    expect(layout.templateId).toBeNull();
    expect(layout.stations).toEqual([]);
    expect(layout.additionalFood).toEqual([]);
  });

  it("preserves source identity, timestamp and calculation rule version", () => {
    const layout = buildSetupLayout({ ...event, source_event_id: "vip-booking-42" });
    expect(layout.source).toEqual({ eventId: "vip-booking-42", updatedAt: event.source_updated_at,
      ruleVersion: `${TACO_BAR_SETUP_TEMPLATE.version} / ${KITCHEN_RULE_CONFIG.ruleVersion}` });
  });

  it("retains source review reasons and flags absent source evidence, guests and area", () => {
    const layout = buildSetupLayout({ ...event, needs_review: true, review_reasons: ["Contract changed", ""],
      source_updated_at: null, rooms: [], guest_count: 0 });
    expect(layout.status).toBe("needs-review");
    expect(layout.tableCount).toBeNull();
    expect(layout.source.updatedAt).toBeNull();
    expect(layout.review).toContain("Contract changed");
    expect(layout.review.join(" ")).toContain("source update timestamp");
    expect(layout.review.join(" ")).toContain("reserved area is missing");
    expect(layout.review.join(" ")).toContain("Guest count is required");
  });

  it("keeps the supplied station instructions and utensil positions exact without assigning food quantities", () => {
    const stations = buildSetupLayout(event).stations;
    expect(stations[0].instructions).toContain("plates, napkins and forks accessible from each side");
    expect(stations[1].equipment).toEqual(["Left tortilla warmer and small tongs", "Center taco stands", "Right tortilla warmer and small tongs", "Clear risers"]);
    expect(stations[2].equipment).toEqual(["Small clear riser box", "2 tongs"]);
    expect(stations[3].equipment).toEqual(["Reference chafing dish", "Left long black plate: 1 spoon and 2 large tongs", "Right long black plate: 1 spoon and 2 large tongs"]);
    expect(stations[4].equipment).toEqual(["Three-tier serving stack", "Top: 2 small tongs", "Middle: 2 spoons", "Bottom: 2 spoons"]);
  });

  it("is deterministic, does not mutate the event and does not share mutable template output", () => {
    const original = structuredClone(event);
    const first = buildSetupLayout(event);
    expect(buildSetupLayout(event)).toEqual(first);
    expect(event).toEqual(original);
    first.stations[0].equipment.push("not real equipment");
    first.purchasedFood.push("not purchased");
    first.food[0].name = "changed";
    expect(buildSetupLayout(event)).not.toEqual(first);
    expect(TACO_BAR_SETUP_TEMPLATE.stations[0].equipment).not.toContain("not real equipment");
    expect(event).toEqual(original);
  });
});

const appetizerEvent: EventPlan = {
  ...event, guest_count: 55,
  food: ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
};

describe("exact Appetizer Bar, wings and dessert reference", () => {
  it.each([
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine", "Appetizer Bar", "2 × Wing Platter", "2 × Dessert Platter"],
    ["55 x The Front Nine", "55 x Appetizer Bar", "2 x Wings Platter", "2 x Dessert Tray"],
    ["55 × The Front Nine with Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
  ].map((food) => ({ food })))("matches the complete known purchased signature through existing normalization: $food", ({ food }) => {
    const plan = { ...appetizerEvent, food };
    const original = structuredClone(plan);
    const setup = contractSetup(plan);
    const layout = buildSetupLayout(plan);
    expect(layout.templateId).toBe("appetizer-wings-dessert");
    expect(layout.additionalFood).toEqual([]);
    expect(layout.status).toBe("needs-review");
    expect(layout.stations.map((station) => station.id)).toEqual(["service-cart", "chafer-one", "chafer-two", "sauces", "dessert"]);
    expect(layout.tableCount).toBe(setup.foodTables);
    expect(layout.mirrored).toBe(setup.mirrored);
    expect(layout.chafingDishes).toBe(setup.chafingDishes);
    expect(layout.servingChafingDishes).toBe(setup.servingSetup?.chafingDishes ?? null);
    expect(layout.food).toEqual(setup.food);
    expect(layout.purchasedFood).toEqual(food);
    for (const warning of setup.review) expect(layout.review).toContain(warning);
    expect(layout.source.ruleVersion).toBe(`${APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE.version} / ${KITCHEN_RULE_CONFIG.ruleVersion}`);
    expect(plan).toEqual(original);
  });

  it.each([50, 54, 55, 56, 75, 100])("matches 55 purchased food portions, not the separate guest count of %i, when the existing calculation uses one table", (guest_count) => {
    const plan = { ...appetizerEvent, guest_count };
    const original = structuredClone(plan);
    const setup = contractSetup(plan);
    const layout = buildSetupLayout(plan);
    expect(setup.foodTables).toBe(1);
    expect(layout.templateId).toBe("appetizer-wings-dessert");
    expect(layout.tableCount).toBe(setup.foodTables);
    expect(layout.mirrored).toBe(setup.mirrored);
    expect(layout.chafingDishes).toBe(setup.chafingDishes);
    expect(layout.servingChafingDishes).toBe(setup.servingSetup?.chafingDishes ?? null);
    expect(layout.food).toEqual(setup.food);
    expect(layout.purchasedFood).toEqual(plan.food);
    for (const warning of setup.review) expect(layout.review).toContain(warning);
    expect(plan).toEqual(original);
  });

  it.each([0, 101, 200, 201])("does not apply the one-table reference to unknown or mirrored setup for %i guests", (guest_count) => {
    const plan = { ...appetizerEvent, guest_count };
    const layout = buildSetupLayout(plan);
    expect(layout.templateId).toBeNull();
    expect(layout.stations).toEqual([]);
    expect(layout.additionalFood).toEqual(plan.food);
    expect(layout.tableCount).toBe(contractSetup(plan).foodTables);
    expect(layout.chafingDishes).toBe(contractSetup(plan).chafingDishes);
  });

  it.each([
    ["The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["54 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["56 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Full Course + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine", "1 × Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine", "54 × Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine", "56 × Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "1 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "3 × Wing Platter", "2 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "1 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "3 × Desert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "1 × Unknown feast"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "1 × Ranch"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "1 × Veggie Tray"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "1 × Wing Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "1 × Dessert Platter"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "Wing Bar"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter", "No food"],
  ].map((food) => ({ food })))("rejects missing, changed, duplicate, extra or unknown purchases: $food", ({ food }) => {
    const plan = { ...appetizerEvent, food };
    const layout = buildSetupLayout(plan);
    expect(layout.templateId).toBeNull();
    expect(layout.stations).toEqual([]);
    expect(layout.additionalFood).not.toEqual([]);
    expect(layout.status).toBe("needs-review");
    expect(layout.food).toEqual(contractSetup(plan).food);
    expect(layout.review.join(" ")).toContain("No complete setup template");
  });

  it("shares the two-cart starting station without changing either reference’s serving tools", () => {
    expect(Object.keys(SETUP_TEMPLATES)).toEqual(["taco-bar", "appetizer-wings-dessert"]);
    for (const template of Object.values(SETUP_TEMPLATES)) {
      expect(template.stations[0]).toBe(SERVING_CART_SETUP_STATION);
      expect(template.stations[0].instructions).toContain("2 marble serving carts side by side");
      expect(template.imagePath).toMatch(/^\/setup\/.+-reference-v1\.png$/);
      expect(template.imageAlt.length).toBeGreaterThan(30);
    }
    expect(TACO_BAR_SETUP_TEMPLATE.referenceChafingDishes).toBe(1);
    expect(APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE.referenceChafingDishes).toBe(2);
    const stations = buildSetupLayout(appetizerEvent).stations;
    expect(stations[1].equipment).toEqual(["First reference chafing dish", "Left long black plate: 3 tongs", "Right long black plate: 3 tongs"]);
    expect(stations[2].equipment).toEqual(["Second reference chafing dish", "Left long black plate: 2 tongs", "Right long black plate: 2 tongs"]);
    expect(stations[3].equipment).toEqual(["Long black sauce plate", "3 spoons"]);
    expect(stations[4].equipment).toEqual(["Small clear riser", "Dessert platter", "2 tongs"]);
    expect(stations[4].instructions).toContain("replace the three-tier stack");
  });

  it("keeps the screenshot’s two purchased dessert platters and all existing prep/chafer calculations", () => {
    const setup = contractSetup(appetizerEvent);
    const layout = buildSetupLayout(appetizerEvent);
    expect(layout.purchasedFood).toContain("2 × Desert Platter");
    expect(layout.food).toEqual(setup.food);
    expect(layout.food).toContainEqual(expect.objectContaining({ name: "Assorted Desserts", quantity: 2 }));
    expect(layout.chafingDishes).toBe(setup.chafingDishes);
    const servingCount = setup.servingSetup?.chafingDishes ?? setup.chafingDishes;
    if (servingCount !== 2 * setup.foodTables!) {
      expect(layout.review.join(" ")).toContain("reference illustrates 2 chafing dishes per table");
      expect(layout.review.join(" ")).toContain(`existing calculation calls for ${servingCount}`);
    }
    expect(layout.review.join(" ")).toContain("physical fit is not approved");
  });

  it("retains source warnings on the matched reference and never mutates its shared station data", () => {
    const plan = { ...appetizerEvent, needs_review: true, review_reasons: ["Updated contract needs checking"], source_event_id: "vip-example-55", source_updated_at: null, rooms: [] };
    const original = structuredClone(plan);
    const layout = buildSetupLayout(plan);
    expect(layout.templateId).toBe("appetizer-wings-dessert");
    expect(layout.status).toBe("needs-review");
    expect(layout.source).toMatchObject({ eventId: "vip-example-55", updatedAt: null });
    expect(layout.review).toContain("Updated contract needs checking");
    expect(layout.review.join(" ")).toContain("source update timestamp");
    expect(layout.review.join(" ")).toContain("reserved area is missing");
    layout.stations[0].equipment.push("not real equipment");
    layout.stations[1].instructions = "changed";
    expect(buildSetupLayout(plan).stations).toEqual(APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE.stations);
    expect(buildSetupLayout(event).stations[0]).toEqual(SERVING_CART_SETUP_STATION);
    expect(plan).toEqual(original);
  });
});
