import { getChecklistRecord, saveChecklist } from "@/lib/checklist-storage";
import type { ChecklistRecord } from "@/lib/checklist-model";
import { getEventPlanStorage, type EventPlanStorage } from "@/lib/event-plans/storage";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { getEntertainmentStorage, type EntertainmentStorage } from "@/lib/entertainment/storage";
import type { EventPlan } from "@/lib/event-plans/types";
import { rollingEventPlanHorizon } from "@/lib/event-plans/horizon";
import { findVipPrepReservationByEventId, VipPrepApiError, vipPrepEventPlan, vipPrepExternalId } from "@/lib/vip-prep/client";
import { operationalKitchenEventId } from "@/lib/vip-prep/identity";
import { getFloorPlanStorage, type FloorPlanStorage } from "@/lib/floor-plans/storage";
import { floorPlanEventSourceIds } from "@/lib/floor-plans/identity";
import { itineraryIdentityScope } from "@/lib/itineraries/entertainment";
import { ADMIN_STATE_EVENT_ID } from "@/lib/admin-state";
import { StaleSaveError } from "@/lib/stale-save";
import type { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { applyWorkspaceAction, buildWorkspacePayload, normalizeWorkspaceSettings, workspaceActivityEvidence, WorkspaceValidationError, type WorkspaceAction, type WorkspaceSettings } from "./workspace";

export const WORKSPACE_SETTINGS_KEY = "workspace:settings";
const READ_ONLY_IDENTITY_WARNING = "Read-only: the legacy numeric checklist identity is ambiguous or belongs to another date. No saved staff record is attached; saving is blocked until source ownership is reconciled.";
type WorkspaceStorageOptions = {
  plans?: Pick<EventPlanStorage, "findById">;
  findFallback?: typeof findEventPlanById;
  entertainment?: Pick<EntertainmentStorage, "getDay">;
  floorPlans?: Pick<FloorPlanStorage, "get">;
  getRecord?: typeof getChecklistRecord;
  saveRecord?: typeof saveChecklist;
  findVip?: typeof findVipPrepReservationByEventId;
  now?: () => Date;
  deliveries?: Pick<GoTabIntegrationStorage, "listEventFoodDelivery">;
};

function isEventPlan(value: unknown, id: number): value is EventPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<EventPlan>;
  return plan.id === id && typeof plan.name === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan.date ?? "") &&
    typeof plan.time === "string" && Array.isArray(plan.food) && Array.isArray(plan.entertainment) && Array.isArray(plan.rooms);
}

