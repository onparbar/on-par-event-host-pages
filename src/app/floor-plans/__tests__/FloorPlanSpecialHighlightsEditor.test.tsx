import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import { getFloorPlanArea } from "@/lib/floor-plans/configuration/areas";
import Editor, { useFloorPlanSpecialHighlights, type FloorPlanSpecialHighlightsState } from "../FloorPlanSpecialHighlightsEditor";

const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], refIndex: 0, refs: [] as Array<{ current: unknown }>,
  effectIndex: 0, deps: [] as Array<readonly unknown[]>, pending: [] as Array<{ index: number; effect: () => unknown }>, cleanups: [] as Array<unknown> }));
const broadcast = vi.hoisted(() => ({ opened: vi.fn(), post: vi.fn(), close: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
  useRef: (value: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: value }; },
  useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
    const index = hooks.effectIndex++;
    if (!hooks.deps[index] || deps.some((value, offset) => value !== hooks.deps[index][offset])) {
      hooks.deps[index] = deps;
      hooks.pending.push({ index, effect });
    }
  },
}));

const DATE = "2026-12-05", OTHER_DATE = "2026-12-06";
const VERSION = "2026-11-25T18:00:00.000Z", NEXT_VERSION = "2026-11-25T18:01:00.000Z";
const note = (id = "special-1", text = "Trivia"): AdminAssetOverlay => ({ id, kind: "highlight", x: 10, y: 20, width: 12, height: 8,
  fill: "#7C3AED", text, opacity: 0.5, textColor: "#FFFFFF", fontSize: 18 });
const payload = (items = [note()], date = DATE, updatedAt: string | null = VERSION) => ({ date, highlights: items, updatedAt });
function resetRender() { hooks.index = 0; hooks.refIndex = 0; hooks.effectIndex = 0; }
function read(date = DATE) { resetRender(); return useFloorPlanSpecialHighlights(date); }
function effects() {
  const pending = hooks.pending.splice(0);
  for (const item of pending) {
    const cleanup = hooks.cleanups[item.index];
    if (typeof cleanup === "function") cleanup();
    hooks.cleanups[item.index] = item.effect();
  }
}
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); }
async function load(date = DATE) { read(date); effects(); await settle(); return read(date); }
function requestBody(request: ReturnType<typeof vi.fn>, index: number) { return JSON.parse(request.mock.calls[index][1].body); }

type Props = { children?: unknown; value?: unknown; disabled?: boolean; placeholder?: string; maxLength?: number;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void };
function elements(node: unknown): Array<ReactElement<Props>> {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props?.children)];
}
function model(items: AdminAssetOverlay[] = []): FloorPlanSpecialHighlightsState {
  const state = { date: DATE, highlights: items, dirty: false, status: "idle" as const, message: "Loaded", selectedId: (items[0]?.id ?? null) as string | null,
    canEdit: true, canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn(), save: vi.fn(), reload: vi.fn(),
    replaceHighlights: vi.fn(), setSelectedId: vi.fn() };
  state.replaceHighlights.mockImplementation((next: AdminAssetOverlay[]) => { state.highlights = next; state.dirty = true; });
  state.setSelectedId.mockImplementation((id: string | null) => { state.selectedId = id; });
  return state;
}
function tree(state: FloorPlanSpecialHighlightsState, area = null as ReturnType<typeof getFloorPlanArea> | null) {
  resetRender(); return elements(Editor({ state, selectedArea: area ?? null }));
}
function button(nodes: ReturnType<typeof tree>, text: string) { return nodes.find((item) => item.type === "button" && item.props.children === text)!; }
function field(nodes: ReturnType<typeof tree>, text: string) {
  const label = nodes.find((item) => item.type === "label" && Array.isArray(item.props.children) && item.props.children.filter((child) => typeof child === "string").join("") === text)!;
  return elements(label).find((item) => item.type === "input")!;
}

beforeEach(() => {
  hooks.index = 0; hooks.states = []; hooks.refIndex = 0; hooks.refs = []; hooks.effectIndex = 0; hooks.deps = []; hooks.pending = []; hooks.cleanups = [];
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  broadcast.opened.mockClear(); broadcast.post.mockClear(); broadcast.close.mockClear();
  vi.stubGlobal("BroadcastChannel", class { constructor(name: string) { broadcast.opened(name); } postMessage = broadcast.post; close = broadcast.close; });
});
afterEach(() => { for (const cleanup of hooks.cleanups) if (typeof cleanup === "function") cleanup(); vi.unstubAllGlobals(); });

