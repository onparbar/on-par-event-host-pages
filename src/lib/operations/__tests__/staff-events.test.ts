import { describe, expect, it, vi } from "vitest";
import { loadStaffEventPlans, mergeVipStaffEventPlans } from "../staff-events";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import type { EventPlan } from "@/lib/event-plans/types";

const reservation = { ...vipPrepPayload.reservations[0], operatingDate: "2026-10-23", eventName: "Staff training", startAt: "2026-10-23T18:00:00Z", endAt: "2026-10-23T20:00:00Z" };
const plan: EventPlan = { id: 123, name: "Different corporate party", date: "2026-10-23", rooms: ["VIP 1"], time: "2:00 PM – 4:00 PM", day: "Friday", guest_count: 20, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };

describe("read-only staff event feed", () => {
  it("uses the existing stable VIP checklist identity, not its event name", () => {
    const merged = mergeVipStaffEventPlans([plan], [reservation]);
    expect(merged.find((row) => row.name.startsWith(reservation.eventName))?.id).toBe(numericVipEventId(vipPrepExternalId(reservation)));
    expect(mergeVipStaffEventPlans([], [{ ...reservation, eventName: "Renamed training" }])[0].id).toBe(numericVipEventId(vipPrepExternalId(reservation)));
  });
  it("retains corporate preparation when a same-date canonical VIP block names that event", () => {
    expect(mergeVipStaffEventPlans([{ ...plan, name: reservation.eventName }], [reservation])).toHaveLength(1);
    expect(mergeVipStaffEventPlans([{ ...plan, name: `${reservation.eventName} VIP` }], [reservation])[0].id).toBe(plan.id);
    expect(mergeVipStaffEventPlans([{ ...plan, name: reservation.eventName, date: "2026-10-24" }], [reservation])).toHaveLength(2);
  });
  it("loads the selected date without checking in VIP guests or synchronizing sources", async () => {
    const loadPlans = vi.fn().mockResolvedValue({ plans: [plan], sync: null });
    const fetchRange = vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [reservation] });
    const result = await loadStaffEventPlans("2026-10-23", { loadPlans, vipClient: { configured: true, fetchRange } });
    expect(loadPlans).toHaveBeenCalledWith({ now: new Date("2026-10-23T12:00:00Z") });
    expect(fetchRange).toHaveBeenCalledExactlyOnceWith("2026-10-23", "2026-10-23");
    expect(result.plans).toHaveLength(2);
    expect(result.sourceWarning).toBe("");
  });
  it("keeps corporate events visible with a safe warning if VIP data is unavailable", async () => {
    const result = await loadStaffEventPlans("2026-10-23", { loadPlans: vi.fn().mockResolvedValue({ plans: [plan], sync: null }), vipClient: { configured: true, fetchRange: vi.fn().mockRejectedValue(new Error("private upstream response")) } });
    expect(result.plans).toEqual([plan]);
    expect(result.sourceWarning).toContain("VIP bookings could not be refreshed");
    expect(result.sourceWarning).not.toContain("private upstream");
  });
  it("rejects invalid dates before reading either source", async () => {
    const loadPlans = vi.fn();
    const fetchRange = vi.fn();
    await expect(loadStaffEventPlans("2026-02-30", { loadPlans, vipClient: { configured: true, fetchRange } })).rejects.toThrow("valid YYYY-MM-DD");
    expect(loadPlans).not.toHaveBeenCalled();
    expect(fetchRange).not.toHaveBeenCalled();
  });
});
