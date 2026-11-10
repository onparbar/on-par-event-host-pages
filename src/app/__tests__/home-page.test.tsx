import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { EventPlan } from "@/lib/event-plans/types";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { loadStaffingCards } from "@/lib/staffing/service";
import { EventCommandCenter } from "../_components/EventCommandCenter";
import HomePage from "../page";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: async () => ({ archivedEventIds: [15] }) }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));
vi.mock("@/lib/staffing/service", () => ({ loadStaffingCards: vi.fn() }));
vi.mock("@/lib/checklist-storage", () => ({ listChecklistRecords: async () => [] }));
vi.mock("../_components/EventCommandCenter", () => ({ EventCommandCenter: () => null }));

const plan: EventPlan = { id: 11, name: "Redacted event", date: "2026-10-31", day: "Saturday",
  rooms: ["VIP 1"], time: "6:00 PM – 8:00 PM", guest_count: 25, color: "#18332F", food: [],
  drink_options: [], entertainment: [], verification_status: "Needs Review", needs_review: true };
const lastDay = { ...plan, id: 12, source_event_id: "vip-redacted-12", date: "2026-11-06" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime("2026-11-01T03:30:00Z");
  vi.mocked(loadStaffEventPlans).mockResolvedValue({
    plans: [plan, lastDay, { ...plan, id: 13, date: "2026-11-07" }, { ...plan, id: 14, date: "2026-10-30" }, { ...plan, id: 15 }],
    sync: null, unfinishedEventIds: [], sourceWarning: "",
  });
});
afterEach(() => vi.useRealTimers());

async function commandProps(date?: string) {
  const page = await HomePage({ searchParams: Promise.resolve({ date }) });
  return (page.props.children.find((node: unknown) => isValidElement(node) && node.type === EventCommandCenter) as ReactElement<Record<string, unknown>>).props;
}

describe("Choose Your Event server data", () => {
  it("loads the Eastern seven-day view and serializes only safe staffing and card data", async () => {
    vi.mocked(loadStaffingCards).mockResolvedValue({
      "11": { status: "assigned", names: ["Redacted Employee"], adminReason: "PRIVATE MATCH DETAILS" },
      "vip-redacted-12": { status: "review", names: [], adminReason: "PRIVATE MATCH DETAILS" },
      "15": { status: "unassigned", names: [] },
    } as Awaited<ReturnType<typeof loadStaffingCards>>);
    const props = await commandProps();
    expect(loadStaffEventPlans).toHaveBeenCalledExactlyOnceWith("2026-10-31", { includeUpcomingVip: true, throughDate: "2026-11-06" });
    expect(loadStaffingCards).toHaveBeenCalledExactlyOnceWith([
      { eventId: "11", date: "2026-10-31", startAt: "2026-10-31T22:00:00.000Z", endAt: "2026-11-01T00:00:00.000Z" },
      { eventId: "vip-redacted-12", date: "2026-11-06", startAt: "2026-11-06T23:00:00.000Z", endAt: "2026-11-07T01:00:00.000Z" },
    ], { now: new Date("2026-11-01T03:30:00Z") });
    expect(props.staffingByEvent).toEqual({
      "11": { status: "assigned", names: ["Redacted Employee"] },
      "vip-redacted-12": { status: "review", names: [] },
    });
    expect(JSON.stringify(props)).not.toMatch(/PRIVATE MATCH DETAILS|Contract needs review|hostAssigned|attention/i);
    expect(props.events).toHaveLength(2);
  });

  it("does not treat a failed staffing read as confirmed absence", async () => {
    vi.mocked(loadStaffingCards).mockRejectedValue(new Error("PRIVATE FAILED-SYNC DETAIL"));
    const props = await commandProps();
    expect(props.staffingByEvent).toEqual({});
    expect(props.events).toHaveLength(2);
    expect(JSON.stringify(props)).not.toContain("PRIVATE FAILED-SYNC DETAIL");
  });
});
