import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { buildEventServingPlan } from "@/lib/operations/serving-plan";
import { buildTableMockup } from "../table-mockup";

const event: EventPlan = { id: 42, name: "Redacted layout fixture", date: "2026-11-04", day: "Wednesday", time: "5:30 PM - 8:30 PM", guest_count: 15, rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified", source_updated_at: "2026-11-04T15:00:00Z" };
const plan = (food: string[], guest_count = 15) => buildEventServingPlan({ ...event, food, guest_count });

describe("event-specific whole-table composition", () => {
  it.each([
    ["15 × The Full Course + Taco Bar"],
    ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Dessert Platter"],
    ["3 × Wing Platter", "2 × Chicken Tender Platter", "1 × Veggie Tray", "1 × Dessert Platter"],
    ["15 × The Full Course + Wing Bar"],
    ["10 × Wing Platter", "10 × Chicken Tender Platter", "10 × Mozzarella Stick Platter"],
  ].map((food) => ({ food })))("retains every top-level object, stable bounded positions and model quantities: $food", ({ food }) => {
    const source = plan(food), before = structuredClone(source), result = buildTableMockup(source);
    const ids = new Set(result.targets.map((target) => target.item.id));
    for (const item of source.objects) expect(ids.has(item.id)).toBe(true);
    expect(new Set(result.targets.map((target) => target.id)).size).toBe(result.targets.length);
    expect(new Set(result.art.map((item) => item.key)).size).toBe(result.art.length);
    for (const box of [...result.targets, ...result.art]) {
      expect(box.tableIndex).toBeGreaterThanOrEqual(0); expect(box.tableIndex).toBeLessThan(result.tableCount);
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
      expect(box.left + box.width).toBeLessThanOrEqual(100); expect(box.top + box.height).toBeLessThanOrEqual(100);
    }
    for (const item of result.art) { expect(item.sprite).toBeGreaterThanOrEqual(0); expect(item.sprite).toBeLessThan(16); expect([11, 13, 14]).not.toContain(item.sprite); }
    expect(buildTableMockup(source)).toEqual(result); expect(source).toEqual(before);
  });

  it("keeps the Taco Bar on one complete board with paired warmers, stands, utensils and tier stand", () => {
    const result = buildTableMockup(plan(["15 × The Full Course + Taco Bar"]));
    expect(result.tableCount).toBe(1); expect(result.crowded).toBe(false);
    expect(result.art.filter((item) => item.sprite === 9)).toHaveLength(2);
    expect(result.art.filter((item) => item.sprite === 10)).toHaveLength(1);
    expect(result.art.filter((item) => item.sprite === 5)).toHaveLength(1);
    expect(result.art.filter((item) => item.sprite === 12)).toHaveLength(1);
    expect(result.targets.some((target) => target.item.kind === "pan")).toBe(false);
    expect(result.targets.find((target) => target.item.id === "taco-chafer")?.item.contents).toEqual(["Black Beans", "Chicken", "Beef"]);
    for (const id of ["tier-top-tools", "tier-middle-tools", "tier-bottom-tools"]) {
      expect(result.targets.find((target) => target.item.id === id)?.item.quantity).toBe(2);
      expect(result.art.some((item) => item.key.startsWith(`${id}-tool-`))).toBe(false);
    }
  });

  it("draws the two-half-pan and three-third-pan groups with matching tools", () => {
    const result = buildTableMockup(plan(["3 × Wing Platter", "2 × Chicken Tender Platter"]));
    expect(result.art.filter((item) => item.sprite === 5)).toHaveLength(1);
    expect(result.art.filter((item) => item.sprite === 4)).toHaveLength(1);
    expect(result.art.filter((item) => item.sprite === 7)).toHaveLength(10);
    expect(result.art.filter((item) => item.sprite === 15)).toHaveLength(10);
    expect(result.art.filter((item) => item.sprite === 8)).toHaveLength(10);
  });

  it("keeps horizontal tool crops in vertical rows inside each black chafer plate", () => {
    const result = buildTableMockup(plan(["15 × The Front Nine + Appetizer Bar"]));
    const chafer = result.targets.find((target) => target.item.id === "appetizer-chafer")!;
    expect(chafer.width).toBe(25); expect(chafer.height).toBe(18);
    for (const side of ["left", "right"]) {
      const id = `appetizer-chafer-utensils-${side}`;
      const plate = result.targets.find((target) => target.item.id === id)!;
      expect(plate.left).toBe(side === "left" ? 21.5 : 65.5);
      expect(plate.width).toBe(13); expect(plate.height).toBe(13);
      expect(side === "left" ? plate.left + plate.width <= chafer.left : plate.left >= chafer.left + chafer.width).toBe(true);
      const tools = result.art.filter((item) => item.key.startsWith(`${id}-tool-`));
      expect(tools).toHaveLength(3);
      expect(new Set(tools.map((item) => item.left)).size).toBe(1);
      for (const [index, tool] of tools.entries()) {
        expect(tool.width / tool.height).toBeCloseTo(4);
        expect(tool.left).toBeGreaterThanOrEqual(plate.left);
        expect(tool.left + tool.width).toBeLessThanOrEqual(plate.left + plate.width);
        expect(tool.top).toBeGreaterThanOrEqual(plate.top);
        expect(tool.top + tool.height).toBeLessThanOrEqual(plate.top + plate.height);
        if (index) expect(tool.top).toBeGreaterThan(tools[index - 1].top + tools[index - 1].height);
      }
    }
  });

  it("keeps the lettuce-wrap tongs target on the reference riser without drawing its pictured tools twice", () => {
    const result = buildTableMockup(plan(["15 × The Full Course + Taco Bar"]));
    const riser = result.targets.find((target) => target.item.id === "taco-lettuce-wraps")!;
    const tools = result.targets.find((target) => target.item.id === "lettuce-wrap-tongs")!;
    expect(result.art.filter((item) => item.key.startsWith("lettuce-wrap-tongs-tool-"))).toHaveLength(0);
    expect(tools.item.quantity).toBe(2);
    expect(tools.left).toBeGreaterThanOrEqual(riser.left);
    expect(tools.left + tools.width).toBeLessThanOrEqual(riser.left + riser.width);
    expect(tools.top).toBeGreaterThanOrEqual(riser.top);
    expect(tools.top + tools.height).toBeLessThanOrEqual(riser.top + riser.height);
    expect(tools.left).toBeGreaterThan(riser.left + riser.width / 2);
  });

  it("draws each cold platter as empty equipment and keeps its two tongs without fake food", () => {
    const result = buildTableMockup(plan(["2 × Dessert Platter", "1 × Veggie Tray"]));
    expect(result.targets.filter((target) => target.item.id === "cold-platter-dessert")).toHaveLength(2);
    expect(result.targets.filter((target) => target.item.id === "cold-platter-veggie")).toHaveLength(1);
    // The dessert reference already includes two tongs on each plate; only veggie tools are composed separately.
    expect(result.art.filter((item) => item.sprite === 7)).toHaveLength(2);
    expect(result.targets.filter((target) => target.item.id === "dessert-tongs")).toHaveLength(2);
    expect(result.art.some((item) => item.key.startsWith("dessert-tongs"))).toBe(false);
    for (const plate of result.targets.filter((target) => target.item.id === "cold-platter-dessert")) {
      const tools = result.targets.find((target) => target.id === plate.id.replace("cold-platter-dessert", "dessert-tongs"))!;
      expect(tools.left).toBeGreaterThan(plate.left + plate.width / 2);
      expect(tools.left + tools.width).toBeLessThanOrEqual(plate.left + plate.width);
      expect(tools.top).toBeGreaterThanOrEqual(plate.top);
      expect(tools.top + tools.height).toBeLessThanOrEqual(plate.top + plate.height);
    }
    const veggiePlate = result.targets.find((target) => target.item.id === "cold-platter-veggie")!;
    const veggieTools = result.targets.find((target) => target.item.id === "veggie-tongs")!;
    expect(veggieTools.left).toBeGreaterThan(veggiePlate.left + veggiePlate.width / 2);
    expect(veggieTools.left + veggieTools.width).toBeLessThanOrEqual(veggiePlate.left + veggiePlate.width);
    expect(veggieTools.top).toBeGreaterThanOrEqual(veggiePlate.top);
    expect(veggieTools.top + veggieTools.height).toBeLessThanOrEqual(veggiePlate.top + veggiePlate.height);
    for (const tool of result.art.filter((item) => item.key.startsWith("veggie-tongs"))) {
      expect(tool.left).toBeGreaterThanOrEqual(veggiePlate.left);
      expect(tool.left + tool.width).toBeLessThanOrEqual(veggiePlate.left + veggiePlate.width);
      expect(tool.top).toBeGreaterThanOrEqual(veggiePlate.top);
      expect(tool.top + tool.height).toBeLessThanOrEqual(veggiePlate.top + veggiePlate.height);
    }
    expect(result.art.some((item) => [11, 13, 14].includes(item.sprite))).toBe(false);
  });

  it("spills large menus onto additional boards without shrinking equipment or repeating carts", () => {
    const small = buildTableMockup(plan(["1 × Wing Platter"]));
    const large = buildTableMockup(plan(["10 × Wing Platter", "10 × Chicken Tender Platter"]));
    expect(large.tableCount).toBeGreaterThan(1); expect(large.crowded).toBe(true);
    expect(large.targets.filter((target) => target.item.kind === "chafer")).toHaveLength(10);
    expect(large.art.filter((item) => item.sprite === 15)).toHaveLength(40);
    expect(large.art.find((item) => item.sprite === 4)?.width).toBe(small.art.find((item) => item.sprite === 5)?.width);
    expect(large.targets.filter((target) => target.item.id === "service-cart")).toHaveLength(1);
    expect(large.targets.filter((target) => ["service-cart", "plates", "napkins", "forks"].includes(target.item.id)).every((target) => target.tableIndex === 0)).toBe(true);
  });

  it("does not double event-wide quantities when a mirrored arrangement is shown", () => {
    const single = buildTableMockup(plan(["15 × The Full Course + Taco Bar"], 100));
    const mirroredPlan = plan(["15 × The Full Course + Taco Bar"], 101), mirrored = buildTableMockup(mirroredPlan);
    expect(mirrored.art).toEqual(single.art);
    expect(mirroredPlan.plates).toBe(202); expect(mirroredPlan.tacoStands).toBe(30);
    expect(mirrored.targets.find((target) => target.item.id === "plates")?.item.quantity).toBe(202);
  });

  it("retains unresolved equipment descriptions without inventing a sauce container count", () => {
    const result = buildTableMockup(plan(["15 × The Full Course + Wing Bar"]));
    expect(result.targets.find((target) => target.item.id === "wing-ranch")?.item.quantity).toBeNull();
    expect(result.art.some((item) => item.key.startsWith("wing-ranch-bowl-"))).toBe(false);
  });

  it("keeps unknown foods unassigned and returns no composition for no food", () => {
    const unknown = buildTableMockup(plan(["1 × Unmapped Buffet"]));
    expect(unknown.targets.every((target) => ["service-cart", "plates", "napkins", "forks"].includes(target.item.id))).toBe(true);
    expect(buildTableMockup(plan([]))).toEqual({ art: [], targets: [], crowded: false, tableCount: 0 });
  });
});
