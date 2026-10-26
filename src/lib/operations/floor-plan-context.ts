import { floorPlanEventSourceIds } from "@/lib/floor-plans/identity";
import type { FloorPlanEvent } from "@/lib/floor-plans/types";
import { operationalKitchenEventId } from "@/lib/vip-prep/identity";

export function operationalFloorPlanEventId(event: FloorPlanEvent) {
  if (event.tripleseatEventId.startsWith("vip-")) return event.tripleseatEventId;
  return /^floor-plan-event-(\d+)$/.exec(event.id)?.[1] ?? operationalKitchenEventId(event.tripleseatEventId);
}

export function findOperationalFloorPlanEvent(events: readonly FloorPlanEvent[], eventId: string | null) {
  if (!eventId) return null;
  const numericCompatibility = /^\d+$/.test(eventId);
  const matches = events.filter((event) => [event.id, operationalFloorPlanEventId(event), ...floorPlanEventSourceIds(event)]
    .some((sourceId) => sourceId === eventId || numericCompatibility && operationalKitchenEventId(sourceId) === eventId));
  return matches.length === 1 ? matches[0] : null;
}
