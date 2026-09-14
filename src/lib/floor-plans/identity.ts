import type { EntertainmentReservation } from "@/lib/entertainment/types";
import type { FloorPlanEvent } from "./types";

export function floorPlanEventSourceIds(event: FloorPlanEvent) {
  return new Set([
    event.tripleseatEventId,
    ...(event.source.sourceEventIds ?? []),
  ]);
}

export function entertainmentReservationMatchesFloorPlanEvent(
  reservation: EntertainmentReservation,
  event: FloorPlanEvent,
) {
  const sourceIds = floorPlanEventSourceIds(event);
  return (
    [reservation.tripleseatEventId, reservation.localEventId]
      .filter((value): value is string => Boolean(value))
      .some((value) => sourceIds.has(value)) ||
    reservation.localEventId === event.id
  );
}
