import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ChecklistEvent } from "@/lib/checklist-events";
import type { ChecklistRecord, EventChecklistState } from "@/lib/checklist-model";
import { defaultChecklistState } from "@/lib/checklist-model";
import AddOnQuickOrder, { type QuickOrderInput } from "../AddOnQuickOrder";
import ChecklistsClient from "../ChecklistsClient";

const hooks = vi.hoisted(() => ({
  stateIndex: 0, refIndex: 0, states: [] as any[], refs: [] as { current: any }[],
  effects: [] as (() => unknown)[], timers: [] as (() => Promise<void>)[],
  staffName: "Brooke", preferredEventId: null as string | null,
}));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useMemo: (read: () => unknown) => read(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  useEffectEvent: (action: unknown) => action,
  useRef: (current: unknown) => {
    const index = hooks.refIndex++;
    if (!hooks.refs[index]) hooks.refs[index] = { current };
    return hooks.refs[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!Object.hasOwn(hooks.states, index)) {
      hooks.states[index] = typeof initial === "function" ? initial() : initial;
    }
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
}));
vi.mock("@/app/_components/EventContext", () => ({ EventSelectionBridge: () => null,
  useEventContext: () => ({ preferredEventId: hooks.preferredEventId, ready: true, selectEvent: vi.fn(), clearEvent: vi.fn(), staffName: hooks.staffName }) }));
vi.mock("@/app/_components/PortalShell", () => ({ PortalPageHeader: () => null, PortalShell: () => null, PortalStatusBadge: () => null }));

const event: ChecklistEvent = { id: 77, name: "Redacted event", date: "2026-11-03", dateLabel: "Tuesday, November 3", day: "Tuesday", time: "5:00 PM - 8:00 PM",
  rooms: ["VIP 1"], guest_count: 20, color: "#18332F", food: ["1 × Wing Platter"], drink_options: [], entertainment: [], verification_status: "Verified",
  source_updated_at: "2026-11-03T14:00:00Z", poc: "" };
const otherEvent: ChecklistEvent = { ...event, id: 88, source_event_id: "vip-redacted-booking", name: "Other redacted VIP" };
const events = [event, otherEvent];
let initialRecords: ChecklistRecord[] | null;
const foodOrder: QuickOrderInput = { category: "food", key: "wings", quantity: "3", panSize: "1/2", notes: "Sauce on side", selectedRateKey: "sun-thu", manualPrice: "" };

function initialRecord(event: ChecklistEvent): ChecklistRecord {
  const state = defaultChecklistState(event.date);
  state.bwa = "Saved BWA"; state.poc = "Saved POC";
  state.extrasAdded = "Existing staff notes";
  state.remainingDrinkCardBalance = "Existing balance note";
  state.tasks["shift-lead-checkout"] = true;
  state.taskEvidence!["shift-lead-checkout"] = { employeeName: "Earlier Staff", completedAt: "2026-11-03T14:00:00Z" };
  state.food.wings.quantity = "2";
  state.entertainment["mini-golf"].quantity = "5";
  return { ...state, eventId: event.id, eventName: event.name, eventDate: event.date, poc: "Saved POC",
    status: "draft", updatedAt: "2026-11-03T15:00:00Z", submittedAt: null };
}

