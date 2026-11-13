import { describe, expect, it } from "vitest";
import { applyWorkspaceAction as applyAction, buildWorkspacePayload, normalizeWorkspaceSettings, workspaceActivityTaskKey, workspaceReminders, type WorkspaceAction, type WorkspacePayload } from "../workspace";
import { workspaceEvent, workspaceRecord, workspaceReservation } from "./workspace-fixtures";

function payload(record = workspaceRecord(), reservation = workspaceReservation()) {
  return buildWorkspacePayload({ event: workspaceEvent, record, reservations: [reservation], scheduleAvailable: true });
}
function applyWorkspaceAction(payload: WorkspacePayload, action: WorkspaceAction, now: Date, acceptedIds?: string[]) {
  return applyAction(payload, { ...action, expectedSourceFingerprint: action.expectedSourceFingerprint ?? payload.sourceFingerprint }, now, acceptedIds);
}
describe("shared event activity projection", () => {
  it("uses exact saved reservation times/quantities and keeps mini golf untimed contract quantity", () => {
    const result = payload();
    expect(result.activities[0]).toMatchObject({ label: "Duckpin Bowling", quantity: "1 lane · Bowling Lane 1", startAt: "2026-10-23T22:30:00.000Z" });
    expect(result.activities[1]).toMatchObject({ label: "Mini Golf", quantity: "20", startAt: null, endAt: null, untimed: true });
    expect(workspaceReminders(result, new Date("2026-10-23T22:00:00Z")).filter((item) => item.activityId === result.activities[1].id)).toEqual([]);
  });
  it("never matches another event by name and rejects another event's checklist", () => {
    const result = buildWorkspacePayload({ event: workspaceEvent, record: workspaceRecord({ eventId: 99 }), reservations: [workspaceReservation({ localEventId: "99", tripleseatEventId: "99" })], scheduleAvailable: true });
    expect(result.record).toBeNull();
    expect(result.activities).toHaveLength(1);
  });
  it("does not invent times when contract timing is absent", () => {
    const result = buildWorkspacePayload({ event: { ...workspaceEvent, time: "TBD", entertainment: [{ name: "Darts", quantity: "2", time: "", duration: "2 hours" }] }, record: null, reservations: [], scheduleAvailable: false });
    expect(result.activities[0]).toMatchObject({ startAt: null, endAt: null, untimed: false });
    expect(result.eventStartAt).toBeNull();
    expect(workspaceReminders(result, new Date())).toEqual([]);
  });
  it("retains paid contract entertainment without inventing a missing saved assignment", () => {
    const event = { ...workspaceEvent, entertainment: [...workspaceEvent.entertainment, { name: "Darts", quantity: "2 lanes", time: "7:00 PM - 8:00 PM", duration: "1 hour" }] };
    const result = buildWorkspacePayload({ event, record: null, reservations: [workspaceReservation()], scheduleAvailable: true });
    expect(result.activities.find((item) => item.label === "Darts")).toMatchObject({ quantity: "2 lanes", resourceNames: [], startAt: null, endAt: null });
    expect(result.warnings.join()).toMatch(/contract includes Darts/);
    expect(result.activities.filter((item) => item.label === "Duckpin Bowling")).toHaveLength(1);
  });
  it("does not resurrect an explicitly cancelled activity from older contract text", () => {
    const event = { ...workspaceEvent, source_updated_at: "2026-10-22T12:00:00Z", entertainment: [{ name: "Bowling", quantity: "1", time: "6:30 PM - 8:30 PM", duration: "2 hours" }] };
    const reservations = [workspaceReservation({ active: false, updatedAt: "2026-10-23T12:00:00Z" })];
    const result = buildWorkspacePayload({ event, record: null, reservations, scheduleAvailable: true });
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].cancelled).toBe(true);
    const revised = buildWorkspacePayload({ event: { ...event, source_updated_at: "2026-10-23T13:00:00Z" }, record: null, reservations, scheduleAvailable: true });
    expect(revised.activities.find((item) => item.label === "Bowling")).toMatchObject({ startAt: null, resourceNames: [], cancelled: false });
    expect(revised.warnings.join()).toMatch(/no matching saved resource/);
  });
  it("handles midnight and DST using Eastern instants", () => {
    for (const [date, time, expected] of [["2026-10-23", "11:00 PM - 1:00 AM", "2026-10-24T05:00:00.000Z"], ["2026-11-01", "1:00 AM - 3:00 AM", "2026-11-01T08:00:00.000Z"]]) {
      const result = buildWorkspacePayload({ event: { ...workspaceEvent, date, time }, record: null, reservations: [], scheduleAvailable: true });
      expect(result.eventEndAt).toBe(expected);
    }
  });
  it("shifts after-midnight contract activities only inside a verified overnight event", () => {
    const entertainment = [{ name: "Bowling", quantity: "1", time: "12:00 AM - 1:00 AM", duration: "1 hour" }];
    const overnight = buildWorkspacePayload({ event: { ...workspaceEvent, time: "10:00 PM - 2:00 AM", entertainment }, record: null, reservations: [], scheduleAvailable: false });
    expect(overnight.activities[0].startAt).toBe("2026-10-24T04:00:00.000Z");
    const daytime = buildWorkspacePayload({ event: { ...workspaceEvent, entertainment }, record: null, reservations: [], scheduleAvailable: false });
    expect(daytime.activities[0].startAt).toBeNull();
  });
});
describe("reminder stages and shared actual status", () => {
  it("defaults to five minutes before and at-start; acknowledgments are independent from actual start", () => {
    const original = payload();
    const now = new Date("2026-10-23T22:25:00Z");
    const first = workspaceReminders(original, now).find((item) => item.stage === "before")!;
    expect(first.state).toBe("due");
    const ack = applyWorkspaceAction(original, { action: "ACK_REMINDER", reminderId: first.id, expectedUpdatedAt: original.record!.updatedAt }, now);
    const acknowledged = payload(ack.record);
    expect(acknowledged.activities[0].startedAt).toBeNull();
    expect(workspaceReminders(acknowledged, new Date("2026-10-23T22:30:00Z")).find((item) => item.stage === "start")?.acknowledged).toBe(false);
  });
  it("shows just at-start overdue on late open rather than all missed stages", () => {
    const reminders = workspaceReminders(payload(), new Date("2026-10-23T23:00:00Z"));
    expect(reminders.filter((item) => item.activityId)).toHaveLength(1);
    expect(reminders.find((item) => item.activityId)).toMatchObject({ stage: "start", state: "overdue" });
  });
  it("preserves actual actor/time across duplicate actions and rescheduling", () => {
    const original = payload();
    const id = original.activities[0].id;
    const action = { action: "START_ACTIVITY" as const, activityId: id, expectedUpdatedAt: original.record!.updatedAt };
    const first = applyWorkspaceAction(original, action, new Date("2026-10-23T22:32:00Z"));
    const changed = payload(first.record, workspaceReservation({ startAt: "2026-10-23T23:00:00Z", endAt: "2026-10-24T01:00:00Z" }));
    expect(changed.activities[0]).toMatchObject({ id, startedAt: "2026-10-23T22:32:00.000Z", startedBy: "BWA test" });
    const duplicate = applyWorkspaceAction(changed, { ...action, employeeName: "Other" }, new Date("2026-10-23T23:15:00Z"));
    expect(duplicate.changed).toBe(false);
    expect(duplicate.record.taskEvidence![workspaceActivityTaskKey(id, "started")].employeeName).toBe("BWA test");
    expect(workspaceReminders(changed, new Date("2026-10-23T23:00:00Z")).filter((item) => item.activityId === id)).toEqual([]);
  });
  it("invalidates old acknowledgments when scheduled times change", () => {
    const original = payload();
    const now = new Date("2026-10-23T22:25:00Z");
    const reminder = workspaceReminders(original, now).find((item) => item.stage === "before")!;
    const acknowledged = applyWorkspaceAction(original, { action: "ACK_REMINDER", reminderId: reminder.id, expectedUpdatedAt: original.record!.updatedAt }, now);
    const rescheduled = payload(acknowledged.record, workspaceReservation({ startAt: "2026-10-23T23:00:00Z", endAt: "2026-10-24T01:00:00Z" }));
    const current = workspaceReminders(rescheduled, new Date("2026-10-23T22:55:00Z")).find((item) => item.stage === "before")!;
    expect(current.id).not.toBe(reminder.id);
    expect(current.acknowledged).toBe(false);
  });
  it("retains actual status when one resource is rescheduled out of a grouped activity", () => {
    const reservations = [workspaceReservation(), workspaceReservation({ id: "reservation-2", resourceId: "bowling-2", resourceName: "Bowling Lane 2" })];
    const original = buildWorkspacePayload({ event: workspaceEvent, record: workspaceRecord(), reservations, scheduleAvailable: true });
    const result = applyWorkspaceAction(original, { action: "START_ACTIVITY", activityId: original.activities[0].id, expectedUpdatedAt: original.record!.updatedAt }, new Date("2026-10-23T22:30:00Z"));
    const split = buildWorkspacePayload({ event: workspaceEvent, record: result.record, reservations: [reservations[0], { ...reservations[1], startAt: "2026-10-23T23:00:00Z", endAt: "2026-10-24T01:00:00Z" }], scheduleAvailable: true });
    expect(split.activities.filter((item) => !item.untimed)).toHaveLength(2);
    expect(split.activities.filter((item) => !item.untimed).every((item) => item.startedAt === "2026-10-23T22:30:00.000Z")).toBe(true);
  });
  it("suppresses cancelled, completed, started and closed-event reminders", () => {
    const original = payload();
    expect(workspaceReminders({ ...original, cancelled: true }, new Date())).toEqual([]);
    expect(workspaceReminders({ ...original, record: workspaceRecord({ status: "submitted" }) }, new Date())).toEqual([]);
    expect(workspaceReminders(payload(workspaceRecord(), workspaceReservation({ active: false })), new Date()).some((item) => item.activityId)).toBe(false);
  });
  it("Food Is Out shares the existing kitchen-window task and records BWA evidence", () => {
    const original = payload();
    expect(original.foodReminderAt).toBe("2026-10-23T21:45:00.000Z");
    const result = applyWorkspaceAction(original, { action: "FOOD_OUT", expectedUpdatedAt: original.record!.updatedAt }, new Date("2026-10-23T21:45:00Z"));
    expect(result.record.tasks["food-kitchen-window"]).toBe(true);
    expect(result.record.taskEvidence!["food-kitchen-window"]).toMatchObject({ employeeName: "BWA test", completedAt: "2026-10-23T21:45:00.000Z", sourceFingerprint: expect.any(String) });
    expect(workspaceReminders(payload(result.record), new Date()).some((item) => item.stage === "food")).toBe(false);
    expect(result.record.poc).toBe("POC test");
    expect(result.record.food).toEqual(original.record!.food);
  });
  it("requires matching revisions and explicit actor or BWA without autofilling assignments", () => {
    expect(() => applyWorkspaceAction(payload(), { action: "FOOD_OUT", expectedUpdatedAt: null }, new Date())).toThrow(/newer version/);
    const empty = buildWorkspacePayload({ event: workspaceEvent, record: null, reservations: [], scheduleAvailable: true });
    expect(() => applyWorkspaceAction(empty, { action: "FOOD_OUT", expectedUpdatedAt: null }, new Date())).toThrow(/BWA/);
    const result = applyWorkspaceAction(empty, { action: "FOOD_OUT", employeeName: "Actor", expectedUpdatedAt: null }, new Date());
    expect(result.record.bwa).toBe("");
    expect(result.record.poc).toBe("");
  });
  it("rejects changed source information even when checklist revision is unchanged", () => {
    const original = payload();
    const changed = payload(workspaceRecord(), workspaceReservation({ startAt: "2026-10-23T23:00:00Z" }));
    expect(() => applyWorkspaceAction(changed, { action: "FOOD_OUT", expectedUpdatedAt: original.record!.updatedAt, expectedSourceFingerprint: original.sourceFingerprint }, new Date())).toThrow(/schedule changed/);
    expect(() => applyAction(original, { action: "FOOD_OUT", expectedUpdatedAt: original.record!.updatedAt }, new Date())).toThrow(/schedule changed/);
  });
  it("only fulfills explicitly validated accepted requests and preserves other task data", () => {
    const original = payload();
    const action = { action: "FULFILL_REQUEST" as const, requestId: "request-1", expectedUpdatedAt: original.record!.updatedAt };
    expect(() => applyWorkspaceAction(original, action, new Date())).toThrow(/accepted food/);
    const result = applyWorkspaceAction(original, action, new Date("2026-10-23T23:00:00Z"), ["request-1"]);
    expect(result.record.tasks["workspace:request:request-1:fulfilled"]).toBe(true);
    expect(result.record.tasks.existing).toBe(true);
  });
  it.each([0, -1, 1.5, 61, NaN])("rejects unsafe configuration %s by defaulting", (lead) => {
    expect(normalizeWorkspaceSettings({ reminderLeadMinutes: lead })).toEqual({ reminderLeadMinutes: 5 });
  });
  it("supports management-configurable pre-start timing", () => {
    const result = workspaceReminders(payload(), new Date("2026-10-23T22:20:00Z"), { reminderLeadMinutes: 10 });
    expect(result.find((item) => item.stage === "before")).toMatchObject({ dueAt: "2026-10-23T22:20:00.000Z", state: "due" });
  });
});
