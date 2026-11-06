import { floorPlanLocalReservationOutlines } from "@/lib/floor-plans/event-view";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import type { EntertainmentReservation } from "@/lib/entertainment/types";

export default function FloorPlanLocalOutlines({
  plan,
  preferredEventId = "",
  entertainmentReservations,
}: {
  plan: FloorPlanDocument;
  preferredEventId?: string;
  entertainmentReservations: EntertainmentReservation[];
}) {
  return floorPlanLocalReservationOutlines(plan, preferredEventId, entertainmentReservations).map((outline) => (
    <span
      aria-label={outline.label}
      className="floor-plan-local-reservation-outline"
      key={outline.id}
      role="img"
      title={outline.label}
      style={{
        left: `${(outline.x / 1920) * 100}%`,
        top: `${(outline.y / 1080) * 100}%`,
        width: `${(outline.width / 1920) * 100}%`,
        height: `${(outline.height / 1080) * 100}%`,
        borderColor: outline.color,
      }}
    />
  ));
}
