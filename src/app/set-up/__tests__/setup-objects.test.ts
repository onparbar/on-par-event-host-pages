import { describe, expect, it } from "vitest";
import { APPETIZER_WING_BAR_SETUP_TEMPLATE, APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE, TACO_BAR_SETUP_TEMPLATE } from "@/lib/operations/setup-layout";
import { APPETIZER_WING_BAR_SETUP_OBJECTS, APPETIZER_WINGS_DESSERT_SETUP_OBJECTS, TACO_BAR_SETUP_OBJECTS } from "../setup-objects";

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

describe("Appetizer Bar, wings and dessert reference object hotspots", () => {
  const objects = APPETIZER_WINGS_DESSERT_SETUP_OBJECTS;
  const byId = new Map(objects.map((object) => [object.id, object]));
  const index = (id: string) => objects.findIndex((object) => object.id === id);
  const utensils = objects.filter((object) => object.id.includes("tongs") || object.id.startsWith("sauce-spoon-"));

  it("identifies the supplied furniture and equipment with unique names and supported stations", () => {
    expect(objects).toHaveLength(32);
    expect(new Set(objects.map((object) => object.id)).size).toBe(objects.length);
    expect(new Set(objects.map((object) => object.label)).size).toBe(objects.length);
    for (const object of objects) {
      expect(object.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(object.label.trim()).toBe(object.label);
      expect(object.label.length).toBeGreaterThan(3);
      expect(object.description.length).toBeGreaterThan(30);
      expect(APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE.stations.map((station) => station.id)).toContain(object.stationId);
    }
    for (const id of ["buffet-table", "marble-cart-left", "marble-cart-right", "plate-stack-left", "plate-stack-right",
      "napkins-left", "napkins-right", "fork-caddy", "chafer-one", "chafer-two", "chafer-one-left-utensil-plate",
      "chafer-one-right-utensil-plate", "chafer-two-left-utensil-plate", "chafer-two-right-utensil-plate", "sauce-plate",
      "dessert-riser", "dessert-platter", "chafer-one-left-tongs-upper", "chafer-one-left-tongs-middle",
      "chafer-one-left-tongs-lower", "chafer-one-right-tongs-upper", "chafer-one-right-tongs-middle", "chafer-one-right-tongs-lower",
      "chafer-two-left-tongs-upper", "chafer-two-left-tongs-lower", "chafer-two-right-tongs-upper", "chafer-two-right-tongs-lower",
      "sauce-spoon-left", "sauce-spoon-center", "sauce-spoon-right", "dessert-tongs-left", "dessert-tongs-right"]) {
      expect(byId.has(id), id).toBe(true);
    }
    expect(objects.some((object) => /tortilla|taco-stand|three-tier/.test(object.id))).toBe(false);
  });

  it("keeps the exact reference utensil counts without inferring food or event equipment quantities", () => {
    expect(objects.filter((object) => object.id.includes("tongs"))).toHaveLength(12);
    expect(objects.filter((object) => object.id.startsWith("sauce-spoon-"))).toHaveLength(3);
    for (const side of ["left", "right"]) {
      expect(objects.filter((object) => object.id.startsWith(`chafer-one-${side}-tongs-`))).toHaveLength(3);
      expect(objects.filter((object) => object.id.startsWith(`chafer-two-${side}-tongs-`))).toHaveLength(2);
      expect(byId.get(`chafer-one-${side}-utensil-plate`)!.description).toContain("3 tongs");
      expect(byId.get(`chafer-two-${side}-utensil-plate`)!.description).toContain("2 tongs");
    }
    expect(objects.filter((object) => object.id.startsWith("dessert-tongs-"))).toHaveLength(2);
    expect(byId.get("sauce-plate")!.description).toContain("3 spoons");
    expect(byId.get("dessert-platter")!.description).toContain("2 tongs");
    expect(byId.get("buffet-table")!.description).toContain("does not confirm");
    expect(byId.get("chafer-one")!.description).toContain("calculated equipment count separately");
    expect(byId.get("chafer-two")!.description).toContain("does not replace");
    const descriptions = objects.map((object) => object.description).join(" ");
    expect(descriptions).not.toMatch(/salsa|sour cream|beef|chicken|beans|cheese|tomato|onion|serves \d+|per guest/i);
  });

  it("keeps every percentage rectangle inside the 1024 by 1536 reference image", () => {
    for (const object of objects) {
      for (const value of [object.left, object.top, object.width, object.height]) expect(Number.isFinite(value)).toBe(true);
      expect(object.left).toBeGreaterThanOrEqual(0);
      expect(object.top).toBeGreaterThanOrEqual(0);
      expect(object.width).toBeGreaterThan(0);
      expect(object.height).toBeGreaterThan(0);
      expect(object.left + object.width).toBeLessThanOrEqual(100);
      expect(object.top + object.height).toBeLessThanOrEqual(100);
    }
  });

  it("places background furniture and supports before the objects resting on them", () => {
    expect(index("buffet-table")).toBe(0);
    expect(index("marble-cart-left")).toBeLessThan(index("plate-stack-left"));
    expect(index("marble-cart-right")).toBeLessThan(index("plate-stack-right"));
    for (const side of ["left", "right"]) {
      for (const position of ["upper", "middle", "lower"]) {
        expect(index(`chafer-one-${side}-utensil-plate`)).toBeLessThan(index(`chafer-one-${side}-tongs-${position}`));
      }
      for (const position of ["upper", "lower"]) {
        expect(index(`chafer-two-${side}-utensil-plate`)).toBeLessThan(index(`chafer-two-${side}-tongs-${position}`));
      }
      expect(index("dessert-riser")).toBeLessThan(index("dessert-platter"));
      expect(index("dessert-platter")).toBeLessThan(index(`dessert-tongs-${side}`));
    }
    for (const position of ["left", "center", "right"]) expect(index("sauce-plate")).toBeLessThan(index(`sauce-spoon-${position}`));
  });

  it("does not overlap separate utensils in the authored geometry", () => {
    for (let left = 0; left < utensils.length; left++) for (let right = left + 1; right < utensils.length; right++) {
      const a = utensils[left], b = utensils[right];
      const overlaps = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });

  it.each([220, 280, 552])("keeps every utensil center selectable with 24px minimum touch targets at %ipx image width", (width) => {
    const height = width * 1.5;
    for (const utensil of utensils) {
      const x = (utensil.left + utensil.width / 2) / 100 * width;
      const y = (utensil.top + utensil.height / 2) / 100 * height;
      const hits = objects.filter((object) => {
        const left = object.left / 100 * width, top = object.top / 100 * height;
        return x >= left && x <= left + Math.max(24, object.width / 100 * width) &&
          y >= top && y <= top + Math.max(24, object.height / 100 * height);
      });
      expect(hits.at(-1)?.id, utensil.id).toBe(utensil.id);
    }
  });
});

describe("Basic Appetizer Bar and Wing Bar reference object hotspots", () => {
  const objects = APPETIZER_WING_BAR_SETUP_OBJECTS;
  const index = (id: string) => objects.findIndex((object) => object.id === id);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const utensils = objects.filter((object) => object.id.includes("tongs") || object.id.startsWith("sauce-spoon-"));
  const smallObjects = [...utensils, ...objects.filter((object) => object.id.startsWith("sauce-container-"))];

  it("identifies all 24 furniture, supply and equipment objects with unique supported labels", () => {
    expect(objects).toHaveLength(24);
    expect(new Set(objects.map((object) => object.id)).size).toBe(objects.length);
    expect(new Set(objects.map((object) => object.label)).size).toBe(objects.length);
    for (const object of objects) {
      expect(object.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(object.label.trim()).toBe(object.label);
      expect(object.label.length).toBeGreaterThan(3);
      expect(object.description.length).toBeGreaterThan(30);
      expect(APPETIZER_WING_BAR_SETUP_TEMPLATE.stations.map((station) => station.id)).toContain(object.stationId);
    }
    for (const id of ["buffet-table", "marble-cart-left", "marble-cart-right", "plate-stack-left", "plate-stack-right",
      "napkins-left", "napkins-right", "fork-caddy", "bar-chafer", "chafer-left-utensil-plate", "chafer-right-utensil-plate",
      "sauce-plate", "sauce-container-left", "sauce-container-center", "sauce-container-right", "chafer-left-tongs-upper",
      "chafer-left-tongs-middle", "chafer-left-tongs-lower", "chafer-right-tongs-upper", "chafer-right-tongs-middle",
      "chafer-right-tongs-lower", "sauce-spoon-left", "sauce-spoon-center", "sauce-spoon-right"]) expect(byId.has(id), id).toBe(true);
    expect(objects.some((object) => /dessert|tortilla|taco|tier|chafer-two/.test(object.id))).toBe(false);
  });

  it("keeps one chafer with three tongs per side and three separate sauce containers and spoons", () => {
    expect(objects.filter((object) => object.id === "bar-chafer")).toHaveLength(1);
    expect(objects.filter((object) => object.id.includes("tongs"))).toHaveLength(6);
    expect(objects.filter((object) => object.id.startsWith("sauce-container-"))).toHaveLength(3);
    expect(objects.filter((object) => object.id.startsWith("sauce-spoon-"))).toHaveLength(3);
    for (const side of ["left", "right"]) {
      expect(objects.filter((object) => object.id.startsWith(`chafer-${side}-tongs-`))).toHaveLength(3);
      expect(byId.get(`chafer-${side}-utensil-plate`)!.description).toContain("3 tongs");
    }
    expect(byId.get("sauce-plate")!.description).toContain("3 sauce containers and 3 spoons");
    expect(byId.get("bar-chafer")!.description).toContain("does not assign pan contents");
    expect(byId.get("sauce-container-left")!.description).toContain("contract");
    expect(byId.get("buffet-table")!.description).toContain("does not confirm physical fit");
    expect(objects.map((object) => object.description).join(" ")).not.toMatch(/salsa|sour cream|beef|chicken|beans|cheese|tomato|onion|serves \d+|per guest/i);
  });

  it("keeps every authored rectangle inside the actual reference image", () => {
    for (const object of objects) {
      for (const value of [object.left, object.top, object.width, object.height]) expect(Number.isFinite(value)).toBe(true);
      expect(object.left).toBeGreaterThanOrEqual(0);
      expect(object.top).toBeGreaterThanOrEqual(0);
      expect(object.width).toBeGreaterThan(0);
      expect(object.height).toBeGreaterThan(0);
      expect(object.left + object.width).toBeLessThanOrEqual(100);
      expect(object.top + object.height).toBeLessThanOrEqual(100);
    }
  });

  it("keeps furniture and support plates beneath their supply, tong, container and spoon targets", () => {
    expect(index("buffet-table")).toBe(0);
    for (const side of ["left", "right"]) {
      expect(index(`marble-cart-${side}`)).toBeLessThan(index(`plate-stack-${side}`));
      for (const level of ["upper", "middle", "lower"]) expect(index(`chafer-${side}-utensil-plate`)).toBeLessThan(index(`chafer-${side}-tongs-${level}`));
    }
    for (const position of ["left", "center", "right"]) {
      expect(index("sauce-plate")).toBeLessThan(index(`sauce-container-${position}`));
      expect(index("sauce-plate")).toBeLessThan(index(`sauce-spoon-${position}`));
    }
  });

  it("keeps neighboring tongs and spoons nonoverlapping in authored percentage geometry", () => {
    for (let left = 0; left < utensils.length; left++) for (let right = left + 1; right < utensils.length; right++) {
      const a = utensils[left], b = utensils[right];
      const overlaps = a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });

  it.each([220, 280, 552])("keeps every small object center selectable with 24px targets at %ipx image width", (width) => {
    const height = width * 1.5;
    for (const target of smallObjects) {
      const x = (target.left + target.width / 2) / 100 * width;
      const y = (target.top + target.height / 2) / 100 * height;
      const hits = objects.filter((object) => {
        const left = object.left / 100 * width, top = object.top / 100 * height;
        return x >= left && x <= left + Math.max(24, object.width / 100 * width) &&
          y >= top && y <= top + Math.max(24, object.height / 100 * height);
      });
      expect(hits.at(-1)?.id, target.id).toBe(target.id);
    }
  });
});
