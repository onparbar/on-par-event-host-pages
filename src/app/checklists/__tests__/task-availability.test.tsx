import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EventChecklistState } from "@/lib/checklist-model";
import type { ChecklistEvent } from "@/lib/checklist-events";
import ChecklistsClient from "../ChecklistsClient";

const hooks = vi.hoisted(() => ({ index: 0, staffName: "Staff", bwa: "BWA", status: "draft", checked: false, states: [] as unknown[] }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useMemo: (read: () => unknown) => read(), useEffect: () => undefined,
  useEffectEvent: (action: unknown) => action, useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    let value = typeof initial === "function" ? initial() : initial;
    if (index === 4) {
      const state = value[77] as EventChecklistState;
      state.bwa = hooks.bwa;
      state.tasks["prepaid-drink-cards-labeled"] = hooks.checked;
      if (hooks.checked) state.taskEvidence!["prepaid-drink-cards-labeled"] = { employeeName: "Earlier Staff", completedAt: "2026-10-27T14:29:00Z" };
    }
    if (index === 5) value[77].status = hooks.status;
    if (index === 14) value = "ready";
    hooks.states[index] = value;
    return [value, vi.fn((next: unknown) => { value = typeof next === "function" ? next(value) : next; hooks.states[index] = value; })];
  },
}));
vi.mock("@/app/_components/EventContext", () => ({ EventSelectionBridge: () => null,
  useEventContext: () => ({ preferredEventId: null, ready: true, selectEvent: vi.fn(), clearEvent: vi.fn(), staffName: hooks.staffName }) }));
vi.mock("@/app/_components/PortalShell", () => ({ PortalPageHeader: () => null, PortalShell: () => null, PortalStatusBadge: () => null }));
vi.mock("@/app/_components/EventWorkspace", () => ({ EventWorkspaceRequests: () => null }));

const event: ChecklistEvent = { id: 77, name: "Redacted package event", date: "2026-10-27", dateLabel: "Tuesday", day: "Tuesday", time: "5:30 PM - 8:30 PM",
  rooms: ["VIP 1"], guest_count: 17, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified",
  source_updated_at: "2026-10-06T14:52:00Z", poc: "" };

function findTask(node: unknown, text: string): ReactElement<{ children: ReactElement[] }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) { const found = findTask(child, text); if (found) return found; }
    return null;
  }
  const element = node as ReactElement<{ children: ReactElement[] }>;
  if (element.type === "label" && renderToStaticMarkup(element).includes(text)) return element;
  return findTask(element.props?.children, text);
}

function render(plan: ChecklistEvent = event) {
  hooks.index = 0;
  return ChecklistsClient({ activeEventIds: [77], events: [plan] });
}
function cardTask(plan: ChecklistEvent = event) {
  const row = findTask(render(plan), "Ensure any prepaid drink cards have been created and labeled")!;
  return { html: renderToStaticMarkup(row), checkbox: row.props.children[0] as ReactElement<{ checked: boolean; disabled: boolean; onChange: (event: { target: { checked: boolean } }) => void }> };
}

beforeEach(() => { hooks.index = 0; hooks.staffName = "Staff"; hooks.bwa = "BWA"; hooks.status = "draft"; hooks.checked = false; hooks.states = []; });

describe("staff checklist task availability", () => {
  it.each([false, true])("never displays a Not applicable label, including contract warnings: %s", (needs_review) => {
    const tree = render({ ...event, needs_review })!;
    const html = renderToStaticMarkup(createElement("div", null, tree.props.children));
    expect(html).not.toMatch(/not applicable|\bN\/A\b/i);
    expect(cardTask().checkbox.props.disabled).toBe(false);
  });

  it("keeps optional tasks selectable without claiming they are absent or critical", () => {
    const { html, checkbox } = cardTask();
    expect(checkbox.props).toMatchObject({ checked: false, disabled: false });
    expect(html).toContain("Available if needed — check against the contract.");
    expect(html).not.toContain("Critical");
    expect(html).not.toContain("No drink cards");
  });

  it("preserves saved optional checkmarks and their staff/time evidence", () => {
    hooks.checked = true;
    const { html, checkbox } = cardTask();
    expect(checkbox.props.checked).toBe(true);
    expect(html).toContain("Recorded by Earlier Staff");
    expect(html).toContain("Oct 27, 10:29 AM Eastern");
  });

  it.each(["Staff", ""])("records an optional checkbox completion using the staff name or BWA: %s", (staffName) => {
    hooks.staffName = staffName;
    const { checkbox } = cardTask();
    const before = structuredClone((hooks.states[4] as Record<number, EventChecklistState>)[77]);
    checkbox.props.onChange({ target: { checked: true } });
    const state = (hooks.states[4] as Record<number, EventChecklistState>)[77];
    expect(state.tasks["prepaid-drink-cards-labeled"]).toBe(true);
    expect(state.taskEvidence?.["prepaid-drink-cards-labeled"]?.employeeName).toBe(staffName || "BWA");
    expect(Number.isFinite(Date.parse(state.taskEvidence!["prepaid-drink-cards-labeled"].completedAt))).toBe(true);
    expect(state.food).toEqual(before.food);
    expect(state.entertainment).toEqual(before.entertainment);
  });

  it("recognizes the normalized redacted real-contract drink-card package as critical", () => {
    const { html, checkbox } = cardTask({ ...event, food: ["17 × The Full Course", "Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"], drink_options: ["Food + Beverage package"] });
    expect(checkbox.props.disabled).toBe(false);
    expect(html).toContain("Critical");
    expect(html).not.toContain("Available if needed");
  });

  it("shows two serving chafers and the unchanged full prep quantities in the redacted real case", () => {
    const tree = render({ ...event, food: ["17 × The Full Course", "Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"], drink_options: ["Food + Beverage package"] })!;
    const html = renderToStaticMarkup(createElement("div", null, tree.props.children));
    expect(html).toContain('Serving chafing dishes</dt><dd data-needs-review="false">2</dd>');
    expect(html).toContain("Wings and chicken tenders share one serving chafing dish");
    expect(html).toContain("remaining prepared pans for refills");
    expect(html).toContain("Chicken Tenders: 64 each · 2 1/2 pans");
    expect(html).toContain("Wings: 64 each · 2 1/2 pans");
  });

  it("still protects submitted checklists and requires a staff-entered name", () => {
    hooks.status = "submitted";
    expect(findTask(render(), "Ensure any prepaid drink cards have been created and labeled")).toBeNull();
    hooks.status = "draft"; hooks.staffName = ""; hooks.bwa = "";
    expect(cardTask().checkbox.props.disabled).toBe(true);
    hooks.bwa = "BWA";
    expect(cardTask().checkbox.props.disabled).toBe(false);
  });
});
