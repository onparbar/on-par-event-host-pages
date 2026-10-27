import { areaUsesSeatingBuffer, getFloorPlanArea, getPhysicalFloorPlanAreaId } from "./configuration/areas";
import { reservationOccupancyOverlap } from "@/lib/operations/reservation-buffer";
import { validEntertainmentInterval } from "@/lib/entertainment/domain";
import type {
  FloorPlanConflict,
  FloorPlanDocument,
  FloorPlanReservation,
} from "./types";

export function timeRangesOverlap(
  leftStart: string | null,
  leftEnd: string | null,
  rightStart: string | null,
  rightEnd: string | null,
) {
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) return false;
  const startsBeforeEnd = Date.parse(leftStart) < Date.parse(rightEnd);
  const endsAfterStart = Date.parse(leftEnd) > Date.parse(rightStart);
  return startsBeforeEnd && endsAfterStart;
}

export function floorPlanAreaTimeOverlap(
  areaId: string,
  leftStart: string | null,
  leftEnd: string | null,
  rightStart: string | null,
  rightEnd: string | null,
) {
  if (areaUsesSeatingBuffer(areaId)) {
    return reservationOccupancyOverlap(leftStart, leftEnd, rightStart, rightEnd);
  }
  if (!leftStart || !leftEnd || !rightStart || !rightEnd ||
      !validEntertainmentInterval(leftStart, leftEnd) || !validEntertainmentInterval(rightStart, rightEnd) ||
      !timeRangesOverlap(leftStart, leftEnd, rightStart, rightEnd)) return null;
  return {
    startAt: new Date(Math.max(Date.parse(leftStart), Date.parse(rightStart))).toISOString(),
    endAt: new Date(Math.min(Date.parse(leftEnd), Date.parse(rightEnd))).toISOString(),
  };
}

function conflict(
  left: FloorPlanReservation,
  right: FloorPlanReservation,
  plan: FloorPlanDocument,
  areaId: string,
): FloorPlanConflict {
  const leftEvent = plan.events.find((event) => event.id === left.floorPlanEventId)!;
  const rightEvent = plan.events.find((event) => event.id === right.floorPlanEventId)!;
  const { startAt, endAt } = floorPlanAreaTimeOverlap(
    areaId === "facility" ? right.areaId : areaId,
    left.startAt, left.endAt, right.startAt, right.endAt,
  )!;
  return {
    id: [areaId, left.id, right.id].sort().join(":"),
    areaId,
    eventIds: [leftEvent.id, rightEvent.id],
    eventNames: [leftEvent.name, rightEvent.name],
    startAt,
    endAt,
    blocking: true,
  };
}

export function detectFloorPlanConflicts(plan: FloorPlanDocument) {
  const result: FloorPlanConflict[] = [];
  const reservations = plan.reservations.filter((reservation) =>
    getFloorPlanArea(reservation.areaId),
  );
  for (let leftIndex = 0; leftIndex < reservations.length; leftIndex += 1) {
    const left = reservations[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < reservations.length; rightIndex += 1) {
      const right = reservations[rightIndex];
      const physicalId = getPhysicalFloorPlanAreaId(left.areaId);
      const sameEvent = left.floorPlanEventId === right.floorPlanEventId;
      const guestSeating = (reservation: FloorPlanReservation) => reservation.reservationType === "seating" ||
        (reservation.reservationType === "room" && (getFloorPlanArea(reservation.areaId)?.capacity ?? 0) > 0);
      const foodAndSeating =
        (left.reservationType === "food-table" && guestSeating(right)) ||
        (right.reservationType === "food-table" && guestSeating(left));
      if (
        (sameEvent && !foodAndSeating) ||
        physicalId !== getPhysicalFloorPlanAreaId(right.areaId) ||
        !floorPlanAreaTimeOverlap(physicalId, left.startAt, left.endAt, right.startAt, right.endAt)
      ) {
        continue;
      }
      result.push(conflict(left, right, plan, physicalId));
    }
  }

  const buyoutEvents = plan.events.filter((event) => event.fullBuyout);
  for (const buyout of buyoutEvents) {
    const buyoutReservation = plan.reservations.find(
      (reservation) =>
        reservation.floorPlanEventId === buyout.id &&
        reservation.areaId === "facility",
    );
    if (!buyoutReservation) continue;
    for (const other of plan.events) {
      const otherReservations = plan.reservations.filter(
        (reservation) => reservation.floorPlanEventId === other.id,
      );
      const otherReservation = otherReservations.find((reservation) => areaUsesSeatingBuffer(reservation.areaId)) ?? otherReservations[0];
      if (
        other.id === buyout.id ||
        !otherReservation ||
        !floorPlanAreaTimeOverlap(otherReservation.areaId, buyout.startAt, buyout.endAt, other.startAt, other.endAt)
      ) {
        continue;
      }
      if (otherReservation) {
        result.push(conflict(
          { ...buyoutReservation, startAt: buyout.startAt, endAt: buyout.endAt },
          { ...otherReservation, startAt: other.startAt, endAt: other.endAt },
          plan,
          "facility",
        ));
      }
    }
  }
  return result;
}
