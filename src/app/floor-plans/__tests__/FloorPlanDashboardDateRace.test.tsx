import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import type { FloorPlanDayPayload, FloorPlanEvent } from "@/lib/floor-plans/types";

const hooks = vi.hoisted(() => ({
  stateIndex: 0, states: [] as unknown[], refIndex: 0, refs: [] as Array<{ current: unknown }>,
  callbackIndex: 0, callbacks: [] as Array<{ value: unknown; deps: readonly unknown[] }>,
  effectIndex: 0, deps: [] as Array<readonly unknown[]>, pending: [] as Array<{ index: number; effect: () => unknown }>, cleanups: [] as unknown[],
}));
const context = vi.hoisted(() => ({ clearEvent: vi.fn(), selectEvent: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (value: unknown, deps: readonly unknown[]) => {
    const index = hooks.callbackIndex++, previous = hooks.callbacks[index];
    if (!previous || deps.some((value, offset) => value !== previous.deps[offset])) hooks.callbacks[index] = { value, deps };
    return hooks.callbacks[index].value;
  },
  useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
    const index = hooks.effectIndex++;
    if (!hooks.deps[index] || deps.some((value, offset) => value !== hooks.deps[index][offset])) {
      hooks.deps[index] = deps;
      hooks.pending = hooks.pending.filter((item) => item.index !== index);
      hooks.pending.push({ index, effect });
    }
  },
}));
vi.mock("@/app/_components/PortalShell", () => ({ PortalShell: "portal-shell", PortalState: "portal-state", PortalStatusBadge: "portal-status-badge" }));
vi.mock("@/app/_components/EventContext", () => ({
  useEventContext: () => ({ ...context, ready: true, preferredEventId: null, requestedDate: null }), EventSelectionBridge: "event-selection-bridge",
}));
vi.mock("../FloorPlanDayHighlights", () => ({ default: "day-highlights" }));
vi.mock("../FloorPlanSpecialHighlightsEditor", () => ({
  default: "special-highlight-editor",
  useFloorPlanSpecialHighlights: (date: string) => ({ date, highlights: [{ id: date, kind: "highlight", text: `Note ${date}`, x: 10, y: 10, width: 10, height: 10, fill: "#7C3AED" }],
    dirty: false, canEdit: true, status: "idle", message: "Loaded", selectedId: null, setSelectedId: vi.fn() }),
}));

import FloorPlanDashboard from "../FloorPlanDashboard";

const FIRST = "2026-12-05", SECOND = "2026-12-06", THIRD = "2026-12-07";
function payload(date: string): FloorPlanDayPayload {
  const event: FloorPlanEvent = { id: `event-${date}`, floorPlanId: `plan-${date}`, tripleseatEventId: `source-${date}`, name: `Party ${date}`, status: "DEFINITE", guestCount: 20,
    startAt: `${date}T17:00:00-05:00`, endAt: `${date}T19:00:00-05:00`, contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: null,
    fullBuyout: false, source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } };
  return { date, plan: { id: `plan-${date}`, eventDate: date, status: "Approved", version: Number(date.slice(-2)), ruleVersion: "test", lastTripleseatSyncAt: null,
    createdAt: `${date}T12:00:00Z`, updatedAt: `${date}T12:00:00Z`, approvedAt: null, approvedBy: null, events: [event], reservations: [] },
    entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [], validation: [], revisions: [], persistence: "database", sourceMode: "live", warnings: [] };
}
type Props = { children?: unknown; className?: string; title?: string; highlights?: AdminAssetOverlay[]; "aria-label"?: string;
  value?: string; onChange?: (event: { target: { value: string } }) => void };
