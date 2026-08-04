import {
  AREAS,
  getFloorPlanArea,
} from "@/lib/floor-plans/configuration/areas";
import { readableOverlayText } from "@/lib/floor-plans/configuration/colors";
import {
  entertainmentTimingLabel,
  eventForFloorPlanEntertainment,
  floorPlanCustomGeometry,
  floorPlanOverlayLabel,
  isEntertainmentTimeAnchor,
} from "@/lib/floor-plans/presentation";
import type { FloorPlanDayPayload } from "@/lib/floor-plans/types";
import { formatClock, formatFullDate } from "@/lib/entertainment/time";

function eventTime(startAt: string | null, endAt: string | null) {
  return startAt && endAt
    ? `${formatClock(startAt)} – ${formatClock(endAt)}`
    : "Time needs review";
}

export default function PublishedFloorPlanMap({
  payload,
}: {
  payload: FloorPlanDayPayload;
}) {
  const { plan } = payload;

  return (
    <div className="published-floor-plan-map">
      <div className="floor-plan-map-canvas">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="On Par Entertainment floor map"
          draggable={false}
          src="/floor-plans/blank-floor-map.png"
        />
        <div className="floor-plan-map-date" aria-hidden="true">
          <strong>{formatFullDate(plan.eventDate)}</strong>
          {plan.events.map((event) => (
            <span key={event.id} style={{ color: event.color }}>
              <b>{event.name} ({event.guestCount})</b>
              <small>{eventTime(event.startAt, event.endAt)}</small>
            </span>
          ))}
        </div>
        <div className="floor-plan-area-layer published-floor-plan-area-layer">
          {AREAS.map((area) => {
            const local = plan.reservations.find(
              (reservation) =>
                reservation.areaId === area.id &&
                reservation.reservationType !== "custom",
            ) ?? null;
            const shared = area.entertainmentResourceId
              ? payload.entertainmentReservations.find(
                  (reservation) =>
                    reservation.active &&
                    reservation.resourceId === area.entertainmentResourceId,
                ) ?? null
              : null;
            const event = local
              ? plan.events.find(
                  (candidate) => candidate.id === local.floorPlanEventId,
                ) ?? null
              : eventForFloorPlanEntertainment(plan, shared);
            if (!event) return null;
            const showTime = Boolean(
              shared &&
                area.type !== "mini-golf" &&
                isEntertainmentTimeAnchor(
                  payload.entertainmentReservations,
                  area,
                  shared,
                ),
            );
            const label = floorPlanOverlayLabel(area, local, shared);
            return (
              <span
                aria-label={`${area.name} assigned to ${event.name}`}
                className={`floor-plan-area is-assigned${showTime ? " has-time-label" : ""}${area.type === "pool" || area.type === "shuffleboard" ? " has-time-below" : ""}`}
                key={area.id}
                style={{
                  left: `${(area.x / 1920) * 100}%`,
                  top: `${(area.y / 1080) * 100}%`,
                  width: `${(area.width / 1920) * 100}%`,
                  height: `${(area.height / 1080) * 100}%`,
                  "--event-color": event.color,
                  backgroundColor: `${event.color}80`,
                  borderColor: event.color,
                  color: readableOverlayText(event.color),
                } as React.CSSProperties}
              >
                {label ? <span>{label}</span> : null}
                {showTime && shared ? (
                  <small className="floor-plan-time-label">
                    {entertainmentTimingLabel(shared, event, area)}
                  </small>
                ) : null}
              </span>
            );
          })}
          {plan.reservations
            .filter((reservation) => reservation.reservationType === "custom")
            .map((reservation) => {
              const event = plan.events.find(
                (candidate) => candidate.id === reservation.floorPlanEventId,
              );
              const geometry = floorPlanCustomGeometry(reservation);
              if (!event || !geometry || !getFloorPlanArea(reservation.areaId)) {
                return null;
              }
              return (
                <span
                  aria-label={`Custom highlight: ${reservation.label}`}
                  className="floor-plan-custom-note"
                  key={reservation.id}
                  style={{
                    left: `${(geometry.x / 1920) * 100}%`,
                    top: `${(geometry.y / 1080) * 100}%`,
                    width: `${(geometry.width / 1920) * 100}%`,
                    height: `${(geometry.height / 1080) * 100}%`,
                    backgroundColor: `${event.color}80`,
                    borderColor: event.color,
                    color: readableOverlayText(event.color),
                  }}
                >
                  {reservation.label}
                </span>
              );
            })}
        </div>
      </div>
    </div>
  );
}
