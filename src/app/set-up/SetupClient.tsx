"use client";

import { useState } from "react";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { PortalPageHeader, PortalShell } from "@/app/_components/PortalShell";
import { checklistEventForSelection } from "@/lib/checklist-model";
import type { EventPlan } from "@/lib/event-plans/types";
import { formatEventDate } from "@/lib/event-format";
import { operationalEventFromPlan } from "@/lib/operations/event-context";
import { buildEventServingPlan } from "@/lib/operations/serving-plan";
import { buildSetupLayout } from "@/lib/operations/setup-layout";
import EventSetupDiagram from "./EventSetupDiagram";
import styles from "./Setup.module.css";

function sourceTime(value: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) + " Eastern"
    : "Source update time unavailable";
}

export default function SetupClient({ events, date, sourceWarning = "" }: { events: EventPlan[]; date: string; sourceWarning?: string }) {
  const { ready, requestedEventId, selectEvent, clearEvent } = useEventContext();
  const [activeEventId, setActiveEventId] = useState(events[0]?.id ?? 0);
  const event = checklistEventForSelection(events, requestedEventId, activeEventId);

  if (!ready) return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName="page"><p role="status">Loading the selected event…</p></PortalShell>;
  if (!event) return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName="page">
    <PortalPageHeader eyebrow="Event preparation" title="Event Set Up" description="Choose an event to view its setup requirements." />
    <div className={styles.eventRow}><SetupDateNavigation date={date} /></div>
    {sourceWarning ? <p className={styles.notice} role="alert">{sourceWarning}</p> : null}
    <section className={styles.card}><h2>{requestedEventId ? "The selected event is unavailable" : "No events available"}</h2><p>{requestedEventId ? "No different party has been substituted. Check the event date or choose another event." : "No active events were returned for this date. Refresh the source from the existing Kitchen or Floor Plans sync controls if needed."}</p>{requestedEventId ? <button type="button" onClick={clearEvent}>Choose another event</button> : null}</section>
  </PortalShell>;

  const layout = buildSetupLayout(event);
  const servingPlan = buildEventServingPlan(event);
  return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName={`page ${styles.page}`}>
    {requestedEventId ? <EventSelectionBridge event={operationalEventFromPlan(event)} /> : null}
    <PortalPageHeader eyebrow="Event preparation" title="Event Set Up" description="Built from this event’s contract. Tap any item to see its food contents, serving tools, and quantities." aside={<button className={styles.printButton} type="button" onClick={() => window.print()}>Print setup guide</button>} />
    <div className={styles.eventRow}>
      <SetupDateNavigation date={event.date} />
      <label className={styles.eventSelect}><span>Event</span><select value={event.source_event_id ?? String(event.id)} onChange={(change) => {
        const selected = events.find((item) => (item.source_event_id ?? String(item.id)) === change.target.value);
        if (selected) { setActiveEventId(selected.id); selectEvent(operationalEventFromPlan(selected)); }
      }}>{events.map((item) => <option key={item.source_event_id ?? item.id} value={item.source_event_id ?? String(item.id)}>{item.name} · {formatEventDate(item.date)}</option>)}</select></label>
      <div><strong className={styles.printEventName}>{event.name}</strong><strong>{event.rooms.join(" · ") || "Area needs review"}</strong><small>{formatEventDate(event.date)} · {event.time} · {event.guest_count > 0 ? `${event.guest_count} guests` : "Guest count needs review"}</small></div>
    </div>
    {sourceWarning ? <p className={styles.notice} role="alert">{sourceWarning}</p> : null}
    {layout.status !== "no-food" ? <p className={styles.notice}>Food-service standard: use two marble serving carts per serving line, side by side, with plates, napkins and forks accessible from each side.</p> : null}
    {layout.mirrored ? <p className={styles.notice}>Two food tables are indicated by the current guest-count rule. Plan mirrored service, but do not double the purchased food quantities. Final table placement still needs confirmation.</p> : null}
    <div className={styles.mainGrid}>
      {servingPlan.status !== "no-food" ? <EventSetupDiagram key={`${event.source_event_id ?? event.id}:${event.date}`} plan={servingPlan} /> : <section className={styles.card}>
        <span className={styles.eyebrow}>Layout coverage</span><h2>No food is listed for this event</h2><p>No buffet layout has been applied. Review the contract if food should be included.</p>
      </section>}
      <div className={styles.guideColumn}>
        {servingPlan.unplacedFood.length ? <section className={styles.reviewCard} aria-label="Additional food placement"><h2>Food needing setup review</h2><p>These contract items could not be assigned safely. Confirm their quantities or contents before adding them to the serving line.</p><ul>{servingPlan.unplacedFood.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></section> : null}
        {servingPlan.review.length ? <section className={styles.reviewCard} aria-label="Setup review items"><h2>Before the team sets up</h2><ul>{servingPlan.review.map((reason) => <li key={reason}>{reason}</li>)}</ul></section> : null}
      </div>
    </div>
    <section className={styles.card} aria-label="Purchased food and prep quantities"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Contract reference</span><h2>Purchased food & prep quantities</h2></div><span>Listed once · quantities unchanged</span></div><ul className={styles.purchased}>{layout.purchasedFood.length ? layout.purchasedFood.map((item, index) => <li key={`${index}:${item}`}>{item}</li>) : <li>No food listed.</li>}</ul>
      {layout.food.length ? <div className={styles.tableScroll}><table><thead><tr><th scope="col">Food</th><th scope="col">Prep quantity</th><th scope="col">Prepared pans</th></tr></thead><tbody>{layout.food.map((item, index) => <tr key={`${index}:${item.name}`}><th scope="row">{item.name}</th><td>{item.quantity === null ? "Needs review" : `${item.quantity} ${item.unit}`}</td><td>{item.pans === null ? item.panSize ? "Needs review" : "—" : `${item.pans}${item.panSize ? ` × ${item.panSize} pans` : " pans"}`}</td></tr>)}</tbody></table></div> : null}
    </section>
    <details className={styles.source}><summary>Source & rule reference</summary><p>Event source: {servingPlan.source.eventId}</p><p>{sourceTime(servingPlan.source.updatedAt)}</p><p>Serving rule version: {servingPlan.ruleVersion}</p><p>Prep rule version: {layout.source.ruleVersion}</p>{servingPlan.source.eventRuleVersion ? <p>Event rule version: {servingPlan.source.eventRuleVersion}</p> : null}<p>Calculated from the existing contract selections. Serving pans show what goes out on the table; all purchased food and kitchen prep quantities remain unchanged. Keep the extra prepared pans for refills.</p></details>
  </PortalShell>;
}

function SetupDateNavigation({ date }: { date: string }) {
  return <form key={date} action="/set-up" method="get" className={styles.dateNavigation} aria-label="Browse setup by date">
    <label><span>Event date</span><input type="date" required name="date" defaultValue={date} /></label>
    <button type="submit">View day</button>
  </form>;
}
