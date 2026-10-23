import { getChecklistRecord, saveChecklist } from "@/lib/checklist-storage";
import type { ChecklistRecord } from "@/lib/checklist-model";
import { getEventPlanStorage, type EventPlanStorage } from "@/lib/event-plans/storage";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { getEntertainmentStorage, type EntertainmentStorage } from "@/lib/entertainment/storage";
import type { EventPlan } from "@/lib/event-plans/types";
import { rollingEventPlanHorizon } from "@/lib/event-plans/horizon";
import { findVipPrepReservationByEventId, vipPrepEventPlan, vipPrepExternalId } from "@/lib/vip-prep/client";
import { operationalKitchenEventId } from "@/lib/vip-prep/identity";
import { getFloorPlanStorage, type FloorPlanStorage } from "@/lib/floor-plans/storage";
import { itineraryIdentityScope } from "@/lib/itineraries/entertainment";
import { ADMIN_STATE_EVENT_ID } from "@/lib/admin-state";
import { StaleSaveError } from "@/lib/stale-save";
import type { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { applyWorkspaceAction, buildWorkspacePayload, normalizeWorkspaceSettings, workspaceActivityEvidence, WorkspaceValidationError, type WorkspaceAction, type WorkspaceSettings } from "./workspace";

export const WORKSPACE_SETTINGS_KEY = "workspace:settings";
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
  const row = await plans.findById(String(id));
  let event: EventPlan | null = row && isEventPlan(row.plan, id) ? structuredClone(row.plan) : null;
  let sourceEventId = String(id);
  let cancelled = Boolean(row && (!row.active || /^(?:cancelled|canceled|lost|prospect)$/i.test(String(row.sourceSnapshot.status ?? ""))));
  if (!row && !event) event = await (options.findFallback ?? findEventPlanById)(id);
  if (!event) {
    const horizon = rollingEventPlanHorizon();
    const reservation = await (options.findVip ?? findVipPrepReservationByEventId)(id, date ?? horizon.startDate, date ?? horizon.endDate);
    if (!reservation || (requestedEventId.startsWith("vip-") && vipPrepExternalId(reservation) !== requestedEventId)) return null;
    event = vipPrepEventPlan(reservation);
    sourceEventId = vipPrepExternalId(reservation);
    cancelled = /^(?:cancelled|canceled)$/i.test(reservation.status);
  }
  if (date && event.date !== date) return null;
  const warnings: string[] = [];
  const [record, admin] = await Promise.all([getRecord(id), getRecord(ADMIN_STATE_EVENT_ID)]);
  const floorPlan = await (options.floorPlans ?? getFloorPlanStorage()).get(event.date).catch(() => {
    warnings.push("Saved floor-plan event links are unavailable; only exact event IDs are used.");
    return null;
  });
  const identityScope = itineraryIdentityScope(event, floorPlan, Boolean(floorPlan));
  const sourceEventIds = [...new Set([sourceEventId, ...(identityScope.sourceEventIds ?? [])])];
  let reservations: Awaited<ReturnType<EntertainmentStorage["getDay"]>>["reservations"] = [];
  let scheduleAvailable = false;
  try {
    const day = await (options.entertainment ?? getEntertainmentStorage()).getDay(event.date);
    reservations = day.reservations;
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
  let acceptedRequestIds: string[] = [];
  if (action.action === "FULFILL_REQUEST") {
    if (!action.requestId || !/^[A-Za-z0-9-]{1,160}$/.test(action.requestId)) throw new WorkspaceValidationError("Invalid food request.");
    const deliveries = options.deliveries ?? new (await import("@/lib/gotab/storage")).GoTabIntegrationStorage();
    const ids = [...new Set([String(payload.event.id), payload.kitchenEventId])];
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
