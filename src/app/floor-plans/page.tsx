import Link from "next/link";
import { cookies } from "next/headers";
import AssetImageWithOverlays from "@/app/_components/AssetImageWithOverlays";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { floorPlans, floorPlanSpecialPages } from "@/lib/events";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function FloorPlansPage() {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const adminState = await loadAdminState();
  const visiblePlans = floorPlans.filter(
    (plan) => !adminState.archivedAssetKeys.includes(plan.image),
  );
  const visibleSpecialPages = floorPlanSpecialPages.filter(
    (plan) => !adminState.archivedAssetKeys.includes(plan.image),
  );

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
        {visibleSpecialPages.map((plan) => (
          <section className="asset-section" key={`special-${plan.image}`}>
            <h3>{plan.label} Special Page</h3>
            <p className="asset-note">Separate from the Saturday event floor map.</p>
            <div className="event-row">
              {plan.events.map((event) => (
                <span className="event-chip" key={event}>
                  {event}
                </span>
              ))}
            </div>
            <AssetImageWithOverlays
              alt={`Special Saturday page for ${plan.label}`}
              image={plan.image}
              overlays={adminState.overlaysByAsset[plan.image] ?? []}
            />
          </section>
        ))}
        {visiblePlans.map((plan) => (
          <section className="asset-section" key={plan.image}>
            <h3>{plan.label}</h3>
            <div className="event-row">
              {plan.events.map((event) => (
                <span className="event-chip" key={event}>
                  {event}
                </span>
              ))}
            </div>
            <AssetImageWithOverlays
              alt={`Floor plan for ${plan.label}`}
              image={plan.image}
              overlays={adminState.overlaysByAsset[plan.image] ?? []}
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
