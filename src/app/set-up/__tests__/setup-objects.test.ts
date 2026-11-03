import { describe, expect, it } from "vitest";
import { TACO_BAR_SETUP_TEMPLATE } from "@/lib/operations/setup-layout";
import { TACO_BAR_SETUP_OBJECTS } from "../setup-objects";

describe("Taco Bar reference object hotspots", () => {
  it("gives every reference object a unique stable identifier, readable name and purpose", () => {
    expect(TACO_BAR_SETUP_OBJECTS).toHaveLength(35);
    const ids = TACO_BAR_SETUP_OBJECTS.map((object) => object.id);
    const labels = TACO_BAR_SETUP_OBJECTS.map((object) => object.label);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const object of TACO_BAR_SETUP_OBJECTS) {
      expect(object.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(object.label.trim()).toBe(object.label);
      expect(object.label.length).toBeGreaterThan(3);
      expect(object.description.length).toBeGreaterThan(30);
      expect(TACO_BAR_SETUP_TEMPLATE.stations.map((station) => station.id)).toContain(object.stationId);
    }
  });

  it("keeps all percentage rectangles inside the reference image", () => {
    for (const object of TACO_BAR_SETUP_OBJECTS) {
      for (const value of [object.left, object.top, object.width, object.height]) expect(Number.isFinite(value)).toBe(true);
      expect(object.left).toBeGreaterThanOrEqual(0);
      expect(object.top).toBeGreaterThanOrEqual(0);
      expect(object.width).toBeGreaterThan(0);
      expect(object.height).toBeGreaterThan(0);
      expect(object.left + object.width).toBeLessThanOrEqual(100);
      expect(object.top + object.height).toBeLessThanOrEqual(100);
    }
  });

  it("places background furniture before supplies and support trays before their utensils", () => {
    const index = (id: string) => TACO_BAR_SETUP_OBJECTS.findIndex((object) => object.id === id);
    expect(index("buffet-table")).toBe(0);
    expect(index("marble-cart-left")).toBeLessThan(index("plate-stack-left"));
    expect(index("marble-cart-right")).toBeLessThan(index("plate-stack-right"));
    expect(index("clear-riser-left")).toBeLessThan(index("tortilla-warmer-left"));
    expect(index("tortilla-warmer-left")).toBeLessThan(index("tortilla-tongs-left"));
    expect(index("lettuce-wrap-riser")).toBeLessThan(index("lettuce-wrap-tongs-left"));
    expect(index("chafer-left-utensil-tray")).toBeLessThan(index("chafer-left-spoon"));
    expect(index("chafer-right-utensil-tray")).toBeLessThan(index("chafer-right-tongs-lower"));
    expect(index("three-tier-stand")).toBeLessThan(index("tier-bottom-spoon-right"));
  });

  it("covers each supplied station and the individually visible utensils without inventing foods", () => {
    const byId = new Map(TACO_BAR_SETUP_OBJECTS.map((object) => [object.id, object]));
    for (const id of ["marble-cart-left", "marble-cart-right", "buffet-table", "plate-stack-left", "plate-stack-right",
      "napkins-left", "napkins-right", "fork-caddy", "tortilla-warmer-left", "tortilla-warmer-right", "tortilla-tongs-left",
      "tortilla-tongs-right", "taco-stands", "clear-riser-left", "clear-riser-center", "clear-riser-right", "lettuce-wrap-riser",
      "lettuce-wrap-tongs-left", "lettuce-wrap-tongs-right", "chafing-dish", "chafer-left-utensil-tray", "chafer-right-utensil-tray",
      "chafer-left-spoon", "chafer-right-spoon", "chafer-left-tongs-upper", "chafer-left-tongs-lower", "chafer-right-tongs-upper",
      "chafer-right-tongs-lower", "three-tier-stand", "tier-top-tongs-left", "tier-top-tongs-right", "tier-middle-spoon-left",
      "tier-middle-spoon-right", "tier-bottom-spoon-left", "tier-bottom-spoon-right"]) expect(byId.has(id)).toBe(true);
    expect(byId.get("chafer-left-utensil-tray")!.description).toContain("1 spoon and 2 large tongs");
    expect(byId.get("three-tier-stand")!.description).toContain("2 small tongs on top, 2 spoons in the middle and 2 spoons on the bottom");
    expect(byId.get("chafing-dish")!.description).toContain("do not infer pan contents");
    const text = TACO_BAR_SETUP_OBJECTS.map((object) => object.description).join(" ");
    expect(text).not.toMatch(/salsa|sour cream|beef|chicken|beans|cheese|tomato|onion|serves \d+|per guest/i);
    expect(text).toContain("does not confirm");
  });

  it("does not overlap adjacent small utensils in the original percentage geometry", () => {
    const ids = ["chafer-left-spoon", "chafer-left-tongs-upper", "chafer-left-tongs-lower", "chafer-right-spoon",
      "chafer-right-tongs-upper", "chafer-right-tongs-lower", "tier-middle-spoon-left", "tier-middle-spoon-right",
      "tier-bottom-spoon-left", "tier-bottom-spoon-right", "lettuce-wrap-tongs-left", "lettuce-wrap-tongs-right"];
    const small = TACO_BAR_SETUP_OBJECTS.filter((object) => ids.includes(object.id));
    for (let left = 0; left < small.length; left++) for (let right = left + 1; right < small.length; right++) {
      const a = small[left], b = small[right];
      const overlaps = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });
});
