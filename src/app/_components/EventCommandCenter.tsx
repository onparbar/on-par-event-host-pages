"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatEventDate } from "@/lib/event-format";
import { easternDateValue } from "@/lib/event-lifecycle";
import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import type { OperationalEventSummary } from "@/lib/operations/command-center";
import { eventSelectionHref } from "@/lib/operations/staff-workspace";
import { EventSelectionBridge, useEventContext } from "./EventContext";
import { StaffNameSelect } from "./StaffNameSelect";

type EventCard = Omit<OperationalEventSummary, "attention" | "hostAssigned">;
type StaffingCards = Record<string, { status: "assigned" | "unassigned" | "review" | "unverified"; names: string[] }>;
const eventKey = ({ event }: EventCard) => `${event.date}:${event.eventId}`;

function timestampLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(value)) : "Not verified";
}

export function EventCommandCenter({ events, initialNow, staffingByEvent = {}, sourceWarning }: {
  events: EventCard[];
  initialNow: string;
  staffingByEvent?: StaffingCards;
  sourceWarning?: string;
}) {
  const router = useRouter();
  const { preferredEventId, requestedDate, selectedEvent, staffName, signedInStaff, openStaffEvent } = useEventContext();
  const today = easternDateValue(new Date(initialNow));
  const date = requestedDate && isValidEntertainmentDate(requestedDate) ? requestedDate : today;
  const through = addCalendarDays(today, 6);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [employee, setEmployee] = useState(staffName);
  const selected = events.find((item) => item.event.eventId === preferredEventId && (!requestedDate || item.event.date === requestedDate));
  const opening = events.find((item) => eventKey(item) === openingId);
  useEffect(() => { setEmployee(staffName); }, [staffName]);
  useEffect(() => { setOpeningId(null); }, [date]);
  const term = search.trim().toLocaleLowerCase("en-US");
  const groups = new Map<string, EventCard[]>();
  const seen = new Set<string>();
  for (const item of events) {
    const { date: eventDate, eventName } = item.event;
    const key = eventKey(item);
    if ((eventDate < today || eventDate > through) && eventDate !== date) continue;
    if (seen.has(key) || (term && !eventName.toLocaleLowerCase("en-US").includes(term))) continue;
    seen.add(key);
    const group = groups.get(eventDate) ?? [];
    group.push(item);
    groups.set(eventDate, group);
  }
  const todayEvents = groups.get(today) ?? [];
  const upcomingDays = [...groups.keys()].filter((eventDate) => eventDate > today && eventDate <= through).sort();
  const outsideWeek = date < today || date > through;

  function chooseDate(nextDate: string) {
    if (isValidEntertainmentDate(nextDate)) router.push(eventSelectionHref(nextDate));
  }

  function cards(items: EventCard[]) {
    return <div className="event-command-grid">{items.map((item) => {
      const staffing = staffingByEvent[item.event.eventId];
      const names = staffing?.names ?? [];
      const unassigned = staffing?.status === "unassigned" && names.length === 0;
      const verified = staffing?.status === "assigned" && names.length > 0;
      const reviewHref = `/admin/staffing?${new URLSearchParams({ eventId: item.event.eventId, date: item.event.date })}`;
      return (
        <article className={`event-command-card${selectedEvent?.eventId === item.event.eventId && selectedEvent.date === item.event.date ? " is-selected" : ""}`} key={eventKey(item)}>
          <h4 className="event-command-card-title">{item.event.eventName}</h4>
          <p className="event-command-time">{item.event.time || "Time not confirmed"}</p>
          <dl className="event-command-facts">
            <div><dt>Guests</dt><dd>{item.event.guestCount || "Not confirmed"}</dd></div>
            <div><dt>Reserved area</dt><dd>{item.event.area || "Not confirmed"}</dd></div>
            <div><dt>Checklist</dt><dd>{item.checklistStatus === "submitted" ? "Submitted" : item.checklistStatus === "unavailable" ? "Unavailable" : item.checklistStatus === "not-started" ? "Not started" : `${item.checklistCompleted}/${item.checklistTotal} tasks checked`}</dd></div>
            <div><dt>Assigned staff</dt><dd>{names.length ? names.join(", ") : unassigned ? "None" : "Not confirmed"}
              {names.length > 0 && !verified ? <small className="event-command-staffing-note">Staffing not yet verified</small> : null}
            </dd></div>
          </dl>
          <p className="event-command-freshness">Source refreshed: {timestampLabel(item.sourceSyncedAt)} · Source updated: {timestampLabel(item.sourceUpdatedAt)}</p>
          <div className="event-command-links">
            <button className="button" onClick={() => {
              if (signedInStaff) openStaffEvent(item.event, staffName);
              else { setOpeningId(eventKey(item)); setEmployee(staffName); }
            }} type="button">Open Event</button>
            {unassigned ? <a className="event-command-unassigned" href={reviewHref}>No Staff Assigned</a> : null}
          </div>
        </article>
      );
    })}</div>;
  }

  return (
    <section aria-labelledby="command-center-title" className="event-command-center">
      <EventSelectionBridge event={selected?.event ?? null} />
      <div className="event-command-heading">
        <div><h2 id="command-center-title">Choose your event</h2><p>Open your event to keep the same party connected across the workspace. All times Eastern.</p></div>
      </div>
      <div className="staff-event-selection-controls">
        <div aria-label="Event date navigation" className="staff-event-date-controls" role="group">
          <button aria-label="Previous day" onClick={() => chooseDate(addCalendarDays(date, -1))} type="button">‹</button>
          <button onClick={() => chooseDate(today)} type="button">Today</button>
          <label>Event date<input onChange={(event) => chooseDate(event.target.value)} type="date" value={date} /></label>
          <button aria-label="Next day" onClick={() => chooseDate(addCalendarDays(date, 1))} type="button">›</button>
        </div>
        <label className="staff-event-search">Search event name<input onChange={(event) => setSearch(event.target.value)} placeholder="Search displayed events…" type="search" value={search} /></label>
      </div>
      {sourceWarning ? <p className="event-command-attention" role="status">{sourceWarning}</p> : null}
      {opening ? (
        <section aria-labelledby="staff-event-opening-title" className="staff-event-opening">
          <div><span className="portal-event-context-label">Open Event</span><h3 id="staff-event-opening-title">{opening.event.eventName}</h3><p>{formatEventDate(opening.event.date)} · {opening.event.time || "Time needs review"} · {opening.event.area || "Area needs review"}</p></div>
          <StaffNameSelect id="open-event-employee" onChange={setEmployee} value={employee} />
          <button className="button" disabled={!employee} onClick={() => openStaffEvent(opening.event, employee)} type="button">Open My Event</button>
          <button className="secondary" onClick={() => setOpeningId(null)} type="button">Cancel</button>
          <p className="staff-identity-note">Opening an event does not check in a VIP or send food.</p>
        </section>
      ) : null}
      <section aria-labelledby="event-command-today" className="event-command-day">
        <h3 id="event-command-today">Today <span>· {formatEventDate(today)}</span></h3>
        {todayEvents.length ? cards(todayEvents) : <p className="event-command-empty">{term ? "No matching events today." : "No events today."}</p>}
      </section>
      <section aria-labelledby="event-command-upcoming" className="event-command-day">
        <h3 id="event-command-upcoming">Upcoming this week</h3>
        {upcomingDays.length ? upcomingDays.map((eventDate) => (
          <section aria-label={formatEventDate(eventDate)} className="event-command-day" key={eventDate}>
            <h4 className="event-command-day-date">{formatEventDate(eventDate)}</h4>
            {cards(groups.get(eventDate)!)}
          </section>
        )) : <p className="event-command-empty">{term ? "No matching upcoming events." : "No upcoming events in the seven-day window."}</p>}
      </section>
      {outsideWeek ? <section aria-label="Selected date outside this week" className="event-command-day">
        <h3>{formatEventDate(date)}</h3>
        {groups.has(date) ? cards(groups.get(date)!) : <p className="event-command-empty">No events found for this date.</p>}
      </section> : null}
      <p className="event-command-hint">This overview uses event plans, saved checklists, and read-only VIP bookings. VIP arrival check-in and kitchen ticket release remain separate operations.</p>
    </section>
  );
}
