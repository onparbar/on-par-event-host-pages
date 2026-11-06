import { afterEach, describe, expect, it, vi } from "vitest";
import SetupPage from "../page";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { loadAdminState } from "@/lib/admin-state";

vi.mock("@/lib/admin-state", () => ({ loadAdminState: vi.fn(async () => ({ archivedEventIds: [] as number[] })) }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));
vi.mock("../SetupClient", () => ({ default: () => null }));
const event = { id: 77, name: "Redacted event", date: "2026-11-03", day: "Tuesday", time: "5:30 PM - 8:30 PM", guest_count: 17,
  rooms: ["VIP 1"], color: "#18332F", food: ["17 × The Full Course + Taco Bar"], drink_options: [], entertainment: [], verification_status: "Verified" };
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("Set Up event feed", () => {
  it("loads the current Eastern date without running a sync or dispatch action", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-11-04T02:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [
      { ...event, id: 76, date: "2026-11-02" }, event, { ...event, id: 79, date: "2026-11-04" },
    ], sync: null, sourceWarning: "", unfinishedEventIds: [] });
    const tree = await SetupPage({ searchParams: Promise.resolve({}) });
    expect(loadStaffEventPlans).toHaveBeenCalledWith("2026-11-03", { exactDate: true });
    expect(tree.props.events).toEqual([event]);
    expect(tree.props.date).toBe("2026-11-03");
  });
  it("advances to the next Eastern day at local midnight and does not reuse yesterday's party", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-11-04T05:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [event], sync: null, sourceWarning: "", unfinishedEventIds: [] });
    const tree = await SetupPage({ searchParams: Promise.resolve({}) });
    expect(loadStaffEventPlans).toHaveBeenCalledExactlyOnceWith("2026-11-04", { exactDate: true });
    expect(tree.props.date).toBe("2026-11-04");
    expect(tree.props.events).toEqual([]);
  });
  it("honors an explicit valid date, filters archived events and retains source warnings", async () => {
    vi.mocked(loadAdminState).mockResolvedValue({ archivedEventIds: [78] } as Awaited<ReturnType<typeof loadAdminState>>);
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [event, { ...event, id: 78 }], sync: null, sourceWarning: "Source warning retained", unfinishedEventIds: [] });
    const tree = await SetupPage({ searchParams: Promise.resolve({ date: "2026-11-03" }) });
    expect(loadStaffEventPlans).toHaveBeenCalledWith("2026-11-03", { exactDate: true });
    expect(tree.props.events.map((item: typeof event) => item.id)).toEqual([77]);
    expect(tree.props.sourceWarning).toBe("Source warning retained");
    expect(tree.props.date).toBe("2026-11-03");
  });
  it.each(["2026-10-31", "2026-12-18", "2027-01-01"])("can browse another day, including an empty day: %s", async (date) => {
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [], sync: null, sourceWarning: "", unfinishedEventIds: [] });
    const tree = await SetupPage({ searchParams: Promise.resolve({ date }) });
    expect(loadStaffEventPlans).toHaveBeenCalledExactlyOnceWith(date, { exactDate: true });
    expect(tree.props.date).toBe(date);
    expect(tree.props.events).toEqual([]);
  });
  it("does not pass an invalid date to the source loader", async () => {
    vi.useFakeTimers(); vi.setSystemTime("2026-11-03T17:00:00Z");
    vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [], sync: null, sourceWarning: "", unfinishedEventIds: [] });
    const tree = await SetupPage({ searchParams: Promise.resolve({ date: "2026-02-30" }) });
    expect(loadStaffEventPlans).toHaveBeenCalledWith("2026-11-03", { exactDate: true });
    expect(tree.props.date).toBe("2026-11-03");
  });
});
