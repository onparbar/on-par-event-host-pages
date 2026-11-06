import { formatClock, formatFullDate } from "@/lib/entertainment/time";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";

export default function FloorPlanEventLegend({
  plan,
  selectedEventId,
  onSelectEvent,
  readOnly = false,
}: {
  plan: FloorPlanDocument;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="floor-plan-map-date">
      <strong>{formatFullDate(plan.eventDate)}</strong>
      {!readOnly && plan.events.length > 1 ? (
        <div className="floor-plan-event-view-controls">
          <button
            aria-pressed={!selectedEventId}
            onClick={() => onSelectEvent(null)}
            type="button"
          >
            Show all events
          </button>
          <small role="status">
            {selectedEventId ? "Showing one event" : "Showing all events"}
          </small>
        </div>
      ) : null}
      {plan.events.map((event) => readOnly ? (
        <span className="floor-plan-event-filter" key={event.id} style={{ color: event.color }}>
          <span><b>{event.name} ({event.guestCount})</b><small>{event.startAt && event.endAt ? `${formatClock(event.startAt)} – ${formatClock(event.endAt)}` : "Time needs review"}</small></span>
        </span>
      ) : (
        <button
          aria-label={`Show only ${event.name} on the floor plan`}
          aria-pressed={event.id === selectedEventId}
          className={`floor-plan-event-filter${selectedEventId && event.id !== selectedEventId ? " is-hidden-event" : ""}`}
          key={event.id}
          onClick={() => onSelectEvent(event.id === selectedEventId ? null : event.id)}
          style={{ color: event.color }}
          type="button"
        >
          <span>
            <b>{event.name} ({event.guestCount})</b>
            <small>
              {event.startAt && event.endAt
                ? `${formatClock(event.startAt)} – ${formatClock(event.endAt)}`
                : "Time needs review"}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
