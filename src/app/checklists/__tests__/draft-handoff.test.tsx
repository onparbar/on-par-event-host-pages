import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ChecklistRecord } from "@/lib/checklist-model";
import ChecklistsClient from "../ChecklistsClient";

const hooks = vi.hoisted(() => ({ index: 0, setters: [] as ReturnType<typeof vi.fn>[], states: [] as unknown[], navigate: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useMemo: (read: () => unknown) => read(), useEffect: () => undefined,
  useEffectEvent: (action: unknown) => action, useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    let value = typeof initial === "function" ? initial() : initial;
    if (index === 4) { value[77].bwa = "Brooke"; value[77].food.wings.quantity = "2"; }
    if (index === 5) value[77].updatedAt = "2026-10-24T20:00:00Z";
    if (index === 10) value = [77]; // Explicitly prove the handoff overrides any old dirty-food flag.
    if (index === 14) value = "ready";
    hooks.states[index] = value;
    const setter = vi.fn((next: unknown) => { value = typeof next === "function" ? next(value) : next; hooks.states[index] = value; });
    hooks.setters[index] = setter;
    return [value, setter];
  },
}));
vi.mock("@/app/_components/EventContext", () => ({ EventSelectionBridge: () => null,
  useEventContext: () => ({ preferredEventId: null, ready: true, selectEvent: vi.fn(), clearEvent: vi.fn(), staffName: "Brooke" }) }));
vi.mock("@/app/_components/PortalShell", () => ({ PortalPageHeader: () => null, PortalShell: () => null, PortalStatusBadge: () => null }));
vi.mock("@/app/_components/EventWorkspace", () => ({ EventWorkspaceRequests: () => null }));

const event = { id: 77, name: "Sanitized Saturday party", date: "2026-10-24", dateLabel: "Saturday", day: "Saturday", time: "5:00 PM - 8:00 PM",
  rooms: ["VIP 1"], guest_count: 20, color: "#18332F", food: ["1 × Wing Platter"], drink_options: [], entertainment: [], verification_status: "Verified",
  source_updated_at: "2026-10-23T14:00:00Z", poc: "" };

function findButton(node: unknown): ReactElement<{ onClick: () => Promise<void> }> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findButton(child); if (found) return found; } return null; }
  const element = node as ReactElement<{ children?: unknown; onClick: () => Promise<void> }>;
  if (element.type === "button" && element.props.children === "Save add-on draft and open checklist") return element;
  return findButton(element.props?.children);
}
function renderButton() {
  hooks.index = 0; hooks.states = []; hooks.setters = [];
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), location: { assign: hooks.navigate } });
  return findButton(ChecklistsClient({ activeEventIds: [77], events: [event], workspace: "addons" }))!;
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("save add-on draft before checklist handoff", () => {
  it("saves the exact quantities without ordering food or faking task completion, then opens the same event", async () => {
    const button = renderButton();
    const state = structuredClone((hooks.states[4] as Record<number, object>)[77]);
    const record = { ...state, eventId: 77, eventName: event.name, eventDate: event.date, poc: "", status: "draft", updatedAt: "2026-10-24T20:01:00Z", submittedAt: null } as ChecklistRecord;
    const fetch = vi.fn().mockResolvedValue(Response.json({ record })); vi.stubGlobal("fetch", fetch);
    button.props.onClick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledOnce();
    const [path, request] = fetch.mock.calls[0];
    expect(path).toBe("/api/checklists"); expect(request.method).toBe("PUT");
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ eventId: 77, sourceEventId: "77", eventDate: event.date, syncFoodAddOns: false,
      expectedUpdatedAt: "2026-10-24T20:00:00Z", checklist: { food: { wings: { quantity: "2" } } } });
    expect(body.checklist.tasks["shift-lead-checkout"]).toBe(false);
    expect(body.checklist.taskEvidence["shift-lead-checkout"]).toBeUndefined();
    expect(hooks.setters[11]).not.toHaveBeenCalled(); // Food delivery state was not changed to sent.
    expect(hooks.navigate).toHaveBeenCalledExactlyOnceWith("/checklists?date=2026-10-24&eventId=77");
  });

  it.each([409, 502])("retains entered quantities and does not navigate after HTTP%s", async (status) => {
    const button = renderButton();
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Saved record changed; review your draft." }, { status })); vi.stubGlobal("fetch", fetch);
    button.props.onClick(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect(hooks.navigate).not.toHaveBeenCalled();
    expect((hooks.states[4] as Record<number, ChecklistRecord>)[77].food.wings.quantity).toBe("2");
    expect(hooks.setters[11]).not.toHaveBeenCalled();
    expect(JSON.parse(fetch.mock.calls[0][1].body).syncFoodAddOns).toBe(false);
  });
  it("does not navigate on an unverified successful response for another event", async () => {
    const button = renderButton();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ record: { eventId: 99, eventDate: event.date, status: "draft", updatedAt: "2026-10-24T20:01:00Z" } })));
    button.props.onClick(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect(hooks.navigate).not.toHaveBeenCalled();
    expect((hooks.states[4] as Record<number, ChecklistRecord>)[77].food.wings.quantity).toBe("2");
    expect(hooks.setters[11]).not.toHaveBeenCalled();
  });
});
