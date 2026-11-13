import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "../page";
import AddOnsPage from "@/app/event-host-addons/page";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { loadStaffingPrefills } from "@/lib/staffing/service";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import { defaultChecklistState, type ChecklistRecord } from "@/lib/checklist-model";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: async () => ({ archivedEventIds: [] }) }));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: vi.fn(() => false), requiresStrongAdminSession: vi.fn(() => false) }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));
vi.mock("@/lib/staffing/service", () => ({ loadStaffingPrefills: vi.fn(async () => ({})) }));
vi.mock("../ChecklistsClient", () => ({ default: () => null }));

const plan = { id: 77, name: "Sanitized Saturday draft", date: "2026-10-24", day: "Saturday", time: "5:00 PM - 8:00 PM", guest_count: 20,
  rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };
const record: ChecklistRecord = { ...defaultChecklistState(plan.date), eventId: plan.id, eventName: plan.name, eventDate: plan.date, poc: "",
  status: "draft", updatedAt: "2026-10-24T20:00:00Z", submittedAt: null };
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("past unfinished checklist access", () => {
  it("keeps an unfinished Saturday record available Monday without fabricating task completion", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [77], savedChecklistRecords: [record] });
    const tree = await Page({ searchParams: Promise.resolve({}) });
    expect(tree.props.activeEventIds).toEqual([77]);
    expect(tree.props.initialRecords).toEqual([record]);
    expect(loadStaffEventPlans).toHaveBeenCalledWith("2026-10-26", { exactDate: false, includeUnsubmitted: true });
  });
  it("honors an explicit past date instead of removing it with today's availability filter", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [], savedChecklistRecords: [] });
    const tree = await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(tree.props.activeEventIds).toEqual([77]);
    expect(tree.props.initialRecords).toEqual([]);
    expect(loadStaffEventPlans).toHaveBeenCalledWith(plan.date, { exactDate: true, includeUnsubmitted: true });
  });
  it("passes exact event date and times and does not request a prefill when a saved checklist already exists", async () => {
    vi.mocked(requiresStrongAdminSession).mockReturnValueOnce(true);
    vi.mocked(hasAdminSession).mockReturnValueOnce(true);
    vi.useFakeTimers(); vi.setSystemTime("2026-10-24T16:00:00Z");
    const second = { ...plan, id: 78, source_event_id: "10078" };
    vi.mocked(loadStaffEventPlans).mockResolvedValue({
      plans: [plan, second], sync: null, sourceWarning: "", unfinishedEventIds: [], savedChecklistRecords: [{ ...record, bwa: "" }],
    });
    vi.mocked(loadStaffingPrefills).mockResolvedValueOnce({ "10078": ["Assigned Employee"] });
    const tree = await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(loadStaffingPrefills).toHaveBeenCalledExactlyOnceWith([
      { eventId: "10078", date: plan.date, startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T00:00:00.000Z" },
    ], { allowAdminPreview: true });
    expect(tree.props.staffingPrefills).toEqual({ "10078": ["Assigned Employee"] });
    expect(tree.props.initialRecords[0].bwa).toBe("");
  });
  it("leaves a checklist available without suggestions when staffing reads fail", async () => {
    vi.mocked(requiresStrongAdminSession).mockReturnValueOnce(true);
    vi.mocked(hasAdminSession).mockReturnValueOnce(true);
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [], savedChecklistRecords: [] });
    vi.mocked(loadStaffingPrefills).mockRejectedValueOnce(new Error("Unavailable"));
    const tree = await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(tree.props.staffingPrefills).toEqual({});
    expect(tree.props.activeEventIds).toEqual([77]);
  });
  it("only requests standalone Admin staffing access once the strong session is verified", async () => {
    vi.mocked(requiresStrongAdminSession).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(hasAdminSession).mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [plan], sync: null, sourceWarning: "", unfinishedEventIds: [], savedChecklistRecords: [] });
    await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(loadStaffingPrefills).not.toHaveBeenCalled();
    await Page({ searchParams: Promise.resolve({ date: plan.date }) });
    expect(loadStaffingPrefills).toHaveBeenLastCalledWith(expect.any(Array), { allowAdminPreview: true });
  });
  it("preserves current-first recovery ordering on Add-Ons instead of defaulting to the oldest saved draft", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-10-26T16:00:00Z");
    const current = { ...plan, id: 78, date: "2026-10-26" };
    const july = { ...plan, id: 79, date: "2026-07-30" };
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [current, plan, july], sync: null, sourceWarning: "", unfinishedEventIds: [plan.id, july.id], savedChecklistRecords: [record] });
    const tree = await AddOnsPage({ searchParams: Promise.resolve({}) });
    expect(tree.props.activeEventIds).toEqual([current.id, plan.id, july.id]);
    expect(tree.props.initialRecords).toEqual([record]);
    expect(tree.props.events.map((event: typeof plan) => event.id)).toEqual([current.id, plan.id, july.id]);
  });
});
