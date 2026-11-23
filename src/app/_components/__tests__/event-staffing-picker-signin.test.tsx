import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStaffingPicker } from "../EventStaffingPicker";

const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], effects: [] as Array<() => unknown> }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
}));

const onSaved = vi.fn();
const props = { id: "staffing-picker-501", eventId: "501", date: "2026-11-23", onClose: vi.fn(), onSaved };
const roster = {
  version: 7, selectedShiftIds: ["shift-1", "shift-2"],
  shifts: ["Jordan", "Casey"].map((employeeName, index) => ({
    shiftId: `shift-${index + 1}`, employeeId: `employee-${index + 1}`, employeeName,
    startAt: "2026-11-23T20:00:00Z", endAt: "2026-11-24T01:00:00Z", coversEvent: true, needsMove: false, conflict: false,
  })),
};

function render() {
  hooks.index = 0;
  return renderToStaticMarkup(createElement(EventStaffingPicker, props));
}
async function load() {
  render();
  hooks.effects.shift()!();
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function saveButton(node: unknown): ReactElement<{ onClick: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) { const found = saveButton(child); if (found) return found; }
    return null;
  }
  const element = node as ReactElement<{ className?: string; children?: unknown; onClick: () => void }>;
  if (element.type === "button" && element.props.className === "button") return element;
  return saveButton(element.props?.children);
}

beforeEach(() => { hooks.index = 0; hooks.states = []; hooks.effects = []; onSaved.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("staffing picker Admin sign-in guidance", () => {
  it("offers Admin sign-in after an unauthenticated load without showing names or a save control", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...roster, error: "Admin sign-in required." }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await load();
    const html = render();
    expect(html).toContain('href="/admin">Sign in to Admin</a>');
    expect(html).toContain("Admin sign-in required.");
    expect(html).not.toContain("Jordan");
    expect(html).not.toContain("Casey");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Save staffing team");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/admin/staffing?eventId=501&date=2026-11-23", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("preserves a schedule-review error without incorrectly asking for Admin sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Refresh the published schedule before editing an event assignment." }, { status: 422 })));
    await load();
    const html = render();
    expect(html).toContain("Refresh the published schedule before editing an event assignment.");
    expect(html).not.toContain("Sign in to Admin");
    expect(html).not.toContain("Save staffing team");
    expect(html).toContain('href="/admin/staffing?eventId=501&amp;date=2026-11-23">Review published schedule</a>');
  });

  it("offers the exact event's schedule review when no verified roster is available", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "This event isn't in the verified staffing schedule for this date." }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await load();
    const html = render();
    expect(html).toContain('href="/admin/staffing?eventId=501&amp;date=2026-11-23">Review published schedule</a>');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Save staffing team");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the multi-select save payload but hides its roster and offers sign-in when the session expires", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(roster))
      .mockResolvedValueOnce(Response.json({ error: "Admin sign-in required." }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await load();
    const loaded = render();
    expect(loaded.match(/type="checkbox"/g)).toHaveLength(2);
    expect(loaded).toContain("Jordan");
    expect(loaded).toContain("Casey");
    expect(loaded).toContain("Select one or more employees, then save the staffing team.");
    expect(loaded).not.toContain("Sign in to Admin");
    hooks.index = 0;
    saveButton(EventStaffingPicker(props))!.props.onClick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "replace-team", eventId: "501", eventDate: "2026-11-23", expectedVersion: 7,
      choices: [{ shiftId: "shift-1" }, { shiftId: "shift-2" }],
    });
    const html = render();
    expect(html).toContain('href="/admin">Sign in to Admin</a>');
    expect(html).not.toContain("Jordan");
    expect(html).not.toContain("Casey");
    expect(html).not.toContain("Save staffing team");
    expect(html).not.toContain("Close and reopen the picker before trying again.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
