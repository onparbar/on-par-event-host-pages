import { isDecemberOwnerHoldVip } from "@/lib/vip-prep/owner-holds";
import type { EntertainmentEventSnapshot, EntertainmentReservation } from "./types";

function isOwnerHoldEvent(event: EntertainmentEventSnapshot) {
  return isDecemberOwnerHoldVip({
    operatingDate: event.operatingDate, eventName: event.eventName, sourceEventId: event.tripleseatEventId,
    sourceSystem: event.sourceSnapshot.sourceSystem, linkedTripleseatEventIds: event.sourceSnapshot.linkedTripleseatEventIds,
    foodCount: event.sourceSnapshot.vipFoodCount, extraCount: event.sourceSnapshot.vipExtraCount ?? event.sourceSnapshot.items.length,
  });
}

function ownerHoldReservation(row: EntertainmentReservation, events: readonly EntertainmentEventSnapshot[]) {
  const event = events.filter((candidate) => candidate.operatingDate === row.operatingDate &&
    [candidate.eventId, candidate.tripleseatEventId, candidate.localEventId].some((id) => id && [row.tripleseatEventId, row.localEventId].includes(id)))
    .sort((left, right) =>
      (Date.parse(right.sourceSnapshot.sourceObservedAt ?? right.sourceUpdatedAt ?? right.syncedAt) || 0) -
      (Date.parse(left.sourceSnapshot.sourceObservedAt ?? left.sourceUpdatedAt ?? left.syncedAt) || 0) ||
      Number(isOwnerHoldEvent(left)) - Number(isOwnerHoldEvent(right)))[0];
  if (event) return isOwnerHoldEvent(event);
  return isDecemberOwnerHoldVip({ operatingDate: row.operatingDate, eventName: row.eventName,
    sourceEventId: row.tripleseatEventId ?? row.localEventId, sourceSystem: row.source === "manual" ? undefined : row.source });
}

/** Read projection only: preserve source/reservation history, including manual overrides. */
export function projectDecemberOwnerHoldEntertainmentVisibility<T extends {
  events: EntertainmentEventSnapshot[]; reservations: EntertainmentReservation[];
}>(day: T): T {
  const reservations = day.reservations.filter((row) => !ownerHoldReservation(row, day.events));
  return { ...day, events: day.events.filter((event) => !isOwnerHoldEvent(event)), reservations };
}
