import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

const { getKitchenDay, listEventFoodDelivery, listVipCheckinsForDate, vipFoodReleaseState, confirmVipArrival, processGoTabDispatches, loadStaffingPrefills, strongAdmin, adminSession } = vi.hoisted(() => ({
  getKitchenDay: vi.fn(), listEventFoodDelivery: vi.fn(), listVipCheckinsForDate: vi.fn(), vipFoodReleaseState: vi.fn(), confirmVipArrival: vi.fn(), processGoTabDispatches: vi.fn(), loadStaffingPrefills: vi.fn(), strongAdmin: vi.fn(() => false), adminSession: vi.fn(() => false),
}));
vi.mock("@/lib/kitchen/sync", () => ({ getKitchenDay, assertKitchenDate: (date: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date"); } }));
vi.mock("@/lib/gotab/storage", () => ({ GoTabIntegrationStorage: class { listEventFoodDelivery = listEventFoodDelivery; listVipCheckinsForDate = listVipCheckinsForDate; } }));
vi.mock("@/lib/vip-checkin/service", () => ({ vipFoodReleaseState, confirmVipArrival }));
vi.mock("@/lib/gotab/worker", () => ({ processGoTabDispatches }));
vi.mock("@/lib/staffing/service", () => ({ loadStaffingPrefills }));
vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("@/lib/admin-auth", () => ({ requiresStrongAdminSession: strongAdmin, hasAdminSession: adminSession }));
import { GET } from "../route";

describe("kitchen VIP arrival projection is read-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const booking = structuredClone(vipPrepPayload.reservations[0]);
    booking.status = "checked_in";
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([booking])[0]);
    getKitchenDay.mockResolvedValue({ date: "2026-08-15", events: [checklist], warnings: [] });
    listEventFoodDelivery.mockResolvedValue([]);
    listVipCheckinsForDate.mockResolvedValue([]);
  });

  it("does not treat external checked_in as Event Host arrival or submit food during repeated refreshes", async () => {
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const response = await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.events[0].vipArrival).toEqual({ checkedInAt: null, checkedInBy: null, foodStatus: "NOT_CHECKED_IN", scheduledReleaseAt: null, itemIssues: [] });
    }
    expect(vipFoodReleaseState).not.toHaveBeenCalled();
    expect(confirmVipArrival).not.toHaveBeenCalled();
    expect(processGoTabDispatches).not.toHaveBeenCalled();
  });

  it("shows actual checked-in employee and partial release facts without creating or retrying a dispatch", async () => {
    listVipCheckinsForDate.mockResolvedValue([{ event_id: "vip-reservation-uuid", reservation_id: "reservation-uuid", employee_name: "Lex", checked_in_at: "2026-08-15T20:00:00Z" }]);
    vipFoodReleaseState.mockResolvedValue({ foodStatus: "FOOD_PARTIAL", scheduledReleaseAt: "2026-08-15T21:15:00Z", itemIssues: ["Mozzarella Sticks: held; review mapping."] });
    const body = await (await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"))).json();
    expect(body.events[0].vipArrival).toEqual({ checkedInAt: "2026-08-15T20:00:00Z", checkedInBy: "Lex", foodStatus: "FOOD_PARTIAL", scheduledReleaseAt: "2026-08-15T21:15:00Z", itemIssues: ["Mozzarella Sticks: held; review mapping."] });
    expect(vipFoodReleaseState).toHaveBeenCalledTimes(1);
    expect(vipFoodReleaseState.mock.calls[0][2]).toMatchObject({ id: "reservation-uuid", foodPrep: vipPrepPayload.reservations[0].foodPrep });
    expect(confirmVipArrival).not.toHaveBeenCalled();
    expect(processGoTabDispatches).not.toHaveBeenCalled();
  });

  it("does not claim arrival or release when the Event Host status lookup is unavailable", async () => {
    listVipCheckinsForDate.mockRejectedValue(new Error("private database detail"));
    const body = await (await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"))).json();
    expect(body.events[0].vipArrival.foodStatus).toBe("STATUS_UNAVAILABLE");
    expect(body.events[0].vipArrival.itemIssues).toContain("Event Host check-in status could not be verified. No food release is implied.");
    expect(JSON.stringify(body)).not.toContain("private database detail");
    expect(vipFoodReleaseState).not.toHaveBeenCalled();
  });
});

describe("kitchen event staffing display defaults", () => {
  const event = { eventId: "42", localDate: "2026-08-15", startTime: "2026-08-15T20:00:00Z", endTime: "2026-08-15T23:00:00Z" };
  const checklist = { event, foodRunnerOrBwa: "", foodRunners: [], assignmentUpdatedAt: null };

  beforeEach(() => {
    vi.clearAllMocks();
    getKitchenDay.mockResolvedValue({ date: "2026-08-15", events: [
      checklist,
      { ...checklist, event: { ...event, eventId: "43" }, foodRunners: ["Saved Runner"] },
      { ...checklist, event: { ...event, eventId: "44" }, assignmentUpdatedAt: "2026-08-15T19:00:00Z" },
    ], warnings: [] });
    listEventFoodDelivery.mockResolvedValue([]);
    loadStaffingPrefills.mockResolvedValue({ "42": ["Sample Staff A", "Sample Staff B"], "43": ["Ignored"], "44": ["Ignored"] });
  });

  it("projects the exact event's names without altering the saved field or an explicit blank", async () => {
    strongAdmin.mockReturnValueOnce(true);
    adminSession.mockReturnValueOnce(true);
    const response = await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"));
    const payload = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(loadStaffingPrefills).toHaveBeenCalledExactlyOnceWith([
      { eventId: "42", date: event.localDate, startAt: event.startTime, endAt: event.endTime },
    ], { allowAdminPreview: true });
    expect(payload.events[0]).toMatchObject({ foodRunnerOrBwa: "", foodRunners: [], staffingFoodRunners: ["Sample Staff A", "Sample Staff B"] });
    expect(payload.events[1]).toMatchObject({ foodRunners: ["Saved Runner"] });
    expect(payload.events[1]).not.toHaveProperty("staffingFoodRunners");
    expect(payload.events[2]).not.toHaveProperty("staffingFoodRunners");
    expect(checklist).not.toHaveProperty("staffingFoodRunners");
  });

  it("leaves the kitchen day available when the optional staffing lookup fails", async () => {
    strongAdmin.mockReturnValueOnce(true);
    adminSession.mockReturnValueOnce(true);
    loadStaffingPrefills.mockRejectedValueOnce(new Error("Internal failure"));
    const response = await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"));
    expect(response.status).toBe(200);
    expect((await response.json()).events[0]).toEqual(checklist);
  });

  it("does not access or return staffing without a verified strong Admin session", async () => {
    strongAdmin.mockReturnValueOnce(true);
    const body = await (await GET(new Request("https://example.test/api/kitchen/day?date=2026-08-15"))).json();
    expect(body.events[0]).toEqual(checklist);
    expect(loadStaffingPrefills).not.toHaveBeenCalled();
  });
});
