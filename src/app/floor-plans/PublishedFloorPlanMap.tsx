"use client";

import { useState } from "react";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { findOperationalFloorPlanEvent, operationalFloorPlanEventId } from "@/lib/operations/floor-plan-context";
import {
  DISPLAY_AREAS,
  getFloorPlanArea,
} from "@/lib/floor-plans/configuration/areas";
import { readableOverlayText } from "@/lib/floor-plans/configuration/colors";
import { floorPlanEventView } from "@/lib/floor-plans/event-view";
import {
  displayEventForFloorPlanArea,
  entertainmentMultipleReservationOutlines,
  entertainmentTimingLabel,
  floorPlanEventFillColor,
  floorPlanCustomGeometry,
  floorPlanOverlayLabel,
  isEntertainmentTimeAnchor,
  primaryLocalFloorPlanReservation,
  visibleEntertainmentReservations,
} from "@/lib/floor-plans/presentation";
import type { FloorPlanDayPayload } from "@/lib/floor-plans/types";
import FloorPlanEventLegend from "./FloorPlanEventLegend";
import FloorPlanLocalOutlines from "./FloorPlanLocalOutlines";
import { formatClock } from "@/lib/entertainment/time";

export default function PublishedFloorPlanMap({
  payload,
  zoom = 100,
  focusEventId,
}: {
  payload: FloorPlanDayPayload;
  zoom?: number;
  focusEventId?: string;
}) {
  const context = useEventContext();
  const [visibleEventId, setVisibleEventId] = useState<string | null>(null);
  const requestedId = focusEventId ?? visibleEventId;
  const selected = findOperationalFloorPlanEvent(payload.plan.events, requestedId);
  const contextEvent = selected ? {
    eventId: operationalFloorPlanEventId(selected), eventName: selected.name, date: payload.plan.eventDate,
    area: selected.contractedAreaIds.map((id) => getFloorPlanArea(id)?.name ?? id).join(" · "), guestCount: selected.guestCount,
    time: selected.startAt && selected.endAt ? `${formatClock(selected.startAt)} – ${formatClock(selected.endAt)}` : "Time needs review",
  } : null;
  if (focusEventId && (!selected || (context.requestedDate && context.requestedDate !== payload.plan.eventDate))) return <p className="floor-plan-warning-copy" role="alert">No floor plan assigned. The selected event cannot be uniquely matched to this saved floor plan. No other party was substituted. <button onClick={context.switchEvent} type="button">Switch Event</button></p>;
  return (
    <>
    <EventSelectionBridge event={focusEventId ? contextEvent : null} />
    <PublishedFloorPlanMapView
      onSelectEvent={setVisibleEventId}
      payload={payload}
      selectedEventId={selected?.id ?? null}
      focused={Boolean(focusEventId)}
      zoom={zoom}
    />
    </>
  );
}

export function PublishedFloorPlanMapView({
  payload,
  zoom = 100,
  selectedEventId,
  onSelectEvent,
  focused = false,
}: {
  payload: FloorPlanDayPayload;
  zoom?: number;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
  focused?: boolean;
}) {
  const view = floorPlanEventView(payload.plan, payload.entertainmentReservations, selectedEventId);
  const { plan, entertainmentReservations } = view;
  const visibleEntertainment = visibleEntertainmentReservations(
    plan,
    entertainmentReservations,
  );
  const multipleReservationOutlines = entertainmentMultipleReservationOutlines(
    plan,
    entertainmentReservations,
  );
  const eventFillColors = new Map(
    plan.events.map((event) => [
      event.id,
      floorPlanEventFillColor(
        plan,
        entertainmentReservations,
        event,
      ),
    ]),
  );

  return (
    <div className="published-floor-plan-map">
      {view.selectedEventId && (payload.floorPlanConflicts.length || payload.entertainmentConflicts.length) ? (
        <p className="floor-plan-warning-copy" role="status">
          Full-day conflicts: {payload.floorPlanConflicts.length + payload.entertainmentConflicts.length}. Showing one event does not remove conflicts with other parties.
        </p>
      ) : null}
      <div
        className="floor-plan-map-canvas"
        style={{
          minWidth: `${9.8 * zoom}px`,
          width: `${zoom}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt="On Par Entertainment floor map"
          draggable={false}
          src="/floor-plans/blank-floor-map.png"
        />
        {plan.events
          .filter((event) => event.fullBuyout)
          .map((event) => (
            <span
              aria-label={`Full facility buyout: ${event.name}`}
              className="floor-plan-full-buyout-overlay"
              key={`full-buyout-${event.id}`}
              style={{
                "--event-color": event.color,
                backgroundColor: `${event.color}24`,
                borderColor: event.color,
              } as React.CSSProperties}
            />
          ))}
        <FloorPlanEventLegend
          onSelectEvent={onSelectEvent}
          plan={focused ? plan : payload.plan}
          selectedEventId={view.selectedEventId}
          readOnly={focused}
        />
        <div className="floor-plan-area-layer published-floor-plan-area-layer">
          <FloorPlanLocalOutlines plan={plan} entertainmentReservations={entertainmentReservations} />
          {multipleReservationOutlines.map((outline) => (
            <span
              aria-label={`${outline.resourceNames.join(", ")} also reserved by ${outline.eventName}${outline.timeLabel ? `, ${outline.timeLabel}` : ""}`}
              className="floor-plan-entertainment-multiple-outline"
              key={outline.id}
              role="img"
              style={{
                left: `${(outline.x / 1920) * 100}%`,
                top: `${(outline.y / 1080) * 100}%`,
                width: `${(outline.width / 1920) * 100}%`,
                height: `${(outline.height / 1080) * 100}%`,
                "--event-color": outline.color,
                "--event-fill-color": outline.fillColor,
              } as React.CSSProperties}
            >
              {outline.timeLabel ? (
                <small className="floor-plan-entertainment-outline-time">
                  {outline.timeLabel}
                </small>
              ) : null}
            </span>
          ))}
          {DISPLAY_AREAS.map((area) => {
            const local = primaryLocalFloorPlanReservation(plan, area.id);
            const shared = area.entertainmentResourceId
              ? visibleEntertainment.find(
                  (reservation) =>
                    reservation.resourceId === area.entertainmentResourceId,
                ) ?? null
              : null;
            const event = displayEventForFloorPlanArea(plan, local, shared);
            if (!event) return null;
            const fillColor = eventFillColors.get(event.id) ?? event.color;
            const showTime = Boolean(
              shared &&
                area.type !== "mini-golf" &&
                isEntertainmentTimeAnchor(
                  visibleEntertainment,
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
                  "--event-fill-color": fillColor,
                  backgroundColor: `${fillColor}80`,
                  borderColor: event.color,
                  color: readableOverlayText(fillColor),
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
              const fillColor = eventFillColors.get(event.id) ?? event.color;
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
                    backgroundColor: `${fillColor}80`,
                    borderColor: event.color,
                    color: readableOverlayText(fillColor),
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
