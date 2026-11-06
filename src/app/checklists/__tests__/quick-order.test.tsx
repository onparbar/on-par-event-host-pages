import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import AddOnQuickOrder, { addQuickOrderQuantity, isValidQuickOrder, quickOrderKeypadValue, quickOrderQuantityError, type QuickOrderInput } from "../AddOnQuickOrder";

const base: QuickOrderInput = { category: "food", key: "wings", quantity: "1", panSize: "", notes: "", selectedRateKey: "sun-thu", manualPrice: "" };

describe("quick add-on ordering", () => {
  it("shows only the three dropdown categories with every existing catalog option", () => {
    const html = renderToStaticMarkup(createElement(AddOnQuickOrder, { eventName: "Redacted party", eventDate: "2026-11-03", disabled: false, isItemLocked: () => false, onSubmit: async () => "accepted" as const }));
    expect(html.match(/<select /g)).toHaveLength(3);
    expect(html).toContain('aria-label="Food Add-Ons"');
    expect(html).toContain('aria-label="Bar Refills"');
    expect(html).toContain('aria-label="Entertainment Add-Ons"');
    expect(html).toContain('label="Appetizer Bar"');
    expect(html).toContain('label="Wing Bar"');
    expect(html).toContain('label="Taco Bar"');
    expect(html).toContain("Dessert Platter · $120.00");
    expect(html).toContain("Mini Golf");
    expect(html).toContain("BBQ Sauce");
    expect(html).not.toContain("Contract food");
    expect(html).not.toContain("Submit Event Record");
    expect(html).not.toContain("Staff POC");
  });
  it.each(["", "0", "-1", "1e1", "Infinity", "1.2", "9007199254740992"])("rejects unsafe food quantity %s", (quantity) => {
    expect(quickOrderQuantityError({ ...base, quantity })).not.toBe("");
  });
  it("uses existing platter and refill limits without silently clamping", () => {
    expect(quickOrderQuantityError({ ...base, quantity: "10" })).toBe("");
    expect(quickOrderQuantityError({ ...base, quantity: "11" })).toContain("10");
    expect(quickOrderQuantityError({ ...base, category: "refills", key: "appetizer-refill-tater-kegs", quantity: "10" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "refills", key: "wing-refill-bbq", quantity: "9999" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "refills", key: "wing-refill-bbq", quantity: "10000" })).not.toBe("");
  });
  it("preserves partial entertainment hours but requires whole Mini Golf guest counts", () => {
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "bowling", quantity: "1.5" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "pool-tables", quantity: "0.5" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "mini-golf", quantity: "20" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "mini-golf", quantity: "1.5" })).not.toBe("");
  });
  it("requires manual card pricing and a configured entertainment rate", () => {
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "prepaid-drink-cards" })).toContain("price");
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "prepaid-drink-cards", manualPrice: "20.00" })).toBe("");
    expect(quickOrderQuantityError({ ...base, category: "entertainment", key: "bowling", selectedRateKey: "unknown" })).toContain("rate");
  });
  it("provides telephone keypad entry, deletion and clear without changing duration precision", () => {
    expect(quickOrderKeypadValue("", "1", false)).toBe("1");
    expect(quickOrderKeypadValue("1", "0", false)).toBe("10");
    expect(quickOrderKeypadValue("10", "delete", false)).toBe("1");
    expect(quickOrderKeypadValue("10", "clear", false)).toBe("");
    expect(quickOrderKeypadValue("0", "5", false)).toBe("5");
    expect(quickOrderKeypadValue("", ".", true)).toBe("0.");
    expect(quickOrderKeypadValue("1.2", ".", true)).toBe("1.2");
    expect(quickOrderKeypadValue("1", ".", false)).toBe("1");
    expect(quickOrderKeypadValue("1.2", "5", true)).toBe("1.25");
  });
  it("rejects unsupported pan sizes and pan choices for non-panned items", () => {
    expect(isValidQuickOrder({ ...base, panSize: "1/4" as QuickOrderInput["panSize"] })).toBe(false);
    expect(isValidQuickOrder({ ...base, key: "veggie-tray", panSize: "1/2" })).toBe(false);
    expect(isValidQuickOrder({ ...base, key: "fry-platters", panSize: "1/3" })).toBe(false);
    expect(isValidQuickOrder({ ...base, key: "fry-platters", panSize: "1/2" })).toBe(true);
    expect(isValidQuickOrder({ ...base, category: "refills", key: "wing-refill-wings", panSize: "1/2" })).toBe(false);
    expect(isValidQuickOrder({ ...base, category: "entertainment", key: "mini-golf", panSize: "1/3" })).toBe(false);
  });
  it("rejects malformed runtime inputs and out-of-category items", () => {
    expect(isValidQuickOrder(null as unknown as QuickOrderInput)).toBe(false);
    expect(isValidQuickOrder({ ...base, quantity: 1 as unknown as string })).toBe(false);
    expect(isValidQuickOrder({ ...base, notes: "x".repeat(501) })).toBe(false);
    expect(isValidQuickOrder({ ...base, category: "food", key: "wing-refill-wings" })).toBe(false);
    expect(isValidQuickOrder({ ...base, category: "refills", key: "wings" })).toBe(false);
    expect(isValidQuickOrder(base)).toBe(true);
  });
  it("disables a locked entertainment option while leaving other options available", () => {
    const html = renderToStaticMarkup(createElement(AddOnQuickOrder, { eventName: "Redacted party", eventDate: "2026-11-03", disabled: false, isItemLocked: (key) => key === "bowling", onSubmit: async () => "accepted" as const }));
    expect(html).toContain('<option value="bowling" disabled="">Bowling</option>');
    expect(html).toContain('<option value="mini-golf">Mini Golf</option>');
  });
  it.each([
    ["0.1", "0.2", "0.3"],
    ["1.25", "0.5", "1.75"],
    ["", "20", "20"],
    ["20", "2", "22"],
    ["2.50", "0.50", "3"],
    ["0.123456789012345", "0.000000000000001", "0.123456789012346"],
    ["9007199254740990", "1", "9007199254740991"],
  ])("adds exact decimal quantities %s + %s without purchased-duration rounding", (current, added, expected) => {
    expect(addQuickOrderQuantity(current, added)).toBe(expected);
  });
  it.each([
    ["9007199254740991", "1"],
    ["9007199254740991", "0.1"],
    ["-1", "1"],
    ["1", "-0.5"],
    ["1e1", "1"],
    ["Infinity", "1"],
    ["1", ""],
    ["one", "1"],
  ])("rejects malformed or overflowing decimal totals %s + %s", (current, added) => {
    expect(addQuickOrderQuantity(current, added)).toBeNull();
  });
});
