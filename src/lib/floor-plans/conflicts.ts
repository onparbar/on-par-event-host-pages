import { getFloorPlanArea } from "./configuration/areas";
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

function conflict(
  left: FloorPlanReservation,
  right: FloorPlanReservation,
  plan: FloorPlanDocument,
  areaId: string,
): FloorPlanConflict {
  const leftEvent = plan.events.find((event) => event.id === left.floorPlanEventId)!;
  const rightEvent = plan.events.find((event) => event.id === right.floorPlanEventId)!;
  const startAt =
    Date.parse(left.startAt!) >= Date.parse(right.startAt!)
      ? left.startAt!
      : right.startAt!;
  const endAt =
    Date.parse(left.endAt!) <= Date.parse(right.endAt!)
      ? left.endAt!
      : right.endAt!;
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
      if (
        left.floorPlanEventId === right.floorPlanEventId ||
        left.areaId !== right.areaId ||
        !timeRangesOverlap(left.startAt, left.endAt, right.startAt, right.endAt)
      ) {
        continue;
      }
      result.push(conflict(left, right, plan, left.areaId));
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
      if (
        other.id === buyout.id ||
        !timeRangesOverlap(buyout.startAt, buyout.endAt, other.startAt, other.endAt)
      ) {
        continue;
      }
      const otherReservation = plan.reservations.find(
        (reservation) => reservation.floorPlanEventId === other.id,
      );
      if (otherReservation) {
        result.push(conflict(buyoutReservation, otherReservation, plan, "facility"));
      }
    }
  }
  return result;
}
