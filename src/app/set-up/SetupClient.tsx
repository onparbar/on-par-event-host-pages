"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { PortalPageHeader, PortalShell, PortalStatusBadge } from "@/app/_components/PortalShell";
import { checklistEventForSelection } from "@/lib/checklist-model";
import type { EventPlan } from "@/lib/event-plans/types";
import { formatEventDate } from "@/lib/event-format";
import { operationalEventFromPlan } from "@/lib/operations/event-context";
import { buildSetupLayout, SETUP_FURNITURE_DIMENSIONS, TACO_BAR_SETUP_TEMPLATE, type SetupLayout } from "@/lib/operations/setup-layout";
import { TACO_BAR_SETUP_OBJECTS } from "./setup-objects";
import styles from "./Setup.module.css";

function sourceTime(value: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) + " Eastern"
    : "Source update time unavailable";
}

export default function SetupClient({ events, sourceWarning = "" }: { events: EventPlan[]; sourceWarning?: string }) {
  const { ready, preferredEventId, selectEvent, clearEvent } = useEventContext();
  const [activeEventId, setActiveEventId] = useState(events[0]?.id ?? 0);
  const event = checklistEventForSelection(events, preferredEventId, activeEventId);

  if (!ready) return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName="page"><p role="status">Loading the selected event…</p></PortalShell>;
  if (!event) return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName="page">
    <PortalPageHeader eyebrow="Event preparation" title="Event Set Up" description="Choose an event to view its setup requirements." />
    {sourceWarning ? <p className={styles.notice} role="alert">{sourceWarning}</p> : null}
    <section className={styles.card}><h2>{preferredEventId ? "The selected event is unavailable" : "No events available"}</h2><p>{preferredEventId ? "No different party has been substituted. Check the event date or choose another event." : "No active events were returned for this date. Refresh the source from the existing Kitchen or Floor Plans sync controls if needed."}</p>{preferredEventId ? <button type="button" onClick={clearEvent}>Choose another event</button> : null}</section>
    <ReferenceIllustration applied={false} />
  </PortalShell>;

  const layout = buildSetupLayout(event);
  return <PortalShell sectionTitle="Set Up" sectionSubtitle="Table layouts & equipment" mainClassName={`page ${styles.page}`}>
    <EventSelectionBridge event={operationalEventFromPlan(event)} />
    <PortalPageHeader eyebrow="Event preparation" title="Event Set Up" description="A visual starting point for the team. Confirm the contract, equipment, and final placement before setting the table." aside={<button className={styles.printButton} type="button" onClick={() => window.print()}>Print setup guide</button>} />
    <div className={styles.eventRow}>
      <label className={styles.eventSelect}><span>Event</span><select value={event.source_event_id ?? String(event.id)} onChange={(change) => {
        const selected = events.find((item) => (item.source_event_id ?? String(item.id)) === change.target.value);
        if (selected) { setActiveEventId(selected.id); selectEvent(operationalEventFromPlan(selected)); }
      }}>{events.map((item) => <option key={item.source_event_id ?? item.id} value={item.source_event_id ?? String(item.id)}>{item.name} · {formatEventDate(item.date)}</option>)}</select></label>
      <div><strong className={styles.printEventName}>{event.name}</strong><strong>{event.rooms.join(" · ") || "Area needs review"}</strong><small>{formatEventDate(event.date)} · {event.time} · {event.guest_count > 0 ? `${event.guest_count} guests` : "Guest count needs review"}</small></div>
    </div>
    {sourceWarning ? <p className={styles.notice} role="alert">{sourceWarning}</p> : null}
    <section className={styles.draftNotice} aria-label="Layout draft limitations"><PortalStatusBadge tone={layout.status === "needs-review" ? "warning" : "neutral"}>{layout.status === "no-food" ? "No food layout applied" : layout.status === "needs-review" ? "Needs Review" : "Draft layout"}</PortalStatusBadge><div><strong>Furniture dimensions confirmed · Equipment placement is a draft</strong><p>Furniture outlines use the supplied dimensions; equipment placement is illustrative, not to scale. Equipment footprints and clearances are still needed to confirm physical fit. This guide does not approve final placement or change reservations, tasks, or kitchen orders.</p></div></section>
    <section className={styles.requirements} aria-label="Contract setup requirements">
      <div><span>Food tables</span><strong>{layout.tableCount ?? "Needs review"}</strong><small>{layout.mirrored ? "Mirrored setup required" : "Existing kitchen setup rule"}</small></div>
      <div><span>Chafing dishes — prepared pans</span><strong>{layout.chafingDishes ?? "Needs review"}</strong><small>Calculated from the purchased food</small></div>
      <div><span>Serving chafing dishes</span><strong>{layout.servingChafingDishes ?? "Confirm placement"}</strong><small>Only shown when an existing serving rule applies</small></div>
    </section>
    {layout.mirrored ? <p className={styles.notice}>Two food tables are indicated by the current guest-count rule. Plan mirrored service, but do not double the purchased food quantities. Final table placement still needs confirmation.</p> : null}
    <div className={styles.mainGrid}>
      <div className={styles.guideColumn}>
        {layout.templateId === "taco-bar" ? <StationGuide key={`${event.source_event_id ?? event.id}:${event.date}`} stations={layout.stations} /> : <section className={styles.card}>
          <span className={styles.eyebrow}>Layout coverage</span><h2>{layout.status === "no-food" ? "No food is listed for this event" : "This menu needs a setup template"}</h2><p>{layout.status === "no-food" ? "No buffet layout has been applied. Review the contract if food should be included." : "The Taco Bar reference has not been applied to this event. Its purchased food and calculated equipment remain listed below; additional layouts need an approved reference."}</p>
        </section>}
        {layout.additionalFood.length ? <section className={styles.reviewCard} aria-label="Additional food placement"><h2>Additional food · Placement needs review</h2><p>These items are not placed in the Taco Bar reference. Allow space for their equipment after equipment footprints and clearances are confirmed.</p><ul>{layout.additionalFood.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></section> : null}
        {layout.review.length ? <section className={styles.reviewCard} aria-label="Setup review items"><h2>Before the team sets up</h2><ul>{layout.review.map((reason) => <li key={reason}>{reason}</li>)}</ul></section> : null}
      </div>
      <ReferenceIllustration key={`${event.source_event_id ?? event.id}:${event.date}`} applied={layout.templateId === "taco-bar"} />
    </div>
    <section className={styles.card} aria-label="Purchased food and prep quantities"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Contract reference</span><h2>Purchased food & prep quantities</h2></div><span>Listed once · quantities unchanged</span></div><ul className={styles.purchased}>{layout.purchasedFood.length ? layout.purchasedFood.map((item, index) => <li key={`${index}:${item}`}>{item}</li>) : <li>No food listed.</li>}</ul>
      {layout.food.length ? <div className={styles.tableScroll}><table><thead><tr><th scope="col">Food</th><th scope="col">Prep quantity</th><th scope="col">Prepared pans</th></tr></thead><tbody>{layout.food.map((item, index) => <tr key={`${index}:${item.name}`}><th scope="row">{item.name}</th><td>{item.quantity === null ? "Needs review" : `${item.quantity} ${item.unit}`}</td><td>{item.pans === null ? item.panSize ? "Needs review" : "—" : `${item.pans}${item.panSize ? ` × ${item.panSize} pans` : " pans"}`}</td></tr>)}</tbody></table></div> : null}
    </section>
    <details className={styles.source}><summary>Source & rule reference</summary><p>Event source: {layout.source.eventId}</p><p>{sourceTime(layout.source.updatedAt)}</p><p>Rule version: {layout.source.ruleVersion}</p><p>Generated from the existing verified event information and deterministic kitchen rules. The reference illustration is not a quantity calculation.</p></details>
  </PortalShell>;
}

export function StationGuide({ stations }: { stations: SetupLayout["stations"] }) {
  const [stationIndex, setStationIndex] = useState(0);
  const selected = stations[stationIndex] ?? stations[0];
  if (!selected) return null;
  return <section className={styles.card} aria-label="Taco Bar station guide"><div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Taco Bar base reference</span><h2>Build the serving line</h2></div><span>Tap a station for details</span></div><p className={styles.caption}>Furniture outlines are proportional to the supplied dimensions. Numbered equipment zones show the reference sequence, not equipment size or confirmed fit. The reference depicts one central chafer; use the event equipment counts above and confirm any additional placement.</p>
    <div className={styles.stationLayout}>
      <div className={styles.schematic} aria-label="Measured furniture with illustrative Taco Bar stations">
        <button className={styles.cartStation} type="button" aria-pressed={stationIndex === 0} aria-controls="setup-station-details" onClick={() => setStationIndex(0)}>
          <span className={styles.cartPair} style={{ width: `${SETUP_FURNITURE_DIMENSIONS.cart.combinedWidthInches / SETUP_FURNITURE_DIMENSIONS.table.widthInches * 100}%`, aspectRatio: `${SETUP_FURNITURE_DIMENSIONS.cart.combinedWidthInches} / ${SETUP_FURNITURE_DIMENSIONS.cart.combinedLengthInches}` }}><span>Cart 1</span><span>Cart 2</span></span>
          <span className={styles.cartTitle}><span className={styles.stationNumber}>1</span>{stations[0].title}</span>
        </button>
        <p className={styles.furnitureLabel}>Two carts · combined 21.5 × 31 in<br />Each cart: 21.5 × 15.5 in</p>
        <div className={styles.tableOutline} style={{ aspectRatio: `${SETUP_FURNITURE_DIMENSIONS.table.widthInches} / ${SETUP_FURNITURE_DIMENSIONS.table.lengthInches}` }}>{stations.slice(1).map((station, index) => <button className={styles.station} key={station.id} type="button" aria-pressed={index + 1 === stationIndex} aria-controls="setup-station-details" onClick={() => setStationIndex(index + 1)}><span className={styles.stationNumber}>{index + 2}</span><StationSymbol index={index + 1} /><span>{station.title}</span></button>)}</div>
        <p className={styles.furnitureLabel}>Buffet table · 8 ft × 3 ft<br />96 × 36 in</p>
      </div>
      <div id="setup-station-details" className={styles.stationDetails} aria-live="polite"><span className={styles.eyebrow}>Station {stationIndex + 1}</span><h3>{selected.title}</h3><p>{selected.instructions}</p><ul>{selected.equipment.map((item) => <li key={item}>{item}</li>)}</ul><p className={styles.caption}>Reference equipment only. Event-specific requirements and any unresolved warnings take priority.</p></div>
    </div>
    <div className={styles.printStations}><p>Measured furniture: buffet table 96 × 36 in (8 ft × 3 ft); two marble carts, each 21.5 × 15.5 in, side by side with a combined outline of 21.5 × 31 in. Equipment footprints and clearances remain unverified.</p>{stations.map((station, index) => <section key={station.id}><h3>{index + 1}. {station.title}</h3><p>{station.instructions}</p><ul>{station.equipment.map((item) => <li key={item}>{item}</li>)}</ul></section>)}</div>
  </section>;
}

function StationSymbol({ index }: { index: number }) {
  return <svg viewBox="0 0 180 74" aria-hidden="true" className={styles.stationSymbol}>
    {index === 0 ? <><rect x="22" y="10" width="48" height="48" rx="4" /><rect x="110" y="10" width="48" height="48" rx="4" /><path d="M28 22h36M28 31h36M28 40h36M116 22h36M116 31h36M116 40h36" /><rect x="81" y="20" width="18" height="34" rx="2" /></> : index === 1 ? <><circle cx="36" cy="36" r="24" /><circle cx="144" cy="36" r="24" /><path d="M20 36h32M128 36h32" /><rect x="75" y="18" width="30" height="12" rx="2" /><rect x="75" y="36" width="30" height="12" rx="2" /></> : index === 2 ? <><rect x="52" y="12" width="76" height="48" rx="3" /><path d="M60 20l25 30M120 20L95 50M60 23l22 30M120 23L98 53" /></> : index === 3 ? <><rect x="53" y="9" width="74" height="56" rx="8" /><path d="M75 34h30v7H75z" /><rect x="13" y="17" width="22" height="40" rx="2" /><rect x="145" y="17" width="22" height="40" rx="2" /></> : <><rect x="55" y="10" width="70" height="12" rx="2" /><rect x="43" y="30" width="94" height="12" rx="2" /><rect x="31" y="50" width="118" height="12" rx="2" /></>}
  </svg>;
}

export function ReferenceIllustration({ applied }: { applied: boolean }) {
  const [selected, setSelected] = useState<(typeof TACO_BAR_SETUP_OBJECTS)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const identify = (item: (typeof TACO_BAR_SETUP_OBJECTS)[number]) => {
    if (item.id === selected?.id) dialog.current?.showModal();
    else setSelected(item);
  };
  const content = <>
    <p className={styles.caption}>Tap an object in the picture to learn its name and use, or choose it from the item picker.</p>
    <figure className={styles.referenceFigure}>
      <div className={styles.objectImage}>
        <img src="/setup/taco-bar-reference-v1.png" width="1024" height="1536" alt="AI-generated example of the Taco Bar serving arrangement, with two marble supply carts, tortilla warmers, taco stands, lettuce-wrap riser, central chafer and tiered serving stand" />
        {TACO_BAR_SETUP_OBJECTS.map((item) => <button key={item.id} className={styles.objectHotspot} type="button" data-setup-object={item.id} aria-label={`Identify: ${item.label}`} aria-haspopup="dialog" aria-controls={dialogId} title={item.label} style={{ left: `${item.left}%`, top: `${item.top}%`, width: `${item.width}%`, height: `${item.height}%` }} onClick={() => identify(item)} />)}
      </div>
      <figcaption>AI-generated reference illustration · Not to scale. Follow the written station instructions and the event’s calculated requirements, not quantities inferred from this picture.</figcaption>
    </figure>
    <label className={styles.objectPicker}><span>Find an item</span><select value="" onChange={(change) => { const item = TACO_BAR_SETUP_OBJECTS.find((entry) => entry.id === change.target.value); if (item) identify(item); }}><option value="">Choose an object…</option>{TACO_BAR_SETUP_OBJECTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <dialog ref={dialog} id={dialogId} className={styles.objectDialog} aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}>
      <form method="dialog"><button className={styles.objectClose} type="submit" aria-label="Close item details">Close</button></form>
      <span className={styles.eyebrow}>Setup item</span><h2 id={`${dialogId}-title`}>{selected?.label}</h2><p id={`${dialogId}-description`}>{selected?.description}</p><p className={styles.caption}>Reference placement only. Use the event’s setup requirements for quantities.</p>
    </dialog>
  </>;
  return applied ? <section className={`${styles.card} ${styles.referenceCard}`} aria-label="Taco Bar reference illustration"><span className={styles.eyebrow}>Visual reference</span><h2>What the setup should resemble</h2>{content}</section> : <details className={`${styles.card} ${styles.referenceCard}`}><summary>Taco Bar reference library · Not applied to this event</summary>{content}<ol>{TACO_BAR_SETUP_TEMPLATE.stations.map((station) => <li key={station.id}><strong>{station.title}</strong><p>{station.instructions}</p></li>)}</ol></details>;
}
