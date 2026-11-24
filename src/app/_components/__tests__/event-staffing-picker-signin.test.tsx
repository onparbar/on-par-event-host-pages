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

const onSaved = vi.fn(), reload = vi.fn();
const props = { id: "staffing-picker-501", eventId: "501", date: "2026-11-23", onClose: vi.fn(), onSaved };
const query = "/api/admin/staffing?eventId=501&date=2026-11-23";
const roster = { version: 7, selectedShiftIds: ["shift-1", "shift-2"],
  shifts: ["Jordan", "Casey"].map((employeeName, index) => ({
    shiftId: `shift-${index + 1}`, employeeId: `employee-${index + 1}`, employeeName,
    startAt: "2026-11-23T20:00:00Z", endAt: "2026-11-24T01:00:00Z", coversEvent: true, needsMove: false, conflict: false,
  })),
};
const review = { error: "Verify the published schedule before assigning staff.", canVerify: true, version: 7 };
type Props = { children?: unknown; type?: string; value?: string; onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => void };
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
async function flush() { await new Promise<void>((resolve) => setImmediate(resolve)); }
async function load() { render(); const cleanup = hooks.effects.shift()!(); await flush(); return cleanup as () => void; }
async function unlock() {
  tree().find((element) => element.type === "input" && element.props.type === "password")!.props.onChange!({ target: { value: "1234" } });
  tree().find((element) => element.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() });
  await flush();
}
async function click(label: string) { button(label).props.onClick!(); await flush(); }
function body(request: ReturnType<typeof vi.fn>, index: number) { return JSON.parse(request.mock.calls[index][1].body); }

