import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOperationalEventSummaries } from "@/lib/operations/command-center";
import type { EventPlan } from "@/lib/event-plans/types";
import { EventCommandCenter } from "../EventCommandCenter";
import { EventStaffingPicker } from "../EventStaffingPicker";

const hooks = vi.hoisted(() => ({ index: 0, states: [] as unknown[], refIndex: 0, refs: [] as Array<{ current: unknown }> }));
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: () => {},
  useRef: (current: unknown) => {
    const index = hooks.refIndex++;
    return hooks.refs[index] ??= { current };
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next; }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("../EventContext", () => ({
  EventSelectionBridge: () => null,
  useEventContext: () => ({ preferredEventId: "501", requestedDate: "2026-11-24", selectedEvent: null, staffName: "", openStaffEvent: vi.fn() }),
}));

const plan: EventPlan = { id: 501, name: "Synthetic team event", date: "2026-11-24", rooms: ["Room 1"], time: "2:00 PM – 4:00 PM", day: "Tuesday", guest_count: 20, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };
const events = buildOperationalEventSummaries([plan, { ...plan, id: 502, name: "Other event", date: "2026-11-25" }], [], null);
const initialNow = "2026-11-23T17:00:00Z";
type Props = Parameters<typeof EventCommandCenter>[0];
type ElementProps = { children?: unknown; className?: string; "aria-label"?: string; "aria-expanded"?: boolean; "aria-controls"?: string; onClick?: (event: { currentTarget: HTMLButtonElement }) => void };

function elements(node: unknown): Array<ReactElement<ElementProps>> {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as ReactElement<ElementProps>;
  return [element, ...elements(element.props?.children)];
}
function render(props: Props) {
  hooks.index = 0;
  hooks.refIndex = 0;
  return elements(EventCommandCenter(props));
}
function action(tree: ReturnType<typeof render>) {
  return tree.find((element) => element.type === "button" && element.props["aria-label"] === "Assign Staff: Synthetic team event")!;
}

beforeEach(() => {
  hooks.index = 0; hooks.states = []; hooks.refIndex = 0; hooks.refs = [];
  navigation.push.mockReset(); navigation.refresh.mockReset();
});

describe("home Assign Staff action", () => {
  it.each(["unverified", "review", "unassigned"] as const)("opens and toggles the exact event's multi-select picker from a %s alert", (status) => {
    const props: Props = { events, initialNow, staffingByEvent: {
      "2026-11-24:501": { status, names: [] },
      "2026-11-25:502": { status: "unassigned", names: [] },
    } };
    const closed = render(props);
    expect(action(closed).props.children).toBe("Assign Staff");
    expect(action(closed).props["aria-expanded"]).toBe(false);
    expect(closed.some((element) => element.type === EventStaffingPicker)).toBe(false);
    const trigger = { focus: vi.fn() } as unknown as HTMLButtonElement;
    action(closed).props.onClick!({ currentTarget: trigger });

    const opened = render(props);
    expect(action(opened).props["aria-expanded"]).toBe(true);
    expect(action(opened).props["aria-controls"]).toBe("staffing-picker-2026-11-24-501");
    const pickers = opened.filter((element) => element.type === EventStaffingPicker);
    expect(pickers).toHaveLength(1);
    expect(pickers[0].props).toMatchObject({ id: "staffing-picker-2026-11-24-501", eventId: "501", date: "2026-11-24" });
    expect(opened.find((element) => element.props["aria-label"] === "Assign Staff: Other event")?.props["aria-expanded"]).toBe(false);

    action(opened).props.onClick!({ currentTarget: trigger });
    expect(render(props).some((element) => element.type === EventStaffingPicker)).toBe(false);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it("restores the trigger on picker close and refreshes the page only after a saved team", () => {
    const props: Props = { events, initialNow, staffingByEvent: { "2026-11-24:501": { status: "review", names: [] } } };
    const trigger = { focus: vi.fn() } as unknown as HTMLButtonElement;
    action(render(props)).props.onClick!({ currentTarget: trigger });
    const picker = render(props).find((element) => element.type === EventStaffingPicker) as ReactElement<Parameters<typeof EventStaffingPicker>[0]>;
    expect(navigation.refresh).not.toHaveBeenCalled();
    picker.props.onSaved();
    expect(navigation.refresh).toHaveBeenCalledOnce();
    picker.props.onClose();
    expect(render(props).some((element) => element.type === EventStaffingPicker)).toBe(false);
    expect(trigger.focus).toHaveBeenCalledOnce();
  });

  it("does not show Assign Staff for assigned, disabled-staffing, or VIP Shift Lead cards", () => {
    const vip = buildOperationalEventSummaries([{ ...plan, id: 503, source_event_id: "vip-503" }], [], null);
    const props: Props = { events: [...events, ...vip], initialNow, staffingByEvent: {
      "2026-11-24:501": { status: "assigned", names: [] },
      "2026-11-24:vip-503": { status: "unverified", names: ["Private name"] },
    } };
    const tree = render(props);
    expect(tree.some((element) => element.props.className === "event-command-staffing-alert")).toBe(false);
    expect(tree.some((element) => Array.isArray(element.props.children) && element.props.children.includes("Shift Lead"))).toBe(true);
    expect(tree.some((element) => Array.isArray(element.props.children) && element.props.children.includes("Private name"))).toBe(false);
  });
});
