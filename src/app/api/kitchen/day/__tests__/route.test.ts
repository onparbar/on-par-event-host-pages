import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

const { getKitchenDay, listEventFoodDelivery, listVipCheckinsForDate, vipFoodReleaseState, confirmVipArrival, processGoTabDispatches } = vi.hoisted(() => ({
  getKitchenDay: vi.fn(), listEventFoodDelivery: vi.fn(), listVipCheckinsForDate: vi.fn(), vipFoodReleaseState: vi.fn(), confirmVipArrival: vi.fn(), processGoTabDispatches: vi.fn(),
}));
vi.mock("@/lib/kitchen/sync", () => ({ getKitchenDay, assertKitchenDate: (date: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date"); } }));
vi.mock("@/lib/gotab/storage", () => ({ GoTabIntegrationStorage: class { listEventFoodDelivery = listEventFoodDelivery; listVipCheckinsForDate = listVipCheckinsForDate; } }));
vi.mock("@/lib/vip-checkin/service", () => ({ vipFoodReleaseState, confirmVipArrival }));
vi.mock("@/lib/gotab/worker", () => ({ processGoTabDispatches }));
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
