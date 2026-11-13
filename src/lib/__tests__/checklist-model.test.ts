import { describe, expect, it } from "vitest";
import {
  foodAddOns,
  completeChecklistTask,
  defaultChecklistState,
  hydrateChecklistState,
  normalizeStaffPoc,
  checklistEventForSelection,
  foodUnitPrice,
  appetizerBarRefillAddOns,
  entertainmentAddOns,
  entertainmentUnitPrice,
  numeric,
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
  it("starts the editable staff POC blank and strips only the known preview placeholder", () => {
    expect(defaultChecklistState("2026-10-23").poc).toBe("");
    expect(hydrateChecklistState("2026-10-23", { poc: "CONTACT OMITTED FROM PREVIEW" }).poc).toBe("");
    expect(normalizeStaffPoc("Carlos")).toBe("Carlos");
    expect(normalizeStaffPoc("Contact omitted from preview - ask Carlos")).toBe("Contact omitted from preview - ask Carlos");
  });

  it("records the session name or BWA without a separate employee input", () => {
    const state = defaultChecklistState("2026-10-23");
    expect(completeChecklistTask(state, "food-kitchen-window", true, "", "2026-10-23T17:00:00Z")).toBe(state);
    state.bwa = " Brooke ";
    const completed = completeChecklistTask(state, "food-kitchen-window", true, " Carlos ", "2026-10-23T17:00:00Z");
    expect(completed.taskEvidence?.["food-kitchen-window"]).toEqual({ employeeName: "Carlos", completedAt: "2026-10-23T17:00:00Z" });
    expect(completeChecklistTask(completed, "food-kitchen-window", true, "Other staff", "2026-10-23T18:00:00Z")).toBe(completed);
    expect(completeChecklistTask(state, "food-kitchen-window", true, " ", "2026-10-23T18:00:00Z").taskEvidence?.["food-kitchen-window"].employeeName).toBe("Brooke");
  });
  it("uses the remembered event before publishing the first tab default", () => {
    const first = { id: 1, name: "Event A" };
    const remembered = { id: 2, name: "Event B" };
    expect(checklistEventForSelection([first, remembered], "2", 1)).toBe(remembered);
    expect(checklistEventForSelection([first, remembered], null, 1)).toBe(first);
    expect(checklistEventForSelection([first, remembered], "unavailable", 1)).toBeUndefined();
  });
  it("selects canonical VIP sources exactly and refuses ambiguous legacy numeric choices", () => {
    const first = { id: 527983760, source_event_id: "vip-test-h4l720-hfbtsa" };
    const second = { id: 527983760, source_event_id: "vip-test-1k212gj-1rfricb" };
    expect(checklistEventForSelection([first, second], second.source_event_id, first.id)).toBe(second);
    expect(checklistEventForSelection([first, second], "vip-unknown", first.id)).toBeUndefined();
    expect(checklistEventForSelection([first, second], "527983760", first.id)).toBeUndefined();
    expect(checklistEventForSelection([first, second], null, first.id)).toBeUndefined();
  });
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
    expect(entertainmentUnitPrice(pool, {
      quantity: "5",
      selectedRateKey: "fri-sat",
      manualPrice: "",
    }) * numeric("5")).toBe(90);
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
    expect(appetizerBarRefillAddOns).toHaveLength(6);
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

  it("offers BBQ sauce once in Food and in both bar refill lists", () => {
    for (const options of [standardFoodAddOns, appetizerBarRefillAddOns, wingBarRefillAddOns]) {
      expect(options.filter((item) => item.label === "BBQ Sauce")).toHaveLength(1);
    }
  });
});
