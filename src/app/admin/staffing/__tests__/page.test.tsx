import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasAdminSession } from "@/lib/admin-auth";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";
import { staffingSnapshotIsFresh } from "@/lib/staffing/service";
import { loadStaffingState, type StaffingState } from "@/lib/staffing/storage";
import AdminAccessGate from "../../AdminAccessGate";
import AdminStaffingPage from "../page";
import StaffingDashboard from "../StaffingDashboard";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn() }) }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession: vi.fn() }));
vi.mock("@/lib/staff-auth/protocol", () => ({ staffLoginRequired: vi.fn() }));
vi.mock("@/lib/staffing/storage", () => ({ loadStaffingState: vi.fn() }));
vi.mock("@/lib/staffing/service", () => ({ staffingSnapshotIsFresh: vi.fn() }));
vi.mock("../../AdminAccessGate", () => ({ default: () => null }));
vi.mock("../StaffingDashboard", () => ({ default: () => null }));

const state: StaffingState = {
  version: 4, reconciliation: null, keepClearEventIds: [], policy: {}, failure: null, lastAttemptAt: null,
  events: [{ eventId: "111", eventName: "Redacted event", date: "2026-11-10", startAt: null, endAt: null }],
  shifts: [{ shiftId: "1", employeeId: "2", employeeName: "Redacted employee", notes: "PRIVATE RAW SHIFT NOTE", startAt: "2026-11-10T21:00:00Z", endAt: "2026-11-11T01:00:00Z" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasAdminSession).mockReturnValue(false);
  vi.mocked(staffLoginRequired).mockReturnValue(true);
  vi.mocked(staffingSnapshotIsFresh).mockReturnValue(true);
  vi.mocked(loadStaffingState).mockResolvedValue(state);
});

describe("Admin staffing page access", () => {
  it("does not load or serialize private schedule data without Admin authorization", async () => {
    const page = await AdminStaffingPage({ searchParams: Promise.resolve({ eventId: "111", date: "2026-11-10" }) });
    expect(page.type).toBe(AdminAccessGate);
    expect(loadStaffingState).not.toHaveBeenCalled();
  });

  it("opens the requested event only for an authorized Admin and excludes raw shift notes", async () => {
    vi.mocked(hasAdminSession).mockReturnValue(true);
    const page = await AdminStaffingPage({ searchParams: Promise.resolve({ eventId: "111", date: "2026-11-10" }) });
    expect(page.type).toBe(StaffingDashboard);
    expect(page.props).toMatchObject({ initialEventId: "111", initialFresh: true, rolloutEnabled: true, initialState: { version: 4 } });
    expect(JSON.stringify(page.props)).not.toContain("PRIVATE RAW SHIFT NOTE");
    expect(staffingSnapshotIsFresh).toHaveBeenCalledWith(state, expect.any(Date));
  });

  it("shows setup state without reading private shifts in legacy mode", async () => {
    vi.mocked(hasAdminSession).mockReturnValue(true);
    vi.mocked(staffLoginRequired).mockReturnValue(false);
    const page = await AdminStaffingPage({ searchParams: Promise.resolve({}) });
    expect(page.props).toMatchObject({ initialState: null, initialFresh: false, rolloutEnabled: false });
    expect(loadStaffingState).not.toHaveBeenCalled();
  });
});