describe("date-only special highlight draft", () => {
  it("loads the exact date by GET only; local edits, selection and undo/redo do not publish", async () => {
    const request = vi.fn().mockResolvedValue(Response.json(payload())); vi.stubGlobal("fetch", request);
    const state = await load();
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/admin/floor-plan-highlights?date=" + DATE, { cache: "no-store", signal: expect.any(AbortSignal) });
    state.setSelectedId("special-1"); state.replaceHighlights([note("special-1", "Bingo")]);
    expect(read()).toMatchObject({ dirty: true, selectedId: "special-1", canUndo: true });
    read().undo(); expect(read().highlights[0].text).toBe("Trivia"); expect(read().dirty).toBe(false);
    read().redo(); expect(read().highlights[0].text).toBe("Bingo"); expect(request).toHaveBeenCalledOnce();
  });

  it("saves only these notes and their revision, never a party or reservation", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(payload())).mockResolvedValueOnce(Response.json(payload([note("special-1", "Bingo")], DATE, NEXT_VERSION)));
    vi.stubGlobal("fetch", request); await load(); read().replaceHighlights([note("special-1", "Bingo")]); await read().save();
    expect(request.mock.calls[1][0]).toBe("/api/admin/floor-plan-highlights");
    expect(request.mock.calls[1][1].method).toBe("PUT");
    expect(requestBody(request, 1)).toEqual({ date: DATE, highlights: [note("special-1", "Bingo")], expectedUpdatedAt: VERSION });
    expect(read()).toMatchObject({ dirty: false, status: "saved", canUndo: false, canRedo: false });
    expect(broadcast.opened).toHaveBeenCalledExactlyOnceWith("event-host-floor-plans");
    expect(broadcast.post).toHaveBeenCalledExactlyOnceWith({ action: "highlights-saved", date: DATE });
    expect(broadcast.close).toHaveBeenCalledOnce();
  });

  it("blocks duplicate Save clicks and edits while the explicit save is pending", async () => {
    let complete!: (response: Response) => void;
    const request = vi.fn().mockResolvedValueOnce(Response.json(payload())).mockReturnValueOnce(new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", request); await load(); const state = read(); state.replaceHighlights([note("special-1", "Bingo")]);
    const first = read().save(); void read().save(); read().replaceHighlights([]);
    expect(read()).toMatchObject({ status: "saving", canEdit: false }); expect(read().highlights).toHaveLength(1); expect(request).toHaveBeenCalledTimes(2);
    complete(Response.json(payload([note("special-1", "Bingo")], DATE, NEXT_VERSION))); await first;
    expect(read().status).toBe("saved");
  });

  it("retains a stale draft and refuses save retry until a confirmed reload", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(payload())).mockResolvedValueOnce(Response.json({ error: "Another Admin saved." }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(payload([note("new-version", "Live music")], DATE, NEXT_VERSION)));
    vi.stubGlobal("fetch", request); await load(); read().replaceHighlights([note("special-1", "Bingo")]); await read().save();
    expect(read()).toMatchObject({ status: "conflict", dirty: true, canEdit: false }); expect(read().highlights[0].text).toBe("Bingo");
    expect(broadcast.post).not.toHaveBeenCalled();
    await read().save(); read().replaceHighlights([]); expect(request).toHaveBeenCalledTimes(2); expect(read().highlights).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValueOnce(false); await read().reload(); expect(request).toHaveBeenCalledTimes(2);
    await read().reload(); expect(request).toHaveBeenCalledTimes(3); expect(read()).toMatchObject({ dirty: false, canEdit: true, status: "idle" });
    expect(read().highlights[0].text).toBe("Live music");
  });

  it.each([Response.json({ error: "Unavailable" }, { status: 503 }), Response.json(payload([], OTHER_DATE)), Response.json({ date: DATE, highlights: [], updatedAt: "bad" })])("disables editing after an unsuccessful or wrong-date load", async (response) => {
    const request = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", request); await load();
    expect(read()).toMatchObject({ status: "error", canEdit: false }); read().replaceHighlights([note()]); await read().save();
    expect(read().highlights).toEqual([]); expect(request).toHaveBeenCalledOnce();
  });

  it("never sends an unnamed or out-of-bounds note", async () => {
    const request = vi.fn().mockResolvedValue(Response.json(payload())); vi.stubGlobal("fetch", request); await load();
    for (const invalid of [{ ...note(), text: " " }, { ...note(), x: 99, width: 2 }]) {
      read().replaceHighlights([invalid]); await read().save(); expect(read().status).toBe("error");
    }
    expect(request).toHaveBeenCalledOnce();
  });

  it("retains a draft on save failure without automatic retry", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json(payload())).mockResolvedValueOnce(Response.json({ error: "Save unavailable" }, { status: 503 }));
    vi.stubGlobal("fetch", request); await load(); read().replaceHighlights([]); await read().save();
    expect(read()).toMatchObject({ status: "error", dirty: true, canEdit: true }); expect(read().highlights).toEqual([]); expect(request).toHaveBeenCalledTimes(2);
  });

  it("aborts an old GET and ignores its late reply when the date changes", async () => {
    let oldReply!: (response: Response) => void;
    const request = vi.fn().mockReturnValueOnce(new Promise<Response>((resolve) => { oldReply = resolve; })).mockResolvedValueOnce(Response.json(payload([note("other", "Bingo")], OTHER_DATE)));
    vi.stubGlobal("fetch", request); read(); effects(); const oldSignal = request.mock.calls[0][1].signal;
    expect(read(OTHER_DATE).highlights).toEqual([]); effects(); await settle();
    expect(oldSignal.aborted).toBe(true); oldReply(Response.json(payload())); await settle();
    expect(read(OTHER_DATE).highlights[0].id).toBe("other"); expect(request).toHaveBeenCalledTimes(2);
  });

  it("cannot apply an old date's Save response to the newly loaded day", async () => {
    let savedReply!: (response: Response) => void;
    const request = vi.fn().mockResolvedValueOnce(Response.json(payload())).mockReturnValueOnce(new Promise<Response>((resolve) => { savedReply = resolve; }))
      .mockResolvedValueOnce(Response.json(payload([note("other", "Other date")], OTHER_DATE)));
    vi.stubGlobal("fetch", request); await load(); read().replaceHighlights([note("special-1", "Changed")]); const saving = read().save();
    read(OTHER_DATE); effects(); await settle(); savedReply(Response.json(payload([note("special-1", "Changed")], DATE, NEXT_VERSION))); await saving;
    expect(read(OTHER_DATE)).toMatchObject({ dirty: false, status: "idle" }); expect(read(OTHER_DATE).highlights[0].text).toBe("Other date");
    expect(requestBody(request, 1).date).toBe(DATE);
  });
});

