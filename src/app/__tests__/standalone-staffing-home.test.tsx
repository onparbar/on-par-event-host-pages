import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStaffingCards } from "@/lib/staffing/service";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { EventCommandCenter } from "../_components/EventCommandCenter";
import HomePage from "../page";

vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: vi.fn(), requiresStrongAdminSession: vi.fn() }));
vi.mock("@/lib/admin-state", () => ({ loadAdminState: vi.fn(async () => ({ archivedEventIds: [] })) }));
vi.mock("@/lib/checklist-storage", () => ({ listChecklistRecords: vi.fn(async () => []) }));
vi.mock("@/lib/staffing/service", () => ({ loadStaffingCards: vi.fn() }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T18:00:00Z"));
  const event = {
    id: 41, name: "Reviewed team event", date: "2026-11-13", day: "Friday", time: "5:00 PM – 8:00 PM", guest_count: 10,
    rooms: ["Main room"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified",
  };
  vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [event, { ...event, id: 42, source_event_id: "vip-42" }], sync: null,
    unfinishedEventIds: [], sourceWarning: "" });
  vi.mocked(loadStaffingCards).mockResolvedValue({ "2026-11-13:41": { names: ["Assigned Staff"], status: "review" } });
});
afterEach(() => vi.useRealTimers());

async function homeStaffing() {
  const page = await HomePage({ searchParams: Promise.resolve({}) });
  return (page.props.children.find((child: unknown) => isValidElement(child) && child.type === EventCommandCenter) as ReactElement<{ staffingByEvent: object }>).props.staffingByEvent;
}

describe("standalone home staffing privacy", () => {
  it("does not read or disclose staffing on the legacy homepage, even with a legacy Admin cookie", async () => {
    vi.mocked(hasAdminSession).mockReturnValue(true);
    expect(await homeStaffing()).toEqual({});
    vi.mocked(requiresStrongAdminSession).mockReturnValue(true);
    vi.mocked(hasAdminSession).mockReturnValue(false);
    expect(await homeStaffing()).toEqual({});
    expect(loadStaffingCards).not.toHaveBeenCalled();
  });

  it("projects exact non-VIP date and timing only for a verified staffing Admin", async () => {
    vi.mocked(requiresStrongAdminSession).mockReturnValue(true);
    vi.mocked(hasAdminSession).mockReturnValue(true);
    expect(await homeStaffing()).toEqual({ "2026-11-13:41": { names: ["Assigned Staff"], status: "review" } });
    expect(loadStaffingCards).toHaveBeenCalledExactlyOnceWith([{
      eventId: "41", date: "2026-11-13", startAt: "2026-11-13T22:00:00.000Z", endAt: "2026-11-14T01:00:00.000Z",
    }], { now: new Date("2026-11-13T18:00:00Z"), allowAdminPreview: true });
  });
});
