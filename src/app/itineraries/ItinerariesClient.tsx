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
        <Link href="/admin">Admin</Link>
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

function compactTimeRange(value: string) {
  return value.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").toUpperCase();
}

function titleSize(name: string) {
  if (name.length > 44) {
    return "2.8rem";
  }
  if (name.length > 30) {
    return "3.25rem";
  }
  return "4.15rem";
}

function entertainmentGroups(event: EventPlan) {
  if (!event.entertainment.length) {
    return [
      {
        title: "No Reserved Entertainment",
        lines: ["No reserved entertainment listed"],
      },
    ];
  }

  return event.entertainment.map((item) => {
    const detailParts = [item.quantity];

    if (item.time && !/time not listed|untimed/i.test(item.time)) {
      detailParts.push(compactTimeRange(item.time));
    } else if (item.time && /untimed/i.test(item.time)) {
      detailParts.push("UNTIMED");
    } else if (item.time && /time not listed/i.test(item.time)) {
      detailParts.push("TIME NOT LISTED ON BEO");
    } else if (item.duration) {
      detailParts.push(upper(item.duration));
    }

    return {
      title: item.name,
      lines: detailParts.filter(Boolean).length ? [detailParts.filter(Boolean).join(" | ")] : [],
    };
  });
}

function itineraryDrinkLines(event: EventPlan) {
  const lines = ["FREE SODA AND JUICE FOR ALL GUESTS!"];
  const hasDrinkCards =
    event.food.some((item) => /full course/i.test(item)) ||
    event.drink_options.some((item) => /back nine|food \+ beverage|drink card/i.test(item));

  if (hasDrinkCards) {
    lines.push(`$20.00 PREPAID DRINK CARDS FOR ${event.guest_count} GUESTS!`);
  }

  return lines;
}

function ItineraryPoster({ event }: { event: ItineraryAsset }) {
  const foodItems = event.food.map((item) => upper(item));
  const drinkItems = itineraryDrinkLines(event).map((item) => upper(item));
  const entertainmentItems = entertainmentGroups(event);

  return (
    <article className="itinerary-poster itinerary-template-poster">
      <div className="template-mask template-date-mask" />
      <div className="template-mask template-time-mask" />
      <div className="template-mask template-event-mask" />
      <div className="template-mask template-food-mask" />
      <div className="template-mask template-entertainment-mask" />
      <div className="template-mask template-drinks-mask" />

      <div className="template-date-value">{upper(formatPosterDate(event.date))}</div>
      <div className="template-time-value">{compactTimeRange(event.time)}</div>
      <h3 className="template-event-value" style={{ fontSize: titleSize(event.name) }}>
        {upper(event.name)}
      </h3>

      <div className="template-section-label template-food-label">Food</div>
      <div className="template-section-label template-entertainment-label">Entertainment</div>
      <div className="template-section-label template-drinks-label">Drinks</div>

      <div className="template-food-value">
        {foodItems.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>

      <div className="template-entertainment-value">
        {entertainmentItems.map((item) => (
          <div className="template-entertainment-item" key={`${item.title}-${item.lines.join("-")}`}>
            {item.title ? <strong>{upper(item.title)}</strong> : null}
            {item.lines.map((line) => (
              <p key={line}>{upper(line)}</p>
            ))}
          </div>
        ))}
      </div>

      <div className="template-drinks-value">
        {drinkItems.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </div>
    </article>
  );
}

export default function ItinerariesClient({ items = itineraries }: { items?: ItineraryAsset[] }) {
  const [activeEventId, setActiveEventId] = useState<number>(items[0]?.id ?? 0);
  const activeEvent = items.find((event) => event.id === activeEventId) ?? items[0];

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
