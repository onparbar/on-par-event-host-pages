import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEventWorkspace, loadWorkspaceSettings, saveEventWorkspaceAction as saveAction, saveWorkspaceSettings } from "../workspace-storage";
import { createMemoryEventPlanStorage } from "@/lib/event-plans/storage";
import { getChecklistRecord, resetLocalChecklistStorageForTests, saveChecklist } from "@/lib/checklist-storage";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { findVipPrepReservationByEventId, VipPrepApiError, VipPrepClient } from "@/lib/vip-prep/client";
import { workspaceEvent, workspaceRecord, workspaceReservation } from "./workspace-fixtures";
import { ADMIN_STATE_EVENT_ID } from "@/lib/admin-state";

async function saveEventWorkspaceAction(...args: Parameters<typeof saveAction>) {
  const [id, date, action, options] = args;
  const latest = await loadEventWorkspace(id, date, options);
  return saveAction(id, date, { ...action, expectedSourceFingerprint: action.expectedSourceFingerprint ?? latest?.sourceFingerprint }, options);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("SUPABASE_SECRET_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEYS", "");
  resetLocalChecklistStorageForTests();
});
async function options() {
  const plans = createMemoryEventPlanStorage();
  await plans.replaceWindow({ startDate: workspaceEvent.date, endDate: workspaceEvent.date }, [{ eventId: "77", eventDate: workspaceEvent.date, plan: { ...workspaceEvent }, sourceSnapshot: { status: "DEFINITE" }, sourceUpdatedAt: null }]);
  const getDay = vi.fn().mockResolvedValue({ date: workspaceEvent.date, events: [], reservations: [workspaceReservation()], sync: null });
  const findVip = vi.fn().mockResolvedValue(null);
  return { plans, entertainment: { getDay }, getRecord: getChecklistRecord, saveRecord: saveChecklist, findFallback: vi.fn().mockResolvedValue(null), findVip, now: () => new Date("2026-10-23T22:25:00Z") };
}
async function seed() {
  const record = workspaceRecord();
  return saveChecklist({ action: "save", eventId: record.eventId, eventName: record.eventName, eventDate: record.eventDate, poc: record.poc, checklist: record, expectedUpdatedAt: null });
}
describe("read-only event workspace storage", () => {
  it("loads exact stored event without syncing sources or dispatching food", async () => {
    const deps = await options();
    const getRecord = vi.fn(deps.getRecord);
    const saveRecord = vi.fn(deps.saveRecord);
    const payload = await loadEventWorkspace("77", workspaceEvent.date, { ...deps, getRecord, saveRecord });
    expect(payload!.event.id).toBe(77);
    expect(deps.entertainment.getDay).toHaveBeenCalledExactlyOnceWith(workspaceEvent.date);
    expect(deps.findVip).toHaveBeenCalledExactlyOnceWith(77, workspaceEvent.date, workspaceEvent.date);
    expect(saveRecord).not.toHaveBeenCalled();
    expect(getRecord).toHaveBeenCalledWith(77);
    expect(getRecord).toHaveBeenCalledWith(ADMIN_STATE_EVENT_ID);
  });
  it("returns null for wrong event/date rather than another similarly named event", async () => {
    const deps = await options();
    expect(await loadEventWorkspace("77", "2026-10-24", deps)).toBeNull();
    expect(await loadEventWorkspace("78", workspaceEvent.date, deps)).toBeNull();
    expect(await loadEventWorkspace("event/unsafe", workspaceEvent.date, deps)).toBeNull();
    expect(deps.entertainment.getDay).not.toHaveBeenCalled();
  });
  it("resolves the canonical numeric/external VIP ID using only the read feed", async () => {
    const deps = await options();
    const reservation = vipPrepPayload.reservations[0];
    deps.findVip.mockResolvedValue(reservation);
    deps.entertainment.getDay.mockResolvedValue({ date: reservation.operatingDate, events: [], reservations: [], sync: null });
    const externalId = vipPrepExternalId(reservation);
    const result = await loadEventWorkspace(externalId, reservation.operatingDate, deps);
    expect(result!.event.id).toBe(numericVipEventId(externalId));
    expect(result!.kitchenEventId).toBe(externalId);
    expect(deps.findVip).toHaveBeenNthCalledWith(1, externalId, reservation.operatingDate, reservation.operatingDate);
    expect(deps.findVip).toHaveBeenNthCalledWith(2, numericVipEventId(externalId), reservation.operatingDate, reservation.operatingDate);
  });
  it.each(["vip", "numeric"])("hides a December internal hold from direct %s workspace reads and saves without changing history", async (selection) => {
    const deps = await options();
    const hold = { ...vipPrepPayload.reservations[0], operatingDate: "2026-12-02", eventName: "Owner hold VIP", foodPrep: [], extras: [] };
    deps.findVip.mockResolvedValue(hold);
    const externalId = vipPrepExternalId(hold);
    const id = numericVipEventId(externalId);
    const selected = selection === "vip" ? externalId : String(id);
    const getRecord = vi.fn(deps.getRecord);
    const saveRecord = vi.fn(deps.saveRecord);
    const dependencies = { ...deps, getRecord, saveRecord };
    expect(await loadEventWorkspace(selected, hold.operatingDate, dependencies)).toBeNull();
    expect(await saveAction(selected, hold.operatingDate, { action: "FOOD_OUT", expectedUpdatedAt: null }, dependencies)).toBeNull();
    expect(getRecord).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
    expect(deps.entertainment.getDay).not.toHaveBeenCalled();
  });
  it.each(["2026-11-02", "2027-12-02"])("keeps same-label workspace bookings outside December 2026 visible: %s", async (operatingDate) => {
    const deps = await options();
    const booking = { ...vipPrepPayload.reservations[0], operatingDate, eventName: "VIP unavailable", foodPrep: [], extras: [] };
    deps.findVip.mockResolvedValue(booking);
    expect((await loadEventWorkspace(vipPrepExternalId(booking), operatingDate, deps))?.event.name).toContain("VIP unavailable");
  });
  it("resolves each canonical VIP despite a hash collision without attaching or saving shared numeric staff state", async () => {
    const deps = await options();
    const reservations = ["test-h4l720-hfbtsa", "test-1k212gj-1rfricb"].map((id, index) => ({ ...vipPrepPayload.reservations[0], id, eventName: `Sanitized VIP ${index + 1}` }));
    const date = reservations[0].operatingDate;
    const client = new VipPrepClient({ env: { VIP_PREP_API_TOKEN: "test-token" }, fetchImpl: async () => Response.json({ ...vipPrepPayload, reservationCount: 2, reservations }) });
    const findVip = (id: string | number, from: string, to: string) => findVipPrepReservationByEventId(id, from, to, client);
    const sharedId = 527983760;
    expect(reservations.map((reservation) => numericVipEventId(vipPrepExternalId(reservation)))).toEqual([sharedId, sharedId]);
    const getRecord = vi.fn().mockImplementation(async (id) => id === sharedId ? { ...workspaceRecord(), eventId: sharedId, eventDate: date, bwa: "Never attach another source's staff state" } : null);
    const saveRecord = vi.fn();
    for (const reservation of reservations) {
      const externalId = vipPrepExternalId(reservation);
      const result = await loadEventWorkspace(externalId, date, { ...deps, findVip, getRecord, saveRecord });
      expect(result?.event.name).toContain(reservation.eventName);
      expect(result?.kitchenEventId).toBe(externalId);
      expect(result?.record).toBeNull();
      expect(result?.warnings.join(" ")).toContain("Read-only");
      await expect(saveAction(externalId, date, { action: "FOOD_OUT", expectedUpdatedAt: null }, { ...deps, findVip, getRecord, saveRecord })).rejects.toThrow("legacy numeric checklist identity");
    }
    expect(saveRecord).not.toHaveBeenCalled();
    await expect(findVip(sharedId, date, date)).rejects.toBeInstanceOf(VipPrepApiError);
    expect(await loadEventWorkspace(String(sharedId), date, { ...deps, findVip, getRecord })).toBeNull();
  });
  it("never substitutes a numeric corporate plan for a canonical VIP and rejects an ambiguous legacy numeric URL", async () => {
    const deps = await options();
    const reservation = { ...vipPrepPayload.reservations[0], id: "test-h4l720-hfbtsa" };
    const date = reservation.operatingDate;
    const externalId = vipPrepExternalId(reservation);
    const id = numericVipEventId(externalId);
    await deps.plans.replaceWindow({ startDate: date, endDate: date }, [{ eventId: String(id), eventDate: date, plan: { ...workspaceEvent, id, date, name: "Different corporate source" }, sourceSnapshot: { status: "DEFINITE" }, sourceUpdatedAt: null }]);
    deps.findVip.mockResolvedValue(reservation);
    const exact = await loadEventWorkspace(externalId, date, deps);
    expect(exact?.event.name).toContain(reservation.eventName);
    expect(exact?.event.name).not.toContain("Different corporate source");
    expect(exact?.record).toBeNull();
    expect(exact?.warnings.join(" ")).toContain("Read-only");
    expect(await loadEventWorkspace(String(id), date, deps)).toBeNull();
  });
  it("does not attach or overwrite staff data owned by a fallback-only corporate source", async () => {
    const deps = await options();
    const reservation = { ...vipPrepPayload.reservations[0], id: "test-h4l720-hfbtsa" };
    const externalId = vipPrepExternalId(reservation);
    const id = numericVipEventId(externalId);
    deps.findVip.mockResolvedValue(reservation);
    deps.findFallback.mockResolvedValue({ ...workspaceEvent, id, date: reservation.operatingDate });
    const getRecord = vi.fn(async (value) => value === id ? { ...workspaceRecord(), eventId: id, eventDate: reservation.operatingDate } : null);
    const result = await loadEventWorkspace(externalId, reservation.operatingDate, { ...deps, getRecord });
    expect(result?.event.name).toContain(reservation.eventName);
    expect(result?.record).toBeNull();
    expect(result?.warnings.join(" ")).toContain("Read-only");
    const saveRecord = vi.fn();
    await expect(saveAction(externalId, reservation.operatingDate, { action: "FOOD_OUT", expectedUpdatedAt: null }, { ...deps, getRecord: async () => null, saveRecord })).rejects.toThrow("legacy numeric checklist identity");
    expect(saveRecord).not.toHaveBeenCalled();
    deps.findFallback.mockRejectedValue(new Error("unavailable"));
    const uncertain = await loadEventWorkspace(externalId, reservation.operatingDate, { ...deps, getRecord });
    expect(uncertain?.record).toBeNull();
    expect(uncertain?.warnings.join(" ")).toContain("Read-only");
  });
  it("keeps a normal corporate read available if VIP collision checks fail, but detaches conflicting-date staff records", async () => {
    const deps = await options();
    deps.findVip.mockRejectedValue(new Error("private source failure"));
    const result = await loadEventWorkspace("77", workspaceEvent.date, deps);
    expect(result?.event.id).toBe(77);
    expect(result?.warnings.join(" ")).toContain("VIP identity collision checks are unavailable");
    expect(result?.warnings.join(" ")).not.toContain("private source failure");
    const getRecord = vi.fn(async (id: number) => id === 77 ? { ...workspaceRecord(), eventDate: "2026-10-24" } : null);
    const wrongDate = await loadEventWorkspace("77", workspaceEvent.date, { ...deps, getRecord });
    expect(wrongDate?.record).toBeNull();
    await expect(saveAction("77", workspaceEvent.date, { action: "FOOD_OUT", expectedUpdatedAt: null }, { ...deps, getRecord })).rejects.toThrow("legacy numeric checklist identity");
  });
  it("degrades a failed saved schedule read without triggering a source refresh", async () => {
    const deps = await options();
    deps.entertainment.getDay.mockRejectedValue(new Error("private diagnostic"));
    const result = await loadEventWorkspace("77", workspaceEvent.date, deps);
    expect(result!.sourceAvailable).toBe(false);
    expect(result!.warnings.join()).not.toContain("private diagnostic");
    expect(result!.activities[0]).toMatchObject({ label: "Mini Golf", startAt: null });
  });
});
describe("atomic shared workspace actions", () => {
  it("preserves POC/BWA/unknown tasks/food/entertainment while saving evidence", async () => {
    const previous = await seed();
    const deps = await options();
    const result = await saveEventWorkspaceAction("77", workspaceEvent.date, { action: "FOOD_OUT", expectedUpdatedAt: previous.updatedAt }, deps);
    expect(result!.record).toMatchObject({ poc: previous.poc, bwa: previous.bwa, food: previous.food, entertainment: previous.entertainment, extrasAdded: previous.extrasAdded });
    expect(result!.record!.tasks.existing).toBe(true);
    expect(result!.record!.taskEvidence!["food-kitchen-window"].completedAt).toBe("2026-10-23T22:25:00.000Z");
    expect((await getChecklistRecord(77))!.tasks["food-kitchen-window"]).toBe(true);
  });
  it("duplicate clicks never reset actual evidence or issue another save", async () => {
    const previous = await seed();
    const deps = await options();
    const id = (await loadEventWorkspace("77", workspaceEvent.date, deps))!.activities[0].id;
    const result = await saveEventWorkspaceAction("77", workspaceEvent.date, { action: "START_ACTIVITY", activityId: id, expectedUpdatedAt: previous.updatedAt }, deps);
    const saveRecord = vi.fn(deps.saveRecord);
    const duplicate = await saveEventWorkspaceAction("77", workspaceEvent.date, { action: "START_ACTIVITY", activityId: id, expectedUpdatedAt: result!.record!.updatedAt, employeeName: "Other" }, { ...deps, saveRecord, now: () => new Date("2026-10-23T23:00:00Z") });
    expect(saveRecord).not.toHaveBeenCalled();
    expect(duplicate!.activities[0]).toMatchObject({ startedAt: "2026-10-23T22:25:00.000Z", startedBy: "BWA test" });
  });
  it("concurrent checklist/actor actions are rejected rather than erasing either writer", async () => {
    const previous = await seed();
    const deps = await options();
    const results = await Promise.allSettled([
      saveEventWorkspaceAction("77", workspaceEvent.date, { action: "FOOD_OUT", expectedUpdatedAt: previous.updatedAt }, deps),
      saveEventWorkspaceAction("77", workspaceEvent.date, { action: "START_ACTIVITY", activityId: "reservation:reservation-1", expectedUpdatedAt: previous.updatedAt }, deps),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((await getChecklistRecord(77))!.poc).toBe(previous.poc);
  });
  it("fulfillment validates exact accepted request and never updates GoTab state", async () => {
    const previous = await seed();
    const deps = await options();
    const listEventFoodDelivery = vi.fn().mockResolvedValue([{ requestId: "request-1", eventId: "99", status: "SENT" }]);
    const action = { action: "FULFILL_REQUEST" as const, requestId: "request-1", expectedUpdatedAt: previous.updatedAt };
    await expect(saveEventWorkspaceAction("77", workspaceEvent.date, action, { ...deps, deliveries: { listEventFoodDelivery } })).rejects.toThrow(/accepted/);
    listEventFoodDelivery.mockResolvedValue([{ requestId: "request-1", eventId: "77", status: "HELD" }]);
    await expect(saveEventWorkspaceAction("77", workspaceEvent.date, action, { ...deps, deliveries: { listEventFoodDelivery } })).rejects.toThrow(/accepted/);
    listEventFoodDelivery.mockResolvedValue([{ requestId: "request-1", eventId: "77", status: "SENT" }]);
    const result = await saveEventWorkspaceAction("77", workspaceEvent.date, action, { ...deps, deliveries: { listEventFoodDelivery } });
    expect(listEventFoodDelivery).toHaveBeenLastCalledWith(["77"], ["request-1"]);
    expect(result!.record!.tasks["workspace:request:request-1:fulfilled"]).toBe(true);
  });
  it("configuration uses existing protected Admin record without erasing its state", async () => {
    const before = await saveChecklist({ action: "save", eventId: ADMIN_STATE_EVENT_ID, eventName: "__admin_state__", eventDate: "2099-12-31", poc: "Admin State", expectedUpdatedAt: null, checklist: { tasks: { adminState: { archivedEventIds: [77] }, other: true }, food: {}, entertainment: {} } });
    const after = await saveWorkspaceSettings({ reminderLeadMinutes: 10 }, before.updatedAt);
    expect(after.settings.reminderLeadMinutes).toBe(10);
    expect((await loadWorkspaceSettings()).settings.reminderLeadMinutes).toBe(10);
    expect((await getChecklistRecord(ADMIN_STATE_EVENT_ID))!.tasks.adminState).toEqual({ archivedEventIds: [77] });
    await expect(saveWorkspaceSettings({ reminderLeadMinutes: 15 }, before.updatedAt)).rejects.toThrow(/newer version/);
    await expect(saveWorkspaceSettings({ reminderLeadMinutes: 61 }, after.updatedAt)).rejects.toThrow(/1 to 60/);
  });
});
