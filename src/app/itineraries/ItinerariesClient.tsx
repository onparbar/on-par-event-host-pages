"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { formatEventDate } from "@/lib/event-format";
import { ENTERTAINMENT_UPDATE_CHANNEL } from "@/lib/entertainment/live-updates";
import type {
  EventPlan,
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

function entertainmentGroups(event: EventPlan) {
  if (!event.entertainment.length) {
    return [
      {
        title: "No reserved entertainment",
        detail: "No entertainment reservation is listed for this event.",
      },
    ];
  }

  return event.entertainment.map((item) => {
    const detailParts = [item.quantity];

    if (item.time && !/time not listed|untimed/i.test(item.time)) {
      detailParts.push(compactTimeRange(item.time));
    } else if (item.time && /untimed/i.test(item.time)) {
      detailParts.push("Untimed");
    } else if (item.time && /time not listed/i.test(item.time)) {
      detailParts.push("Time not listed on BEO");
    } else if (item.duration) {
      detailParts.push(item.duration);
    }

    return {
      title: item.name,
      detail: detailParts.filter(Boolean).join(" · "),
    };
  });
}

function itineraryDrinkLines(event: EventPlan) {
  const lines = ["Free soda and juice for all guests"];

  event.drink_options.forEach((item) => {
    if (
      /back nine|food \+ beverage|drink card|soft drinks included|soft drinks free of charge/i.test(
        item,
      )
    ) {
      return;
    }
    lines.push(item);
  });

  const hasDrinkCards =
    event.food.some((item) => /full course/i.test(item)) ||
    event.drink_options.some((item) =>
      /back nine|food \+ beverage|drink card/i.test(item),
    );

  if (hasDrinkCards) {
    lines.push(`$20 prepaid drink cards for ${event.guest_count} guests`);
  }

  return lines;
}

function ItineraryDashboard({ event }: { event: ItineraryAsset }) {
  const entertainmentItems = entertainmentGroups(event);
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
    </article>
  );
}

export default function ItinerariesClient({
  items,
}: {
  items: ItineraryAsset[];
}) {
  const router = useRouter();
  const [activeEventId, setActiveEventId] = useState<number>(items[0]?.id ?? 0);
  const [refreshState, setRefreshState] = useState<
    "idle" | "refreshing" | "error"
  >("idle");
  const activeEvent =
    items.find((event) => event.id === activeEventId) ?? items[0];

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

  if (!activeEvent) {
    return null;
  }

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
        description="Review the event summary and approved guest itinerary in the same visual system as the operations dashboard."
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
              onClick={() => setActiveEventId(event.id)}
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

      <section className="itinerary-panel">
        <div className="itinerary-toolbar">
          <div>
            <span className="eyebrow">Current Itinerary</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {activeEvent.guest_count} guests · {activeEvent.rooms.join(", ")}
            </span>
          </div>
          {activeEvent.pdf ? (
            <a
              className="button-link itinerary-open-link"
              href={activeEvent.pdf}
              rel="noreferrer"
              target="_blank"
            >
              Open Approved PDF
            </a>
          ) : (
            <PortalStatusBadge>Generated from current event data</PortalStatusBadge>
          )}
        </div>

        <div className="itinerary-workspace">
          <ItineraryDashboard event={activeEvent} />

          <aside className="itinerary-operations-card">
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
