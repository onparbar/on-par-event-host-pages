import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { contractSetup } from "../setup";
import { buildEventServingPlan, EVENT_SERVING_RULE_VERSION, type ServingObject } from "../serving-plan";

const base: EventPlan = {
  id: 42, name: "Redacted serving fixture", date: "2026-11-04", day: "Wednesday", time: "5:30 PM - 8:30 PM",
  guest_count: 15, rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [],
  verification_status: "Verified redacted source", source_updated_at: "2026-11-04T15:00:00Z", rule_version: "verified-event-rule",
};
function plan(food: string[], extra: Partial<EventPlan> = {}) { return buildEventServingPlan({ ...base, food, ...extra }); }
function flat(objects: ServingObject[]): ServingObject[] { return objects.flatMap((item) => [item, ...flat(item.children ?? [])]); }
function chafers(food: string[]) { return plan(food).objects.filter((item) => item.kind === "chafer"); }

describe("deterministic event serving plan", () => {
  it("matches the validated redacted August 21 BEO without treating its one Wing Bar option as one guest", () => {
    const event = { ...base, guest_count: 50, food: ["50 × The Full Course", "1 × Jumbo Wing Bar — Premium wings, expertly prepared and designed for effortless group dining.", "5 × Desert Platter"] };
    const before = structuredClone(event);
    const prep = contractSetup(event);
    const result = buildEventServingPlan(event);
    expect(result.plates).toBe(100);
    expect(result.chafingDishesPerLine).toBe(1);
    expect(result.unplacedFood).toEqual([]);
    expect(flat(result.objects).find((item) => item.id === "cold-platter-dessert")?.quantity).toBe(5);
    expect(result.review.join(" ")).toContain("Wing Bar ranch container quantity needs review");
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
  });
  it.each([0, 1, 2, 3, 4, 5, 7, 10])("packs %i purchased hot platters into a triple then pairs, separate from prep pans", (quantity) => {
    const food = quantity ? [`${quantity} × Tater Keg Platter`] : [];
    const event = { ...base, food };
    const prep = contractSetup(event);
    const before = structuredClone(event);
    const result = buildEventServingPlan(event);
    const dishes = result.objects.filter((item) => item.kind === "chafer");
    expect(result.chafingDishesPerLine).toBe(quantity === 0 ? 0 : quantity % 2 ? Math.max(1, (quantity - 1) / 2) : quantity / 2);
    expect(dishes).toHaveLength(quantity === 0 ? 0 : quantity % 2 ? 1 + Math.max(0, (quantity - 3) / 2) : quantity / 2);
    const pans = dishes.flatMap((item) => item.children?.filter((child) => child.kind === "pan") ?? []);
    expect(pans).toHaveLength(quantity);
    expect(pans.map((item) => item.contents)).toEqual(Array.from({ length: quantity }, () => ["Tater Kegs"]));
    for (const [index, dish] of dishes.entries()) {
      const group = dish.children!.filter((item) => item.kind === "pan");
      expect(group.map((item) => item.panSize)).toEqual(group.map(() => index === 0 && quantity % 2 ? "1/3" : "1/2"));
      expect(dish.children!.filter((item) => item.kind === "utensils").map((item) => item.quantity)).toEqual([group.length, group.length]);
      expect(dish.description).toContain("hold remaining prepared pans for refills");
    }
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
  });

  it("counts platter quantities, not distinct food names, and sums duplicate kinds", () => {
    const dishes = chafers(["1 × Wing Platter", "2 × Wing Platter", "2 × Chicken Tender Platter"]);
    expect(dishes).toHaveLength(2);
    expect(dishes[0].contents).toEqual(["Chicken Tenders", "Chicken Tenders", "Wings"]);
    expect(dishes[1].contents).toEqual(["Wings", "Wings"]);
    expect(dishes.flatMap((item) => item.children!.filter((child) => child.kind === "pan"))).toHaveLength(5);
  });

  it("keeps veggie and dessert platters on plates/risers outside the hot-platter count", () => {
    const result = plan(["1 × Wing Platter", "1 × Chicken Tender Platter", "3 × Veggie Tray", "2 × Desert Platter"]);
    expect(result.chafingDishesPerLine).toBe(1);
    const items = flat(result.objects);
    expect(items.find((item) => item.id === "cold-platter-veggie")).toMatchObject({ quantity: 3, contents: ["Veggie Tray"] });
    expect(items.find((item) => item.id === "cold-platter-dessert")).toMatchObject({ quantity: 2, contents: ["Dessert Platter"] });
    expect(items.find((item) => item.id === "veggie-tongs")?.quantity).toBe(6);
    expect(items.find((item) => item.id === "dessert-tongs")?.quantity).toBe(4);
    expect(items.filter((item) => item.kind === "pan").map((item) => item.contents[0])).toEqual(["Chicken Tenders", "Wings"]);
  });

  it("uses BBQ plus ranch for each wing/tender platter and marinara for each mozzarella platter, one spoon each", () => {
    const result = plan(["2 × Chicken Tender Platter", "1 × Wing Platter", "2 × Mozzarella Stick Platter"]);
    const items = flat(result.objects);
    expect(items.find((item) => item.id === "sauce-bbq")?.quantity).toBe(3);
    expect(items.find((item) => item.id === "sauce-ranch")?.quantity).toBe(3);
    expect(items.find((item) => item.id === "sauce-marinara")?.quantity).toBe(2);
    expect(items.find((item) => item.id === "sauce-station")?.quantity).toBe(8);
    expect(items.find((item) => item.id === "sauce-ranch")?.description).toContain("3 spoons");
    expect(items.find((item) => item.id === "sauce-station")?.description).toContain("one spoon per container");
  });

  it("keeps required Wing Bar BBQ and unresolved Ranch in one shared serving station", () => {
    const result = plan(["15 × The Full Course + Wing Bar"]);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(result.objects.filter((item) => item.kind === "sauces")).toEqual([station]);
    expect(station.quantity).toBeNull();
    expect(station.description).toContain("one shared long black sauce plate with one spoon per sauce type");
    expect(station.children).toEqual([
      expect.objectContaining({ id: "sauce-bbq", quantity: 1, contents: ["BBQ"] }),
      expect.objectContaining({ id: "sauce-ranch", quantity: null, contents: ["Ranch"] }),
    ]);
    expect(station.children?.find((item) => item.id === "sauce-ranch")?.description).toContain("complete event container and matching-spoon quantity remains unresolved");
    expect(flat(result.objects).some((item) => item.id === "wing-ranch")).toBe(false);
    expect(result.review.join(" ")).toContain("Wing Bar ranch container quantity needs review");
    expect(result.review.join(" ")).toContain("Ranch is required, but the number of sauce bowls is not approved.");
    expect(result.status).toBe("needs-review");
  });

  it("keeps the Appetizer Bar’s approved Marinara, Ranch and BBQ amounts in one shared station", () => {
    const result = plan(["15 × The Front Nine + Appetizer Bar"]);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(result.objects.filter((item) => item.kind === "sauces")).toEqual([station]);
    expect(station.quantity).toBe(3);
    expect(station.children?.map((item) => [item.id, item.quantity])).toEqual([["sauce-marinara", 1], ["sauce-ranch", 1], ["sauce-bbq", 1]]);
    expect(station.description).toContain("one shared long black sauce plate");
    expect(result.review.join(" ")).not.toContain("Wing Bar ranch");
  });

  it.each([1, 2, 10])("retains BBQ and Ranch per purchased Wing/Tender Platter, not per prepared pan, for %i of each", (quantity) => {
    const event = { ...base, food: [`${quantity} × Wing Platter`, `${quantity} × Chicken Tender Platter`] };
    const before = structuredClone(event);
    const prep = contractSetup(event);
    const result = buildEventServingPlan(event);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(station.quantity).toBe(quantity * 4);
    expect(station.children?.map((item) => [item.id, item.quantity])).toEqual([["sauce-bbq", quantity * 2], ["sauce-ranch", quantity * 2]]);
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
  });

  it("preserves approved Ranch from platters without presenting it as the complete Wing Bar event amount", () => {
    const event = { ...base, source_event_id: "vip-redacted-wing-tender", food: ["15 × The Full Course + Wing Bar", "2 × Chicken Tender Platter"] };
    const before = structuredClone(event);
    const prep = contractSetup(event);
    const result = buildEventServingPlan(event);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(station.quantity).toBeNull();
    expect(station.children?.map((item) => [item.id, item.quantity])).toEqual([["sauce-bbq", 3], ["sauce-ranch", null]]);
    expect(station.children?.find((item) => item.id === "sauce-ranch")?.description).toContain("2 approved Ranch containers with 2 matching spoons are counted from other selected food");
    expect(result.review.join(" ")).toContain("additional quantity required for Wing Bar is not approved");
    expect(result.source).toEqual({ eventId: event.source_event_id, updatedAt: event.source_updated_at, eventRuleVersion: event.rule_version, rawSelections: event.food });
    expect(result.ruleVersion).toBe("event-serving-2026-11-05.1");
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
    expect(buildEventServingPlan(event)).toEqual(result);
  });

  it("merges mixed bars and platters by sauce type without losing Marinara or guessing Wing Bar Ranch", () => {
    const event = { ...base, food: ["15 × The Full Course + Wing Bar", "15 × The Front Nine + Appetizer Bar", "1 × Mozzarella Stick Platter", "2 × Chicken Tender Platter"] };
    const before = structuredClone(event);
    const prep = contractSetup(event);
    const result = buildEventServingPlan(event);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(result.objects.filter((item) => item.kind === "sauces")).toEqual([station]);
    expect(station.quantity).toBeNull();
    expect(station.children?.find((item) => item.id === "sauce-bbq")?.quantity).toBe(4);
    expect(station.children?.find((item) => item.id === "sauce-marinara")?.quantity).toBe(2);
    expect(station.children?.find((item) => item.id === "sauce-ranch")).toMatchObject({ quantity: null, contents: ["Ranch"] });
    expect(station.children?.find((item) => item.id === "sauce-ranch")?.description).toContain("3 approved Ranch containers with 3 matching spoons");
    expect(new Set(station.children?.map((item) => item.id)).size).toBe(3);
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
  });

  it.each([100, 101, 200, 201])("keeps shared sauce requirements event-wide and unresolved prep warnings at %i guests", (guests) => {
    const event = { ...base, guest_count: guests, food: ["25 × The Full Course + Wing Bar", "2 × Chicken Tender Platter"] };
    const before = structuredClone(event);
    const prep = contractSetup(event);
    const result = buildEventServingPlan(event);
    const station = result.objects.find((item) => item.id === "sauce-station")!;
    expect(result.servingLines).toBe(guests > 100 ? 2 : 1);
    expect(station.quantity).toBeNull();
    expect(station.children?.map((item) => [item.id, item.quantity])).toEqual([["sauce-bbq", 3], ["sauce-ranch", null]]);
    expect(result.review.join(" ")).toContain("Wing Bar ranch container quantity needs review");
    if (guests > 200) expect(result.review.join(" ")).toContain("additional/reserve dishes");
    expect(result.source.rawSelections).toEqual(event.food);
    expect(contractSetup(event)).toEqual(prep);
    expect(event).toEqual(before);
  });

  it("builds the Taco Bar contents and 2 stands per contracted guest, with 2 plates per event guest", () => {
    const result = plan(["15 × The Full Course + Taco Bar"]);
    const items = flat(result.objects);
    expect(result).toMatchObject({ plates: 30, tacoStands: 30, chafingDishesPerLine: 1, servingLines: 1 });
    expect(items.find((item) => item.id === "taco-chafer")?.contents).toEqual(["Black Beans", "Chicken", "Beef"]);
    expect(items.find((item) => item.id === "taco-tortillas")?.contents).toEqual(["Tortillas"]);
    expect(items.find((item) => item.id === "taco-lettuce-wraps")?.contents).toEqual(["Lettuce Wraps"]);
    expect(items.find((item) => item.id === "tier-top")?.contents).toEqual(["Lettuce", "Cheese"]);
    expect(items.find((item) => item.id === "tier-middle")?.contents).toEqual(["Onion", "Tomato"]);
    expect(items.find((item) => item.id === "tier-bottom")?.contents).toEqual(["Salsa", "Sour Cream"]);
    expect(items.find((item) => item.id === "tier-top-tools")?.quantity).toBe(2);
    expect(items.find((item) => item.id === "tier-middle-tools")?.quantity).toBe(2);
    expect(items.find((item) => item.id === "tier-bottom-tools")?.quantity).toBe(2);
    expect(result.review.join(" ")).not.toContain("Bar serving-tong quantities need review");
    expect(result.review.join(" ")).not.toContain("Bar sauce containers need review");
  });

  it.each([
    ["40 × The Full Course + Taco Bar"],
    ["40 × The Full Course", "Taco Bar"],
    ["40 × The Full Course", "40 × Taco Bar"],
  ])("uses contracted Taco Bar guests rather than the separate event headcount: %s", (...food) => {
    const result = plan(food, { guest_count: 50 });
    expect(result.plates).toBe(100);
    expect(result.tacoStands).toBe(80);
  });

  it.each([
    ["The Full Course", "Taco Bar"],
    ["40 × The Full Course", "1 × Taco Bar"],
    ["50 × The Full Course", "40 × Taco Bar"],
    ["15 × The Full Course + Taco Bar", "20 × Taco Bar"],
  ])("does not guess conflicting or missing contracted Taco Bar counts: %s", (...food) => {
    const result = plan(food);
    expect(result.tacoStands).toBeNull();
    expect(result.review.join(" ")).toContain("Taco Bar guest quantity");
  });

  it("keeps package dessert guest portions separate from purchased platter counts", () => {
    const included = plan(["55 × The Front Nine with dessert + Appetizer Bar"], { guest_count: 55 });
    expect(flat(included.objects).find((item) => item.id === "cold-platter-dessert")?.quantity).toBe(2);
    expect(flat(included.objects).find((item) => item.id === "cold-platter-dessert")?.description).toContain("kitchen-calculated");
    const explicit = plan(["55 × The Front Nine with dessert + Appetizer Bar", "5 × Dessert Platter"], { guest_count: 55 });
    expect(flat(explicit.objects).find((item) => item.id === "cold-platter-dessert")?.quantity).toBe(5);
    const largeExplicit = plan(["11 × Dessert Platter"]);
    expect(flat(largeExplicit.objects).find((item) => item.id === "cold-platter-dessert")?.quantity).toBe(11);
    expect(largeExplicit.unplacedFood).toEqual([]);
  });

  it("composes additional platters separately from the approved bar chafer", () => {
    const result = plan(["15 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "1 × Desert Platter"]);
    expect(result.objects.filter((item) => item.kind === "chafer").map((item) => item.id)).toEqual(["appetizer-chafer", "platter-chafer-1"]);
    expect(result.objects.find((item) => item.id === "appetizer-chafer")?.contents).toEqual(["Tater Kegs", "Mozzarella Sticks", "Chicken Tenders"]);
    expect(result.unplacedFood).toEqual([]);
    const wing = plan(["15 × The Full Course + Wing Bar"]);
    expect(wing.objects.find((item) => item.id === "wing-chafer")?.contents).toEqual(["Wings", "French Fries"]);
    expect(wing.objects.find((item) => item.id === "wing-celery")?.kind).toBe("cold-platter");
    expect(wing.review.join(" ")).toContain("Wing Bar ranch container quantity needs review");
  });

  it("does not confuse another explicitly linked bar package with the contracted Taco Bar quantity", () => {
    const result = plan(["15 × The Full Course + Taco Bar", "20 × The Front Nine + Appetizer Bar"], { guest_count: 35 });
    expect(result.tacoStands).toBe(30);
    expect(result.plates).toBe(70);
    expect(result.chafingDishesPerLine).toBe(2);
    expect(result.unplacedFood).toEqual([]);
    expect(result.review.join(" ")).not.toContain("Taco Bar guest quantity");
  });

  it.each([100, 101, 200, 201])("mirrors equipment at %i guests without multiplying event-wide plates, stands or purchased foods", (guests) => {
    const event = { ...base, guest_count: guests, food: ["15 × The Full Course + Taco Bar", "1 × Wing Platter", "2 × Desert Platter"] };
    const result = buildEventServingPlan(event);
    expect(result.servingLines).toBe(guests > 100 ? 2 : 1);
    expect(result.plates).toBe(guests * 2);
    expect(result.tacoStands).toBe(30);
    expect(result.chafingDishesPerLine).toBe(2);
    expect(flat(result.objects).find((item) => item.id === "sauce-ranch")?.quantity).toBe(1);
    expect(flat(result.objects).find((item) => item.id === "cold-platter-dessert")?.quantity).toBe(2);
    expect(result.review.join(" ")).toContain(guests > 200 ? "additional/reserve dishes" : guests > 100 ? "Mirror serving equipment" : "");
  });

  it.each(["Chicken Tender Platter", "0 × Chicken Tender Platter", "1.5 × Chicken Tender Platter", "11 × Chicken Tender Platter", "1 × Unknown Feast", "2 × Ranch"])("leaves unresolved selections unplaced instead of inventing pans or sauces: %s", (food) => {
    const result = plan([food]);
    expect(result.status).toBe("needs-review");
    expect(result.unplacedFood).toContain(food);
    expect(result.chafingDishesPerLine).toBeNull();
    expect(result.objects.some((item) => item.kind === "chafer")).toBe(false);
  });

  it.each(["0 × The Full Course + Taco Bar", "1.5 × The Full Course + Taco Bar"])("does not assign a buffet for invalid bar quantities: %s", (food) => {
    const result = plan([food]);
    expect(result.objects.some((item) => item.kind === "chafer")).toBe(false);
    expect(result.unplacedFood).toContain(food);
  });

  it("retains missing source/guest/room evidence and source warnings", () => {
    const result = plan(["1 × Wing Platter"], { guest_count: 0, rooms: [], source_updated_at: null, needs_review: true, review_reasons: ["Source contract warning"] });
    expect(result.plates).toBeNull();
    expect(result.servingLines).toBeNull();
    expect(result.status).toBe("needs-review");
    expect(result.review.join(" ")).toContain("Source contract warning");
    expect(result.review.join(" ")).toContain("source update timestamp");
    expect(result.review.join(" ")).toContain("reserved area");
  });

  it.each([[], ["No food"], ["none"]].map((food) => ({ food })))("does not manufacture a service line for a no-food event: $food", ({ food }) => {
    expect(plan(food)).toMatchObject({ status: "no-food", objects: [], servingLines: 0, plates: 0, tacoStands: 0, chafingDishesPerLine: 0 });
  });

  it("retains raw canonical source selections, identity and rule evidence without mutation", () => {
    const event = { ...base, source_event_id: "vip-test-42", food: ["15 × The Full Course + Taco Bar", "1 × Wing Platter"] };
    const before = structuredClone(event);
    const result = buildEventServingPlan(event);
    expect(result.ruleVersion).toBe(EVENT_SERVING_RULE_VERSION);
    expect(result.source).toEqual({ eventId: "vip-test-42", updatedAt: base.source_updated_at, eventRuleVersion: "verified-event-rule", rawSelections: event.food });
    expect(buildEventServingPlan(event)).toEqual(result);
    expect(event).toEqual(before);
    result.objects[0].children![0].description = "mutated";
    result.source.rawSelections.push("not purchased");
    expect(buildEventServingPlan(event)).not.toEqual(result);
    expect(event).toEqual(before);
    const ids = flat(buildEventServingPlan(event).objects).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
