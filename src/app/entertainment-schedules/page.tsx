import Link from "next/link";
import AssetImageWithOverlays from "@/app/_components/AssetImageWithOverlays";
import { loadAdminState } from "@/lib/admin-state";
import { entertainmentSchedules } from "@/lib/events";

export const metadata = {
  title: "Entertainment Schedules | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function EntertainmentSchedulesPage() {
  const adminState = await loadAdminState();
  const visibleSchedules = entertainmentSchedules.filter((schedule) => !adminState.archivedAssetKeys.includes(schedule.image));

  return (
    <>
      <Header />
      <main className="page">
        <section className="intro">
          <div>
            <h2>Entertainment schedules</h2>
            <p>Template schedule exports, ordered by date.</p>
          </div>
        </section>
        {visibleSchedules.map((schedule) => (
          <section className="asset-section" key={schedule.date}>
            <h3>{schedule.label}</h3>
            {schedule.source ? <p className="meta">{schedule.source}</p> : null}
            <div className="event-row">
              {schedule.events.map((event) => (
                <span className="event-chip" key={event}>
                  {event}
                </span>
              ))}
            </div>
            <AssetImageWithOverlays
              alt={`Entertainment schedule for ${schedule.label}`}
              image={schedule.image}
              overlays={adminState.overlaysByAsset[schedule.image] ?? []}
            />
          </section>
        ))}
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Entertainment Schedules</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/itineraries">Itineraries</Link>
        <Link href="/checklists">Checklists</Link>
        <Link href="/admin">Admin</Link>
      </nav>
    </header>
  );
}
