import {
  AREAS,
  getAreaForEntertainmentResource,
  getFloorPlanArea,
} from "./configuration/areas";
import { formatClock } from "@/lib/entertainment/time";
import type {
  EntertainmentCategory,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import type {
  FloorPlanArea,
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanReservation,
} from "./types";

export function eventForFloorPlanEntertainment(
  plan: FloorPlanDocument,
  reservation: EntertainmentReservation | null,
) {
  if (!reservation) return null;
  return (
    plan.events.find(
      (event) =>
        event.tripleseatEventId === reservation.tripleseatEventId ||
        event.tripleseatEventId === reservation.localEventId ||
        event.id === reservation.localEventId,
    ) ?? null
  );
}

export function floorPlanOverlayLabel(
  area: FloorPlanArea,
  local: FloorPlanReservation | null,
  shared: EntertainmentReservation | null,
) {
  if (shared) return area.shortLabel;
  if (!local) return "";
  if (local.reservationType === "food-table") return "F";
  if (area.type === "room" || area.type === "seating-section") {
    return area.shortLabel || local.label;
  }
  return "";
}

function sameEntertainmentGroup(
  left: EntertainmentReservation,
  right: EntertainmentReservation,
) {
  return (
    left.tripleseatEventId === right.tripleseatEventId &&
    left.localEventId === right.localEventId &&
    left.resourceCategory === right.resourceCategory &&
    left.startAt === right.startAt &&
    left.endAt === right.endAt
  );
}

export function isEntertainmentTimeAnchor(
  reservations: readonly EntertainmentReservation[],
  area: FloorPlanArea,
  reservation: EntertainmentReservation,
) {
  return AREAS.find(
    (candidate) =>
      candidate.entertainmentResourceId &&
      reservations.some(
        (item) =>
          item.active &&
          item.resourceId === candidate.entertainmentResourceId &&
          sameEntertainmentGroup(item, reservation),
      ),
  )?.id === area.id;
}

export type EntertainmentMultipleReservationOutline = {
  id: string;
  eventId: string;
  eventName: string;
  color: string;
  category: EntertainmentCategory;
  resourceNames: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};

type EntertainmentGroup = {
  id: string;
  event: FloorPlanEvent;
  category: EntertainmentCategory;
  reservations: EntertainmentReservation[];
};

const OUTLINE_PADDING = 4;
const SEQUENTIAL_ENTERTAINMENT_CATEGORIES = new Set<EntertainmentCategory>([
  "bowling",
  "darts",
  "pool",
  "shuffleboard",
]);

function compareEntertainmentReservations(
  left: EntertainmentReservation,
  right: EntertainmentReservation,
) {
  return (
    Date.parse(left.startAt) - Date.parse(right.startAt) ||
    Date.parse(left.endAt) - Date.parse(right.endAt) ||
    left.eventName.localeCompare(right.eventName) ||
    left.id.localeCompare(right.id)
  );
}

export function primaryEntertainmentReservationForResource(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
  resourceId: string,
  preferredEventId = "",
) {
  const candidates = reservations
    .filter(
      (reservation) =>
        reservation.active &&
        reservation.resourceId === resourceId &&
        eventForFloorPlanEntertainment(plan, reservation),
    )
    .sort(compareEntertainmentReservations);
  return (
    candidates.find(
      (reservation) =>
        eventForFloorPlanEntertainment(plan, reservation)?.id === preferredEventId,
    ) ?? candidates[0] ?? null
  );
}

export function visibleEntertainmentReservations(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
  preferredEventId = "",
) {
  return AREAS.flatMap((area) => {
    if (!area.entertainmentResourceId) return [];
    const reservation = primaryEntertainmentReservationForResource(
      plan,
      reservations,
      area.entertainmentResourceId,
      preferredEventId,
    );
    return reservation ? [reservation] : [];
  });
}

function additionalEntertainmentGroups(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
  preferredEventId: string,
) {
  const groups = new Map<string, EntertainmentGroup>();
  for (const reservation of reservations) {
    if (!reservation.active || reservation.resourceCategory === "mini-golf") {
      continue;
    }
    const event = eventForFloorPlanEntertainment(plan, reservation);
    const area = getAreaForEntertainmentResource(reservation.resourceId);
    if (!event || !area?.entertainmentResourceId) continue;
    const primary = primaryEntertainmentReservationForResource(
      plan,
      reservations,
      reservation.resourceId,
      preferredEventId,
    );
    if (
      !primary ||
      eventForFloorPlanEntertainment(plan, primary)?.id === event.id
    ) {
      continue;
    }
    const id = [
      event.id,
      reservation.resourceCategory,
      reservation.startAt,
      reservation.endAt,
    ].join(":");
    const group = groups.get(id) ?? {
      id,
      event,
      category: reservation.resourceCategory,
      reservations: [],
    };
    if (!group.reservations.some((item) => item.resourceId === reservation.resourceId)) {
      group.reservations.push(reservation);
    }
    groups.set(id, group);
  }
  return [...groups.values()];
}

function contiguousReservationRuns(group: EntertainmentGroup) {
  if (!SEQUENTIAL_ENTERTAINMENT_CATEGORIES.has(group.category)) {
    return group.reservations.map((reservation) => [reservation]);
  }
  const resourceOrder = new Map(
    AREAS.filter((area) => area.type === group.category).flatMap((area, index) =>
      area.entertainmentResourceId
        ? [[area.entertainmentResourceId, index] as const]
        : [],
    ),
  );
  const ordered = [...group.reservations].sort(
    (left, right) =>
      (resourceOrder.get(left.resourceId) ?? Number.MAX_SAFE_INTEGER) -
      (resourceOrder.get(right.resourceId) ?? Number.MAX_SAFE_INTEGER),
  );
  const runs: EntertainmentReservation[][] = [];
  for (const reservation of ordered) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    const isNext =
      previous &&
      resourceOrder.get(reservation.resourceId) ===
        (resourceOrder.get(previous.resourceId) ?? Number.MAX_SAFE_INTEGER) + 1;
    if (run && isNext) run.push(reservation);
    else runs.push([reservation]);
  }
  return runs;
}

