import Link from "next/link";
import type { CSSProperties } from "react";
import { events, formatEventDate } from "@/lib/events";

export const metadata = {
  title: "Itineraries | On Par Event Host",
};

export default function ItinerariesPage() {
  return (
    <>
      <Header />
      <main className="page">
        <section className="intro">
          <div>
            <h2>Itineraries</h2>
            <p>Contract-checked event details from the current Tripleseat pull.</p>
          </div>
        </section>
        <section className="itinerary-grid">
          {events.map((event) => (
            <article className="itinerary-card" key={event.id} style={{ "--event-color": event.color } as CSSProperties}>
              <h3>{event.name}</h3>
              <p>
                {formatEventDate(event.date)} | {event.time}
              </p>
              <p>
                {event.guest_count} guests | {event.rooms.join(", ")}
              </p>

              <DetailList title="Food" items={event.food} />
              <DetailList title="Drink Options" items={event.drink_options} />
              <DetailList
                title="Entertainment"
                items={
                  event.entertainment.length
                    ? event.entertainment.map(
                        (item) => `${item.name}: ${item.quantity}, ${item.time}, ${item.duration}`,
                      )
                    : ["No reserved entertainment listed on the available BEO/API fields."]
                }
              />
              {event.special_instructions?.length ? (
                <DetailList title="Special Instructions" items={event.special_instructions} />
              ) : null}
              <p>{event.verification_status}</p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <p>
        <strong>{title}</strong>
      </p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

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
