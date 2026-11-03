import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AddOnQuickOrder, { type QuickOrderInput, type QuickOrderResult } from "../AddOnQuickOrder";

const hooks = vi.hoisted(() => ({ index: 0, order: null as QuickOrderInput | null, result: null as QuickOrderResult | "sending" | null, effects: [] as Array<() => void>, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    const setter = vi.fn();
    hooks.setters[index] = setter;
    return [index === 0 ? hooks.order : index === 1 ? hooks.result : initial, setter];
  },
}));

function render(errorMessage = "", props: Partial<ComponentProps<typeof AddOnQuickOrder>> = {}) {
  hooks.index = 0;
  const onSubmit = vi.fn(async () => "accepted" as const);
  const html = renderToStaticMarkup(createElement(AddOnQuickOrder, { eventName: "Redacted party", eventDate: "2026-11-03", disabled: false, isItemLocked: () => false, onSubmit, errorMessage, ...props }));
  expect(onSubmit).not.toHaveBeenCalled();
  return html;
}
beforeEach(() => {
  hooks.order = { category: "food", key: "wings", quantity: "1", panSize: "", notes: "", selectedRateKey: "sun-thu", manualPrice: "" };
  hooks.result = null;
  hooks.effects = [];
  hooks.setters = [];
});

function findSelect(node: unknown, label: string): ReactElement<{ onChange: (event: { target: { value: string } }) => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findSelect(child, label); if (found) return found; } return null; }
  const element = node as ReactElement<{ "aria-label"?: string; children?: unknown; onChange: (event: { target: { value: string } }) => void }>;
  if (element.type === "select" && element.props["aria-label"] === label) return element;
  return findSelect(element.props?.children, label);
}

describe("quick-order modal feedback", () => {
  it.each(["error", "uncertain"] as const)("keeps the actual %s reason visible inside the modal", (result) => {
    hooks.result = result;
    const html = render("A newer saved version exists. Reload before ordering.");
    expect(html).toContain('role="alert">A newer saved version exists. Reload before ordering.</p>');
    expect(html).toContain('aria-labelledby="quick-order-title"');
    if (result === "uncertain") {
      expect(html).toContain("Do not submit again until the saved order has been checked.");
      expect(html).not.toContain("Submit to Kitchen");
    }
  });
  it.each(["accepted", "pending", "uncertain"] as const)("offers Done, not another Submit, after %s", (result) => {
    hooks.result = result;
    const html = render();
    expect(html).toContain(">Done</button>");
    expect(html).not.toContain('type="submit"');
    if (result === "pending") expect(html).toContain("Do not submit this order again.");
  });
  it("distinguishes an entertainment record save from kitchen or reservation confirmation", () => {
    hooks.order = { ...hooks.order!, category: "entertainment", key: "mini-golf", quantity: "20" };
    hooks.result = "accepted";
    const html = render();
    expect(html).toContain("Add-on saved");
    expect(html).toContain("No kitchen order or entertainment reservation was sent.");
    expect(html).not.toContain("GoTab accepted");
  });
  it("does not offer a third-pan choice for fries", () => {
    hooks.order = { ...hooks.order!, key: "fry-platters" };
    const html = render();
    expect(html).toContain('<option value="1/2">1/2 pan</option>');
    expect(html).not.toContain('<option value="1/3">1/3 pan</option>');
  });
  it("keeps partial-hour entry and its exact quantity visible", () => {
    hooks.order = { ...hooks.order!, category: "entertainment", key: "bowling", quantity: "1.25" };
    const html = render();
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="1.25"');
    expect(html).toContain('aria-label="Decimal point"');
  });
  it("opens additional entertainment quantities at the saved rate without changing prior totals", () => {
    hooks.index = 0; hooks.order = null;
    const tree = AddOnQuickOrder({ eventName: "Redacted party", eventDate: "2026-11-03", disabled: false, isItemLocked: () => false, onSubmit: async () => "accepted", existingEntertainment: {
      bowling: { quantity: "2", selectedRateKey: "fri-sat", manualPrice: "" },
      "prepaid-drink-cards": { quantity: "10", selectedRateKey: "", manualPrice: "20.00" },
    } });
    const select = findSelect(tree, "Entertainment Add-Ons")!;
    select.props.onChange({ target: { value: "bowling" } });
    expect(hooks.setters[0]).toHaveBeenLastCalledWith(expect.objectContaining({ key: "bowling", quantity: "", selectedRateKey: "fri-sat" }));
    select.props.onChange({ target: { value: "prepaid-drink-cards" } });
    expect(hooks.setters[0]).toHaveBeenLastCalledWith(expect.objectContaining({ key: "prepaid-drink-cards", quantity: "", manualPrice: "20.00" }));
  });
  it("keeps the existing entertainment rate and card price read-only", () => {
    hooks.order = { ...hooks.order!, category: "entertainment", key: "bowling", selectedRateKey: "fri-sat" };
    let html = render("", { existingEntertainment: { bowling: { quantity: "2", selectedRateKey: "fri-sat", manualPrice: "" } } });
    expect(html).toContain('Rate</span><select disabled=""');
    expect(html).toContain("Uses the existing event rate.");
    hooks.order = { ...hooks.order!, key: "prepaid-drink-cards", manualPrice: "20.00" };
    html = render("", { existingEntertainment: { "prepaid-drink-cards": { quantity: "10", selectedRateKey: "", manualPrice: "20.00" } } });
    expect(html).toContain('step="0.01" disabled=""');
    expect(html).toContain("Uses the existing price per card.");
  });
  it.each(["accepted", "error", "uncertain"] as const)("updates an open pending dialog only from the polled %s result", (settled) => {
    hooks.result = "pending";
    const getItemResult = vi.fn(() => settled);
    render("", { getItemResult });
    hooks.effects.forEach((effect) => effect());
    expect(getItemResult).toHaveBeenCalledExactlyOnceWith("wings");
    expect(hooks.setters[1]).toHaveBeenCalledExactlyOnceWith(settled);
  });
  it.each([null, "pending"] as const)("does not infer acceptance from an unlocked item or unsettled poll: %s", (pending) => {
    hooks.result = "pending";
    render("", { getItemResult: () => pending, isItemLocked: () => false });
    hooks.effects.forEach((effect) => effect());
    expect(hooks.setters[1]).not.toHaveBeenCalled();
  });
});
