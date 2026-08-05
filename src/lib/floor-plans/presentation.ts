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
import { timeRangesOverlap } from "./conflicts";
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

export type EntertainmentOverlapOutline = {
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
  startAt: string;
  endAt: string;
  reservations: EntertainmentReservation[];
};

const OUTLINE_PADDING = 2;
const SEQUENTIAL_ENTERTAINMENT_CATEGORIES = new Set<EntertainmentCategory>([
  "bowling",
  "darts",
  "pool",
  "shuffleboard",
]);

function entertainmentGroups(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
) {
  const groups = new Map<string, EntertainmentGroup>();
  for (const reservation of reservations) {
    if (!reservation.active || reservation.resourceCategory === "mini-golf") {
      continue;
    }
    const event = eventForFloorPlanEntertainment(plan, reservation);
    const area = getAreaForEntertainmentResource(reservation.resourceId);
    if (!event || !area?.entertainmentResourceId) continue;
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
      startAt: reservation.startAt,
      endAt: reservation.endAt,
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
 * Builds transparent group borders only when different parties use the same
 * entertainment category during overlapping time windows. Individual resource
 * highlights stay visible inside each border.
 */
export function entertainmentOverlapOutlines(
  plan: FloorPlanDocument,
  reservations: readonly EntertainmentReservation[],
): EntertainmentOverlapOutline[] {
  const groups = entertainmentGroups(plan, reservations);
  const overlappingGroupIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    const left = groups[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const right = groups[rightIndex];
      if (
        left.event.id === right.event.id ||
        left.category !== right.category ||
        !timeRangesOverlap(left.startAt, left.endAt, right.startAt, right.endAt)
      ) {
        continue;
      }
      overlappingGroupIds.add(left.id);
      overlappingGroupIds.add(right.id);
    }
  }

  return groups
    .filter((group) => overlappingGroupIds.has(group.id))
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
