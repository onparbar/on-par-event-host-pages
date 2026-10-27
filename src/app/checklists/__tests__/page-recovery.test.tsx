import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "../page";
import AddOnsPage from "@/app/event-host-addons/page";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: async () => ({ archivedEventIds: [] }) }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));
vi.mock("../ChecklistsClient", () => ({ default: () => null }));

const plan = { id: 77, name: "Sanitized Saturday draft", date: "2026-10-24", day: "Saturday", time: "5:00 PM - 8:00 PM", guest_count: 20,
  rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("past unfinished checklist access", () => {
  it("keeps an unfinished Saturday record available Monday without fabricating task completion", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [77] });
    const tree = await Page({ searchParams: Promise.resolve({}) });
    expect(tree.props.activeEventIds).toEqual([77]);
    expect(loadStaffEventPlans).toHaveBeenCalledWith("2026-10-26", { exactDate: false, includeUnsubmitted: true });
  });
  it("honors an explicit past date instead of removing it with today's availability filter", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [] });
    const tree = await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(tree.props.activeEventIds).toEqual([77]);
    expect(loadStaffEventPlans).toHaveBeenCalledWith(plan.date, { exactDate: true, includeUnsubmitted: true });
  });
  it("preserves current-first recovery ordering on Add-Ons instead of defaulting to the oldest saved draft", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    const current = { ...plan, id: 78, date: "2026-10-26" };
    const july = { ...plan, id: 79, date: "2026-07-30" };
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [current, plan, july], sync: null, sourceWarning: "", unfinishedEventIds: [plan.id, july.id] });
    const tree = await AddOnsPage({ searchParams: Promise.resolve({}) });
    expect(tree.props.activeEventIds).toEqual([current.id, plan.id, july.id]);
    expect(tree.props.events.map((event: typeof plan) => event.id)).toEqual([current.id, plan.id, july.id]);
  });
});
