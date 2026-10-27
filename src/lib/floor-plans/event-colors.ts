import { deterministicEventColor, isHexColor } from "@/lib/entertainment/resources";
import type { EntertainmentEventSnapshot, EntertainmentReservation } from "@/lib/entertainment/types";
import { distinctFloorPlanEventColor, floorPlanEventColorsAreDistinct } from "./configuration/colors";
import { floorPlanEventSourceIds } from "./identity";
import type { FloorPlanEvent } from "./types";

/** A color-only read projection. It never edits reservations, source provenance or saved revisions. */
export function projectDayEventColors(
  floorEvents: readonly FloorPlanEvent[],
  events: readonly EntertainmentEventSnapshot[],
  reservations: readonly EntertainmentReservation[],
  savedFloorEvents: readonly FloorPlanEvent[] = [],
) {
  type Party = { id: string; floorColor?: string; manualColor?: string; fallback?: string };
  const parties = new Map<string, Party>();
  const aliases = new Map<string, Set<Party>>();
  const get = (id: string) => {
    if (!parties.has(id)) parties.set(id, { id });
    return parties.get(id)!;
  };
  const register = (party: Party, ids: readonly (string | null)[]) => {
    for (const id of ids.filter((value): value is string => Boolean(value))) {
      const owners = aliases.get(id) ?? new Set<Party>();
      owners.add(party);
      aliases.set(id, owners);
    }
  };
  const owner = (ids: readonly (string | null)[]) => {
    const owners = new Set(ids.flatMap((id) => id ? [...(aliases.get(id) ?? [])] : []));
    return owners.size === 1 ? [...owners][0] : undefined;
  };
  const floorOwners = new Map<FloorPlanEvent, Party>();
  const corporateIds = new Set(events.map((event) => event.tripleseatEventId).filter((id) => id && !id.startsWith("vip-")));
  for (const event of savedFloorEvents) {
    const ids = [event.tripleseatEventId, event.id, ...floorPlanEventSourceIds(event)];
    const linkedCorporateIds = ids.filter((id) => corporateIds.has(id));
    const primary = event.tripleseatEventId.startsWith("vip-") && new Set(linkedCorporateIds).size === 1
      ? linkedCorporateIds[0] : event.tripleseatEventId || event.id;
    const party = parties.get(primary) ?? owner(ids) ?? get(primary);
    register(party, ids);
    floorOwners.set(event, party);
  }
  for (const event of savedFloorEvents) {
    const party = floorOwners.get(event)!;
    if (isHexColor(event.color) && (!party.floorColor || party.id === event.tripleseatEventId)) party.floorColor = event.color;
  }
  const eventOwners = new Map<EntertainmentEventSnapshot, Party>();
  // Corporate identities exist before a VIP's explicit linked-source reference is considered.
  const ordered = [...events].sort((a, b) => Number(a.tripleseatEventId.startsWith("vip-")) - Number(b.tripleseatEventId.startsWith("vip-")) || a.eventId.localeCompare(b.eventId));
  for (const event of ordered) {
    const primary = event.tripleseatEventId || event.localEventId || event.eventId;
    const ids = primary.startsWith("vip-") ? [primary] : [primary, event.eventId, event.localEventId];
    const linked = primary.startsWith("vip-") ? owner(event.sourceSnapshot.linkedTripleseatEventIds ?? []) : undefined;
    const party = parties.get(primary) ?? owner(ids) ?? linked ?? get(primary);
    register(party, ids);
    if (isHexColor(event.eventColor)) {
      if (!party.fallback || party.id === primary) party.fallback = event.eventColor;
      if (event.colorSource === "manual" && (!party.manualColor || party.id === primary)) party.manualColor = event.eventColor;
    }
    eventOwners.set(event, party);
  }
  const reservationOwners = new Map<EntertainmentReservation, Party>();
  for (const reservation of reservations) {
    const primary = reservation.tripleseatEventId || reservation.localEventId ||
      (reservation.source === "manual" ? `manual:${reservation.eventName}` : `reservation:${reservation.id}`);
    const ids = primary.startsWith("vip-") ? [primary] : [primary, reservation.localEventId];
    const party = parties.get(primary) ?? owner(ids) ?? get(primary);
    register(party, ids);
    if (!party.fallback && isHexColor(reservation.eventColor)) party.fallback = reservation.eventColor;
    if (!party.manualColor && reservation.colorSource === "manual" && isHexColor(reservation.eventColor)) party.manualColor = reservation.eventColor;
    reservationOwners.set(reservation, party);
  }
  const all = [...parties.values()];
  // A distinct staff choice wins. Duplicated legacy "manual" colors are not a unique choice.
  const manual = (party: Party) => party.manualColor && all.every((other) => other === party || !other.manualColor || floorPlanEventColorsAreDistinct(party.manualColor!, other.manualColor));
  const priority = (party: Party) => manual(party) ? 0 : party.floorColor ? 1 : 2;
  all.sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));
  const colors = new Map<Party, string>();
  const used: string[] = [];
  all.forEach((party, index) => {
    const preferred = manual(party) ? party.manualColor : party.floorColor ?? party.fallback ?? deterministicEventColor(party.id);
    const color = distinctFloorPlanEventColor(preferred ?? null, index, used);
    colors.set(party, color);
    used.push(color);
  });
  // Unsaved floor-only arrivals must not recolor the shared saved schedule.
  for (const event of [...floorEvents].sort((a, b) => a.tripleseatEventId.localeCompare(b.tripleseatEventId) || a.id.localeCompare(b.id))) {
    const ids = [event.tripleseatEventId, event.id, ...floorPlanEventSourceIds(event)];
    const party = parties.get(event.tripleseatEventId || event.id) ?? owner(ids) ?? get(event.tripleseatEventId || event.id);
    register(party, ids);
    floorOwners.set(event, party);
    if (!colors.has(party)) {
      const color = distinctFloorPlanEventColor(isHexColor(event.color) ? event.color : null, used.length, used);
      colors.set(party, color);
      used.push(color);
    }
  }
  return {
    floorEvents: floorEvents.map((event) => ({ ...event, color: colors.get(floorOwners.get(event)!)! })),
    events: events.map((event) => ({ ...event, eventColor: colors.get(eventOwners.get(event)!)! })),
    reservations: reservations.map((reservation) => ({ ...reservation, eventColor: colors.get(reservationOwners.get(reservation)!)! })),
  };
}