function findElement(node: unknown, match: (element: ReactElement<any>) => boolean): ReactElement<any> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const child of node) { const found = findElement(child, match); if (found) return found; } return null; }
  const element = node as ReactElement<any>;
  if (match(element)) return element;
  return findElement(element.props?.children, match);
}
function treeText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(treeText).join(" ");
  return node && typeof node === "object" ? treeText((node as ReactElement<any>).props?.children) : "";
}
function render(workspace: "addons" | "checklist" = "addons") {
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
  return ChecklistsClient({ activeEventIds: [77, 88], events, initialRecords, workspace })!;
}
function quickOrder() { return findElement(render(), (element) => element.type === AddOnQuickOrder)!; }
function submit(order = foodOrder) { return quickOrder().props.onSubmit(order) as Promise<string>; }
function currentState(id = 77) { return hooks.states[1][id] as EventChecklistState; }
function savedResponse(body: Record<string, any>, kitchenSync: Record<string, unknown> | undefined = { status: "live" }, revision = "2026-11-03T15:01:00Z") {
  const record: ChecklistRecord = { ...body.checklist, eventId: body.eventId, eventName: body.eventId === 77 ? event.name : otherEvent.name,
    eventDate: body.eventDate, poc: body.checklist.poc ?? "", status: "draft", updatedAt: revision, submittedAt: null };
  return Response.json({ record, ...(kitchenSync ? { kitchenSync } : {}) });
}
function acceptFetch() {
  let revision = 0;
  const fetch = vi.fn(async (_path: string, request: RequestInit) => savedResponse(JSON.parse(request.body as string), { status: "live" }, `2026-11-03T15:0${++revision}:00Z`));
  vi.stubGlobal("fetch", fetch); return fetch;
}

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.timers = []; hooks.effects = [];
  hooks.stateIndex = 0; hooks.refIndex = 0; hooks.staffName = "Brooke"; hooks.preferredEventId = null;
  initialRecords = events.map(initialRecord);
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), location: { reload: vi.fn() }, setTimeout: vi.fn((callback) => { hooks.timers.push(callback); return hooks.timers.length; }), clearTimeout: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("simplified add-on explicit submission", () => {
  it("uses saved server data immediately without fetching all checklist records again", () => {
    const fetch = acceptFetch();
    const tree = render();
    expect(findElement(tree, (element) => element.type === AddOnQuickOrder)?.props.disabled).toBe(false);
    expect(currentState().food.wings.quantity).toBe("2");
    expect(hooks.states[2][77].updatedAt).toBe("2026-11-03T15:00:00Z");
    hooks.effects[2]();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a newer cross-tab record when a slower read or navigation snapshot arrives", async () => {
    const initial = initialRecord(event);
    const newest = { ...initial, bwa: "Newer staff", updatedAt: "2026-11-03T15:02:00Z" };
    const older = { ...initial, bwa: "Older staff", updatedAt: "2026-11-03T15:01:00Z" };
    const fetch = vi.fn().mockResolvedValue(Response.json({ records: [older] }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("document", { visibilityState: "visible" });
    const listeners = new Map<string, (event?: Event) => Promise<void> | void>();
    Object.assign(window, { addEventListener: (name: string, listener: (event?: Event) => Promise<void> | void) => listeners.set(name, listener), setInterval: vi.fn() });

    render();
    hooks.effects[0]();
    hooks.effects.at(-1)!();
    const pending = listeners.get("focus")!();
    listeners.get("event-host:workspace-updated")!({ detail: { record: newest } } as CustomEvent);
    await pending;
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/checklists?eventId=77", { cache: "no-store" });
    expect(currentState().bwa).toBe("Newer staff");

    initialRecords = [older];
    render();
    hooks.effects[2]();
    expect(currentState().bwa).toBe("Newer staff");
    expect(hooks.states[2][77].updatedAt).toBe(newest.updatedAt);
  });

  it("retains a local draft and blocks a tab switch while its autosave is pending", () => {
    const tree = render("checklist");
    expect(tree.props.beforeNavigate()).toBe(true);
    findElement(tree, (element) => element.props?.label === "BWA")!.props.onChange("Unsaved BWA");
    initialRecords = [{ ...initialRecord(event), bwa: "Different saved BWA", updatedAt: "2026-11-03T15:02:00Z" }];
    expect(render("checklist").props.beforeNavigate()).toBe(false);
    hooks.effects[2]();
    expect(currentState().bwa).toBe("Unsaved BWA");
    expect(treeText(render("checklist"))).toContain("Please wait for your checklist draft to save before switching tabs.");
  });

  it("asks before leaving a dirty draft that cannot currently save", () => {
    const tree = render("checklist");
    findElement(tree, (element) => element.props?.label === "BWA")!.props.onChange("Unsaved BWA");
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    Object.assign(window, { confirm });
    initialRecords = null;
    const guard = render("checklist").props.beforeNavigate;
    expect(guard()).toBe(false);
    expect(guard()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(currentState().bwa).toBe("Unsaved BWA");
  });

  it("sends the exact new keypad quantity, selected key, source and saved revision in one PUT", async () => {
    const fetch = acceptFetch(); render();
    const before = structuredClone(currentState());
    expect(await submit()).toBe("accepted");
    expect(fetch).toHaveBeenCalledOnce();
    const [path, request] = fetch.mock.calls[0];
    expect(path).toBe("/api/checklists"); expect(request.method).toBe("PUT");
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({ eventId: 77, sourceEventId: "77", eventDate: event.date, expectedUpdatedAt: "2026-11-03T15:00:00Z",
      syncFoodAddOns: true, syncFoodAddOnKeys: ["wings"], sourceType: "EVENT_HOST_ADDON", requesterName: "Brooke",
      checklist: { food: { wings: { quantity: "3", panSize: "1/2", notes: "Sauce on side" } } } });
    expect(body.checklist).toMatchObject({ bwa: before.bwa, poc: before.poc, extrasAdded: before.extrasAdded, remainingDrinkCardBalance: before.remainingDrinkCardBalance,
      tasks: before.tasks, taskEvidence: before.taskEvidence, entertainment: before.entertainment });
    expect(body.checklist.food["dessert-platter"]).toEqual(before.food["dessert-platter"]);
    expect(currentState().food.wings.quantity).toBe("3");
  });

  it("sends a single refill as REFILL and uses saved BWA when session staff is blank", async () => {
    hooks.staffName = ""; const fetch = acceptFetch();
    expect(await submit({ ...foodOrder, category: "refills", key: "appetizer-refill-tater-kegs", quantity: "10", panSize: "" })).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ sourceType: "REFILL", syncFoodAddOnKeys: ["appetizer-refill-tater-kegs"], requesterName: "Saved BWA",
      checklist: { food: { "appetizer-refill-tater-kegs": { quantity: "10" } } } });
  });

  it("does not save merely by rendering/selecting the interface and removes redundant contract/closeout panels", () => {
    const fetch = acceptFetch(); const tree = render();
    expect(fetch).not.toHaveBeenCalled(); expect(findElement(tree, (element) => element.type === AddOnQuickOrder)).not.toBeNull();
    expect(findElement(tree, (element) => element.type === "section" && element.props.className === "event-header-card")).toBeNull();
    expect(findElement(tree, (element) => element.type === "button" && /Submit Event Record|Submit Final Checklist|Save add-on draft/.test(String(element.props.children)))).toBeNull();
    expect(findElement(tree, (element) => element.type === "strong" && element.props.children === "Contracted entertainment")).toBeNull();
  });

  it("guards a second click synchronously while the first request is still running", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn((_path: string, _request: RequestInit) => new Promise<Response>((done) => { resolve = done; })); vi.stubGlobal("fetch", fetch);
    const handler = quickOrder().props.onSubmit;
    const first = handler(foodOrder); expect(await handler(foodOrder)).toBe("error");
    expect(fetch).toHaveBeenCalledOnce();
    resolve(savedResponse(JSON.parse(fetch.mock.calls[0][1].body as string))); expect(await first).toBe("accepted");
  });

  it("allows a deliberate same-quantity order after acceptance using the newly saved revision", async () => {
    const fetch = acceptFetch(); expect(await submit()).toBe("accepted"); expect(await submit()).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetch.mock.calls[0][1].body as string); const second = JSON.parse(fetch.mock.calls[1][1].body as string);
    expect(second.expectedUpdatedAt).toBe("2026-11-03T15:01:00Z");
    expect(second.checklist.food.wings.quantity).toBe(first.checklist.food.wings.quantity);
    expect(second.syncFoodAddOnKeys).toEqual(["wings"]);
  });

  it("polls pending acceptance with read-only GET and never resends", async () => {
    const fetch = vi.fn(async (path: string, request?: RequestInit) => request?.method === "PUT"
      ? savedResponse(JSON.parse(request.body as string), { status: "pending", eventId: "kitchen-77", requestIds: ["request-1"] })
      : Response.json({ status: "live", deliveries: [] })); vi.stubGlobal("fetch", fetch);
    expect(await submit()).toBe("pending");
    expect(quickOrder().props.isItemLocked("wings")).toBe(true);
    expect(await submit()).toBe("error"); expect(fetch).toHaveBeenCalledOnce();
    render(); hooks.effects[1](); expect(hooks.timers).toHaveLength(1); await hooks.timers[0]();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/kitchen/events/kitchen-77/food-delivery?requestIds=request-1");
    expect(fetch.mock.calls[1][1]).toEqual({ cache: "no-store" });
    expect(quickOrder().props.isItemLocked("wings")).toBe(false);
  });

  it("keeps a lost-response order locked, without resetting saved quantities or retrying", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("Lost response")); vi.stubGlobal("fetch", fetch); render();
    const before = structuredClone(currentState());
    expect(await submit()).toBe("uncertain"); expect(quickOrder().props.isItemLocked("wings")).toBe(true);
    expect(await submit()).toBe("error"); expect(fetch).toHaveBeenCalledOnce(); expect(currentState()).toEqual(before);
  });

  it("retains and blocks a stale draft on 409 rather than overwriting or retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "A newer record exists" }, { status: 409 })); vi.stubGlobal("fetch", fetch); render();
    const before = structuredClone(currentState());
    expect(await submit()).toBe("error"); expect(await submit()).toBe("error");
    expect(fetch).toHaveBeenCalledOnce(); expect(currentState()).toEqual(before); expect(quickOrder().props.disabled).toBe(true);
  });

  it.each([{ eventId: 999 }, { eventDate: "2026-11-04" }, { status: "submitted" }, { updatedAt: null }])("rejects an unverified success response: %o", async (changed) => {
    const fetch = vi.fn(async (_path: string, request: RequestInit) => {
      const response = await savedResponse(JSON.parse(request.body as string)).json(); return Response.json({ ...response, record: { ...response.record, ...changed } });
    }); vi.stubGlobal("fetch", fetch); render(); const before = structuredClone(currentState());
    expect(await submit()).toBe("uncertain"); expect(currentState()).toEqual(before); expect(quickOrder().props.isItemLocked("wings")).toBe(true);
  });

  it("increments entertainment record totals without dispatching food or creating reservations", async () => {
    const fetch = acceptFetch();
    const order: QuickOrderInput = { ...foodOrder, category: "entertainment", key: "mini-golf", quantity: "20", panSize: "", notes: "" };
    expect(await submit(order)).toBe("accepted");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.checklist.entertainment["mini-golf"].quantity).toBe("25"); expect(body.syncFoodAddOns).toBe(false);
    expect(body).not.toHaveProperty("syncFoodAddOnKeys"); expect(body).not.toHaveProperty("sourceType");
    expect(currentState().food.wings.quantity).toBe("2"); expect(fetch).toHaveBeenCalledOnce();
  });

  it("keeps fractional-hour entertainment quantities exact", async () => {
    const fetch = acceptFetch();
    expect(await submit({ ...foodOrder, category: "entertainment", key: "bowling", quantity: "1.5", notes: "", panSize: "" })).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).checklist.entertainment.bowling.quantity).toBe("1.5");
  });

  it("does not reprice saved drink cards when a new submission requests a different price", async () => {
    const fetch = acceptFetch(); render();
    currentState().entertainment["prepaid-drink-cards"] = { quantity: "5", manualPrice: "20", selectedRateKey: "" };
    const order: QuickOrderInput = { ...foodOrder, category: "entertainment", key: "prepaid-drink-cards", quantity: "5", manualPrice: "10", panSize: "", notes: "", selectedRateKey: "" };
    expect(await submit(order)).toBe("error"); expect(fetch).not.toHaveBeenCalled();
    expect(currentState().entertainment["prepaid-drink-cards"]).toEqual({ quantity: "5", manualPrice: "20", selectedRateKey: "" });
    expect(quickOrder().props.errorMessage).toMatch(/price|rate/i);
  });

  it("adds more drink cards at the saved price without changing the previous charges", async () => {
    const fetch = acceptFetch(); render();
    currentState().entertainment["prepaid-drink-cards"] = { quantity: "5", manualPrice: "20", selectedRateKey: "" };
    expect(await submit({ ...foodOrder, category: "entertainment", key: "prepaid-drink-cards", quantity: "5", manualPrice: "20", panSize: "", notes: "", selectedRateKey: "" })).toBe("accepted");
    const body = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(body.checklist.entertainment["prepaid-drink-cards"]).toEqual({ quantity: "10", manualPrice: "20", selectedRateKey: "" });
    expect(body.syncFoodAddOns).toBe(false); expect(body).not.toHaveProperty("syncFoodAddOnKeys");
    expect(quickOrder().props.existingEntertainment["prepaid-drink-cards"]).toEqual({ quantity: "10", manualPrice: "20", selectedRateKey: "" });
  });

  it.each([
    ["0.5", "0.25", "0.75"],
    ["0.1", "0.2", "0.3"],
  ])("preserves exact purchased hours when adding %s + %s", async (previous, added, total) => {
    const fetch = acceptFetch(); render();
    currentState().entertainment.bowling.quantity = previous;
    expect(await submit({ ...foodOrder, category: "entertainment", key: "bowling", quantity: added, notes: "", panSize: "" })).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).checklist.entertainment.bowling.quantity).toBe(total);
  });

  it("shows an actionable saved-record load error instead of leaving silently disabled controls", () => {
    const fetch = acceptFetch(); initialRecords = null;
    const tree = render(); expect(quickOrder().props.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
    const alert = findElement(tree, (element) => element.props?.role === "alert" && /load|unavailable/i.test(treeText(element)));
    expect(alert).not.toBeNull();
    const reload = findElement(alert, (element) => element.type === "button" && /reload|try again/i.test(treeText(element)))!;
    expect(reload).not.toBeNull(); reload.props.onClick(); expect(window.location.reload).toHaveBeenCalledOnce();
  });

  it("remounts keypad scope for the selected party and preserves its exact VIP source identity", async () => {
    const fetch = acceptFetch(); const first = quickOrder(); expect(first.key).toBe("77:2026-11-03");
    const button = findElement(render(), (element) => element.type === "button" && findElement(element.props.children, (child) => child.type === "span" && child.props.children === otherEvent.name) !== null)!;
    button.props.onClick(); const selected = quickOrder(); expect(selected.key).toBe("88:2026-11-03");
    expect(await selected.props.onSubmit(foodOrder)).toBe("accepted");
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ eventId: 88, sourceEventId: "vip-redacted-booking", eventDate: event.date });
    expect(currentState(77).food.wings.quantity).toBe("2");
  });

  it.each(["", "0", "-1", "1.5", "11", "NaN", "9007199254740992"])("never sends an invalid platter quantity %s", async (quantity) => {
    const fetch = acceptFetch(); expect(await submit({ ...foodOrder, quantity })).toBe("error"); expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send when saved records are unavailable or after submission", async () => {
    const fetch = acceptFetch(); const records = initialRecords; initialRecords = null;
    expect(await submit()).toBe("error"); initialRecords = records;
    render(); hooks.effects[2]();
    const handler = quickOrder().props.onSubmit; hooks.states[2][77].status = "submitted";
    // An old dialog callback must respect current submitted metadata as well as the visible lock.
    expect(await handler(foodOrder)).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });
});
