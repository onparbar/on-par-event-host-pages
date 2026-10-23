"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { EventWorkspaceTimeline } from "@/app/_components/EventWorkspace";
import { operationalEventFromPlan } from "@/lib/operations/event-context";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { formatEventDate } from "@/lib/event-format";
import { ENTERTAINMENT_UPDATE_CHANNEL } from "@/lib/entertainment/live-updates";
import { changedItinerarySections, itineraryDrinkLines, itineraryEntertainmentGroups } from "@/lib/itineraries/presentation";
import type {
  EventPlanOperationalNote,
  ItineraryAsset,
} from "@/lib/event-plans/types";

function compactTimeRange(value: string) {
  return value.replace(/\s*-\s*/g, " – ").replace(/\s+/g, " ");
}

function operationalNoteKey(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLocaleLowerCase("en-US");
}

function formatSourceNoteTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function operationalNoteProvenance(note: EventPlanOperationalNote) {
  const details = [
    note.sourceId
      ? `Tripleseat note #${note.sourceId}`
      : "Tripleseat event note",
  ];
  if (
    note.sourceCreatedAt &&
    note.sourceCreatedAt !== note.sourceUpdatedAt
  ) {
    details.push(
      `Created ${formatSourceNoteTimestamp(note.sourceCreatedAt)}`,
    );
  }
  if (note.sourceUpdatedAt) {
    details.push(
      `Updated ${formatSourceNoteTimestamp(note.sourceUpdatedAt)}`,
    );
  } else if (note.sourceCreatedAt) {
    details.push(
      `Created ${formatSourceNoteTimestamp(note.sourceCreatedAt)}`,
    );
  }
  return details.join(" · ");
}

