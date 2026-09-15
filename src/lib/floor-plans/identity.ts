import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { floorPlanSourceNamesMatch } from "./source-resolution";
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
  const identityMatches =
    [reservation.tripleseatEventId, reservation.localEventId]
      .filter((value): value is string => Boolean(value))
      .some((value) => sourceIds.has(value)) ||
    reservation.localEventId === event.id;
  if (identityMatches) return true;

  const eventStart = Date.parse(event.startAt ?? "");
  const eventEnd = Date.parse(event.endAt ?? "");
  const reservationStart = Date.parse(reservation.startAt);
  const reservationEnd = Date.parse(reservation.endAt);
  return (
    floorPlanSourceNamesMatch(reservation.eventName, event.name) &&
    [eventStart, eventEnd, reservationStart, reservationEnd].every(
      Number.isFinite,
    ) &&
    reservationStart < eventEnd &&
    reservationEnd > eventStart
  );
}
