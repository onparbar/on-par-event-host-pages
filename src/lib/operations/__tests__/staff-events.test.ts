import { describe, expect, it, vi } from "vitest";
import { loadStaffEventPlans, mergeVipStaffEventPlans } from "../staff-events";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import type { EventPlan } from "@/lib/event-plans/types";
import { operationalEventFromPlan } from "../event-context";
import { buildOperationalEventSummaries } from "../command-center";

const reservation = { ...vipPrepPayload.reservations[0], operatingDate: "2026-10-23", eventName: "Staff training", startAt: "2026-10-23T18:00:00Z", endAt: "2026-10-23T20:00:00Z" };
const plan: EventPlan = { id: 123, name: "Different corporate party", date: "2026-10-23", rooms: ["VIP 1"], time: "2:00 PM – 4:00 PM", day: "Friday", guest_count: 20, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };

describe("read-only staff event feed", () => {
  it("uses the existing stable VIP checklist identity, not its event name", () => {
    const merged = mergeVipStaffEventPlans([plan], [reservation]);
    expect(merged.find((row) => row.name.startsWith(reservation.eventName))?.id).toBe(numericVipEventId(vipPrepExternalId(reservation)));
    expect(operationalEventFromPlan(merged.find((row) => row.source_event_id)!).eventId).toBe(vipPrepExternalId(reservation));
    expect(mergeVipStaffEventPlans([], [{ ...reservation, eventName: "Renamed training" }])[0].id).toBe(numericVipEventId(vipPrepExternalId(reservation)));
  });
  it("retains both sources with the same name, including verified links without purchased-item equivalence", () => {
    expect(mergeVipStaffEventPlans([{ ...plan, name: reservation.eventName }], [reservation])).toHaveLength(2);
    expect(mergeVipStaffEventPlans([{ ...plan, name: `${reservation.eventName} VIP` }], [reservation])).toHaveLength(2);
    expect(mergeVipStaffEventPlans([{ ...plan, name: reservation.eventName, date: "2026-10-24" }], [reservation])).toHaveLength(2);
    const linked = mergeVipStaffEventPlans([{ ...plan, food: ["Corporate source food"] }], [{ ...reservation, linkedTripleseatEventIds: [String(plan.id)] }]);
    expect(linked).toHaveLength(2);
    expect(linked.flatMap((item) => item.food)).toContain("Corporate source food");
    expect(linked.find((item) => item.source_event_id === vipPrepExternalId(reservation))?.food).toEqual(reservation.foodPrep.map((item) => `${item.quantity} ${item.label}`));
  });
  it("includes active no-food VIPs but not cancelled or known inactive cached reservations", () => {
    const merged = mergeVipStaffEventPlans([], [
      { ...reservation, foodPrep: [] }, { ...reservation, id: "cancelled", status: "cancelled" },
      { ...reservation, id: "canceled", status: "canceled" }, { ...reservation, id: "inactive", activeInSource: false },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source_event_id).toBe(vipPrepExternalId(reservation));
    expect(merged[0].food).toEqual([]);
  });
  it("fails closed for colliding numeric selectors instead of coalescing parties or attaching another source's staff record", async () => {
    const reservations = ["test-h4l720-hfbtsa", "test-1k212gj-1rfricb"].map((id) => ({ ...reservation, id }));
    expect(mergeVipStaffEventPlans([], reservations)).toEqual([]);
    const corporate = { ...plan, id: 527983760 };
    expect(mergeVipStaffEventPlans([corporate], [reservations[0]])).toEqual([]);
    const loadPlans = vi.fn().mockResolvedValue({ plans: [corporate], sync: null });
    const result = await loadStaffEventPlans("2026-10-23", { loadPlans, vipClient: { configured: true,
      fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations }) } });
    expect(result.plans).toEqual([]);
    expect(result.sourceWarning).toContain("No parties were merged");
    expect(result.sourceWarning).toContain("source reservation ID");
    const summaries = buildOperationalEventSummaries(reservations.map((item) => ({ ...plan, id: 527983760, source_event_id: vipPrepExternalId(item) })), [
      { eventId: 527983760, eventDate: plan.date, status: "submitted", tasks: {}, bwa: "Different source staff" },
    ], null);
    expect(summaries.map((item) => item.event.eventId)).toEqual(reservations.map(vipPrepExternalId));
    for (const summary of summaries) {
      expect(summary.checklistStatus).toBe("unavailable");
      expect(summary.hostAssigned).toBe(false);
      expect(summary.attention.join(" ")).toContain("ambiguous");
    }
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