export function ItineraryDashboard({ event, online }: { event: ItineraryAsset; online: boolean }) {
  const entertainmentItems = itineraryEntertainmentGroups(event);
  const drinkItems = itineraryDrinkLines(event);

  return (
    <article className="itinerary-dashboard-card">
      <header className="itinerary-dashboard-hero">
        <div className="itinerary-hero-brand">
          <Image
            alt="On Par Entertainment"
            height={73}
            src="/brand/on-par-logo-white-transparent.png"
            width={142}
          />
          <span aria-hidden="true" />
          <div>
            <small>Event Host Itinerary</small>
            <strong>Guest Experience Plan</strong>
          </div>
        </div>
        <div className="itinerary-hero-title">
          <span>{formatEventDate(event.date)}</span>
          <h2>{event.name}</h2>
          <p>{event.time}</p>
        </div>
      </header>

      <div className="itinerary-revision-stamp" data-ready={event.revision?.ready === true && online}>
        <span title={event.revision?.fingerprint}>{event.revision?.label ?? "Revision not verified"}</span>
        {event.revision ? <small>Snapshot {formatSourceNoteTimestamp(event.revision.generatedAt)} · Floor plan {event.revision.floorPlanVersion ? `v${event.revision.floorPlanVersion}` : "not verified"}</small> : null}
      </div>

      <div className="itinerary-fact-grid">
        <div>
          <span>Event Date</span>
          <strong>{formatEventDate(event.date)}</strong>
          <small>Confirmed event date</small>
        </div>
        <div>
          <span>Event Time</span>
          <strong>{compactTimeRange(event.time)}</strong>
          <small>Local venue time</small>
        </div>
        <div>
          <span>Guest Count</span>
          <strong>{event.guest_count}</strong>
          <small>Expected guests</small>
        </div>
        <div>
          <span>Reserved Rooms</span>
          <strong>{event.rooms.length}</strong>
          <small>{event.rooms.join(", ") || "No room listed"}</small>
        </div>
      </div>

      <div className="itinerary-detail-grid">
        <section className="itinerary-detail-card itinerary-food-card">
          <header>
            <span className="itinerary-section-number">01</span>
            <div>
              <small>Service Plan</small>
              <h3>Food</h3>
            </div>
          </header>
          {event.food.length ? (
            <ul>
              {event.food.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No food selections are listed.</p>
          )}
        </section>

        <section className="itinerary-detail-card itinerary-entertainment-card">
          <header>
            <span className="itinerary-section-number">02</span>
            <div>
              <small>Reserved Activities</small>
              <h3>Entertainment</h3>
            </div>
          </header>
          <div className="itinerary-activity-list">
            {entertainmentItems.map((item) => (
              <div key={`${item.title}-${item.detail}`}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="itinerary-detail-card itinerary-drinks-card">
          <header>
            <span className="itinerary-section-number">03</span>
            <div>
              <small>Beverage Service</small>
              <h3>Drinks</h3>
            </div>
          </header>
          <ul>
            {drinkItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
      {event.itinerary_edit?.fields.special_instructions?.length ? <section className="itinerary-admin-instructions"><h3>Event Instructions</h3><ul>{event.itinerary_edit.fields.special_instructions.map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
    </article>
  );
}

export default function ItinerariesClient({
  items,
  initialEventId,
}: {
  items: ItineraryAsset[];
  initialEventId?: number;
}) {
  const router = useRouter();
  const { preferredEventId, ready: eventContextReady, selectEvent } = useEventContext();
  const activeEventId = preferredEventId ?? (initialEventId ? String(initialEventId) : null);
  const [refreshState, setRefreshState] = useState<
    "idle" | "refreshing" | "error"
  >("idle");
  const [isOnline, setIsOnline] = useState(true);
  const [changedSections, setChangedSections] = useState<Record<number, string[]>>({});
  const previousRevisions = useRef(new Map<number, NonNullable<ItineraryAsset["revision"]>>());
  const activeEvent = activeEventId
    ? items.find((event) => String(event.id) === activeEventId)
    : eventContextReady ? items[0] : undefined;

  useEffect(() => {
    const changed: Record<number, string[]> = {};
    for (const item of items) {
      const previous = previousRevisions.current.get(item.id);
      if (previous && item.revision) {
        const sections = changedItinerarySections(previous, item.revision);
        if (sections.length) changed[item.id] = sections;
      }
      if (item.revision) previousRevisions.current.set(item.id, item.revision);
    }
    if (Object.keys(changed).length) setChangedSections((current) => ({ ...current, ...changed }));
  }, [items]);

  useEffect(() => {
    const refresh = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine && document.visibilityState === "visible") router.refresh();
    };
    const offline = () => setIsOnline(false);
    setIsOnline(navigator.onLine);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(ENTERTAINMENT_UPDATE_CHANNEL);
    channel.addEventListener("message", () => router.refresh());
    return () => channel.close();
  }, [router]);

  async function refreshEventPlans() {
    setRefreshState("refreshing");
    try {
      const response = await fetch("/api/event-plans/sync", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Unable to refresh event plans.");
      }
      window.location.reload();
    } catch {
      setRefreshState("error");
    }
  }

  if (!activeEvent) return (
    <PortalShell mainClassName="page itinerary-page" sectionSubtitle="Event details" sectionTitle="Itineraries">
      <PortalPageHeader description="Choose an available event to review its current itinerary." eyebrow="Event Host workspace" title="Itineraries" />
      <p role="status">{!eventContextReady ? "Loading your selected event…" : activeEventId ? "The selected event is not available in this itinerary window. Choose another event below; no different party has been selected automatically." : "No itineraries are available."}</p>
      {items.map((event) => <button className="event-switcher" key={event.id} onClick={() => selectEvent(operationalEventFromPlan(event))} type="button">{event.name} · {formatEventDate(event.date)}</button>)}
    </PortalShell>
  );

  const operationalNotes = activeEvent.operational_notes ?? [];
  const operationalNoteTexts = new Set(
    operationalNotes.map((note) => operationalNoteKey(note.text)),
  );
  const uniqueSpecialInstructions = (
    activeEvent.special_instructions ?? []
  ).filter(
    (instruction) =>
      !operationalNoteTexts.has(operationalNoteKey(instruction)),
  );
  const reviewReasons = activeEvent.review_reasons ?? [];
  const needsReview =
    activeEvent.needs_review === true || reviewReasons.length > 0;
  const hasEventHostDetails =
    uniqueSpecialInstructions.length > 0 ||
    operationalNotes.length > 0;

  return (
    <PortalShell
      mainClassName="page itinerary-page"
      sectionSubtitle="Event details"
      sectionTitle="Itineraries"
    >
      <EventSelectionBridge event={operationalEventFromPlan(activeEvent)} />
      <PortalPageHeader
        aside={
          <div className="portal-status-row">
            <PortalStatusBadge tone="success">
              {items.length} active itineraries
            </PortalStatusBadge>
            <button
              className="button-link itinerary-open-link"
              disabled={refreshState === "refreshing"}
              onClick={() => void refreshEventPlans()}
              type="button"
            >
              {refreshState === "refreshing"
                ? "Refreshing…"
                : "Refresh Tripleseat plans"}
            </button>
            {refreshState === "error" ? (
              <PortalStatusBadge>Refresh failed</PortalStatusBadge>
            ) : null}
          </div>
        }
        description="Review current event, shared entertainment, and saved floor-plan information. Readiness checks and revision stamps distinguish staff-ready copies from review copies."
        eyebrow="Event Host workspace"
        title="Itineraries"
      />

      <section className="event-tab-strip" aria-label="Itinerary event tabs">
        {items.map((event) => {
          const isActive = event.id === activeEvent.id;
          return (
            <button
              className={`event-switcher${isActive ? " active" : ""}`}
              key={event.id}
              onClick={() => selectEvent(operationalEventFromPlan(event))}
              type="button"
            >
              <span>{event.name}</span>
              <small>
                {formatEventDate(event.date)} · {event.time}
              </small>
            </button>
          );
        })}
      </section>

      <EventWorkspaceTimeline />
      <section className="itinerary-panel">
        {!isOnline ? <p className="itinerary-source-alert" role="alert">Offline — this is the last loaded copy. Reconnect and refresh before issuing it to staff.</p> : null}
        {changedSections[activeEvent.id]?.length ? <p className="itinerary-source-alert" role="status">Updated since this page was opened: {changedSections[activeEvent.id].join(", ")}. Review the new revision before printing.</p> : null}
        <div className="itinerary-toolbar">
          <div>
            <span className="eyebrow">{activeEvent.revision?.ready ? "Verified saved snapshot" : "Itinerary review copy"}</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {activeEvent.guest_count} guests · {activeEvent.rooms.join(", ")}
            </span>
          </div>
          <div className="itinerary-toolbar-actions">
            {activeEvent.pdf ? (
              <a
                className="button-link itinerary-open-link"
                href={activeEvent.pdf}
                rel="noreferrer"
                target="_blank"
              >
                {activeEvent.revision?.savedPdfStatus === "matching" ? "Open matching saved PDF" : activeEvent.revision?.savedPdfStatus === "outdated" ? "Open outdated saved PDF" : "Open saved PDF (unverified)"}
              </a>
            ) : (
              <PortalStatusBadge>
                {activeEvent.revision?.ready ? "Readiness checks passed" : "Review required"}
              </PortalStatusBadge>
            )}
            <button
              aria-label={`Print ${activeEvent.name} ${activeEvent.revision?.ready && isOnline ? "staff itinerary" : "review copy"} at 4 by 9 inches`}
              className="button-link itinerary-print-button"
              onClick={() => window.print()}
              type="button"
            >
              {activeEvent.revision?.ready && isOnline ? "Print staff itinerary" : "Print review copy"} · 4″ × 9″
            </button>
          </div>
        </div>

        <div className="itinerary-workspace">
          <ItineraryDashboard event={activeEvent} online={isOnline} />

          <aside className="itinerary-operations-card">
            {activeEvent.itinerary_edit ? <p className="itinerary-source-alert">Admin-edited itinerary · {formatSourceNoteTimestamp(activeEvent.itinerary_edit.updatedAt)}. These display edits do not change the contract, reservations, kitchen prep, or KDS orders.</p> : null}
            <div className="itinerary-verification">
              <span>Readiness · {activeEvent.revision?.label ?? "Unverified revision"}</span>
              <strong>{activeEvent.revision?.ready ? "Verified source and approved floor plan" : "Review required before staff use"}</strong>
              {activeEvent.revision?.reasons.length ? <ul className="itinerary-support-list">{activeEvent.revision.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              <p className="meta">Source sync: {activeEvent.revision?.lastSourceSyncAt ? formatSourceNoteTimestamp(activeEvent.revision.lastSourceSyncAt) : "Not verified"}<br />Entertainment sync: {activeEvent.revision?.lastEntertainmentSyncAt ? formatSourceNoteTimestamp(activeEvent.revision.lastEntertainmentSyncAt) : "Not verified"}<br />Floor plan: {activeEvent.revision?.floorPlanStatus ?? "Not verified"}</p>
              {activeEvent.pdf && activeEvent.revision?.savedPdfStatus !== "matching" ? <p className="meta">The saved PDF has no matching current-revision evidence. It remains available for reference but is not presented as approved or current.</p> : null}
            </div>
            <span className="eyebrow">Operational Notes</span>
            <h3>Event Host Details</h3>
            {hasEventHostDetails ? (
              <ul className="itinerary-support-list">
                {uniqueSpecialInstructions.map((item, index) => (
                  <li key={`instruction-${operationalNoteKey(item)}-${index}`}>
                    {item}
                  </li>
                ))}
                {operationalNotes.map((note, index) => (
                  <li
                    key={`event-note-${note.sourceId ?? index}-${index}`}
                  >
                    <span>{note.text}</span>
                    <br />
                    <small className="meta">
                      {operationalNoteProvenance(note)}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="meta">
                No additional instructions are listed on the current event data.
              </p>
            )}
            {activeEvent.needs_review !== undefined ||
            reviewReasons.length > 0 ? (
              <div className="itinerary-verification">
                <span>Plan status</span>
                <strong>
                  {needsReview
                    ? "Needs review"
                    : "No unresolved review items"}
                </strong>
                {reviewReasons.length ? (
                  <ul className="itinerary-support-list">
                    {reviewReasons.map((reason, index) => (
                      <li key={`review-${reason}-${index}`}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="itinerary-verification">
              <span>Verification status</span>
              <strong>{activeEvent.verification_status}</strong>
            </div>
          </aside>
        </div>
      </section>
    </PortalShell>
  );
}
