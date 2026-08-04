import type {
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import { getAreaForEntertainmentResource } from "./configuration/areas";
import type { FloorPlanDocument } from "./types";

export function buildFloorPlanExportModel(
  plan: FloorPlanDocument,
  entertainmentReservations: readonly EntertainmentReservation[],
) {
  return {
    date: plan.eventDate,
    status: plan.status,
    version: plan.version,
    events: plan.events.map((event) => ({
      id: event.id,
      name: event.name,
      guestCount: event.guestCount,
      startAt: event.startAt,
      endAt: event.endAt,
      color: event.color,
    })),
    reservations: plan.reservations.map((reservation) => ({ ...reservation })),
    entertainment: entertainmentReservations.flatMap((reservation) => {
      const area = getAreaForEntertainmentResource(reservation.resourceId);
      return reservation.active && area
        ? [{
            reservationId: reservation.id,
            areaId: area.id,
            resourceId: reservation.resourceId,
            eventId:
              reservation.tripleseatEventId ?? reservation.localEventId,
            startAt: reservation.startAt,
            endAt: reservation.endAt,
            color: reservation.eventColor,
          }]
        : [];
    }),
  };
}
