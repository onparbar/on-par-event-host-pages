"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatEventDate } from "@/lib/event-format";
import { easternDateValue } from "@/lib/event-lifecycle";
import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import type { OperationalEventSummary } from "@/lib/operations/command-center";
import { eventSelectionHref, staffEventsForDate } from "@/lib/operations/staff-workspace";
import { EventSelectionBridge, useEventContext } from "./EventContext";
import { StaffNameSelect } from "./StaffNameSelect";
import { PortalStatusBadge } from "./PortalShell";

function timestampLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value)) : "Not verified";
}

export function EventCommandCenter({ events, initialNow, assignedStaffByEvent = {}, sourceWarning }: {
  events: OperationalEventSummary[];
  initialNow: string;
  assignedStaffByEvent?: Record<string, string>;
  sourceWarning?: string;
}) {
  const router = useRouter();
  const { preferredEventId, requestedDate, selectedEvent, staffName, openStaffEvent } = useEventContext();
  const today = easternDateValue(new Date(initialNow));
  const date = requestedDate && isValidEntertainmentDate(requestedDate) ? requestedDate : today;
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [employee, setEmployee] = useState(staffName);
  const selected = events.find((item) => item.event.eventId === preferredEventId && (!requestedDate || item.event.date === requestedDate));
  const opening = events.find((item) => item.event.eventId === openingId && item.event.date === date);
  useEffect(() => { setEmployee(staffName); }, [staffName]);
  useEffect(() => { setOpeningId(null); }, [date]);
  const visible = staffEventsForDate(events, date, search);

  function chooseDate(nextDate: string) {
    if (isValidEntertainmentDate(nextDate)) router.push(eventSelectionHref(nextDate));
  }

  return (
    <section aria-labelledby="command-center-title" className="event-command-center">
      <EventSelectionBridge event={selected?.event ?? null} />
      <div className="event-command-heading">
        <div><h2 id="command-center-title">Choose your event</h2><p>Open your event, select your name, and keep the same party connected across all five workspace tabs. All times Eastern.</p></div>
      </div>
      <div className="staff-event-selection-controls">
        <div aria-label="Event date navigation" className="staff-event-date-controls" role="group">
          <button aria-label="Previous day" onClick={() => chooseDate(addCalendarDays(date, -1))} type="button">‹</button>
          <button onClick={() => chooseDate(today)} type="button">Today</button>
          <label>Event date<input onChange={(event) => chooseDate(event.target.value)} type="date" value={date} /></label>
          <button aria-label="Next day" onClick={() => chooseDate(addCalendarDays(date, 1))} type="button">›</button>
        </div>
        <label className="staff-event-search">Search event name<input onChange={(event) => setSearch(event.target.value)} placeholder="Search this date…" type="search" value={search} /></label>
      </div>
      {sourceWarning ? <p className="event-command-attention" role="status">{sourceWarning}</p> : null}
      <p className="event-command-hint">{formatEventDate(date)} · {visible.length} {visible.length === 1 ? "event" : "events"}</p>
      {opening ? (
        <section aria-labelledby="staff-event-opening-title" className="staff-event-opening">
          <div><span className="portal-event-context-label">Open Event</span><h3 id="staff-event-opening-title">{opening.event.eventName}</h3><p>{formatEventDate(opening.event.date)} · {opening.event.time || "Time needs review"} · {opening.event.area || "Area needs review"}</p></div>
          <StaffNameSelect id="open-event-employee" onChange={setEmployee} value={employee} />
          <button className="button" disabled={!employee} onClick={() => openStaffEvent(opening.event, employee)} type="button">Open My Event</button>
          <button className="secondary" onClick={() => setOpeningId(null)} type="button">Cancel</button>
          <p className="staff-identity-note">Your name identifies your workspace only. No code or login is needed, and this does not check in a VIP or send food.</p>
        </section>
      ) : null}
      <div className="event-command-grid">
        {visible.map((item) => (
          <article className={`event-command-card${selectedEvent?.eventId === item.event.eventId && selectedEvent.date === item.event.date ? " is-selected" : ""}`} key={`${item.event.date}:${item.event.eventId}`}>
            <div className="event-command-card-top"><span>{formatEventDate(item.event.date)}</span><PortalStatusBadge tone={item.attention.length ? "warning" : "neutral"}>{item.attention.length ? "Needs attention" : "Source available"}</PortalStatusBadge></div>
            <h3>{item.event.eventName}</h3>
            <p className="event-command-time">{item.event.time || "Time needs review"}</p>
            <dl className="event-command-facts">
              <div><dt>Guests</dt><dd>{item.event.guestCount || "Needs review"}</dd></div>
              <div><dt>Reserved area</dt><dd>{item.event.area || "Needs review"}</dd></div>
              <div><dt>Checklist</dt><dd>{item.checklistStatus === "submitted" ? "Submitted" : item.checklistStatus === "unavailable" ? "Unavailable" : item.checklistStatus === "not-started" ? "Not started" : `${item.checklistCompleted}/${item.checklistTotal} tasks checked`}</dd></div>
              <div><dt>Assigned staff</dt><dd>{assignedStaffByEvent[`${item.event.date}:${item.event.eventId}`] || (item.hostAssigned ? "Assigned in checklist" : "Not assigned")}</dd></div>
            </dl>
            {item.attention.length ? <ul className="event-command-attention">{item.attention.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
            <p className="event-command-freshness">Source refreshed: {timestampLabel(item.sourceSyncedAt)} · Source updated: {timestampLabel(item.sourceUpdatedAt)}</p>
            <div className="event-command-links"><button className="button" onClick={() => { setOpeningId(item.event.eventId); setEmployee(staffName); }} type="button">Open Event</button></div>
          </article>
        ))}
      </div>
      {!visible.length ? <div className="event-command-empty"><h3>No events found for this date</h3><p>{search ? "Try another event name or clear your search." : "Use Previous day, Next day, or the date picker to find your party. Source refresh controls remain in each operations section."}</p></div> : null}
      <p className="event-command-hint">This overview uses event plans, saved checklists, and read-only VIP bookings. VIP arrival check-in and kitchen ticket release remain separate operations.</p>
    </section>
  );
}