/** Read-only source access. Never call kitchen sync, VIP check-in, or a GoTab worker here. */
export async function loadEventWorkspace(requestedEventId: string, date: string | null = null, options: WorkspaceStorageOptions = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestedEventId)) return null;
  const canonicalId = operationalKitchenEventId(requestedEventId);
  if (!/^\d+$/.test(canonicalId) || !Number.isSafeInteger(Number(canonicalId)) || Number(canonicalId) <= 0) return null;
  const id = Number(canonicalId);
  const plans = options.plans ?? getEventPlanStorage();
  const getRecord = options.getRecord ?? getChecklistRecord;
  const findVip = options.findVip ?? findVipPrepReservationByEventId;
  const horizon = rollingEventPlanHorizon();
  const canonicalVip = requestedEventId.startsWith("vip-");
  const warnings: string[] = [];
  let unsafeRecordIdentity = false;
  const row = await plans.findById(String(id));
  let event: EventPlan | null = !canonicalVip && row && isEventPlan(row.plan, id) ? structuredClone(row.plan) : null;
  let sourceEventId = String(id);
  let cancelled = Boolean(row && (!row.active || /^(?:cancelled|canceled|lost|prospect)$/i.test(String(row.sourceSnapshot.status ?? ""))));
  if (!canonicalVip && !row && !event) event = await (options.findFallback ?? findEventPlanById)(id);
  let reservation = null;
  try {
    reservation = await findVip(canonicalVip ? requestedEventId : id, date ?? event?.date ?? horizon.startDate, date ?? event?.date ?? horizon.endDate);
  } catch (error) {
    if (!event || error instanceof VipPrepApiError && error.message === "VIP booking identity is ambiguous. Use the source reservation ID.") return null;
    warnings.push("VIP identity collision checks are unavailable. The exact corporate source is shown; no VIP source has been substituted.");
  }
  if (canonicalVip) {
    if (!reservation || vipPrepExternalId(reservation) !== requestedEventId) return null;
    event = vipPrepEventPlan(reservation);
    sourceEventId = vipPrepExternalId(reservation);
    cancelled = /^(?:cancelled|canceled)$/i.test(reservation.status);
    unsafeRecordIdentity = Boolean(row);
    try {
      const numericOwner = await findVip(id, reservation.operatingDate, reservation.operatingDate);
      if (!numericOwner || vipPrepExternalId(numericOwner) !== requestedEventId) unsafeRecordIdentity = true;
    } catch { unsafeRecordIdentity = true; }
  } else if (reservation) {
    // A legacy numeric URL cannot choose between corporate and VIP ownership.
    if (event) return null;
    event = vipPrepEventPlan(reservation);
    sourceEventId = vipPrepExternalId(reservation);
    cancelled = /^(?:cancelled|canceled)$/i.test(reservation.status);
  }
  if (!event) return null;
  if (date && event.date !== date) return null;
  const [storedRecord, admin] = await Promise.all([getRecord(id), getRecord(ADMIN_STATE_EVENT_ID)]);
  if (canonicalVip && storedRecord && !row && !unsafeRecordIdentity) {
    try { unsafeRecordIdentity = Boolean(await (options.findFallback ?? findEventPlanById)(id)); }
    catch { unsafeRecordIdentity = true; }
  }
  if (storedRecord && storedRecord.eventDate !== event.date) unsafeRecordIdentity = true;
  if (unsafeRecordIdentity) warnings.push(READ_ONLY_IDENTITY_WARNING);
  const record = unsafeRecordIdentity ? null : storedRecord;
  const floorPlan = await (options.floorPlans ?? getFloorPlanStorage()).get(event.date).catch(() => {
    warnings.push("Saved floor-plan event links are unavailable; only exact event IDs are used.");
    return null;
  });
  const linkedVipEvents = sourceEventId.startsWith("vip-") && floorPlan?.eventDate === event.date
    ? floorPlan.events.filter((entry) => floorPlanEventSourceIds(entry).has(sourceEventId)) : [];
  const identityScope = sourceEventId.startsWith("vip-")
    ? { sourceEventIds: linkedVipEvents.length === 1 ? [...floorPlanEventSourceIds(linkedVipEvents[0])] : [] }
    : itineraryIdentityScope(event, floorPlan, Boolean(floorPlan));
  const sourceEventIds = [...new Set([sourceEventId, ...(identityScope.sourceEventIds ?? [])])];
  let reservations: Awaited<ReturnType<EntertainmentStorage["getDay"]>>["reservations"] = [];
  let scheduleAvailable = false;
  try {
    const day = await (options.entertainment ?? getEntertainmentStorage()).getDay(event.date);
    reservations = sourceEventId.startsWith("vip-") ? day.reservations.filter((entry) => sourceEventIds.includes(entry.localEventId ?? "") || sourceEventIds.includes(entry.tripleseatEventId ?? "")) : day.reservations;
    scheduleAvailable = day.events.some((entry) => sourceEventIds.includes(entry.localEventId ?? "") || sourceEventIds.includes(entry.tripleseatEventId)) ||
      reservations.some((entry) => sourceEventIds.includes(entry.localEventId ?? "") || sourceEventIds.includes(entry.tripleseatEventId ?? ""));
    if (!scheduleAvailable) warnings.push("No matching saved entertainment schedule. Contract timing is shown without assigning resources.");
  } catch {
    warnings.push("The saved entertainment schedule is unavailable. Refresh before relying on activity times.");
  }
  const settings = normalizeWorkspaceSettings((admin?.tasks as Record<string, unknown> | undefined)?.[WORKSPACE_SETTINGS_KEY]);
  return buildWorkspacePayload({ event, record, reservations, sourceEventIds, scheduleAvailable, cancelled, warnings, settings });
}

