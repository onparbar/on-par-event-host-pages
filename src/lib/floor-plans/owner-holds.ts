import { isDecemberOwnerHoldVip } from "@/lib/vip-prep/owner-holds";
import { floorPlanStatusAfterSourceChange } from "./lifecycle";
import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "./types";

export function isDecemberOwnerHoldFloorPlanEvent(event: FloorPlanEvent, date: string) {
  return isDecemberOwnerHoldVip({
    operatingDate: date, eventName: event.name, sourceEventId: event.tripleseatEventId,
    linkedTripleseatEventIds: [
      ...(event.source.onParBooking?.linkedTripleseatEventIds ?? []),
      ...(event.source.sourceEventIds ?? []), ...(event.source.verifiedSourceEventIds ?? []),
    ].filter((id) => !id.startsWith("vip-")),
    foodCount: event.source.food.length, extraCount: event.source.vipExtraCount ?? event.source.entertainment.length,
  });
}

export function isProtectedFloorPlanAssignment(row: FloorPlanReservation) {
  return row.source === "manual" || row.lockedByUser || row.placementOverride === true || row.timingSource === "staff-override";
}

/** Planning exception only: retain source history and any explicit staff assignment. */
export function withoutDecemberOwnerHoldFloorPlanEvents(plan: FloorPlanDocument): FloorPlanDocument {
  const removedIds = new Set(plan.events.filter((event) =>
    isDecemberOwnerHoldFloorPlanEvent(event, plan.eventDate) &&
    !plan.reservations.some((row) => row.floorPlanEventId === event.id && isProtectedFloorPlanAssignment(row)),
  ).map((event) => event.id));
  if (!removedIds.size) return plan;
  return { ...plan, events: plan.events.filter((event) => !removedIds.has(event.id)),
    reservations: plan.reservations.filter((row) => !removedIds.has(row.floorPlanEventId)),
    status: floorPlanStatusAfterSourceChange(plan.status, true) };
}

/** Display only: internal December placeholders are hidden even when staff protected them. */
export function projectDecemberOwnerHoldFloorPlanVisibility<T extends FloorPlanDocument>(plan: T): T {
  const hiddenIds = new Set(plan.events.filter((event) => isDecemberOwnerHoldFloorPlanEvent(event, plan.eventDate)).map((event) => event.id));
  if (!hiddenIds.size) return plan;
  return { ...plan, events: plan.events.filter((event) => !hiddenIds.has(event.id)),
    reservations: plan.reservations.filter((row) => !hiddenIds.has(row.floorPlanEventId)) };
}
