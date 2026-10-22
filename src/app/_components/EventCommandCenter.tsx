"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEventDate } from "@/lib/event-format";
import { easternDateValue } from "@/lib/event-lifecycle";
import { commandCenterEvents, type CommandCenterFilter, type OperationalEventSummary } from "@/lib/operations/command-center";
import { operationalEventHref } from "@/lib/operations/event-context";
import { EventSelectionBridge, useEventContext } from "./EventContext";
import { PortalStatusBadge } from "./PortalShell";

const FILTERS: Array<{ key: CommandCenterFilter; label: string }> = [
  { key: "today", label: "Today" },
  { key: "next60", label: "Next 60 minutes" },
  { key: "attention", label: "Needs attention" },
  { key: "upcoming", label: "Upcoming" },
];

function timestampLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value)) : "Not verified";
}

export function EventCommandCenter({ events, initialNow }: { events: OperationalEventSummary[]; initialNow: string }) {
  const [filter, setFilter] = useState<CommandCenterFilter>("today");
  const [now, setNow] = useState(() => new Date(initialNow));
  const { preferredEventId, requestedDate, selectedEvent } = useEventContext();
  const selected = events.find((item) => item.event.eventId === preferredEventId && (!requestedDate || item.event.date === requestedDate));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const visible = commandCenterEvents(events, filter, now);
  return (
    <section aria-labelledby="command-center-title" className="event-command-center">
      <EventSelectionBridge event={selected?.event ?? null} />
      <div className="event-command-heading">
        <div>
          <h2 id="command-center-title">Event command center</h2>
          <p>Select a party to keep its date and event connected across your workspace. All times Eastern.</p>
        </div>
        <span className="event-command-date">{formatEventDate(easternDateValue(now))}</span>
      </div>
      <div aria-label="Filter events" className="event-command-filters" role="group">
        {FILTERS.map((item) => (
          <button aria-pressed={filter === item.key} className={filter === item.key ? "is-active" : ""} key={item.key} onClick={() => setFilter(item.key)} type="button">
            {item.label} <span>{commandCenterEvents(events, item.key, now).length}</span>
          </button>
        ))}
      </div>
      {filter === "next60" ? <p className="event-command-hint">Events running now or starting within the next hour.</p> : null}
      <div className="event-command-grid">
        {visible.map((item) => (
          <article className={`event-command-card${selectedEvent?.eventId === item.event.eventId ? " is-selected" : ""}`} key={`${item.event.date}:${item.event.eventId}`}>
            <div className="event-command-card-top">
              <span>{formatEventDate(item.event.date)}</span>
              <PortalStatusBadge tone={item.attention.length ? "warning" : "neutral"}>{item.attention.length ? "Needs attention" : "Source available"}</PortalStatusBadge>
            </div>
            <h3>{item.event.eventName}</h3>
            <p className="event-command-time">{item.event.time || "Time needs review"}</p>
            <dl className="event-command-facts">
              <div><dt>Guests</dt><dd>{item.event.guestCount || "Needs review"}</dd></div>
              <div><dt>Reserved area</dt><dd>{item.event.area || "Needs review"}</dd></div>
              <div><dt>Checklist</dt><dd>{item.checklistStatus === "submitted" ? "Submitted" : item.checklistStatus === "unavailable" ? "Unavailable" : item.checklistStatus === "not-started" ? "Not started" : `${item.checklistCompleted}/${item.checklistTotal} tasks checked`}</dd></div>
              <div><dt>Event host</dt><dd>{item.hostAssigned ? "Assigned in checklist" : "Not assigned"}</dd></div>
            </dl>
            {item.attention.length ? <ul className="event-command-attention">{item.attention.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            <p className="event-command-freshness">Source refreshed: {timestampLabel(item.sourceSyncedAt)} · Source updated: {timestampLabel(item.sourceUpdatedAt)}</p>
            <nav aria-label={`${item.event.eventName} workspace`} className="event-command-links">
              <Link className="button" href={operationalEventHref("/kitchen", item.event)}>Open event workspace</Link>
              <Link href={operationalEventHref("/floor-plans", item.event)}>Floor plan</Link>
              <Link href={operationalEventHref("/checklists", item.event)}>Checklist</Link>
              <Link href={operationalEventHref("/itineraries", item.event)}>Itinerary</Link>
            </nav>
          </article>
        ))}
      </div>
      {!visible.length ? <div className="event-command-empty"><h3>No events in this view</h3><p>{filter === "attention" ? "No source or checklist warnings were found for upcoming events. This is not a full kitchen or resource readiness approval." : "Try another filter. Source refresh controls remain in each operations section."}</p></div> : null}
      <p className="event-command-hint">This overview uses saved event plans and checklists. Open each department for live kitchen tickets, resource conflicts, and final readiness checks.</p>
    </section>
  );
}
