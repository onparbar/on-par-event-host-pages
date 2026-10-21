import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { eventForFloorPlanEntertainment, primaryEntertainmentReservationForResource } from "./presentation";
import { getFloorPlanArea } from "./configuration/areas";
import { formatClock } from "@/lib/entertainment/time";
import type { FloorPlanDocument } from "./types";

/** A display-only projection. Save and validate the original, complete plan. */
export function floorPlanEventView(
  plan: FloorPlanDocument,
  entertainmentReservations: EntertainmentReservation[],
  selectedEventId: string | null,
) {
  const event = plan.events.find((candidate) => candidate.id === selectedEventId);
  if (!event) {
    return { plan, entertainmentReservations, selectedEventId: null };
  }
  return {
    plan: {
      ...plan,
      events: [event],
      reservations: plan.reservations.filter(
        (reservation) => reservation.floorPlanEventId === event.id,
      ),
    },
    entertainmentReservations: entertainmentReservations.filter((reservation) =>
      eventForFloorPlanEntertainment(plan, reservation)?.id === event.id,
    ),
    selectedEventId: event.id,
  };
}

/** Keep later use of the same table visible without duplicating shared room outlines. */
export function floorPlanLocalReservationOutlines(
  plan: FloorPlanDocument,
  preferredEventId = "",
  entertainmentReservations: EntertainmentReservation[] = [],
) {
  return plan.reservations.flatMap((reservation) => {
    const area = getFloorPlanArea(reservation.areaId);
    if (!area || area.id === "facility" ||
      reservation.reservationType === "custom") return [];
    const candidates = plan.reservations.filter((candidate) =>
      candidate.areaId === area.id && candidate.reservationType !== "custom",
    );
    const primaryLocal = candidates.find((candidate) =>
      candidate.floorPlanEventId === preferredEventId,
    ) ?? candidates[0];
    const shared = area.entertainmentResourceId
      ? entertainmentReservations.filter((candidate) => candidate.active &&
        candidate.resourceId === area.entertainmentResourceId)
      : [];
    const primaryShared = area.entertainmentResourceId
      ? primaryEntertainmentReservationForResource(plan, shared, area.entertainmentResourceId, preferredEventId)
      : null;
    const primaryEventId = eventForFloorPlanEntertainment(plan, primaryShared)?.id ?? primaryLocal.floorPlanEventId;
    const sharedEventIds = shared.flatMap((candidate) => {
      const event = eventForFloorPlanEntertainment(plan, candidate);
      return event ? [event.id] : [];
    });
    // Shared entertainment already renders its additional party outlines.
    if (sharedEventIds.includes(reservation.floorPlanEventId)) return [];
    const secondaryEventIds = [...new Set([
      ...sharedEventIds,
      ...candidates.map((candidate) => candidate.floorPlanEventId),
    ])].filter((eventId) => eventId !== primaryEventId);
    const index = secondaryEventIds.indexOf(reservation.floorPlanEventId);
    const event = plan.events.find((candidate) => candidate.id === reservation.floorPlanEventId);
    if (index < 0 || !event || candidates.find((candidate) =>
      candidate.floorPlanEventId === event.id,
    )?.id !== reservation.id) return [];
    const padding = 3 + index * 4;
    const time = reservation.startAt && reservation.endAt
      ? `${formatClock(reservation.startAt)} – ${formatClock(reservation.endAt)}`
      : "Time needs review";
    return [{
      id: reservation.id,
      color: event.color,
      label: `${area.name} also assigned to ${event.name}, ${time}`,
      x: area.x - padding,
      y: area.y - padding,
      width: area.width + padding * 2,
      height: area.height + padding * 2,
    }];
  });
}
