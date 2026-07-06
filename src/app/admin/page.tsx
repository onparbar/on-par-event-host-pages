import Link from "next/link";
import EditableAssetSection from "@/app/_components/EditableAssetSection";
import { entertainmentSchedules, floorPlans } from "@/lib/events";

export const metadata = {
  title: "Admin | On Par Event Host",
};

export default function AdminPage() {
  return (
    <>
      <Header />
      <main className="page admin-page">
        <section className="intro">
          <div>
            <h2>Admin</h2>
            <p>Edit floor plans and entertainment schedules here without changing the employee-facing display pages.</p>
          </div>
        </section>

        <section className="asset-section admin-section-card">
          <h3>Floor Plan Editor</h3>
          <p className="meta">Use highlights for new reservations, or Cover blocks to hide baked-in marks before redrawing them.</p>
        </section>
        {floorPlans.map((plan) => (
          <EditableAssetSection
            asset={plan}
            key={`admin-floor-${plan.date}`}
            subtitle="Admin editor for floor-plan revisions and PNG exports."
            title={plan.label}
          />
        ))}

        <section className="asset-section admin-section-card">
          <h3>Entertainment Schedule Editor</h3>
          <p className="meta">Adjust schedule blocks, labels, and callouts here without adding editing tools to the employee schedule view.</p>
        </section>
        {entertainmentSchedules.map((schedule) => (
          <EditableAssetSection
            asset={schedule}
            key={`admin-schedule-${schedule.date}`}
            subtitle={schedule.source ?? "Admin editor for entertainment schedule revisions."}
            title={schedule.label}
          />
        ))}
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Admin</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/itineraries">Itineraries</Link>
        <Link href="/checklists">Checklists</Link>
        <Link href="/admin">Admin</Link>
      </nav>
    </header>
  );
}