/**
 * Keeps the earliest reservation as the resource fill and wraps each additional
 * party's contiguous resources in that party's color.
 */
export function entertainmentMultipleReservationOutlines(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
  preferredEventId = "",
): EntertainmentMultipleReservationOutline[] {
  return additionalEntertainmentGroups(plan, reservations, preferredEventId)
    .flatMap((group) =>
      contiguousReservationRuns(group).flatMap((run, runIndex) => {
        const areas = run.flatMap((reservation) => {
          const area = getAreaForEntertainmentResource(reservation.resourceId);
          return area ? [area] : [];
        });
        if (!areas.length) return [];
        const left = Math.max(0, Math.min(...areas.map((area) => area.x)) - OUTLINE_PADDING);
        const top = Math.max(0, Math.min(...areas.map((area) => area.y)) - OUTLINE_PADDING);
        const right = Math.min(
          1920,
          Math.max(...areas.map((area) => area.x + area.width)) + OUTLINE_PADDING,
        );
        const bottom = Math.min(
          1080,
          Math.max(...areas.map((area) => area.y + area.height)) + OUTLINE_PADDING,
        );
        return [{
          id: `${group.id}:${runIndex}`,
          eventId: group.event.id,
          eventName: group.event.name,
          color: group.event.color,
          category: group.category,
          resourceNames: run.map((reservation) => reservation.resourceName),
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        }];
      }),
    );
}

function sourceDurationForArea(event: FloorPlanEvent, area: FloorPlanArea) {
  const pattern =
    area.type === "bowling"
      ? /bowling/i
      : area.type === "darts"
        ? /dart/i
        : area.type === "pool"
          ? /pool/i
          : area.type === "shuffleboard"
            ? /shuffle/i
            : area.type === "mini-golf"
              ? /mini\s*golf/i
              : null;
  if (!pattern) return "";
  const duration = event.source.entertainment.find((item) =>
    pattern.test(item.name),
  )?.duration.trim();
  if (!duration || /not listed|unknown|tbd/i.test(duration)) return "";
  return duration
    .toUpperCase()
    .replace(/\bHOURS\b/g, "HRS")
    .replace(/\bHOUR\b/g, "HR");
}

export function entertainmentTimingLabel(
  reservation: EntertainmentReservation,
  event: FloorPlanEvent,
  area: FloorPlanArea,
) {
  const needsTimeReview = reservation.reviewIssues.some(
    (issue) => issue.code === "TIME_NEEDS_REVIEW",
  );
  const time = needsTimeReview
    ? "TIME TBD"
    : `${formatClock(reservation.startAt)} – ${formatClock(reservation.endAt)}`;
  const duration = sourceDurationForArea(event, area);
  return duration ? `${duration} · ${time}` : time;
}

export function floorPlanCustomGeometry(
  reservation: FloorPlanReservation,
) {
  const area = getFloorPlanArea(reservation.areaId);
  if (!area) return null;
  return reservation.customGeometry ?? {
    x: area.x,
    y: area.y,
    width: Math.max(area.width, 120),
    height: Math.max(area.height, 44),
  };
}

export function localHighlightIdsForDeletion(
  plan: FloorPlanDocument,
  eventId: string,
  areaIds: readonly string[],
  selectedReservationId: string,
) {
  const selected = selectedReservationId
    ? plan.reservations.find(
        (reservation) => reservation.id === selectedReservationId,
      ) ?? null
    : null;
  if (selected?.floorPlanEventId === eventId) return [selected.id];
  const selectedAreas = new Set(areaIds);
  return plan.reservations
    .filter(
      (reservation) =>
        reservation.floorPlanEventId === eventId &&
        selectedAreas.has(reservation.areaId) &&
        reservation.reservationType !== "custom",
    )
    .map((reservation) => reservation.id);
}
