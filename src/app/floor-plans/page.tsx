import Link from "next/link";
import AssetImageWithOverlays from "@/app/_components/AssetImageWithOverlays";
import { loadAdminState } from "@/lib/admin-state";
import { floorPlans } from "@/lib/events";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function FloorPlansPage() {
  const adminState = await loadAdminState();
  const visiblePlans = floorPlans.filter((plan) => !adminState.archivedAssetKeys.includes(plan.image));

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
        {visiblePlans.map((plan) => (
          <section className="asset-section" key={plan.date}>
            <h3>{plan.label}</h3>
            <div className="event-row">
              {plan.events.map((event) => (
                <span className="event-chip" key={event}>
                  {event}
                </span>
              ))}
            </div>
            <AssetImageWithOverlays alt={`Floor plan for ${plan.label}`} image={plan.image} overlays={adminState.overlaysByAsset[plan.image] ?? []} />
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
        <Link href="/checklists">Checklists</Link>
        <Link href="/admin">Admin</Link>
      </nav>
    </header>
  );
}