export async function saveEventWorkspaceAction(requestedEventId: string, date: string | null, action: WorkspaceAction, options: WorkspaceStorageOptions = {}) {
  const payload = await loadEventWorkspace(requestedEventId, date, options);
  if (!payload) return null;
  if (payload.warnings.includes(READ_ONLY_IDENTITY_WARNING)) throw new WorkspaceValidationError(READ_ONLY_IDENTITY_WARNING);
  if (requestedEventId.startsWith("vip-") && !payload.record) {
    // Do not create a first shared numeric record over an existing fallback
    // corporate source; this ownership read is unnecessary for ordinary views.
    let fallback;
    try { fallback = await (options.findFallback ?? findEventPlanById)(payload.event.id); }
    catch { throw new WorkspaceValidationError(READ_ONLY_IDENTITY_WARNING); }
    if (fallback) throw new WorkspaceValidationError(READ_ONLY_IDENTITY_WARNING);
  }
  let acceptedRequestIds: string[] = [];
  if (action.action === "FULFILL_REQUEST") {
    if (!action.requestId || !/^[A-Za-z0-9-]{1,160}$/.test(action.requestId)) throw new WorkspaceValidationError("Invalid food request.");
    const deliveries = options.deliveries ?? new (await import("@/lib/gotab/storage")).GoTabIntegrationStorage();
    const ids = payload.kitchenEventId.startsWith("vip-") ? [payload.kitchenEventId] : [...new Set([String(payload.event.id), payload.kitchenEventId])];
    const matches = await deliveries.listEventFoodDelivery(ids, [action.requestId]);
    acceptedRequestIds = matches.filter((item) => ids.includes(item.eventId) && item.requestId === action.requestId && item.status === "SENT").map((item) => item.requestId);
  }
  const result = applyWorkspaceAction(payload, action, (options.now ?? (() => new Date()))(), acceptedRequestIds);
  if (!result.changed) return payload;
  const current = result.record;
  const record = await (options.saveRecord ?? saveChecklist)({
    action: "save", eventId: current.eventId, eventName: current.eventName, eventDate: current.eventDate, poc: current.poc,
    expectedUpdatedAt: action.expectedUpdatedAt,
    checklist: {
      bwa: current.bwa, extrasAdded: current.extrasAdded, remainingDrinkCardBalance: current.remainingDrinkCardBalance,
      tasks: current.tasks, taskEvidence: current.taskEvidence, entertainment: current.entertainment, food: current.food,
    },
  });
  return {
    ...payload, record,
    activities: payload.activities.map((activity) => {
      const started = workspaceActivityEvidence(record, activity, "started");
      const completed = workspaceActivityEvidence(record, activity, "completed");
      return { ...activity, startedAt: started.at, startedBy: started.by, completedAt: completed.at, completedBy: completed.by };
    }),
  };
}

export async function loadWorkspaceSettings(options: Pick<WorkspaceStorageOptions, "getRecord"> = {}) {
  const record = await (options.getRecord ?? getChecklistRecord)(ADMIN_STATE_EVENT_ID);
  return { settings: normalizeWorkspaceSettings((record?.tasks as Record<string, unknown> | undefined)?.[WORKSPACE_SETTINGS_KEY]), updatedAt: record?.updatedAt ?? null };
}

export async function saveWorkspaceSettings(settings: WorkspaceSettings, expectedUpdatedAt: string | null, options: Pick<WorkspaceStorageOptions, "getRecord" | "saveRecord"> = {}) {
  const normalized = normalizeWorkspaceSettings(settings);
  if (normalized.reminderLeadMinutes !== settings.reminderLeadMinutes) throw new WorkspaceValidationError("Reminder lead time must be a whole number from 1 to 60 minutes.");
  const record = await (options.getRecord ?? getChecklistRecord)(ADMIN_STATE_EVENT_ID);
  if ((record?.updatedAt ?? null) !== expectedUpdatedAt) throw new StaleSaveError();
  const saved = await (options.saveRecord ?? saveChecklist)({
    action: "save", eventId: ADMIN_STATE_EVENT_ID, eventName: record?.eventName ?? "__admin_state__", eventDate: record?.eventDate ?? "2099-12-31",
    poc: record?.poc ?? "Admin State", expectedUpdatedAt,
    checklist: {
      bwa: record?.bwa ?? "admin-state-v1", extrasAdded: record?.extrasAdded ?? "", remainingDrinkCardBalance: record?.remainingDrinkCardBalance ?? "",
      tasks: { ...record?.tasks, [WORKSPACE_SETTINGS_KEY]: normalized }, taskEvidence: record?.taskEvidence,
      entertainment: record?.entertainment ?? {}, food: record?.food ?? {},
    },
  });
  return { settings: normalized, updatedAt: saved.updatedAt };
}
