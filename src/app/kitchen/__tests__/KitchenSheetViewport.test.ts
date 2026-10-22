import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KitchenSheetViewport, kitchenSheetScale } from "../KitchenSheetViewport";

describe("kitchen whole-sheet fit", () => {
  it("fits the whole height without enlarging an already fitting sheet", () => {
    expect(kitchenSheetScale(1800, 900, 1800, 1200)).toBe(0.75);
    expect(kitchenSheetScale(1280, 700, 1600, 600)).toBe(0.8);
    expect(kitchenSheetScale(1800, 900, 1600, 700)).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("ignores unmeasured or invalid geometry: %s", (value) => {
    expect(kitchenSheetScale(value, 900, 1600, 1000)).toBe(1);
    expect(kitchenSheetScale(1800, value, 1600, 1000)).toBe(1);
    expect(kitchenSheetScale(1800, 900, value, 1000)).toBe(1);
    expect(kitchenSheetScale(1800, 900, 1600, value)).toBe(1);
  });

  it("keeps all sheet content in the fit viewport", () => {
    const html = renderToStaticMarkup(createElement(KitchenSheetViewport, { fit: true, children: createElement("div", null, "All food rows, staff, quantities and notes") }));
    expect(html).toContain('data-fit="true"');
    expect(html).toContain("All food rows, staff, quantities and notes");
    expect(html).not.toContain("display:none");
  });
});
