import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { buildEventServingPlan, type EventServingPlan, type ServingObject } from "@/lib/operations/serving-plan";
import { contractSetup } from "@/lib/operations/setup";
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
const objectButton = (html: string, id: string) => html.match(new RegExp(`<button\\b[^>]*data-serving-object="${id}"[^>]*>`))?.[0] ?? "";
const twoChaferEvent: EventPlan = {
  id: 78, name: "Redacted two-chafer setup event", date: "2026-11-04", day: "Wednesday", time: "5:30 PM - 8:30 PM",
  guest_count: 55, rooms: ["VIP 1"], color: "#18332F", food: ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Dessert Platter"],
  drink_options: [], entertainment: [], verification_status: "Verified redacted source", source_updated_at: "2026-11-04T15:00:00Z",
};
const novemberFifthEvent: EventPlan = {
  ...twoChaferEvent, id: 89, name: "Redacted November 5 Taco Bar event", date: "2026-11-05", day: "Thursday",
  guest_count: 35, food: ["35 × The Front Nine + Taco Bar", "1 × Chicken Tender Platter", "1 × Dessert Platter"],
  source_event_id: "redacted-november-5", source_updated_at: "2026-11-05T15:00:00Z",
};

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

  it("uses the approved two-chafer mockup with one sauce station and one dessert station for the matching event", () => {
    const event = structuredClone(twoChaferEvent);
    const value = buildEventServingPlan(event);
    const before = structuredClone(value);
    const html = render(value);
    const figures = photoFigures(html);
    expect(figures).toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(figures).not.toContain('src="/setup/empty-buffet-table-v1.png"');
    expect(figures.match(/<figure\b/g)).toHaveLength(1);
    expect(figures.match(/data-serving-object="appetizer-chafer"/g)).toHaveLength(1);
    expect(figures.match(/data-serving-object="platter-chafer-1"/g)).toHaveLength(1);
    expect(figures.match(/data-serving-object="sauce-station"/g)).toHaveLength(1);
    expect(figures.match(/data-serving-object="cold-platter-dessert"/g)).toHaveLength(1);
    expect(figures.match(/data-serving-object="dessert-tongs"/g)).toHaveLength(1);
    expect(figures).not.toContain("data-equipment-sprite=");
    for (const target of buildTableMockup(value).targets) {
      expect(figures).toContain(`data-serving-object="${target.item.id}"`);
      expect(html).toContain(`value="${target.item.id}"`);
    }
    expect(html).toContain("110 plates · event total");
    expect(html).toContain("Left long black plate: 3 tongs");
    expect(html).toContain("Right long black plate: 3 tongs");
    expect(html).toContain("Left long black plate: 2 tongs");
    expect(html).toContain("Right long black plate: 2 tongs");
    const printed = html.split(/<div class="[^"]*printGuide[^"]*">/)[1];
    expect(printed).toContain("one long black sauce plate with 3 spoons — one per sauce type");
    expect(printed).toContain("one dessert platter on a clear riser with two tongs");
    expect(printed).toContain("Service setup: one spoon for this sauce type on the shared long black sauce plate.");
    expect(printed).toContain("Service setup: two tongs at the shared dessert riser.");
    expect(printed).toContain("hold extra prepared food for refills");
    expect(printed).toContain("Full event totals include refill containers and spare serving tools");
    for (const item of flatten(value.objects)) expect(printed).toContain(item.description);
    expect(value).toEqual(before);
    expect(event).toEqual(twoChaferEvent);
  });

  it("does not substitute the approved two-chafer mockup for a different or unresolved event", () => {
    for (const food of [
      ["15 × The Full Course + Taco Bar"],
      ["2 × Wing Platter", "1 × Dessert Platter"],
      [...twoChaferEvent.food, "1 × Unmapped Buffet"],
    ]) {
      const html = render(buildEventServingPlan({ ...twoChaferEvent, food }));
      expect(photoFigures(html)).not.toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    }
  });

  it("keeps the redacted November 5 Taco Bar and tender stations on one buffet with an attached dessert table", () => {
    const event = structuredClone(novemberFifthEvent);
    const prep = contractSetup(event);
    const value = buildEventServingPlan(event);
    const before = structuredClone(value);
    const html = render(value);
    const figures = photoFigures(html);
    expect(figures.match(/<figure\b/g)).toHaveLength(1);
    expect(figures).toContain('aria-label="Whole table mockup"');
    expect(html).not.toContain("Layout continuation");
    for (const id of ["service-cart", "taco-tortillas", "taco-stands", "taco-lettuce-wraps", "taco-tier", "taco-chafer", "platter-chafer-1", "sauce-station"]) {
      expect(objectButton(figures, id)).toContain('data-serving-surface="buffet"');
      expect(html).toContain(`value="${id}"`);
    }
    expect(value.objects.filter((item) => item.kind === "chafer")).toHaveLength(2);
    expect(html).toContain("70 plates · event total");
    expect(html).toContain("70 taco stands · event total");
    for (const text of ["Black Beans", "Chicken", "Beef", "Chicken Tenders", "Lettuce; Cheese", "Onion; Tomato", "Salsa; Sour Cream"]) expect(html).toContain(text);
    for (const id of ["cold-platter-dessert", "dessert-tongs"]) {
      expect(objectButton(figures, id)).toContain('data-serving-surface="dessert-cocktail"');
      expect(figures.match(new RegExp(`data-serving-object="${id}"`, "g"))).toHaveLength(1);
    }
    expect(figures).toContain('aria-label="Dessert cocktail table at the end of the buffet"');
    expect(objectButton(figures, "dessert-support-table")).toContain('aria-haspopup="dialog"');
    expect(html).toContain('value="dessert-support-table"');
    const printed = html.split(/<div class="[^"]*printGuide[^"]*">/)[1];
    expect(printed).toContain("Round black cocktail table · 1 cocktail table per serving line");
    expect(printed).toContain("two tongs");
    expect(printed).toContain("This support table does not change purchased food, kitchen prep or booked seating");
    expect(value).toEqual(before);
    expect(event).toEqual(novemberFifthEvent);
    expect(contractSetup(event)).toEqual(prep);
  });

  it.each([
    { food: "15 × The Front Nine + Appetizer Bar", chafer: "appetizer-chafer", sauces: ["sauce-marinara", "sauce-ranch", "sauce-bbq"], spoons: 3 },
    { food: "15 × The Full Course + Wing Bar", chafer: "wing-chafer", sauces: ["sauce-bbq", "sauce-ranch"], spoons: 2 },
  ])("centers the standalone $chafer and shows each required sauce on one shared plate", ({ food, chafer, sauces, spoons }) => {
    const value = buildEventServingPlan({ ...twoChaferEvent, guest_count: 15, food: [food] });
    const html = render(value);
    const figures = photoFigures(html);
    const target = buildTableMockup(value).targets.find((item) => item.item.id === chafer)!;
    expect(target.left + target.width / 2).toBeCloseTo(50);
    expect(target.top + target.height / 2).toBeGreaterThan(50);
    expect(objectButton(figures, chafer)).toContain('data-serving-surface="buffet"');
    expect(figures.match(/data-serving-object="sauce-station"/g)).toHaveLength(1);
    for (const id of sauces) {
      expect(objectButton(figures, id)).toContain('aria-haspopup="dialog"');
      expect(html).toContain(`value="${id}"`);
    }
    expect(html).toContain(`one long black sauce plate with ${spoons} spoons — one per sauce type`);
    expect(figures).not.toContain('data-serving-object="taco-chafer"');
    if (chafer === "wing-chafer") {
      expect(value.objects.find((item) => item.id === "sauce-station")?.quantity).toBeNull();
      expect(html).toContain("Check flagged items");
      expect(html).toContain("Ranch");
      expect(html).toContain("complete event container and matching-spoon quantity remains unresolved");
    } else expect(html).toContain("Marinara");
  });

  it("puts overflow dessert and its tongs on the cocktail surface without duplicating them on the buffet", () => {
    const value = buildEventServingPlan({ ...twoChaferEvent, guest_count: 35, food: ["35 × The Front Nine + Appetizer Bar", "4 × Wing Platter", "1 × Veggie Tray", "1 × Dessert Platter"] });
    const html = render(value);
    const figures = photoFigures(html);
    expect(value.objects.filter((item) => item.kind === "chafer")).toHaveLength(3);
    expect(figures.match(/<figure\b/g)).toHaveLength(1);
    for (const id of ["cold-platter-dessert", "dessert-tongs"]) {
      const buttons = [...figures.matchAll(new RegExp(`<button\\b[^>]*data-serving-object="${id}"[^>]*>`, "g"))];
      expect(buttons).toHaveLength(1);
      expect(buttons[0][0]).toContain('data-serving-surface="dessert-cocktail"');
    }
    expect(html).toContain('value="dessert-support-table"');
    for (const item of flatten(value.objects)) expect(html).toContain(item.description);
  });

  it("keeps mirrored dessert support visual-only and event-wide food, plates and stands unchanged", () => {
    const value = buildEventServingPlan({ ...novemberFifthEvent, guest_count: 101 });
    const before = structuredClone(value);
    const html = render(value);
    expect(html).toContain("Two mirrored serving lines");
    expect(html).toContain("202 plates · event total");
    expect(html).toContain("70 taco stands · event total");
    expect(html).not.toContain("404 plates");
    expect(html).not.toContain("140 taco stands");
    expect(html).toContain("1 cocktail table per serving line");
    expect(html).toContain("Food is shared between the lines, not doubled");
    expect(value.objects.some((item) => item.id === "dessert-support-table")).toBe(false);
    expect(value).toEqual(before);
  });

  it("keeps unresolved food unpictured and preserves all source evidence", () => {
    const event = { ...novemberFifthEvent, food: [...novemberFifthEvent.food, "1 × Unmapped Buffet"] };
    const before = structuredClone(event);
    const value = buildEventServingPlan(event);
    const source = structuredClone(value.source);
    const html = render(value);
    expect(html).toContain("Check flagged items");
    expect(value.unplacedFood).toContain("1 × Unmapped Buffet");
    expect(photoFigures(html)).not.toContain("Unmapped Buffet");
    expect(html).not.toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(value.source).toEqual(source);
    expect(value.source.eventId).toBe("redacted-november-5");
    expect(value.source.updatedAt).toBe("2026-11-05T15:00:00Z");
    expect(value.source.rawSelections).toEqual(event.food);
    expect(event).toEqual(before);
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