function elements(node: unknown): Array<ReactElement<Props>> {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props?.children)];
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return node && typeof node === "object" ? text((node as ReactElement<Props>).props?.children) : "";
}
function render() {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.callbackIndex = 0; hooks.effectIndex = 0;
  return elements(FloorPlanDashboard({ initialDate: FIRST }));
}
function effects() {
  for (const item of hooks.pending.splice(0)) {
    const cleanup = hooks.cleanups[item.index];
    if (typeof cleanup === "function") cleanup();
    hooks.cleanups[item.index] = item.effect();
  }
}
function switchDate(date: string) {
  render().find((item) => item.type === "input" && item.props["aria-label"] === "Floor plan date")!.props.onChange!({ target: { value: date } });
  return render();
}
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); return render(); }
function visibleDate(nodes: ReturnType<typeof render>) { return nodes.find((item) => item.type === "day-highlights")?.props.highlights?.[0].id ?? null; }
function defer() {
  let resolve!: (response: Response) => void, reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.callbacks = []; hooks.deps = []; hooks.pending = []; hooks.cleanups = [];
  vi.clearAllMocks(); vi.stubGlobal("window", { confirm: vi.fn(() => true), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { for (const cleanup of hooks.cleanups) if (typeof cleanup === "function") cleanup(); vi.unstubAllGlobals(); });

describe("Admin floor-plan date request isolation", () => {
  it("hides the old party and map immediately, before the next date's GET effect starts", async () => {
    const first = defer(), second = defer(), fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch); render(); effects(); first.resolve(Response.json(payload(FIRST)));
    expect(visibleDate(await settle())).toBe(FIRST);
    const switching = switchDate(SECOND);
    expect(text(switching)).not.toContain(`Party ${FIRST}`); expect(visibleDate(switching)).toBeNull(); expect(fetch).toHaveBeenCalledOnce();
    effects(); second.resolve(Response.json(payload(SECOND)));
    const current = await settle(); expect(visibleDate(current)).toBe(SECOND); expect(text(current)).toContain(`Party ${SECOND}`); expect(text(current)).not.toContain(`Party ${FIRST}`);
  });

  it.each(["success", "failure"])("ignores an old %s even when it arrives before the new date's effect starts", async (result) => {
    const first = defer(), second = defer(), fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch); render(); effects(); switchDate(SECOND);
    if (result === "success") first.resolve(Response.json(payload(FIRST))); else first.reject(new Error("Old request failed"));
    const switching = await settle(); expect(visibleDate(switching)).toBeNull(); expect(text(switching)).not.toContain(`Party ${FIRST}`);
    expect(text(switching)).toContain("Loading saved floor plan…"); expect(text(switching)).not.toContain("Version 5 loaded"); expect(text(switching)).not.toContain("Old request failed");
    effects(); second.resolve(Response.json(payload(SECOND))); expect(visibleDate(await settle())).toBe(SECOND);
  });

  it.each(["success", "failure"])("ignores a late old-date %s after the current day has loaded", async (result) => {
    const first = defer(), second = defer(), fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch); render(); effects(); switchDate(SECOND); effects(); second.resolve(Response.json(payload(SECOND)));
    expect(visibleDate(await settle())).toBe(SECOND);
    if (result === "success") first.resolve(Response.json(payload(FIRST))); else first.reject(new Error("Old request failed"));
    const current = await settle(); expect(visibleDate(current)).toBe(SECOND); expect(text(current)).toContain("Version 6 loaded from Event Host.");
    expect(text(current)).not.toContain("Old request failed"); expect(text(current)).not.toContain("Needs attention");
  });

  it("keeps the latest of three rapid selections when GET replies arrive out of order", async () => {
    const first = defer(), second = defer(), third = defer();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    vi.stubGlobal("fetch", fetch); render(); effects(); switchDate(SECOND); effects(); switchDate(THIRD); effects();
    third.resolve(Response.json(payload(THIRD))); expect(visibleDate(await settle())).toBe(THIRD);
    second.resolve(Response.json(payload(SECOND))); first.resolve(Response.json(payload(FIRST)));
    const current = await settle(); expect(visibleDate(current)).toBe(THIRD); expect(text(current)).toContain(`Party ${THIRD}`);
    expect(text(current)).not.toContain(`Party ${FIRST}`); expect(text(current)).not.toContain(`Party ${SECOND}`);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([FIRST, SECOND, THIRD].map((date) => `/api/floor-plans?date=${date}`));
    expect(fetch.mock.calls.every(([, options]) => options.method === undefined)).toBe(true);
  });

  it.each(["payload", "plan"])("refuses a response whose %s date is not the requested date", async (mismatch) => {
    const wrong = payload(SECOND); if (mismatch === "payload") wrong.date = FIRST; else wrong.plan.eventDate = FIRST;
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(payload(FIRST))).mockResolvedValueOnce(Response.json(wrong));
    vi.stubGlobal("fetch", fetch); render(); effects(); await settle(); switchDate(SECOND); effects();
    const current = await settle(); expect(visibleDate(current)).toBeNull(); expect(text(current)).not.toContain(`Party ${FIRST}`);
    expect(text(current)).toContain("The floor plan date could not be verified. Reload the selected date.");
    expect(current.some((item) => item.type === "portal-state" && item.props.title === "Floor plan unavailable")).toBe(true);
  });
});
