"use client";

import Link from "next/link";
import { useState } from "react";
import { formatEventDate, itineraries, type EventPlan, type ItineraryAsset } from "@/lib/events";

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Itineraries</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/checklists">Checklists</Link>
      </nav>
    </header>
  );
}

function formatPosterDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function upper(value: string) {
  return value.toUpperCase();
}

function entertainmentGroups(event: EventPlan) {
  if (!event.entertainment.length) {
    return [
      {
        title: "Entertainment",
        lines: ["No reserved entertainment listed"],
      },
    ];
  }

  return event.entertainment.map((item) => {
    const detail = [item.quantity, item.time, item.duration].filter(Boolean).join(" | ");
    return {
      title: item.name,
      lines: detail ? [detail] : [],
    };
  });
}

function PosterSection({
  heading,
  items,
}: {
  heading: string;
  items: Array<{ title?: string; lines: string[] }>;
}) {
  return (
    <section className="poster-section">
      <h4>{heading}</h4>
      <div className="poster-section-body">
        {items.map((item, index) => (
          <div className="poster-item" key={`${heading}-${index}-${item.title ?? item.lines.join("-")}`}>
            {item.title ? <strong>{upper(item.title)}</strong> : null}
            {item.lines.map((line) => (
              <p key={line}>{upper(line)}</p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function ItineraryPoster({ event }: { event: ItineraryAsset }) {
  const foodItems = event.food.map((item) => ({ lines: [item] }));
  const drinkItems = event.drink_options.map((item) => ({ lines: [item] }));
  const entertainmentItems = entertainmentGroups(event);

  return (
    <article className="itinerary-poster">
      <div className="poster-stripe poster-stripe-a" />
      <div className="poster-stripe poster-stripe-b" />
      <div className="poster-stripe poster-stripe-c" />

      <div className="poster-logo">
        <span>On Par</span>
        <small>Entertainment</small>
      </div>

      <div className="poster-topline">
        <span>{formatPosterDate(event.date)}</span>
        <span>{upper(event.time)}</span>
      </div>

      <h3 className="poster-title">{upper(event.name)}</h3>

      <PosterSection heading="Food" items={foodItems} />
      <PosterSection heading="Entertainment" items={entertainmentItems} />
      <PosterSection heading="Drinks" items={drinkItems} />

      <div className="poster-review">
        <div className="poster-review-badge">On Par</div>
        <p>SCAN TO LEAVE US A GOOGLE REVIEW</p>
      </div>
    </article>
  );
}

export default function ItinerariesClient() {
  const [activeEventId, setActiveEventId] = useState<number>(itineraries[0]?.id ?? 0);
  const activeEvent = itineraries.find((event) => event.id === activeEventId) ?? itineraries[0];

  if (!activeEvent) {
    return null;
  }

  return (
    <>
      <Header />
      <main className="page itinerary-page">
        <section className="intro">
          <div>
            <h2>Itineraries</h2>
            <p>Each event follows the same itinerary poster format shown in your uploaded template.</p>
          </div>
        </section>

        <section className="event-tab-strip" aria-label="Itinerary event tabs">
          {itineraries.map((event) => {
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
                  {formatEventDate(event.date)} | {event.time}
                </small>
              </button>
            );
          })}
        </section>

        <section className="itinerary-panel">
          <div className="event-header-card itinerary-summary-card">
            <div className="event-field-grid itinerary-summary-grid">
              <div className="checklist-meta-card">
                <span className="eyebrow">Event</span>
                <strong>{activeEvent.name}</strong>
                <span className="meta">{activeEvent.guest_count} guests</span>
              </div>
              <div className="checklist-meta-card">
                <span className="eyebrow">Date</span>
                <strong>{formatEventDate(activeEvent.date)}</strong>
                <span className="meta">{activeEvent.day}</span>
              </div>
              <div className="checklist-meta-card">
                <span className="eyebrow">Time</span>
                <strong>{activeEvent.time}</strong>
                <span className="meta">{activeEvent.rooms.join(", ")}</span>
              </div>
              <div className="checklist-meta-card">
                <span className="eyebrow">Status</span>
                <strong>Current itinerary</strong>
                {activeEvent.pdf ? (
                  <a className="button-link itinerary-open-link" href={activeEvent.pdf} target="_blank" rel="noreferrer">
                    Open approved PDF
                  </a>
                ) : (
                  <span className="meta">Poster view generated from current Tripleseat data.</span>
                )}
              </div>
            </div>
          </div>

          <div className="itinerary-poster-shell">
            <ItineraryPoster event={activeEvent} />
          </div>

          <div className="asset-section itinerary-support-card">
            <h3>Operational Notes</h3>
            {activeEvent.special_instructions?.length ? (
              <ul className="itinerary-support-list">
                {activeEvent.special_instructions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="meta">No additional instructions are listed on the current event data.</p>
            )}
            <p className="meta">{activeEvent.verification_status}</p>
          </div>
        </section>
      </main>
    </>
  );
}
