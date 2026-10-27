import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { AdminState } from "@/lib/admin-types";
import FloorPlansClient, { prepareFloorPlanMonthDrafts } from "../FloorPlansClient";

const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], refresh: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useMemo: (read: () => unknown) => read(), useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock("@/app/_components/EventContext", () => ({ useEventContext: () => ({ ready: true, requestedDate: null, selectedEvent: null, requestedEventId: null }) }));
vi.mock("@/app/_components/PortalShell", () => ({ PortalShell: () => null, PortalPageHeader: () => null, PortalCard: () => null, PortalStatusBadge: () => null, PortalZoomControls: () => null }));

const props = { initialState: { archivedAssetKeys: [], overlaysByAsset: {} } as unknown as AdminState, plans: [], publications: [], specialPages: [], today: "2026-10-27" };
function result(statuses: Array<"created" | "skipped" | "error"> = []) {
  return { month: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31", results: Array.from({ length: 31 }, (_, index) => ({ date: `2026-12-${String(index + 1).padStart(2, "0")}`, status: statuses[index] ?? "skipped", eventCount: statuses[index] === "created" ? 1 : 0 })) };
}
function findButton(node: unknown, text: string): ReactElement<{ disabled: boolean; onClick: () => void }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findButton(child, text); if (found) return found; } return null; }
  const element = node as ReactElement<{ children?: unknown; disabled: boolean; onClick: () => void }>;
  if (element.type === "button" && element.props.children === text) return element;
  return findButton(element.props?.children, text);
}
function button(text = "Prepare December drafts") { hooks.index = 0; return findButton(FloorPlansClient(props), text)!; }
function state() { return hooks.states[4] as { status: string; message: string }; }
async function settle() { await new Promise<void>((resolve) => setImmediate(resolve)); }

beforeEach(() => { hooks.index = 0; hooks.states = []; hooks.refresh.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("December missing-draft preparation", () => {
  it("uses only the scoped month endpoint and returns real per-date results", async () => {
    const response = result(["created", "error"]);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    expect(await prepareFloorPlanMonthDrafts("2026-12", fetch)).toEqual(response);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/floor-plans/planning-month", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month: "2026-12" }) });
  });

  it("disables preparation while busy, reports partial counts, and refreshes created drafts", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    button().props.onClick();
    expect(state().status).toBe("preparing");
    const busy = button("Preparing December drafts…");
    expect(busy.props.disabled).toBe(true);
    busy.props.onClick();
    expect(fetch).toHaveBeenCalledOnce();
    resolve(Response.json(result(["created", "created", "error"])));
    await settle();
    expect(state()).toMatchObject({ status: "error" });
    expect(state().message).toContain("2 drafts created · 28 dates skipped · 1 date needs attention");
    expect(state().message).toContain("Existing saved plans were preserved");
    expect(hooks.refresh).toHaveBeenCalledOnce();
    expect(hooks.states[1]).toEqual({}); // No existing live map data was replaced locally.
  });

  it("clearly reports zero created drafts when all dates were skipped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(result())));
    button().props.onClick(); await settle();
    expect(state()).toMatchObject({ status: "success" });
    expect(state().message).toContain("0 drafts created · 31 dates skipped · 0 dates need attention");
    expect(state().message).toContain("No missing drafts were available to create");
    expect(hooks.refresh).toHaveBeenCalledOnce();
  });

  it.each([403, 502])("retains existing map data after HTTP%s rather than claiming preparation succeeded", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Source unavailable; existing drafts remain saved." }, { status })));
    button().props.onClick(); await settle();
    expect(state()).toEqual({ status: "error", message: "Source unavailable; existing drafts remain saved." });
    expect(hooks.states[1]).toEqual({});
    expect(hooks.refresh).not.toHaveBeenCalled();
    expect(button().props.disabled).toBe(false);
  });

  it.each([
    { ...result(), month: "2027-12" },
    { ...result(), endDate: "2027-01-01" },
    { ...result(), results: [] },
    { ...result(), results: [...result().results.slice(0, 30), { date: "2026-12-31", status: "approved", eventCount: 1 }] },
  ])("does not report success for an unverified month response", async (response) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    await expect(prepareFloorPlanMonthDrafts("2026-12", fetch)).rejects.toThrow("Existing plans are unchanged");
  });
});
