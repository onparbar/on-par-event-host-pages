import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStaffingPicker } from "../EventStaffingPicker";

const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], refIndex: 0,
  refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => unknown> }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useRef: (current: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current }; },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
}));

const onSaved = vi.fn();
const props = { id: "staffing-picker-501", eventId: "501", date: "2026-11-30", onClose: vi.fn(), onSaved };
const query = "/api/staffing?eventId=501&date=2026-11-30";
const roster = { version: 7, reviewToken: "opaque-review-token", selectedShiftIds: ["shift-1", "shift-2"],
  shifts: ["Jordan", "Casey"].map((employeeName, index) => ({
    shiftId: `shift-${index + 1}`, employeeId: `employee-${index + 1}`, employeeName,
    startAt: "2026-11-30T20:00:00Z", endAt: "2026-12-01T01:00:00Z", coversEvent: true, needsMove: false, conflict: false,
  })),
};
type Props = { children?: unknown; type?: string; disabled?: boolean; checked?: boolean;
  onClick?: () => void; onChange?: () => void };
function resetRender() { hooks.index = 0; hooks.refIndex = 0; }
function render() { resetRender(); return renderToStaticMarkup(createElement(EventStaffingPicker, props)); }
function elements(node: unknown): Array<ReactElement<Props>> {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props?.children)];
}
function tree() { resetRender(); return elements(EventStaffingPicker(props)); }
function button(label: string) { return tree().find((element) => element.type === "button" && element.props.children === label)!; }
function checkboxes() { return tree().filter((element) => element.type === "input" && element.props.type === "checkbox"); }
async function flush() { await new Promise<void>((resolve) => setImmediate(resolve)); }
async function load() { render(); const cleanup = hooks.effects.shift()!(); await flush(); return cleanup as () => void; }
async function click(label: string) { button(label).props.onClick!(); await flush(); }
function body(request: ReturnType<typeof vi.fn>, index: number) { return JSON.parse(request.mock.calls[index][1].body); }

beforeEach(() => {
  hooks.index = 0; hooks.states = []; hooks.refIndex = 0; hooks.refs = []; hooks.effects = [];
  onSaved.mockReset(); vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

describe("password-free inline staffing picker", () => {
  it("loads employees by GET only, without an Admin session or any automatic write", async () => {
    const request = vi.fn().mockResolvedValue(Response.json(roster));
    vi.stubGlobal("fetch", request); await load();
    const html = render();
    expect(request).toHaveBeenCalledExactlyOnceWith(query, { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(checkboxes()).toHaveLength(2);
    expect(html).toContain("Jordan"); expect(html).toContain("Casey");
    for (const text of ["passphrase", 'type="password"', 'href="/admin', "Unlock staff", "Load employees for this day"]) expect(html).not.toContain(text);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves multiple choices to the staffing-only API with the exact event, version and review token", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(roster)).mockResolvedValueOnce(Response.json({ version: 8 }));
    vi.stubGlobal("fetch", request); await load(); await click("Save staffing team (2)");
    expect(request.mock.calls[1][0]).toBe("/api/staffing");
    expect(body(request, 1)).toEqual({ action: "replace-team", eventId: "501", eventDate: props.date, expectedVersion: 7,
      reviewToken: roster.reviewToken, choices: [{ shiftId: "shift-1" }, { shiftId: "shift-2" }] });
    expect(render()).toContain("Staffing team saved."); expect(onSaved).toHaveBeenCalledOnce();
    expect(render()).not.toContain("passphrase");
  });

  it("lets a user select multiple previously unassigned staff before Save", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ ...roster, selectedShiftIds: [] }));
    vi.stubGlobal("fetch", request); await load();
    expect(button("Save staffing team (0)").props.disabled).toBe(true);
    checkboxes()[0].props.onChange!(); checkboxes()[1].props.onChange!();
    expect(checkboxes().every((checkbox) => checkbox.props.checked)).toBe(true);
    expect(button("Save staffing team (2)").props.disabled).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation for removal, moves and partial coverage", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ ...roster, shifts: [roster.shifts[0], { ...roster.shifts[1], needsMove: true, coversEvent: false }] }))
      .mockResolvedValueOnce(Response.json({ version: 8 }));
    vi.stubGlobal("fetch", request); await load(); checkboxes()[0].props.onChange!();
    await click("Save staffing team (1)");
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("Unchecked shifts will be removed"));
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("move to this event"));
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("don’t cover the full event"));
    expect(body(request, 1).choices).toEqual([{ shiftId: "shift-2", confirmMove: true, confirmPartialCoverage: true }]);
  });

  it("does not save when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const request = vi.fn().mockResolvedValue(Response.json(roster)); vi.stubGlobal("fetch", request);
    await load(); checkboxes()[0].props.onChange!(); await click("Save staffing team (1)");
    expect(request).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
  });

  it("disables conflicting shifts and duplicate shifts for an already selected employee", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ ...roster, selectedShiftIds: ["shift-1"],
      shifts: [roster.shifts[0], { ...roster.shifts[1], conflict: true }, { ...roster.shifts[0], shiftId: "duplicate" }] }));
    vi.stubGlobal("fetch", request); await load();
    expect(checkboxes()[1].props.disabled).toBe(true); expect(checkboxes()[2].props.disabled).toBe(true);
  });

  it.each([401, 403, 404, 422, 503])("offers only a read-only retry after a roster failure, never a password (%s)", async (status) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ error: "Published employees unavailable." }, { status }))
      .mockResolvedValueOnce(Response.json(roster));
    vi.stubGlobal("fetch", request); await load();
    expect(render()).toContain("Reload employees"); expect(render()).not.toContain('type="password"');
    expect(checkboxes()).toHaveLength(0); expect(request).toHaveBeenCalledTimes(1);
    await click("Reload employees"); expect(request.mock.calls[1][0]).toBe(query); expect(checkboxes()).toHaveLength(2);
  });

  it.each([403, 409, 422, 503])("does not retry a denied or stale save automatically (%s)", async (status) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(roster))
      .mockResolvedValueOnce(Response.json({ error: "Reload before saving." }, { status }))
      .mockResolvedValueOnce(Response.json({ ...roster, version: 8 }));
    vi.stubGlobal("fetch", request); await load(); await click("Save staffing team (2)");
    expect(button("Save staffing team (2)").props.disabled).toBe(true);
    expect(render()).toContain("Reload employees"); expect(render()).not.toContain("passphrase");
    expect(request).toHaveBeenCalledTimes(2); expect(onSaved).not.toHaveBeenCalled();
    await click("Reload employees"); expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0]).toBe(query);
  });

  it("shows an empty verified day without fabricating employee names", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...roster, shifts: [], selectedShiftIds: [] })));
    await load(); expect(render()).toContain("No published employee shifts for this day.");
    expect(checkboxes()).toHaveLength(0); expect(button("Save staffing team (0)").props.disabled).toBe(true);
  });

  it("aborts a pending roster request and ignores a late response", async () => {
    let respond!: (response: Response) => void;
    const request = vi.fn((_input: string, _options: { signal: AbortSignal }) => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", request); const cleanup = await load();
    const signal = request.mock.calls[0][1].signal; cleanup(); expect(signal.aborted).toBe(true);
    respond(Response.json(roster)); await flush(); expect(checkboxes()).toHaveLength(0); expect(onSaved).not.toHaveBeenCalled();
  });
});
