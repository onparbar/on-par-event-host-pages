import Link from "next/link";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { activeEvents, easternDateValue } from "@/lib/event-lifecycle";
import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import { listChecklistRecords } from "@/lib/checklist-storage";
import { buildOperationalEventSummaries } from "@/lib/operations/command-center";
import { EventCommandCenter } from "@/app/_components/EventCommandCenter";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { loadStaffingCards } from "@/lib/staffing/service";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const now = new Date();
  const { date: requestedDate } = await searchParams;
  const today = easternDateValue(now);
  const through = addCalendarDays(today, 6);
  const date = typeof requestedDate === "string" && isValidEntertainmentDate(requestedDate) ? requestedDate : today;
  const outsideWeek = date < today || date > through;
  const [adminState, eventPlanWindow, checklistRecords, selectedDay] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(today, { includeUpcomingVip: true, throughDate: through }),
    listChecklistRecords().catch(() => null),
    outsideWeek ? loadStaffEventPlans(date, { exactDate: true }) : null,
  ]);
  const plans = [
    ...eventPlanWindow.plans.filter((plan) => plan.date >= today && plan.date <= through),
    ...(selectedDay?.plans.filter((plan) => plan.date === date) ?? []),
  ];
  const visibleEvents = activeEvents(
    plans,
    adminState.archivedEventIds,
    now,
  );
  const visibleFloorPlanDates = new Set(visibleEvents.map((event) => event.date)).size;
  const checklistEvents = checklistEventsForPlans(plans);
  const visibleChecklists = activeEvents(
    checklistEvents,
    adminState.archivedEventIds,
    now,
  );
  const operationalEvents = buildOperationalEventSummaries(
    plans.filter((event) => !adminState.archivedEventIds.includes(event.id)),
    checklistRecords,
    eventPlanWindow.sync,
  ).map(({ attention: _privateReasons, hostAssigned: _checklistHost, ...card }) => card);
  const weekEvents = operationalEvents.flatMap(({ event, startsAt, endsAt }) =>
    event.date >= today && event.date <= through ? [{ eventId: event.eventId, date: event.date, startAt: startsAt, endAt: endsAt }] : [],
  );
  const savedStaffing = weekEvents.length ? await loadStaffingCards(weekEvents, { now }).catch(() => null) : null;
  const staffingByEvent = Object.fromEntries(weekEvents.flatMap(({ eventId }) => {
    const staffing = savedStaffing?.[eventId];
    return staffing ? [[eventId, { status: staffing.status, names: staffing.names }]] : [];
  }));

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
        description="See today’s events and the week ahead, then open an event to get to work."
        eyebrow="On Par operations"
        title="Event Host Portal"
      />
      <EventCommandCenter
        staffingByEvent={staffingByEvent}
        events={operationalEvents}
        initialNow={now.toISOString()}
        sourceWarning={[...new Set([eventPlanWindow.sourceWarning, selectedDay?.sourceWarning].filter(Boolean))].join(" ")}
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
          <Link className="home-link portal-module-card" href="/set-up">
            <span className="portal-module-kicker">Table arrangements</span>
            <strong>Set Up</strong>
            <span>View event-specific equipment and the Taco Bar setup reference.</span>
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
