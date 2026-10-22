import { getFloorPlanArea } from "@/lib/floor-plans/configuration/areas";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import type { KitchenChecklist } from "./types";

/**
 * Display saved seating assignments without changing the stored source room.
 * A matching event with no seating highlights has no assigned area; falling
 * back to its contracted room would undo a staff member's cleared placement.
 */
export function withKitchenReservedAreas(
  checklists: readonly KitchenChecklist[],
  plan: FloorPlanDocument | null,
): KitchenChecklist[] {
  return checklists.map((checklist) => {
    if (!plan || plan.eventDate !== checklist.event.localDate) {
      return checklist;
    }
    const eventId = String(checklist.event.eventId);
    const matches = plan.events.filter(
      (event) =>
        event.tripleseatEventId === eventId ||
        event.source.sourceEventIds?.includes(eventId),
    );
    if (matches.length !== 1) return checklist;
    const event = matches[0];
    const areas = new Set<string>();
    if (event.fullBuyout) {
      areas.add("Entire Facility");
    } else {
      const seating = plan.reservations.filter((reservation) =>
        reservation.floorPlanEventId === event.id &&
        (reservation.reservationType === "room" || reservation.reservationType === "seating"),
      );
      const reservedRoomIds = new Set(seating.flatMap((reservation) => {
        const area = getFloorPlanArea(reservation.areaId);
        return area?.type === "room" ? [area.id] : [];
      }));
      for (const reservation of seating) {
        const area = getFloorPlanArea(reservation.areaId);
        if (!area || (area.canBeFoodTable && area.capacity === 0)) continue;
        const reservedArea = area.parentAreaId
          ? getFloorPlanArea(area.parentAreaId)
          : area;
        // Ancillary tables do not reserve a second VIP room beside an assigned room.
        if (area.parentAreaId && reservedArea?.type === "room" &&
          reservedRoomIds.size > 0 && !reservedRoomIds.has(reservedArea.id)) continue;
        if (
          reservedArea &&
          (reservedArea.type === "room" ||
            reservedArea.type === "seating-section")
        ) {
          areas.add(reservedArea.name);
        }
      }
    }
    return {
      ...checklist,
      event: {
        ...checklist.event,
        room: [...areas].sort().join(", ") || null,
      },
    };
  });
}
