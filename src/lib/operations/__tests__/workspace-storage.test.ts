import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEventWorkspace, loadWorkspaceSettings, saveEventWorkspaceAction as saveAction, saveWorkspaceSettings } from "../workspace-storage";
import { createMemoryEventPlanStorage } from "@/lib/event-plans/storage";
import { getChecklistRecord, resetLocalChecklistStorageForTests, saveChecklist } from "@/lib/checklist-storage";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
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
    expect(deps.findVip).not.toHaveBeenCalled();
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
    expect(deps.findVip).toHaveBeenCalledExactlyOnceWith(numericVipEventId(externalId), reservation.operatingDate, reservation.operatingDate);
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
