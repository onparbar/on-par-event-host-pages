import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventServingPlan, ServingObject } from "@/lib/operations/serving-plan";
import EventSetupDiagram from "../EventSetupDiagram";
import { buildTableMockup } from "../table-mockup";

const object = (id: string, kind: ServingObject["kind"], label: string, description: string, extra: Partial<ServingObject> = {}): ServingObject => ({ id, kind, label, description, quantity: 1, unit: "item", contents: [], ...extra });
const plan: EventServingPlan = {
  status: "ready", ruleVersion: "test-serving-v1", servingLines: 1, plates: 30, tacoStands: 30, chafingDishesPerLine: 1,
  source: { eventId: "123", updatedAt: "2026-11-04T15:00:00Z", eventRuleVersion: null, rawSelections: ["15 × Taco Bar"] }, review: [], unplacedFood: [],
  objects: [
    object("service-cart", "carts", "Two marble carts", "Place two carts side by side.", { quantity: 2, unit: "carts per serving line", children: [
      object("plates", "plates", "Guest plates", "Use two plates per event guest, 30 total for this event.", { quantity: 30, unit: "plates · event total" }),
      object("napkins", "napkins", "Guest napkins", "Keep napkins on both sides.", { quantity: null }),
      object("forks", "forks", "Guest forks", "Keep forks available from either side.", { quantity: null }),
    ] }),
    object("taco-tortillas", "tortillas", "Tortilla warmers", "Fill the warmers with tortillas.", { quantity: 2, unit: "warmers", contents: ["Tortillas"] }),
    object("taco-stands", "taco-stands", "Taco stands", "Two stands per contracted Taco Bar guest: 15 × 2 = 30.", { quantity: 30, unit: "stands · event total" }),
    object("taco-lettuce-wraps", "lettuce-wraps", "Lettuce-wrap riser", "Place lettuce wraps on the clear riser.", { contents: ["Lettuce wraps"] }),
    object("taco-chafer", "chafer", "Taco Bar chafing dish", "Use three third pans for the Taco Bar.", { contents: ["Black beans", "Chicken", "Beef"], children: [
      object("taco-pan-beans", "pan", "Black bean pan", "Serve black beans from this pan.", { panSize: "1/3", contents: ["Black beans"] }),
      object("taco-pan-chicken", "pan", "Chicken pan", "Serve chicken from this pan.", { panSize: "1/3", contents: ["Chicken"] }),
      object("taco-pan-beef", "pan", "Beef pan", "Serve beef from this pan.", { panSize: "1/3", contents: ["Beef"] }),
      object("taco-chafer-utensils-left", "utensils", "Left black utensil plate", "Place one spoon and two tongs on the left."),
      object("taco-chafer-utensils-right", "utensils", "Right black utensil plate", "Place one spoon and two tongs on the right."),
    ] }),
    object("taco-tier", "tier", "Three-tier stand", "Top: lettuce and cheese. Middle: onion and tomato. Bottom: salsa and sour cream.", { children: [
      object("tier-top", "tier", "Top tier", "Lettuce and cheese go on the top tier.", { contents: ["Lettuce", "Cheese"] }),
      object("tier-middle", "tier", "Middle tier", "Onion and tomato go on the middle tier.", { contents: ["Onion", "Tomato"] }),
      object("tier-bottom", "tier", "Bottom tier", "Salsa and sour cream go on the bottom tier.", { contents: ["Salsa", "Sour cream"] }),
    ] }),
  ],
};
const render = (value = plan) => renderToStaticMarkup(createElement(EventSetupDiagram, { plan: value }));
const flatten = (items: ServingObject[]): ServingObject[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
const photoFigures = (html: string) => [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/g)].map((match) => match[0]).join("");

