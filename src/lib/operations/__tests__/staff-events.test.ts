import { describe, expect, it, vi } from "vitest";
import { loadStaffEventPlans, mergeVipStaffEventPlans } from "../staff-events";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import type { EventPlan } from "@/lib/event-plans/types";
import { operationalEventFromPlan } from "../event-context";
import { buildOperationalEventSummaries } from "../command-center";
import { createMemoryEventPlanStorage } from "@/lib/event-plans/storage";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import { defaultChecklistState, type ChecklistRecord } from "@/lib/checklist-model";

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
  it("hides only exact December 2026 internal holds while preserving customer evidence and corporate events", async () => {
    const hold = { ...reservation, id: "internal-hold", operatingDate: "2026-12-02", eventName: "VIP unavailable VIP", foodPrep: [], extras: [] };
    const retained = [
      { ...hold, id: "similar-name", eventName: "VIP unavailable birthday" },
      { ...hold, id: "november", operatingDate: "2026-11-02" },
      { ...hold, id: "next-december", operatingDate: "2027-12-02" },
      { ...hold, id: "food", foodPrep: reservation.foodPrep },
      { ...hold, id: "extras", extras: [{ code: "mini-golf", quantity: 2 }] },
      { ...hold, id: "linked", linkedTripleseatEventIds: [String(plan.id)] },
    ];
    const corporate = { ...plan, date: hold.operatingDate, name: "Owner hold VIP" };
    const before = structuredClone([hold, ...retained]);
    const merged = mergeVipStaffEventPlans([corporate], [hold, ...retained]);
    expect(merged.map((item) => item.source_event_id).filter(Boolean).sort()).toEqual(retained.map(vipPrepExternalId).sort());
    expect(merged).toContain(corporate);
    expect([hold, ...retained]).toEqual(before);
    const result = await loadStaffEventPlans(hold.operatingDate, { exactDate: true,
      loadPlans: vi.fn().mockResolvedValue({ plans: [], sync: null }),
      vipClient: { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [hold] }) } });
    expect(result.plans).toEqual([]);
    expect(result.sourceWarning).toBe("");
  });
  it("retains hidden internal holds in raw numeric collision checks", async () => {
    const holds = ["test-h4l720-hfbtsa", "test-1k212gj-1rfricb"].map((id, index) => ({ ...reservation, id,
      operatingDate: "2026-12-02", eventName: index === 0 ? "Owner hold VIP" : "Customer party", foodPrep: [], extras: [] }));
    expect(mergeVipStaffEventPlans([], holds)).toEqual([]);
    const result = await loadStaffEventPlans("2026-12-02", { exactDate: true,
      loadPlans: vi.fn().mockResolvedValue({ plans: [], sync: null }),
      vipClient: { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: holds }) } });
    expect(result.plans).toEqual([]);
    expect(result.sourceWarning).toContain("legacy numeric event IDs collide");
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
    expect(loadPlans).toHaveBeenCalledWith({ now: new Date("2026-10-23T12:00:00Z"), window: { startDate: "2026-10-22", endDate: "2026-11-23" } });
    expect(fetchRange).toHaveBeenCalledExactlyOnceWith("2026-10-22", "2026-10-23");
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
  it("actually loads a previous-day event instead of losing it before the following-day eligibility filter", async () => {
    const storage = createMemoryEventPlanStorage();
    await storage.replaceWindow({ startDate: plan.date, endDate: plan.date }, [{ eventId: String(plan.id), eventDate: plan.date,
      plan: { ...plan }, sourceSnapshot: { status: "DEFINITE" }, sourceUpdatedAt: null }]);
    const result = await loadStaffEventPlans("2026-10-24", { loadPlans: (options) => loadEventPlanWindow({ ...options, storage, legacyPlans: [] }), vipClient: { configured: false, fetchRange: vi.fn() } });
    expect(result.plans.map((item) => item.id)).toEqual([plan.id]);
  });
  it("recovers saved unfinished past events by exact source ID and date, never by a matching name", async () => {
    const old = { ...plan, id: 999, date: "2026-09-12", name: "Sanitized older event" };
    const record = { ...defaultChecklistState(old.date), eventId: old.id, eventName: old.name, eventDate: old.date, poc: "", status: "draft", updatedAt: null, submittedAt: null } as ChecklistRecord;
    const submitted = { ...record, eventId: 1000, status: "submitted" as const };
    const moved = { ...record, eventId: 1001 };
    const findPlan = vi.fn().mockImplementation(async (id) => id === old.id ? old : id === moved.eventId ? { ...old, id, date: "2026-09-13" } : null);
    const result = await loadStaffEventPlans("2026-10-26", { includeUnsubmitted: true,
      loadPlans: vi.fn().mockResolvedValue({ plans: [], sync: null }), findPlan,
      loadChecklists: vi.fn().mockResolvedValue([record, submitted, moved]), vipClient: { configured: false, fetchRange: vi.fn() } });
    expect(result.plans).toEqual([old]); expect(result.unfinishedEventIds).toEqual([old.id]);
    expect(findPlan).toHaveBeenCalledWith(old.id); expect(findPlan).not.toHaveBeenCalledWith(submitted.eventId);
    expect(result.sourceWarning).toContain("No different party was substituted");
  });
  it.each([true, false])("keeps current events first and recovered drafts newest-first (current available: %s)", async (includeCurrent) => {
    const current = { ...plan, id: 990, date: "2026-10-26" };
    const saturday = { ...plan, id: 991, date: "2026-10-24" };
    const july = { ...plan, id: 992, date: "2026-07-30" };
    const records: ChecklistRecord[] = [july, saturday].map((event) => ({ ...defaultChecklistState(event.date),
      eventId: event.id, eventName: event.name, eventDate: event.date, poc: "", status: "draft", updatedAt: null, submittedAt: null }));
    const result = await loadStaffEventPlans(current.date, { includeUnsubmitted: true,
      loadPlans: vi.fn().mockResolvedValue({ plans: includeCurrent ? [current] : [], sync: null }),
      loadChecklists: vi.fn().mockResolvedValue(records),
      findPlan: vi.fn(async (id) => [saturday, july].find((event) => event.id === id) ?? null),
      vipClient: { configured: false, fetchRange: vi.fn() },
    });
    expect(result.plans.map((event) => event.id)).toEqual(includeCurrent ? [current.id, saturday.id, july.id] : [saturday.id, july.id]);
    expect(result.unfinishedEventIds).toEqual([saturday.id, july.id]);
  });
  it("uses only the requested past date and does not recover unrelated older records into that explicit view", async () => {
    const loadPlans = vi.fn().mockResolvedValue({ plans: [plan], sync: null });
    const fetchRange = vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [reservation] });
    const findPlan = vi.fn();
    const result = await loadStaffEventPlans(plan.date, { exactDate: true, includeUnsubmitted: true, loadPlans, findPlan,
      loadChecklists: vi.fn().mockResolvedValue([{ eventId: 991, eventDate: "2026-01-01", status: "draft" } as ChecklistRecord]),
      vipClient: { configured: true, fetchRange } });
    expect(loadPlans).toHaveBeenCalledWith({ now: new Date(`${plan.date}T12:00:00Z`), window: { startDate: plan.date, endDate: plan.date } });
    expect(fetchRange).toHaveBeenCalledExactlyOnceWith(plan.date, plan.date); expect(findPlan).not.toHaveBeenCalled();
    expect(result.plans).toHaveLength(2);
  });
  it("recovers a past VIP draft from its saved exact date and fails closed on an unavailable source", async () => {
    const sourceId = vipPrepExternalId(reservation);
    const id = numericVipEventId(sourceId);
    const record = { ...defaultChecklistState(reservation.operatingDate), eventId: id, eventName: "A name is not identity", eventDate: reservation.operatingDate, poc: "", status: "draft", updatedAt: null, submittedAt: null } as ChecklistRecord;
    const fetchRange = vi.fn(async (from: string) => ({ ...vipPrepPayload, reservations: from === reservation.operatingDate ? [reservation] : [] }));
    const options = { includeUnsubmitted: true, loadPlans: vi.fn().mockResolvedValue({ plans: [], sync: null }), findPlan: vi.fn().mockResolvedValue(null), loadChecklists: vi.fn().mockResolvedValue([record]), vipClient: { configured: true, fetchRange } };
    const result = await loadStaffEventPlans("2026-10-26", options);
    expect(result.plans[0].source_event_id).toBe(sourceId); expect(result.unfinishedEventIds).toEqual([id]);
    expect(fetchRange).toHaveBeenCalledWith(reservation.operatingDate, reservation.operatingDate);
    fetchRange.mockRejectedValue(new Error("Private source diagnostic"));
    const failed = await loadStaffEventPlans("2026-10-26", options);
    expect(failed.plans).toEqual([]); expect(failed.sourceWarning).toContain("No different party was substituted");
    expect(failed.sourceWarning).not.toContain("Private source diagnostic");
  });
  it("does not recover an internal December hold into the staff unfinished-checklist list", async () => {
    const hold = { ...reservation, operatingDate: "2026-12-02", eventName: "Owner hold VIP", foodPrep: [], extras: [] };
    const id = numericVipEventId(vipPrepExternalId(hold));
    const record = { ...defaultChecklistState(hold.operatingDate), eventId: id, eventName: hold.eventName,
      eventDate: hold.operatingDate, status: "draft", updatedAt: null, submittedAt: null } as ChecklistRecord;
    const result = await loadStaffEventPlans("2027-01-02", { includeUnsubmitted: true,
      loadPlans: vi.fn().mockResolvedValue({ plans: [], sync: null }), findPlan: vi.fn().mockResolvedValue(null),
      loadChecklists: vi.fn().mockResolvedValue([record]), vipClient: { configured: true,
        fetchRange: vi.fn(async (from) => ({ ...vipPrepPayload, reservations: from === hold.operatingDate ? [hold] : [] })) } });
    expect(result.plans).toEqual([]);
    expect(result.unfinishedEventIds).toEqual([]);
    expect(result.sourceWarning).toBe("");
    expect(record.status).toBe("draft");
  });
});
