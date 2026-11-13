import type { ChecklistRecord } from "@/lib/checklist-model";
import { operationalEventWindow } from "./command-center";
import { canonicalCategoryForText, exactResourceIdsForText } from "@/lib/entertainment/resources";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { itineraryReservationMatchesPlan, itineraryEntertainmentFromReservations } from "@/lib/itineraries/entertainment";
import type { EventPlan } from "@/lib/event-plans/types";
import { StaleSaveError } from "@/lib/stale-save";
import { reconcileChecklistSetup, setupTaskFingerprint } from "./setup";
import { addCalendarDays } from "@/lib/entertainment/time";

export type WorkspaceSettings = { reminderLeadMinutes: number };
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { reminderLeadMinutes: 5 };
export class WorkspaceValidationError extends Error {
  constructor(message: string) { super(message); this.name = "WorkspaceValidationError"; }
}
export type WorkspaceActivity = {
  id: string;
  label: string;
  quantity: string;
  resourceNames: string[];
  reservationIds: string[];
  startAt: string | null;
  endAt: string | null;
  untimed: boolean;
  cancelled: boolean;
  scheduleFingerprint: string;
  startedAt: string | null;
  completedAt: string | null;
  startedBy: string | null;
  completedBy: string | null;
};
export type WorkspacePayload = {
  event: EventPlan;
  kitchenEventId: string;
  sourceFingerprint: string;
  record: ChecklistRecord | null;
  activities: WorkspaceActivity[];
  eventStartAt: string | null;
  eventEndAt: string | null;
  foodReminderAt: string | null;
  cancelled: boolean;
  sourceAvailable: boolean;
  warnings: string[];
  settings: WorkspaceSettings;
};
export type WorkspaceReminder = {
  id: string;
  activityId: string | null;
  stage: "before" | "start" | "food";
  dueAt: string;
  state: "upcoming" | "due" | "overdue";
  label: string;
  acknowledged: boolean;
};
export type WorkspaceAction = {
  action: "ACK_REMINDER" | "START_ACTIVITY" | "COMPLETE_ACTIVITY" | "FOOD_OUT" | "FULFILL_REQUEST";
  activityId?: string;
  reminderId?: string;
  requestId?: string;
  employeeName?: string;
  expectedUpdatedAt: string | null;
  expectedSourceFingerprint?: string;
};

