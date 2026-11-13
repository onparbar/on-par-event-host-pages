import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../kitchen-refresh.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("kitchen screen refresh boundaries", () => {
  it("keeps every top-level block screen-only so existing print output stays unchanged", () => {
    let remaining = css.trim();
    while (remaining) {
      const opening = remaining.indexOf("{");
      expect(remaining.slice(0, opening).trim()).toMatch(/^@media screen(?:\s|$)/);
      let depth = 1;
      let cursor = opening + 1;
      for (; cursor < remaining.length && depth; cursor += 1) {
        if (remaining[cursor] === "{") depth += 1;
        if (remaining[cursor] === "}") depth -= 1;
      }
      expect(depth).toBe(0);
      remaining = remaining.slice(cursor).trim();
    }
  });

  it("scopes all presentation rules to the kitchen dashboard", () => {
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1].trim();
      if (!selector.startsWith("@media")) expect(selector).toMatch(/^\.kitchen-dashboard-shell(?:\s|$)/);
    }
  });

  it("preserves fit geometry, staff dropdown positions, food-column order and operational category fills", () => {
    expect(css).not.toMatch(/--kitchen-(?:dashboard-zoom|sheet-scale)|grid-template|\b(?:position|inset|order)\s*:|\.kitchen-sheet-canvas/);
    expect(css).not.toMatch(/\.kitchen-sheet-viewport\[[^\]]+\]\s*\{/);
    expect(css).not.toMatch(/\.kitchen-category-(?:dessert|platter|taco|wing|appetizer|sauce)\b|\.kitchen-item-complete\b/);
    expect(css).not.toMatch(/\bdisplay\s*:\s*none/);
  });

  it("limits larger sheet controls, padding and type to natural-size sheets", () => {
    const sheetRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
      /\.kitchen-(?:checklist-table|category-heading|checklist-header-fact|checklist-fact strong|prepped-audit)/.test(match[1])
      && /\b(?:min-height|min-width|padding(?:-block)?|font-size|line-height)\s*:/.test(match[2]),
    );
    expect(sheetRules.length).toBeGreaterThan(6);
    for (const rule of sheetRules) {
      expect(rule[1]).toContain('.kitchen-sheet-viewport[data-fit="false"]');
      expect(rule[1]).toContain(".kitchen-checklist-inline");
    }
    expect(css).toMatch(/:not\(\.kitchen-sheet-viewport\[data-fit="true"\] \*\)\s*\{\s*min-height:\s*44px/);
  });

  it("provides natural-size touch controls, visible keyboard focus and a persistent food-details affordance", () => {
    expect(css).toMatch(/\[data-fit="false"\]\) \.kitchen-checklist-table :is\(\.kitchen-ready-control[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.kitchen-staff-select fieldset label\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid #297025/);
    expect(css).toMatch(/\.kitchen-food-button\s*\{[^}]*text-decoration-line:\s*underline/);
  });
});
