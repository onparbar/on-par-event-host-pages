import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { floorPlanSourceNamesMatch } from "./source-resolution";
import type { FloorPlanEvent } from "./types";

export function floorPlanEventSourceIds(event: FloorPlanEvent) {
  const vip = event.tripleseatEventId.startsWith("vip-");
  return new Set([
    event.tripleseatEventId,
    ...(event.source.sourceEventIds ?? []).filter((id) => !vip && !id.startsWith("vip-")),
    ...(event.source.verifiedSourceEventIds ?? []),
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
  if (reservation.source === "vip-prep" || reservation.tripleseatEventId?.startsWith("vip-") || event.tripleseatEventId.startsWith("vip-")) return false;

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
