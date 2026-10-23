import Link from "next/link";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { activeEvents, easternDateValue } from "@/lib/event-lifecycle";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { listChecklistRecords } from "@/lib/checklist-storage";
import { buildOperationalEventSummaries } from "@/lib/operations/command-center";
import { EventCommandCenter } from "@/app/_components/EventCommandCenter";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const now = new Date();
  const { date: requestedDate } = await searchParams;
  const date = requestedDate && isValidEntertainmentDate(requestedDate) ? requestedDate : easternDateValue(now);
  const [adminState, eventPlanWindow, checklistRecords] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(date),
    listChecklistRecords().catch(() => null),
  ]);
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
  const operationalEvents = buildOperationalEventSummaries(
    eventPlanWindow.plans.filter((event) => !adminState.archivedEventIds.includes(event.id)),
    checklistRecords,
    eventPlanWindow.sync,
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
        description="Choose an event, review what needs attention, and continue into seating, entertainment, kitchen, setup, and add-ons."
        eyebrow="On Par operations"
        title="Event Host Portal"
      />
      <EventCommandCenter
        assignedStaffByEvent={Object.fromEntries((checklistRecords ?? []).filter((record) => record.bwa.trim()).map((record) => [`${record.eventDate}:${record.eventId}`, record.bwa]))}
        events={operationalEvents}
        initialNow={now.toISOString()}
        sourceWarning={eventPlanWindow.sourceWarning}
      />
      <h2 className="portal-modules-title">All operations</h2>
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
          <Link className="home-link portal-module-card" href="/vip-check-in">
            <span className="portal-module-kicker">VIP arrivals</span>
            <strong>VIP Check-In</strong>
            <span>Confirm VIP arrivals and release their reserved food to the kitchen.</span>
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
