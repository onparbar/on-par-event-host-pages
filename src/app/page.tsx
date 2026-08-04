import Link from "next/link";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { loadAdminState } from "@/lib/admin-state";
import { entertainmentSchedules } from "@/lib/events";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { activeEvents } from "@/lib/event-lifecycle";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadEventPlanWindow(),
  ]);
  const now = new Date();
  const visibleSchedules = entertainmentSchedules.filter((schedule) => !adminState.archivedAssetKeys.includes(schedule.image));
  const visibleEvents = activeEvents(
    eventPlanWindow.plans,
    adminState.archivedEventIds,
    now,
  );
  const visibleFloorPlanDates = new Set(visibleEvents.map((event) => event.date)).size;
  const checklistEvents = checklistEventsForPlans(eventPlanWindow.plans);
  const visibleChecklists = activeEvents(
    checklistEvents,
    adminState.archivedEventIds,
    now,
  );

  return (
    <PortalShell
      mainClassName="page portal-home-page"
      sectionSubtitle="Unified operations portal"
      sectionTitle="Event Host"
    >
      <PortalPageHeader
        aside={
          <div className="portal-status-row">
            <PortalStatusBadge tone="success">
              {visibleEvents.length} active events
            </PortalStatusBadge>
            <PortalStatusBadge>
              {visibleFloorPlanDates} floor-plan dates
            </PortalStatusBadge>
            <PortalStatusBadge>
              {visibleChecklists.length} active checklists
            </PortalStatusBadge>
          </div>
        }
        description={`${visibleSchedules.length} published schedule dates plus live Tripleseat-backed entertainment and kitchen operations.`}
        eyebrow="On Par operations"
        title="Event Host Portal"
      />
      <nav className="link-grid portal-module-grid" aria-label="Event host sections">
          <Link className="home-link portal-module-card" href="/floor-plans">
            <span className="portal-module-kicker">Venue maps</span>
            <strong>Floor Plans</strong>
            <span>Generate, validate, approve, and print date-based operational floor plans.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/entertainment-schedules">
            <span className="portal-module-kicker">Live operations</span>
            <strong>Entertainment Schedule</strong>
            <span>Manage the live, resource-level schedule synchronized from Tripleseat.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/itineraries">
            <span className="portal-module-kicker">Event details</span>
            <strong>Itineraries</strong>
            <span>View guest count, food, drinks, rooms, and reserved entertainment.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/checklists">
            <span className="portal-module-kicker">Event Host workflow</span>
            <strong>Event Checklists</strong>
            <span>Complete and submit the operational checklist for each active event.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/event-host-addons">
            <span className="portal-module-kicker">Food &amp; entertainment</span>
            <strong>Event Add-Ons</strong>
            <span>Send Food add-ons live to Kitchen and close the complete add-on record to Admin.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/kitchen">
            <span className="portal-module-kicker">Daily production</span>
            <strong>Event Kitchen</strong>
            <span>View daily prep requirements and printable kitchen checklists.</span>
          </Link>
          <Link className="home-link portal-module-card" href="/admin">
            <span className="portal-module-kicker">Protected controls</span>
            <strong>Admin</strong>
            <span>Manage published schedule assets and completed staff records.</span>
          </Link>
        </nav>
    </PortalShell>
  );
}