describe("special highlight editor controls", () => {
  it("adds an independently named and colored note at the selected object's percentage bounds, locally only", () => {
    const state = model(), area = getFloorPlanArea("vip-1")!;
    field(tree(state, area), "New highlight name").props.onChange!({ target: { value: "  Bingo  " } });
    field(tree(state, area), "New highlight color").props.onChange!({ target: { value: "#297025" } });
    button(tree(state, area), "Add special event highlight").props.onClick!();
    expect(state.highlights[0]).toMatchObject({ text: "Bingo", fill: "#297025", kind: "highlight", x: area.x / 1920 * 100, y: area.y / 1080 * 100 });
    expect(state.highlights[0].width).toBeCloseTo(area.width / 1920 * 100); expect(state.selectedId).toBe(state.highlights[0].id);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("lets staff rename, recolor, bound and delete only the selected note, without changing other notes", () => {
    const state = model([note(), note("second", "Bingo")]);
    field(tree(state), "Name").props.onChange!({ target: { value: "Trivia night" } });
    field(tree(state), "Color").props.onChange!({ target: { value: "#FFFFFF" } });
    field(tree(state), "x (%)").props.onChange!({ target: { value: "200" } });
    expect(state.highlights[0]).toMatchObject({ text: "Trivia night", fill: "#FFFFFF", textColor: "#000000", x: 88 });
    expect(state.highlights[1]).toEqual(note("second", "Bingo"));
    button(tree(state), "Delete selected special event highlight").props.onClick!(); expect(state.highlights).toEqual([note("second", "Bingo")]);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("provides explicit, separately labeled Save and Reload controls and clearly identifies notes as non-reservations", () => {
    const state = model([note()]); state.dirty = true;
    const nodes = tree(state); button(nodes, "Save special event highlights").props.onClick!(); button(nodes, "Reload special event highlights").props.onClick!();
    expect(state.save).toHaveBeenCalledOnce(); expect(state.reload).toHaveBeenCalledOnce();
    expect(nodes.some((item) => typeof item.props.children === "string" && item.props.children.includes("not reservations or plan approval"))).toBe(true);
    expect(field(nodes, "Name").props).toMatchObject({ placeholder: "Trivia or Bingo", maxLength: 80 });
  });

  it("disables Add and Save when unavailable or when the date has reached 50 notes", () => {
    const state = model(); state.canEdit = false; state.status = "error";
    expect(tree(state).find((item) => item.type === "fieldset")?.props.disabled).toBe(true);
    expect(button(tree(state), "Save special event highlights").props.disabled).toBe(true);
    state.canEdit = true; state.highlights = Array.from({ length: 50 }, (_, index) => note("note-" + index));
    field(tree(state), "New highlight name").props.onChange!({ target: { value: "More" } });
    expect(button(tree(state), "Add special event highlight").props.disabled).toBe(true);
  });
});
