import { detectEntertainmentConflicts } from "@/lib/entertainment/domain";
import { parseTimeRange } from "@/lib/entertainment/time";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import {
  entertainmentEvidenceForSource,
  type EventPlanEntertainmentEvidence,
} from "@/lib/event-plans/domain";
import { eventPlanToday } from "@/lib/event-plans/horizon";
import type { EventPlan, TripleseatEventPlanSource } from "@/lib/event-plans/types";
import { resolveAreaAlias } from "@/lib/floor-plans/configuration/aliases";
import {
  getAreaForEntertainmentResource,
  getFloorPlanArea,
} from "@/lib/floor-plans/configuration/areas";
import { detectFloorPlanConflicts, timeRangesOverlap } from "@/lib/floor-plans/conflicts";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import type { KitchenChecklist, KitchenWarningCode } from "@/lib/kitchen/types";

export const ADMIN_OPERATIONS_LOOKAHEAD_DAYS = 7;

export function adminOperationsWindow(
  now: Date,
  lookaheadDays = ADMIN_OPERATIONS_LOOKAHEAD_DAYS,
) {
  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 0) {
    throw new Error("Admin operations lookahead must be a non-negative whole number.");
  }
  const startDate = eventPlanToday(now);
  const end = new Date(`${startDate}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + lookaheadDays);
  return {
    startDate,
    endDate: end.toISOString().slice(0, 10),
  };
}

export type AdminCompletenessStatus =
  | "complete"
  | "missing"
  | "needs-review"
  | "not-applicable";

export type AdminCompletenessKey =
  | "end-time"
  | "reserved-section"
  | "food-service-time"
  | "entertainment-duration"
  | "guest-count"
  | "food-quantities"
  | "floor-plan"
  | "staff-assignments";

export type AdminCompletenessCheck = {
  key: AdminCompletenessKey;
  label: string;
  status: AdminCompletenessStatus;
  detail: string;
};

export type AdminEventCompleteness = {
  eventId: number;
  eventName: string;
  date: string;
  time: string;
  color: string;
  issueCount: number;
  checks: AdminCompletenessCheck[];
};

export type AdminConflictKind =
  | "contracted-room"
  | "floor-plan"
  | "entertainment"
  | "combined";

export type AdminOperationsConflict = {
  id: string;
  date: string;
  kind: AdminConflictKind;
  resourceId: string;
  resourceName: string;
  eventIds: string[];
  eventNames: string[];
  eventColors: string[];
  startAt: string;
  endAt: string;
  blocking: boolean;
};

export type AdminOperationsPayload = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  completeness: AdminEventCompleteness[];
  conflicts: AdminOperationsConflict[];
  warnings: string[];
};

export type AdminContractEvidenceRow = {
  key: string;
  field: string;
  importedValue: string;
  sourceKind: "Structured Tripleseat field" | "Contract selection" | "Contract line item" | "Derived default" | "Evidence unavailable";
  sourceText: string;
  sourceReference: string | null;
};

export type AdminContractEvidence = {
  eventId: number;
  eventName: string;
  eventDate: string;
  sourceEventId: string | null;
  sourceBookingId: string | null;
  sourceUpdatedAt: string | null;
  rows: AdminContractEvidenceRow[];
};

const QUANTITY_WARNING_CODES = new Set<KitchenWarningCode>([
  "NO_FOOD_SELECTIONS",
  "INVALID_SELECTION_QUANTITY",
  "CONFLICTING_QUANTITY",
  "UNAPPROVED_PLATTER_QUANTITY",
  "UNAPPROVED_PLATTER_PACKING",
  "UNRESOLVED_TACO_ADD_ON",
  "UNRESOLVED_SAUCE_QUANTITY",
]);

function check(
  key: AdminCompletenessKey,
  label: string,
  status: AdminCompletenessStatus,
  detail: string,
): AdminCompletenessCheck {
  return { key, label, status, detail };
}

function sourceRange(source: TripleseatEventPlanSource | null) {
  if (!source?.eventStartAt || !source.eventEndAt) {
    return null;
  }
  const start = Date.parse(source.eventStartAt);
  const end = Date.parse(source.eventEndAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { startAt: source.eventStartAt, endAt: source.eventEndAt }
    : null;
}

function eventRange(plan: EventPlan, source: TripleseatEventPlanSource | null) {
  return sourceRange(source) ?? parseTimeRange(plan.time, plan.date);
}

function miniGolfOnly(value: string) {
  return /\b(?:mini\s*golf|putt\s*putt)\b/i.test(value);
}

function entertainmentEvidenceKey(
  item: EventPlan["entertainment"][number],
  field: keyof EventPlan["entertainment"][number],
) {
  return [item.name, item[field]]
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .join("|");
}

function entertainmentEvidenceSource(
  retained: EventPlanEntertainmentEvidence | undefined,
): Pick<
  AdminContractEvidenceRow,
  "sourceKind" | "sourceText" | "sourceReference"
> {
  return retained
    ? {
        sourceKind:
          retained.sourceType === "selection"
            ? "Contract selection"
            : "Contract line item",
        sourceText: retained.sourceText,
        sourceReference: retained.sourceId,
      }
    : {
        sourceKind: "Evidence unavailable",
        sourceText: "",
        sourceReference: null,
      };
}

export function evaluateEventCompleteness({
  plan,
  source,
  kitchen,
  floorPlan,
}: {
  plan: EventPlan;
  source: TripleseatEventPlanSource | null;
  kitchen: KitchenChecklist | null;
  floorPlan: FloorPlanDocument | null;
}): AdminEventCompleteness {
  const range = sourceRange(source);
  const normalizedRange = parseTimeRange(plan.time, plan.date);
  const endTime = range
    ? check("end-time", "End time", "complete", "Verified from the structured Tripleseat event end.")
    : normalizedRange
      ? check("end-time", "End time", "needs-review", "A normalized end time exists, but an exact source end was not retained.")
      : check("end-time", "End time", "missing", "No valid event end time is available.");

  const sourceRooms = source?.rooms.filter(Boolean) ?? [];
  const reservedSection = sourceRooms.length
    ? check("reserved-section", "Reserved section", "complete", sourceRooms.join(", "))
    : plan.rooms.length
      ? check("reserved-section", "Reserved section", "needs-review", `${plan.rooms.join(", ")} is normalized without matching source evidence.`)
      : check("reserved-section", "Reserved section", "missing", "No reserved room or seating section is available.");

  const foodServiceTime = kitchen?.timing.foodReadyBy
    ? check("food-service-time", "Food service time", "needs-review", "Food-ready time is derived from the event start; an explicit contract service time is not stored.")
    : check("food-service-time", "Food service time", "missing", "No explicit or derived food service time is available.");

  const timedEntertainment = plan.entertainment.filter(
    (item) => !miniGolfOnly(item.name),
  );
  const missingEntertainmentDuration = timedEntertainment.some((item) =>
    !item.duration.trim() ||
    /(?:not listed|needs review|not available|unknown)/i.test(item.duration),
  );
  const supportedEntertainment = source
    ? new Set(
        entertainmentEvidenceForSource(source).map(({ item }) =>
          entertainmentEvidenceKey(item, "duration"),
        ),
      )
    : new Set<string>();
  const hasUnsupportedEntertainment = timedEntertainment.some(
    (item) =>
      !supportedEntertainment.has(entertainmentEvidenceKey(item, "duration")),
  );
  const entertainmentDuration = timedEntertainment.length === 0
    ? check("entertainment-duration", "Entertainment duration", "not-applicable", "No reservable entertainment requires a duration.")
    : missingEntertainmentDuration
      ? check("entertainment-duration", "Entertainment duration", "missing", "One or more entertainment reservations are missing a verified duration.")
      : hasUnsupportedEntertainment
        ? check("entertainment-duration", "Entertainment duration", "needs-review", "A duration is normalized, but retained source evidence does not support every entertainment item.")
        : check("entertainment-duration", "Entertainment duration", "complete", "All reservable entertainment durations are supported by retained Tripleseat source items.");

  const guestCount = source?.guestCount != null && source.guestCount > 0
    ? check("guest-count", "Guest count", "complete", `${source.guestCount} guests from Tripleseat.`)
    : plan.guest_count > 0
      ? check("guest-count", "Guest count", "needs-review", `${plan.guest_count} guests are normalized without matching structured source evidence.`)
      : check("guest-count", "Guest count", "missing", "No positive guest count is available.");

  const kitchenRows = kitchen?.sections.flatMap((section) => section.rows) ?? [];
  const quantityWarnings = kitchen?.warnings.filter((warning) =>
    QUANTITY_WARNING_CODES.has(warning.code),
  ) ?? [];
  const foodQuantities = kitchenRows.length === 0
    ? check("food-quantities", "Food quantities", "missing", "No operational food quantities are available.")
    : kitchenRows.some((row) => row.quantity === null) || quantityWarnings.length > 0
      ? check("food-quantities", "Food quantities", "missing", quantityWarnings[0]?.message ?? "One or more food quantities are unresolved.")
      : check("food-quantities", "Food quantities", "complete", `${kitchenRows.length} operational food line${kitchenRows.length === 1 ? "" : "s"} have quantities.`);

  const floorPlanEvent = floorPlan?.events.find(
    (event) => event.tripleseatEventId === String(plan.id),
  );
  const floorPlanAssignments = floorPlanEvent
    ? floorPlan!.reservations.filter(
        (reservation) => reservation.floorPlanEventId === floorPlanEvent.id,
      )
    : [];
  const floorPlanCheck = !floorPlan
    ? check("floor-plan", "Floor plan", "missing", "No structured floor plan has been saved for this date.")
    : !floorPlanEvent || floorPlanAssignments.length === 0
      ? check("floor-plan", "Floor plan", "missing", "The saved floor plan has no assignments for this event.")
      : floorPlan.status === "Approved" || floorPlan.status === "Completed"
        ? check("floor-plan", "Floor plan", "complete", `${floorPlan.status} with ${floorPlanAssignments.length} assignment${floorPlanAssignments.length === 1 ? "" : "s"}.`)
        : check("floor-plan", "Floor plan", "needs-review", `${floorPlan.status} with ${floorPlanAssignments.length} saved assignment${floorPlanAssignments.length === 1 ? "" : "s"}.`);

  const staffAssignments = !kitchen?.foodRunnerOrBwa.trim()
    ? check("staff-assignments", "Staff assignments", "missing", "No Food Runner/BWA assignment is saved.")
    : check("staff-assignments", "Staff assignments", "needs-review", `${kitchen.foodRunnerOrBwa} is saved in the legacy BWA field; separate POC and FR roles are not yet available.`);

  const checks = [
    endTime,
    reservedSection,
    foodServiceTime,
    entertainmentDuration,
    guestCount,
    foodQuantities,
    floorPlanCheck,
    staffAssignments,
  ];
  return {
    eventId: plan.id,
    eventName: plan.name,
    date: plan.date,
    time: plan.time,
    color: plan.color,
    issueCount: checks.filter(
      (item) => item.status === "missing" || item.status === "needs-review",
    ).length,
    checks,
  };
}

function intersection(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
) {
  return {
    startAt: Date.parse(leftStart) >= Date.parse(rightStart) ? leftStart : rightStart,
    endAt: Date.parse(leftEnd) <= Date.parse(rightEnd) ? leftEnd : rightEnd,
  };
}

function conflictKey(conflict: AdminOperationsConflict) {
  const normalizedStart = Date.parse(conflict.startAt);
  const normalizedEnd = Date.parse(conflict.endAt);
  return [
    conflict.date,
    conflict.resourceId,
    [...conflict.eventIds].sort().join("|"),
    Number.isFinite(normalizedStart) ? normalizedStart : conflict.startAt,
    Number.isFinite(normalizedEnd) ? normalizedEnd : conflict.endAt,
  ].join("::");
}

function mergeConflict(
  current: AdminOperationsConflict,
  incoming: AdminOperationsConflict,
) {
  const kinds = new Set([current.kind, incoming.kind]);
  return {
    ...current,
    kind: kinds.size === 1 ? current.kind : "combined",
    eventIds: [...new Set([...current.eventIds, ...incoming.eventIds])],
    eventNames: [...new Set([...current.eventNames, ...incoming.eventNames])],
    eventColors: [...new Set([...current.eventColors, ...incoming.eventColors])],
    blocking: current.blocking || incoming.blocking,
  } satisfies AdminOperationsConflict;
}

export function buildAdminConflictCenter({
  date,
  plans,
  floorPlan,
  entertainmentReservations,
}: {
  date: string;
  plans: ReadonlyArray<{
    plan: EventPlan;
    source: TripleseatEventPlanSource | null;
  }>;
  floorPlan: FloorPlanDocument | null;
  entertainmentReservations: readonly EntertainmentReservation[];
}) {
  const conflicts: AdminOperationsConflict[] = [];

  for (let leftIndex = 0; leftIndex < plans.length; leftIndex += 1) {
    const left = plans[leftIndex];
    const leftRange = eventRange(left.plan, left.source);
    if (!leftRange) continue;
    const leftAreas = new Set(
      (left.source?.rooms ?? left.plan.rooms)
        .map(resolveAreaAlias)
        .filter((areaId): areaId is string => {
          const area = areaId ? getFloorPlanArea(areaId) : null;
          return area?.type === "room" || area?.type === "seating-section";
        }),
    );
    for (let rightIndex = leftIndex + 1; rightIndex < plans.length; rightIndex += 1) {
      const right = plans[rightIndex];
      const rightRange = eventRange(right.plan, right.source);
      if (!rightRange || !timeRangesOverlap(leftRange.startAt, leftRange.endAt, rightRange.startAt, rightRange.endAt)) continue;
      const rightAreas = new Set(
        (right.source?.rooms ?? right.plan.rooms)
          .map(resolveAreaAlias)
          .filter((areaId): areaId is string => {
            const area = areaId ? getFloorPlanArea(areaId) : null;
            return area?.type === "room" || area?.type === "seating-section";
          }),
      );
      const sharedAreaIds = leftAreas.has("facility") && rightAreas.size > 0
        ? ["facility"]
        : rightAreas.has("facility") && leftAreas.size > 0
          ? ["facility"]
          : [...leftAreas].filter((areaId) => rightAreas.has(areaId));
      for (const areaId of sharedAreaIds) {
        const overlap = intersection(leftRange.startAt, leftRange.endAt, rightRange.startAt, rightRange.endAt);
        conflicts.push({
          id: `contracted:${date}:${areaId}:${left.plan.id}:${right.plan.id}`,
          date,
          kind: "contracted-room",
          resourceId: areaId,
          resourceName: getFloorPlanArea(areaId)?.name ?? areaId,
          eventIds: [
            left.source?.eventId || String(left.plan.id),
            right.source?.eventId || String(right.plan.id),
          ],
          eventNames: [left.plan.name, right.plan.name],
          eventColors: [left.plan.color, right.plan.color],
          ...overlap,
          blocking: true,
        });
      }
    }
  }

  if (floorPlan) {
    for (const item of detectFloorPlanConflicts(floorPlan)) {
      const canonicalEventIds = item.eventIds.map((eventId) => {
        const event = floorPlan.events.find((candidate) => candidate.id === eventId);
        return event?.tripleseatEventId || eventId;
      });
      conflicts.push({
        id: `floor:${item.id}`,
        date,
        kind: "floor-plan",
        resourceId: item.areaId,
        resourceName: getFloorPlanArea(item.areaId)?.name ?? item.areaId,
        eventIds: canonicalEventIds,
        eventNames: [...item.eventNames],
        eventColors: item.eventIds.flatMap((eventId) => {
          const color = floorPlan.events.find((event) => event.id === eventId)?.color;
          return color ? [color] : [];
        }),
        startAt: item.startAt,
        endAt: item.endAt,
        blocking: item.blocking,
      });
    }
  }

  const activeEntertainment = entertainmentReservations.filter(
    (reservation) => reservation.active && reservation.resourceCategory !== "mini-golf",
  );
  for (const item of detectEntertainmentConflicts(activeEntertainment)) {
    const area = getAreaForEntertainmentResource(item.resourceId);
    const related = activeEntertainment.filter((reservation) =>
      item.reservationIds.includes(reservation.id),
    );
    conflicts.push({
      id: `entertainment:${item.id}`,
      date,
      kind: "entertainment",
      resourceId: area?.id ?? item.resourceId,
      resourceName: area?.name ?? item.resourceName,
      eventIds: related.map(
        (reservation) =>
          reservation.tripleseatEventId ||
          reservation.localEventId ||
          reservation.id,
      ),
      eventNames: [...item.eventNames],
      eventColors: related.map((reservation) => reservation.eventColor),
      startAt: item.startAt,
      endAt: item.endAt,
      blocking: true,
    });
  }

  const byKey = new Map<string, AdminOperationsConflict>();
  for (const item of conflicts) {
    const key = conflictKey(item);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeConflict(previous, item) : item);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      Date.parse(left.startAt) - Date.parse(right.startAt) ||
      left.resourceName.localeCompare(right.resourceName),
  );
}

function safeEvidenceText(value: string) {
  const redacted = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone redacted]")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<]+/gi, "[link redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > 600 ? `${redacted.slice(0, 599).trimEnd()}…` : redacted;
}

function evidenceRow(
  row: AdminContractEvidenceRow,
): AdminContractEvidenceRow {
  return {
    ...row,
    importedValue: safeEvidenceText(row.importedValue) || "Not available",
    sourceText: safeEvidenceText(row.sourceText) || "Evidence not captured; reimport may be required.",
  };
}

export function buildAdminContractEvidence(
  plan: EventPlan,
  source: TripleseatEventPlanSource | null,
  kitchen: KitchenChecklist | null,
): AdminContractEvidence {
  const entertainmentEvidence = source
    ? entertainmentEvidenceForSource(source)
    : [];
  const entertainmentRows = plan.entertainment.length
    ? plan.entertainment.flatMap((item, index) => {
        const retainedFor = (
          field: keyof EventPlan["entertainment"][number],
        ) =>
          entertainmentEvidence.find(
            ({ item: retained }) =>
              entertainmentEvidenceKey(retained, field) ===
              entertainmentEvidenceKey(item, field),
          );
        const label = `${item.name} ${index + 1}`;
        return [
          evidenceRow({ key: `entertainment-${index}-resource`, field: `${label} — resource`, importedValue: item.name, ...entertainmentEvidenceSource(retainedFor("name")) }),
          evidenceRow({ key: `entertainment-${index}-quantity`, field: `${label} — quantity`, importedValue: item.quantity, ...entertainmentEvidenceSource(retainedFor("quantity")) }),
          evidenceRow({ key: `entertainment-${index}-time`, field: `${label} — time`, importedValue: item.time, ...entertainmentEvidenceSource(retainedFor("time")) }),
          evidenceRow({ key: `entertainment-${index}-duration`, field: `${label} — duration`, importedValue: item.duration, ...entertainmentEvidenceSource(retainedFor("duration")) }),
        ];
      })
    : [
        evidenceRow({
          key: "entertainment-none",
          field: "Entertainment",
          importedValue: "None imported",
          sourceKind: "Evidence unavailable",
          sourceText: "",
          sourceReference: null,
        }),
      ];
  const rows: AdminContractEvidenceRow[] = [
    evidenceRow({
      key: "event-name",
      field: "Event name",
      importedValue: plan.name,
      sourceKind: source?.eventName.trim() ? "Structured Tripleseat field" : "Evidence unavailable",
      sourceText: source?.eventName ?? "",
      sourceReference: source?.eventId ?? null,
    }),
    evidenceRow({
      key: "event-time",
      field: "Event time",
      importedValue: plan.time,
      sourceKind: sourceRange(source) ? "Structured Tripleseat field" : "Evidence unavailable",
      sourceText: source ? `${source.eventStartAt ?? "Start missing"} to ${source.eventEndAt ?? "End missing"}` : "",
      sourceReference: source?.eventId ?? null,
    }),
    evidenceRow({
      key: "guest-count",
      field: "Guest count",
      importedValue: `${plan.guest_count}`,
      sourceKind: source?.guestCount != null ? "Structured Tripleseat field" : "Evidence unavailable",
      sourceText: source?.guestCount == null ? "" : `${source.guestCount} guests`,
      sourceReference: source?.eventId ?? null,
    }),
    evidenceRow({
      key: "reserved-sections",
      field: "Reserved section",
      importedValue: plan.rooms.join(", ") || "Not available",
      sourceKind: source?.rooms.length ? "Structured Tripleseat field" : "Evidence unavailable",
      sourceText: source?.rooms.join(", ") ?? "",
      sourceReference: source?.eventId ?? null,
    }),
    evidenceRow({
      key: "food-service-time",
      field: "Food service time",
      importedValue: kitchen?.timing.foodReadyBy ?? "Not available",
      sourceKind: kitchen?.timing.foodReadyBy ? "Derived default" : "Evidence unavailable",
      sourceText: kitchen?.timing.foodReadyBy
        ? "Derived by the Kitchen rule from the event start; no explicit contract service-time field is stored."
        : "",
      sourceReference: null,
    }),
    evidenceRow({
      key: "food-selections",
      field: "Food selections",
      importedValue: plan.food.join(" · ") || "None imported",
      sourceKind: source?.selections.length ? "Contract selection" : "Evidence unavailable",
      sourceText: source?.selections.map((selection) => `${selection.quantity ?? "quantity not listed"} × ${selection.name}`).join(" · ") ?? "",
      sourceReference: source?.selections.map((selection) => selection.sourceId).filter(Boolean).join(", ") || null,
    }),
    ...entertainmentRows,
  ];

  return {
    eventId: plan.id,
    eventName: plan.name,
    eventDate: plan.date,
    sourceEventId: source?.eventId ?? null,
    sourceBookingId: source?.bookingId ?? null,
    sourceUpdatedAt: source?.sourceUpdatedAt ?? plan.source_updated_at ?? null,
    rows,
  };
}
