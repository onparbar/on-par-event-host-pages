import type {
  KitchenAddOnActivity,
  KitchenAddOnCompletion,
  KitchenChecklist,
} from "./types";
import { appetizerDropReminder, kitchenLocalMinute } from "./appetizer-drop";
import { kitchenEventInterval } from "./lifecycle";
import { quantityAwareReadinessKey } from "./readiness";

export type KitchenTimedAlert = {
  id: string;
  eventId: string;
  eventName: string;
  kind: "prep" | "ready" | "appetizer-drop";
  scheduledAt: string;
  expiresAt?: string;
};

export type KitchenLiveAddOnAlert = {
  id: string;
  eventId: string;
  eventName: string;
  kind: "add-on";
  itemNames: string[];
  receivedAt: string | null;
};

export type KitchenDashboardAlert =
  | KitchenTimedAlert
  | KitchenLiveAddOnAlert;

export type EventHostCompletionAlert = {
  id: string;
  eventId: string;
  eventName: string;
  itemNames: string[];
};

const LOCAL_MINUTE_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/;

function localMinute(value: string | null) {
  return value?.match(LOCAL_MINUTE_PATTERN)?.[1] ?? null;
}

function adjacentDateKeys(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) {
    return new Set([date]);
  }

  return new Set(
    [-1, 0, 1].map((dayOffset) => {
      const shifted = new Date(value);
      shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
      return shifted.toISOString().slice(0, 10);
    }),
  );
}

export function easternMinuteKey(value: Date) {
  return kitchenLocalMinute(value.getTime());
}

export function kitchenTimedAlerts(
  events: readonly KitchenChecklist[],
  selectedDate: string,
) {
  const alerts: KitchenTimedAlert[] = [];
  const allowedAlertDates = adjacentDateKeys(selectedDate);

  for (const checklist of events) {
    if (checklist.event.localDate !== selectedDate) {
      continue;
    }
    const eventId = String(checklist.event.eventId);
    const candidates: { kind: KitchenTimedAlert["kind"]; scheduledAt: string | null; expiresAt?: string }[] = [
      {
        kind: "prep" as const,
        scheduledAt: localMinute(checklist.timing.earliestPrepTime),
      },
      {
        kind: "ready" as const,
        scheduledAt: localMinute(checklist.timing.foodReadyBy),
      },
    ];
    const drop = appetizerDropReminder(checklist);
    if (drop?.scheduledAt) {
      const completed = new Set(checklist.completedItemKeys);
      const hasUnreadyFood = checklist.sections.flatMap((section) => section.rows).some(
        (row) => drop.itemKeys.includes(row.key) && !completed.has(quantityAwareReadinessKey({
          itemKey: row.key,
          quantity: row.quantity,
          numberOfPans: row.numberOfPans,
          panSize: row.panSize,
          unit: row.unit,
          ruleVersion: checklist.ruleVersion,
        })),
      );
      const interval = kitchenEventInterval(checklist.event);
      const expiresAt = drop.source === "contract"
        ? interval.endAt ?? interval.startAt
        : interval.startAt;
      if (hasUnreadyFood) {
        candidates.push({
          kind: "appetizer-drop",
          scheduledAt: drop.scheduledAt,
          ...(expiresAt !== null ? { expiresAt: kitchenLocalMinute(expiresAt) } : {}),
        });
      }
    }

    for (const candidate of candidates) {
      if (
        candidate.scheduledAt === null ||
        !allowedAlertDates.has(candidate.scheduledAt.slice(0, 10))
      ) {
        continue;
      }
      alerts.push({
        id: `${eventId}:${candidate.kind}:${candidate.scheduledAt}`,
        eventId,
        eventName: checklist.event.name,
        kind: candidate.kind,
        scheduledAt: candidate.scheduledAt,
        ...(candidate.expiresAt ? { expiresAt: candidate.expiresAt } : {}),
      });
    }
  }

  return alerts.sort(
    (left, right) =>
      left.scheduledAt.localeCompare(right.scheduledAt) ||
      left.eventName.localeCompare(right.eventName) ||
      left.kind.localeCompare(right.kind),
  );
}

export function dueKitchenAlerts(
  alerts: readonly KitchenTimedAlert[],
  lastCheckedAt: string,
  currentMinute: string,
  dismissedIds: ReadonlySet<string>,
) {
  return alerts.filter(
    (alert) =>
      alert.scheduledAt > lastCheckedAt &&
      alert.scheduledAt <= currentMinute &&
      (!alert.expiresAt || currentMinute < alert.expiresAt) &&
      !dismissedIds.has(alert.id),
  );
}

export function newlyObservedDueKitchenAlerts(
  alerts: readonly KitchenTimedAlert[],
  knownIds: ReadonlySet<string>,
  currentMinute: string,
  dismissedIds: ReadonlySet<string>,
) {
  return alerts.filter(
    (alert) =>
      !knownIds.has(alert.id) &&
      alert.scheduledAt <= currentMinute &&
      (!alert.expiresAt || currentMinute < alert.expiresAt) &&
      !dismissedIds.has(alert.id),
  );
}

export function currentKitchenAddOnAlerts(
  activity: readonly KitchenAddOnActivity[],
  dismissedIds: ReadonlySet<string>,
): KitchenLiveAddOnAlert[] {
  return activity
    .flatMap((entry) => {
      const id = `${entry.eventId}:add-on-revision:${entry.revision}`;
      return entry.itemNames.length > 0 && !dismissedIds.has(id)
        ? [
            {
              id,
              eventId: entry.eventId,
              eventName: entry.eventName,
              kind: "add-on" as const,
              itemNames: [...new Set(entry.itemNames)],
              receivedAt: entry.updatedAt,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        (left.receivedAt ?? "").localeCompare(right.receivedAt ?? "") ||
        left.eventName.localeCompare(right.eventName) ||
        left.id.localeCompare(right.id),
    );
}

export function currentEventHostCompletionAlerts(
  completions: readonly KitchenAddOnCompletion[],
  dismissedIds: ReadonlySet<string>,
): EventHostCompletionAlert[] {
  return completions
    .flatMap((completion) => {
      const id = `${completion.eventId}:add-on-ready:${completion.itemKey}:${completion.readinessUpdatedAt}`;
      return dismissedIds.has(id)
        ? []
        : [
            {
              id,
              eventId: completion.eventId,
              eventName: completion.eventName,
              itemNames: [completion.foodName],
            },
          ];
    })
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.eventName.localeCompare(right.eventName),
    );
}