describe("event-specific whole-table equipment mockups", () => {
  it("shows each complete table using the existing equipment artwork", () => {
    const html = render();
    const figures = photoFigures(html);
    expect(figures).toContain('src="/setup/empty-buffet-table-v1.png"');
    expect(figures).toContain('aria-label="Whole table mockup"');
    expect(figures.match(/<figure\b/g)).toHaveLength(buildTableMockup(plan).tableCount);
    expect(figures).toContain("data-equipment-sprite=");
    expect(figures).not.toMatch(/taco-bar-staff-photo|service-carts-staff-photo/);
    const css = readFileSync(new URL("../EventSetupDiagram.module.css", import.meta.url), "utf8");
    expect(css).toContain(".hotspot { position: absolute");
  });

  it("makes every pictured target accessible and every event object available through the item picker", () => {
    const html = render();
    const figures = photoFigures(html);
    for (const target of buildTableMockup(plan).targets) {
      expect(figures).toContain(`data-serving-object="${target.item.id}"`);
      expect(figures).toContain(`Identify: ${target.item.label}`);
      expect(html).toContain(`value="${target.item.id}"`);
    }
    for (const item of flatten(plan.objects)) expect(html).toContain(`value="${item.id}"`);
    for (const button of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) expect(button[1]).not.toContain("<button");
    const dialogId = html.match(/<dialog\b[^>]*id="([^"]+)"/)?.[1];
    expect(dialogId).toBeTruthy();
    expect(figures).toContain(`aria-controls="${dialogId}"`);
    expect(figures).toContain('aria-haspopup="dialog"');
    expect(html).toContain('method="dialog"');
    expect(html).toContain("Close setup item details");
    expect(html).not.toContain("<dialog open");
  });

  it("identifies a closed chafer as a whole while retaining its exact pan contents in the picker", () => {
    const html = render();
    const figures = photoFigures(html);
    expect(figures).toContain('data-serving-object="taco-chafer"');
    for (const id of ["taco-pan-beans", "taco-pan-chicken", "taco-pan-beef"]) {
      expect(figures).not.toContain(`data-serving-object="${id}"`);
      expect(html).toContain(`value="${id}"`);
    }
    for (const text of ["Black beans", "Chicken", "Beef", "1/3 pan"]) expect(html).toContain(text);
  });

  it("shows exact event contents, plate totals and taco-stand calculations", () => {
    const html = render();
    for (const text of ["Tortillas", "Lettuce wraps", "Lettuce", "Cheese", "Onion", "Tomato", "Salsa", "Sour cream", "30 plates · event total", "30 taco stands · event total", "15 × 2 = 30"]) expect(html).toContain(text);
    expect(html).toContain("See item details");
    expect(html).not.toContain("Quantity needs review");
    expect(html.indexOf("What the setup should resemble")).toBeLessThan(html.indexOf("Build the serving line"));
    for (const item of flatten(plan.objects)) expect(html).toContain(item.description);
  });

  it("does not multiply event-wide quantities when equipment is mirrored", () => {
    const html = render({ ...plan, servingLines: 2 });
    expect(html).toContain("Two mirrored serving lines");
    expect(html).toContain("Food is shared between the lines, not doubled");
    expect(html).toContain("Plate and taco-stand totals above are for the entire event");
    expect(html).toContain("30 plates · event total");
    expect(html).not.toContain("60 plates");
    expect(html).not.toContain("60 taco stands");
  });

  it("pictures each extra dish, cold platter and sauce station for the selected event", () => {
    const value: EventServingPlan = { ...plan, status: "needs-review", plates: null, tacoStands: null, objects: [
      object("platter-chafer-1", "chafer", "Platter chafing dish 1", "Two half pans share one dish.", { children: [object("wing-pan", "pan", "Wing platter pan", "Wings go here.", { panSize: "1/2", contents: ["Wings"] }), object("tender-pan", "pan", "Tender platter pan", "Tenders go here.", { panSize: "1/2", contents: ["Chicken tenders"] })] }),
      object("platter-chafer-2", "chafer", "Platter chafing dish 2", "A second serving dish is required."),
      object("sauce-plate", "sauces", "Sauce plate", "Two sauce bowls need two spoons.", { quantity: 2, unit: "bowls", contents: ["BBQ", "Ranch"] }),
      object("cold-platter-dessert", "cold-platter", "Dessert platter", "Use a plate, not a chafing dish.", { quantity: 1, unit: "platter", contents: ["Assorted desserts"] }),
    ] };
    const before = structuredClone(value);
    const html = render(value);
    const figures = photoFigures(html);
    expect(figures).toContain('data-serving-object="platter-chafer-1"');
    for (const id of ["platter-chafer-2", "sauce-plate", "cold-platter-dessert"]) {
      expect(figures).toContain(`data-serving-object="${id}"`);
      expect(html).toContain(`value="${id}"`);
    }
    for (const id of ["wing-pan", "tender-pan"]) {
      expect(figures).not.toContain(`data-serving-object="${id}"`);
      expect(html).toContain(`value="${id}"`);
    }
    expect(html).toContain("Check flagged items");
    expect(html).toContain("Plate total needs review");
    for (const text of ["1/2 pan", "Two sauce bowls need two spoons", "Use a plate, not a chafing dish"]) expect(html).toContain(text);
    expect(value).toEqual(before);
    expect(html).not.toContain("Save");
    expect(html).not.toContain("Submit");
    expect(figures).not.toContain('data-serving-object="taco-chafer"');
    expect(figures).not.toContain('data-serving-object="taco-stands"');
    expect(html).not.toContain("Black beans");
    expect(html).not.toContain("Salsa and sour cream");
  });

  it("continues a large illustration without reserving additional physical food tables", () => {
    const objects = Array.from({ length: 7 }, (_, index) => object(`chafer-${index}`, "chafer", `Chafing dish ${index + 1}`, `Serving dish ${index + 1} contents.`));
    const value = { ...plan, objects };
    const mockup = buildTableMockup(value);
    const html = render(value);
    const figures = photoFigures(html);
    expect(mockup.tableCount).toBeGreaterThan(1);
    expect(figures.match(/<figure\b/g)).toHaveLength(mockup.tableCount);
    expect(html).toContain("Layout continuation 2");
    expect(html).toContain("these views do not change the event’s food-table reservation or purchased quantities");
    for (const item of objects) {
      expect(figures).toContain(`data-serving-object="${item.id}"`);
      expect(html).toContain(`value="${item.id}"`);
    }
    expect(html).not.toContain("physical fit is confirmed");
  });

  it("retains all quantities and written instructions for black-and-white print without open dialogs", () => {
    const html = render();
    const print = html.split(/<div class="[^"]*printGuide[^"]*">/)[1];
    expect(print).toBeTruthy();
    for (const item of flatten(plan.objects)) {
      expect(print).toContain(item.description);
      for (const content of item.contents) expect(print).toContain(content);
    }
    const css = readFileSync(new URL("../EventSetupDiagram.module.css", import.meta.url), "utf8");
    const printCss = css.split("@media print")[1];
    expect(printCss).toMatch(/\.hotspot[^}]*display: none !important/);
    expect(printCss).toContain(".printGuide { display: block; }");
    expect(printCss).toContain("color: #000");
    expect(html).not.toContain("<dialog open");
  });

  it("does not show an equipment layout when no food was purchased", () => {
    expect(render({ ...plan, status: "no-food", objects: [] })).toBe("");
  });

  it("omits taco-stand totals when no Taco Bar was contracted", () => {
    const html = render({ ...plan, tacoStands: 0, objects: plan.objects.slice(0, 1) });
    expect(html).toContain("30 plates · event total");
    expect(html).not.toContain("taco stands · event total");
    expect(html).not.toContain("Taco-stand total needs review");
  });
});
