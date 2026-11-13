import { cookies } from "next/headers";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { loadAdminState } from "@/lib/admin-state";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
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
  const assignedStaffByEvent = Object.fromEntries((checklistRecords ?? [])
    .filter((record) => record.bwa.trim())
    .map((record) => [`${record.eventDate}:${record.eventId}`, record.bwa]));
  const staffingEvents = operationalEvents.flatMap(({ event, startsAt, endsAt }) =>
    event.date >= today && event.date <= through && !event.eventId.startsWith("vip-")
      ? [{ eventId: event.eventId, date: event.date, startAt: startsAt, endAt: endsAt }] : []);
  const staffingByEvent = staffingEvents.length && requiresStrongAdminSession() && hasAdminSession(await cookies())
    ? await loadStaffingCards(staffingEvents, { now, allowAdminPreview: true }).catch(() => ({})) : {};

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
        assignedStaffByEvent={assignedStaffByEvent}
        staffingByEvent={staffingByEvent}
        events={operationalEvents}
        initialNow={now.toISOString()}
        sourceWarning={[...new Set([eventPlanWindow.sourceWarning, selectedDay?.sourceWarning].filter(Boolean))].join(" ")}
      />
    </PortalShell>
  );
}
