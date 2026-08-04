import {
  AREAS,
  getFloorPlanArea,
} from "./configuration/areas";
import { formatClock } from "@/lib/entertainment/time";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
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
