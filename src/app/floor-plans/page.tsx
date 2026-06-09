import Link from "next/link";
import { floorPlans } from "@/lib/events";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
};

export default function FloorPlansPage() {
  return (
    <>
      <Header />
      <main className="page">
        <section className="intro">
          <div>
            <h2>Floor plans</h2>
            <p>Current floor maps, ordered by event date.</p>
          </div>
        </section>
        {floorPlans.map((plan) => (
          <section className="asset-section" key={plan.date}>
            <h3>{plan.label}</h3>
            <div className="event-row">
              {plan.events.map((event) => (
                <span className="event-chip" key={event}>
                  {event}
                </span>
              ))}
            </div>
            <img className="asset-image" src={plan.image} alt={`Floor plan for ${plan.label}`} />
          </section>
        ))}
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Floor Plans</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/itineraries">Itineraries</Link>
      </nav>
    </header>
  );
}
