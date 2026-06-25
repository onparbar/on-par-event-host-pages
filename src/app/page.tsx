import Link from "next/link";
import { entertainmentSchedules, events, floorPlans } from "@/lib/events";
import { checklistEvents } from "@/lib/checklist-events";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="page">
        <section className="intro">
          <div>
            <h2>Event host pages</h2>
            <p>
              {events.length} verified events, {floorPlans.length} floor-plan dates,{" "}
              {entertainmentSchedules.length} entertainment schedule dates, and {checklistEvents.length} checklist tabs.
            </p>
          </div>
        </section>
        <nav className="link-grid" aria-label="Event host sections">
          <Link className="home-link" href="/floor-plans">
            <strong>Floor Plans</strong>
            <span>View current floor-plan maps in date order.</span>
          </Link>
          <Link className="home-link" href="/entertainment-schedules">
            <strong>Entertainment Schedules</strong>
            <span>View schedule exports generated from the current Tripleseat/BEO data.</span>
          </Link>
          <Link className="home-link" href="/itineraries">
            <strong>Itineraries</strong>
            <span>View guest count, food, drinks, rooms, and reserved entertainment.</span>
          </Link>
          <Link className="home-link" href="/checklists">
            <strong>Event Checklists</strong>
            <span>Switch between event checklist pages and add-on sheets.</span>
          </Link>
        </nav>
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Event Host</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/itineraries">Itineraries</Link>
        <Link href="/checklists">Checklists</Link>
      </nav>
    </header>
  );
}