/** Browser-safe deterministic key: schedule changes replace acknowledgments, not actual-start evidence. */
export function workspaceFingerprint(parts: readonly (string | null)[]) {
  let hash = 2166136261;
  for (const character of JSON.stringify(parts)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
export function workspaceActivityTaskKey(id: string, stage: "started" | "completed") {
  return `workspace:activity:${encodeURIComponent(id)}:${stage}`;
}
function evidenceTime(record: ChecklistRecord | null, key: string) {
  const timestamp = record?.tasks[key] && record.taskEvidence?.[key]?.completedAt;
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}
export function workspaceActivityEvidence(record: ChecklistRecord | null, activity: Pick<WorkspaceActivity, "id" | "reservationIds">, stage: "started" | "completed") {
  const ids = activity.reservationIds.length ? activity.reservationIds.map((id) => `reservation:${id}`) : [activity.id];
  const evidence = ids.map((id) => {
    const key = workspaceActivityTaskKey(id, stage);
    return evidenceTime(record, key) ? record?.taskEvidence?.[key] : undefined;
  });
  if (evidence.some((item) => !item)) return { at: null, by: null };
  return {
    at: evidence.map((item) => item!.completedAt).sort().at(-1) ?? null,
    by: [...new Set(evidence.map((item) => item!.employeeName))].join(", ") || null,
  };
}
export function normalizeWorkspaceSettings(value: unknown): WorkspaceSettings {
  const lead = value && typeof value === "object" ? (value as Partial<WorkspaceSettings>).reminderLeadMinutes : undefined;
  return { reminderLeadMinutes: typeof lead === "number" && Number.isInteger(lead) && lead >= 1 && lead <= 60 ? lead : 5 };
}
export function buildWorkspacePayload(input: {
  event: EventPlan;
  record: ChecklistRecord | null;
  reservations: readonly EntertainmentReservation[];
  sourceEventIds?: readonly string[];
  scheduleAvailable: boolean;
  cancelled?: boolean;
  settings?: WorkspaceSettings;
  warnings?: string[];
}): WorkspacePayload {
  const { event } = input;
  const persisted = input.record?.eventId === event.id && input.record.eventDate === event.date ? input.record : null;
  const record = persisted ? { ...persisted, ...reconcileChecklistSetup(event, persisted) } : null;
  const cancelled = input.cancelled === true;
  const warnings = [...(input.warnings ?? [])];
  const eventWindow = operationalEventWindow(event);
  const groups = new Map<string, EntertainmentReservation[]>();
  for (const item of input.reservations) {
    if (item.operatingDate !== event.date || item.resourceCategory === "mini-golf" || !itineraryReservationMatchesPlan(item, event, { sourceEventIds: input.sourceEventIds })) continue;
    const groupKey = `${item.resourceCategory === "private-rooms" ? item.resourceId : item.resourceCategory}:${item.startAt}:${item.endAt}:${item.active}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  const activities: WorkspaceActivity[] = [...groups.values()].map((group) => {
    const item = group[0];
    const id = `reservation:${group.map((entry) => entry.id).sort().join(",")}`;
    const reservationIds = group.map((entry) => entry.id).sort();
    const started = workspaceActivityEvidence(record, { id, reservationIds }, "started");
    const completed = workspaceActivityEvidence(record, { id, reservationIds }, "completed");
    const validTime = Number.isFinite(Date.parse(item.startAt)) && Number.isFinite(Date.parse(item.endAt)) && Date.parse(item.startAt) < Date.parse(item.endAt);
    const itineraryItem = itineraryEntertainmentFromReservations(group.map((entry) => ({ ...entry, active: true })))[0];
    return {
      id, label: itineraryItem?.name ?? item.resourceName, quantity: itineraryItem?.quantity ?? "",
      resourceNames: group.map((entry) => entry.resourceName).sort(), reservationIds,
      startAt: validTime ? item.startAt : null, endAt: validTime ? item.endAt : null,
      untimed: false, cancelled: cancelled || !item.active,
      scheduleFingerprint: workspaceFingerprint([item.startAt, item.endAt, ...group.map((entry) => entry.resourceId).sort()]),
      startedAt: started.at, completedAt: completed.at, startedBy: started.by, completedBy: completed.by,
    };
  });
  // Mini golf is contract-only open play: never fabricate a timed reservation.
  const seen = new Set<string>();
  event.entertainment.forEach((item, index) => {
    const category = canonicalCategoryForText(item.name);
    const miniGolf = category === "mini-golf";
    const roomIds = category === "private-rooms" ? exactResourceIdsForText(item.name, category) : [];
    const matchingAssignments = input.reservations.filter((reservation) => reservation.operatingDate === event.date && reservation.resourceCategory === category &&
      (category !== "private-rooms" || roomIds.includes(reservation.resourceId)) && itineraryReservationMatchesPlan(reservation, event, { sourceEventIds: input.sourceEventIds }));
    const hasSavedAssignment = matchingAssignments.some((reservation) => reservation.active);
    if (!miniGolf && input.scheduleAvailable && hasSavedAssignment) return;
    const cancelledAssignments = matchingAssignments.filter((reservation) => !reservation.active);
    const contractChangedAfterCancellation = event.source_updated_at && cancelledAssignments.every((reservation) => Date.parse(event.source_updated_at!) > Date.parse(reservation.updatedAt));
    if (!miniGolf && cancelledAssignments.length && !contractChangedAfterCancellation) return;
    const duplicateKey = `${item.name}|${item.quantity}`;
    if (seen.has(duplicateKey)) return;
    seen.add(duplicateKey);
    const id = `contract:${index}:${item.name}`;
    if (!miniGolf && input.scheduleAvailable) warnings.push(`The contract includes ${item.name}, but no matching saved resource assignment is available. Verify its schedule before starting.`);
    let interval = miniGolf || input.scheduleAvailable ? null : operationalEventWindow({ date: event.date, time: item.time });
    if (interval && eventWindow && Date.parse(interval.startsAt) < Date.parse(eventWindow.startsAt)) {
      const shifted = operationalEventWindow({ date: addCalendarDays(event.date, 1), time: item.time });
      // Only move an after-midnight contract time when the verified event spans it.
      interval = shifted && Date.parse(shifted.startsAt) >= Date.parse(eventWindow.startsAt) && Date.parse(shifted.endsAt) <= Date.parse(eventWindow.endsAt) ? shifted : null;
    }
    if (!miniGolf && !input.scheduleAvailable && !interval) warnings.push(`${item.name} has no verified activity time. Review the contract schedule; no time has been invented.`);
    activities.push({
      id, label: miniGolf ? "Mini Golf" : item.name, quantity: item.quantity, resourceNames: [], reservationIds: [],
      startAt: interval?.startsAt ?? null, endAt: interval?.endsAt ?? null,
      untimed: miniGolf, cancelled,
      scheduleFingerprint: workspaceFingerprint([interval?.startsAt ?? null, interval?.endsAt ?? null, item.quantity]),
      startedAt: evidenceTime(record, workspaceActivityTaskKey(id, "started")),
      completedAt: evidenceTime(record, workspaceActivityTaskKey(id, "completed")),
      startedBy: record?.taskEvidence?.[workspaceActivityTaskKey(id, "started")]?.employeeName ?? null,
      completedBy: record?.taskEvidence?.[workspaceActivityTaskKey(id, "completed")]?.employeeName ?? null,
    });
  });
  activities.sort((left, right) => left.startAt === null && right.startAt !== null ? 1 : right.startAt === null && left.startAt !== null ? -1 : (left.startAt ?? "").localeCompare(right.startAt ?? "") || left.label.localeCompare(right.label));
  const window = eventWindow;
  const hasFood = event.food.some((item) => item.trim() && !/^(?:no food\b|none\b)/i.test(item.trim()));
  const settings = normalizeWorkspaceSettings(input.settings);
  const sourceFingerprint = workspaceFingerprint([
    String(event.id), event.date, event.name, event.time, String(event.guest_count), JSON.stringify(event.rooms),
    JSON.stringify(event.food), JSON.stringify(event.entertainment), event.source_updated_at ?? null,
    String(cancelled), String(input.scheduleAvailable), String(settings.reminderLeadMinutes),
    ...activities.map((item) => `${item.id}:${item.scheduleFingerprint}:${item.cancelled}`),
  ]);
  return {
    event, kitchenEventId: input.sourceEventIds?.[0] ?? String(event.id), record, activities,
    sourceFingerprint,
    eventStartAt: window?.startsAt ?? null, eventEndAt: window?.endsAt ?? null,
    foodReminderAt: hasFood && window ? new Date(Date.parse(window.startsAt) - 15 * 60_000).toISOString() : null,
    cancelled, sourceAvailable: input.scheduleAvailable, warnings,
    settings,
  };
}

export function workspaceReminders(payload: WorkspacePayload, now: Date, settings = payload.settings): WorkspaceReminder[] {
  if (payload.cancelled || payload.record?.status === "submitted" || !Number.isFinite(now.getTime())) return [];
  const reminders: WorkspaceReminder[] = [];
  const timestamp = now.getTime();
  const make = (id: string, activityId: string | null, stage: WorkspaceReminder["stage"], dueAt: string, label: string) => ({
    id, activityId, stage, dueAt, label,
    state: timestamp < Date.parse(dueAt) ? "upcoming" as const : timestamp === Date.parse(dueAt) ? "due" as const : "overdue" as const,
    acknowledged: payload.record?.tasks[id] === true,
  });
  for (const item of payload.activities) {
    if (item.untimed || item.cancelled || item.startedAt || item.completedAt || !item.startAt) continue;
    const key = `workspace:reminder:${encodeURIComponent(item.id)}:${item.scheduleFingerprint}`;
    const beforeAt = new Date(Date.parse(item.startAt) - normalizeWorkspaceSettings(settings).reminderLeadMinutes * 60_000).toISOString();
    // A late-opened event shows one relevant alert, not every missed past stage.
    if (timestamp < Date.parse(item.startAt)) reminders.push(make(`${key}:before`, item.id, "before", beforeAt, `${item.label} starts soon`));
    reminders.push(make(`${key}:start`, item.id, "start", item.startAt, `${item.label} starts now`));
  }
  if (payload.foodReminderAt && !payload.record?.tasks["food-kitchen-window"]) {
    const id = `workspace:reminder:food:${workspaceFingerprint([payload.eventStartAt, ...payload.event.food])}`;
    reminders.push(make(id, null, "food", payload.foodReminderAt, "Food must be out 15 minutes before the event"));
  }
  return reminders.sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id));
}

/** Only these reserved keys may be written; client objects cannot replace checklist fields. */
export function applyWorkspaceAction(payload: WorkspacePayload, action: WorkspaceAction, now: Date, acceptedRequestIds: readonly string[] = []): { record: ChecklistRecord; changed: boolean } {
  const previous = payload.record;
  if (action.expectedSourceFingerprint !== payload.sourceFingerprint) throw new StaleSaveError("The contract or saved activity schedule changed. Refresh and review the current event before saving.");
  if ((previous?.updatedAt ?? null) !== action.expectedUpdatedAt) throw new StaleSaveError();
  if (payload.cancelled || previous?.status === "submitted") throw new WorkspaceValidationError("This event is closed; workspace changes are unavailable.");
  const actor = (action.employeeName ?? previous?.bwa ?? "").trim();
  if (!actor || actor.length > 120) throw new WorkspaceValidationError("Enter the BWA name before completing workspace actions.");
  if (!Number.isFinite(now.getTime())) throw new WorkspaceValidationError("Invalid action timestamp.");
  let key: string;
  if (action.action === "FULFILL_REQUEST") {
    if (!action.requestId || !acceptedRequestIds.includes(action.requestId)) throw new WorkspaceValidationError("Only this event's accepted food requests may be marked fulfilled.");
    key = `workspace:request:${action.requestId}:fulfilled`;
  } else if (action.action === "FOOD_OUT") {
    if (!payload.foodReminderAt) throw new WorkspaceValidationError("This event has no verified food reminder.");
    key = "food-kitchen-window";
  } else if (action.action === "ACK_REMINDER") {
    const reminder = workspaceReminders(payload, now).find((item) => item.id === action.reminderId);
    if (!reminder || reminder.state === "upcoming") throw new WorkspaceValidationError("This reminder is no longer due. Refresh the event.");
    key = reminder.id;
  } else {
    const item = payload.activities.find((entry) => entry.id === action.activityId);
    if (!item || item.cancelled) throw new WorkspaceValidationError("This activity is unavailable. Refresh the event.");
    if (item.completedAt && action.action === "START_ACTIVITY") return { record: previous!, changed: false };
    key = workspaceActivityTaskKey(item.id, action.action === "START_ACTIVITY" ? "started" : "completed");
  }
  if (previous?.tasks[key]) return { record: previous, changed: false };
  const record: ChecklistRecord = previous ? structuredClone(previous) : {
    eventId: payload.event.id, eventName: payload.event.name, eventDate: payload.event.date,
    poc: "", bwa: "", extrasAdded: "", remainingDrinkCardBalance: "", tasks: {}, taskEvidence: {},
    food: {}, entertainment: {}, status: "draft", updatedAt: null, submittedAt: null,
  };
  record.tasks[key] = true;
  record.taskEvidence = { ...record.taskEvidence, [key]: {
    employeeName: actor, completedAt: now.toISOString(),
    ...(action.action === "FOOD_OUT" ? { sourceFingerprint: setupTaskFingerprint(payload.event, "food-kitchen-window") } : {}),
  } };
  if (action.action === "START_ACTIVITY" || action.action === "COMPLETE_ACTIVITY") {
    const activity = payload.activities.find((item) => item.id === action.activityId)!;
    const stage = action.action === "START_ACTIVITY" ? "started" : "completed";
    for (const id of activity.reservationIds) {
      const reservationKey = workspaceActivityTaskKey(`reservation:${id}`, stage);
      if (record.tasks[reservationKey]) continue;
      record.tasks[reservationKey] = true;
      record.taskEvidence[reservationKey] = { employeeName: actor, completedAt: now.toISOString() };
    }
  }
  return { record, changed: true };
}
