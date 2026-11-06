import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../visual-refresh.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const layout = readFileSync(new URL("../../layout.tsx", import.meta.url), "utf8");
const checklist = readFileSync(new URL("../../checklists/ChecklistsClient.tsx", import.meta.url), "utf8");

function mediaBlocks() {
  const blocks: Array<{ media: string; body: string }> = [];
  let remaining = css.trim();
  while (remaining) {
    const opening = remaining.indexOf("{");
    const media = remaining.slice(0, opening).trim();
    expect(media).toMatch(/^@media (?:screen|print)(?:\s|$)/);
    let depth = 1;
    let cursor = opening + 1;
    for (; cursor < remaining.length && depth; cursor++) {
      if (remaining[cursor] === "{") depth++;
      if (remaining[cursor] === "}") depth--;
    }
    expect(depth).toBe(0);
    blocks.push({ media, body: remaining.slice(opening + 1, cursor - 1) });
    remaining = remaining.slice(cursor).trim();
  }
  return blocks;
}

describe("dashboard visual refresh boundaries", () => {
  it("loads presentation after the existing styles without adding new font dependencies", () => {
    expect(layout.indexOf('import "./visual-refresh.css"')).toBeGreaterThan(layout.indexOf('import "./workspace.css"'));
    expect(layout.indexOf('import "./kitchen-refresh.css"')).toBeGreaterThan(layout.indexOf('import "./visual-refresh.css"'));
    expect(css).toContain("ui-sans-serif, system-ui");
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });
  it("keeps screen decoration out of print", () => {
    const blocks = mediaBlocks();
    const print = blocks.filter((block) => block.media === "@media print");
    expect(print).toHaveLength(1);
    expect(print[0].body).toContain(".checklist-progress { display: none; }");
    expect(print[0].body).not.toMatch(/\b(?:background|color|position|height|width)\s*:/);
  });
  it("does not hide operational content, change map geometry, or collapse tablet navigation", () => {
    for (const block of mediaBlocks().filter((item) => item.media.startsWith("@media screen"))) expect(block.body).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(css).not.toMatch(/floor-plan-area|kitchen-sheet-scale|kitchen-dashboard-zoom|\.kitchen-checklist-table/);
    expect(css).toContain(".staff-workspace-navigation a { min-height: 48px");
    expect(css).toContain(".task-row { min-height: 64px");
    expect(css).toContain("@media screen and (max-width: 640px)");
  });
  it("presents checklist progress without repeating setup quantities", () => {
    expect(checklist).not.toContain("Contract-driven Event Setup");
    expect(css).not.toContain(".setup-equipment-grid");
    expect(checklist).toContain('<progress aria-label="Checklist completion"');
    expect(checklist).toContain('max={Math.max(1, progress.total)} value={progress.completed}');
  });
  it("omits duplicate submission instructions without bypassing closeout validation", () => {
    expect(checklist).not.toContain('aria-label="Checklist submission requirements"');
    expect(checklist).not.toContain("Draft saves automatically");
    expect(checklist).toContain("readiness.warningMessages.map((message)");
    expect(checklist).toContain("checklistSections.map((section)");
    expect(checklist).toContain("readiness.canSubmit || warningsConfirmed && readiness.canSubmitAfterWarningConfirmation");
    expect(checklist).toContain("warningConfirmation.employeeName === warningActor");
    expect(checklist).toContain("confirmation?.sourceFingerprint === currentReadiness.warningFingerprint");
    expect(checklist).toContain("confirmedWarnings ? { warningConfirmation:");
    expect(checklist).toContain("disabled={!canSubmit || isSubmitted}");
  });
});