beforeEach(() => {
  hooks.index = 0; hooks.states = []; hooks.refIndex = 0; hooks.refs = []; hooks.effects = [];
  onSaved.mockReset(); reload.mockReset(); vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => vi.unstubAllGlobals());

describe("inline staffing picker access and verification", () => {
  it("offers inline unlock after401 without exposing names or redirecting to Admin", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ ...roster, error: "Admin sign-in required." }, { status: 401 }));
    vi.stubGlobal("fetch", request); await load();
    const html = render();
    expect(html).toContain("Unlock staff assignment");
    expect(html).toContain('type="password"');
    expect(html).toContain("Admin sign-in required.");
    for (const text of ['href="/admin', "Jordan", "Casey", 'type="checkbox"', "Save staffing team"]) expect(html).not.toContain(text);
    expect(request).toHaveBeenCalledExactlyOnceWith(query, { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("unlocks through the existing session endpoint and loads names without navigation or reload", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ error: "Admin sign-in required." }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json(roster));
    vi.stubGlobal("fetch", request); await load(); await unlock();
    expect(request).toHaveBeenNthCalledWith(2, "/api/admin-session", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "1234" }), signal: expect.any(AbortSignal) });
    expect(request).toHaveBeenNthCalledWith(3, query, { cache: "no-store", signal: expect.any(AbortSignal) });
    const html = render();
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("Jordan"); expect(html).toContain("Casey");
    expect(html).not.toContain('type="password"'); expect(html).not.toContain('href="/admin');
    expect(reload).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([[401, "Incorrect admin passphrase."], [429, "Too many sign-in attempts. Wait 15 minutes and try again."]])(
    "keeps unlock error inline without another roster request (%s)", async (status, error) => {
      const request = vi.fn().mockResolvedValueOnce(Response.json({ error: "Admin sign-in required." }, { status: 401 }))
        .mockResolvedValueOnce(Response.json({ error }, { status: Number(status) }));
      vi.stubGlobal("fetch", request); await load(); await unlock();
      expect(request).toHaveBeenCalledTimes(2); expect(render()).toContain(error);
      expect(render()).toContain("Unlock staff assignment");
      expect(tree().find((element) => element.type === "input" && element.props.type === "password")!.props.value).toBe("");
      expect(reload).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
    });

  it.each([404, 422])("offers versioned inline loading without auto-syncing (%s)", async (status) => {
    const request = vi.fn().mockResolvedValue(Response.json(review, { status }));
    vi.stubGlobal("fetch", request); await load();
    const html = render(); expect(html).toContain("Load employees for this day"); expect(html).toContain("This also updates automatic matches");
    expect(html).not.toContain('href="/admin'); expect(html).not.toContain('type="checkbox"');
    expect(request).toHaveBeenCalledTimes(1); expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([{ error: "Schedule review required." }, { ...review, version: -1 }, { ...review, version: "7" }, { ...review, version: 1.5 }, { ...review, canVerify: false }])(
    "does not offer unsafe or unapproved verification (%o)", async (response) => {
      const request = vi.fn().mockResolvedValue(Response.json(response, { status: 422 }));
      vi.stubGlobal("fetch", request); await load();
      expect(render()).not.toContain("Load employees for this day"); expect(render()).not.toContain('href="/admin');
      expect(request).toHaveBeenCalledTimes(1);
    });

  it("explicitly verifies the exact week then loads its multi-select roster in place", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(review, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ state: { version: 8 }, fresh: true })).mockResolvedValueOnce(Response.json({ ...roster, version: 8 }));
    vi.stubGlobal("fetch", request); await load(); await click("Load employees for this day");
    expect(request).toHaveBeenNthCalledWith(2, "/api/admin/staffing", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync", date: props.date, expectedVersion: 7 }), signal: expect.any(AbortSignal) });
    expect(request.mock.calls[2][0]).toBe(query); expect(render().match(/type="checkbox"/g)).toHaveLength(2);
    expect(render()).not.toContain("Load employees for this day"); expect(render()).not.toContain('href="/admin');
    expect(reload).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });

  it("updates the CAS version after failed verification without presenting unverified choices", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(review, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ state: { version: 8, shifts: roster.shifts }, fresh: false }))
      .mockResolvedValueOnce(Response.json({ state: { version: 9 }, fresh: true })).mockResolvedValueOnce(Response.json({ ...roster, version: 9 }));
    vi.stubGlobal("fetch", request); await load(); await click("Load employees for this day");
    expect(request).toHaveBeenCalledTimes(2); expect(render()).toContain("Published employees could not be verified");
    expect(render()).not.toContain("Jordan"); expect(render()).not.toContain('type="checkbox"');
    await click("Load employees for this day");
    expect(body(request, 2)).toEqual({ action: "sync", date: props.date, expectedVersion: 8 });
    expect(request).toHaveBeenCalledTimes(4); expect(render()).toContain("Jordan"); expect(onSaved).not.toHaveBeenCalled();
  });

  it("requires explicit reload after a409 rather than auto-retrying", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(review, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ error: "Staffing changed. Reload before saving." }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ ...review, version: 9 }, { status: 422 }));
    vi.stubGlobal("fetch", request); await load(); await click("Load employees for this day");
    expect(request).toHaveBeenCalledTimes(2); expect(render()).toContain("Reload employees"); expect(render()).not.toContain("Load employees for this day");
    await click("Reload employees"); expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0]).toBe(query); expect(render()).toContain("Load employees for this day"); expect(onSaved).not.toHaveBeenCalled();
  });

  it("preserves read-only Preview403 without bypassing protection or loading names", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(review, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ error: "This Preview is read-only. No staffing changes were saved." }, { status: 403 }));
    vi.stubGlobal("fetch", request); await load(); await click("Load employees for this day");
    expect(request).toHaveBeenCalledTimes(2); expect(render()).toContain("This Preview is read-only");
    expect(render()).not.toContain("Jordan"); expect(render()).not.toContain('type="checkbox"');
    expect(reload).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  });

  it("hides names and offers inline unlock when a multi-select save receives401", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(roster))
      .mockResolvedValueOnce(Response.json({ error: "Admin sign-in required." }, { status: 401 }));
    vi.stubGlobal("fetch", request); await load(); expect(render().match(/type="checkbox"/g)).toHaveLength(2);
    await click("Save staffing team (2)");
    expect(body(request, 1)).toEqual({ action: "replace-team", eventId: "501", eventDate: props.date, expectedVersion: 7,
      choices: [{ shiftId: "shift-1" }, { shiftId: "shift-2" }] });
    const html = render(); expect(html).toContain("Unlock staff assignment");
    for (const text of ["Jordan", "Casey", "Save staffing team", 'href="/admin']) expect(html).not.toContain(text);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("aborts a pending roster request on cleanup and ignores its late response", async () => {
    let respond!: (response: Response) => void;
    const request = vi.fn((_input: string, _options: { signal: AbortSignal }) => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", request); const cleanup = await load();
    const signal = request.mock.calls[0][1].signal; expect(signal.aborted).toBe(false); cleanup(); expect(signal.aborted).toBe(true);
    respond(Response.json(roster)); await flush();
    expect(render()).not.toContain("Jordan"); expect(render()).not.toContain('type="checkbox"'); expect(onSaved).not.toHaveBeenCalled();
  });
});
