import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { availableChecklistEvents } from "@/lib/event-lifecycle";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { easternDateValue } from "@/lib/event-lifecycle";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { operationalEventWindow } from "@/lib/operations/command-center";
import { loadStaffingPrefills } from "@/lib/staffing/service";
import ChecklistsClient from "./ChecklistsClient";

export const metadata = {
  title: "Event Checklists | On Par Entertainment",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  const { tab, date: requestedDate } = await searchParams;
  if (tab === "addons") {
    redirect("/event-host-addons");
  }

  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(requestedDate && isValidEntertainmentDate(requestedDate) ? requestedDate : easternDateValue(new Date()), {
      exactDate: Boolean(requestedDate && isValidEntertainmentDate(requestedDate)), includeUnsubmitted: true,
    }),
  ]);
  const checklistEvents = checklistEventsForPlans(eventPlanWindow.plans);
  const activeEventIds = requestedDate && isValidEntertainmentDate(requestedDate)
    ? checklistEvents.map((event) => event.id)
    : [...new Set([
      ...availableChecklistEvents(checklistEvents, adminState.archivedEventIds).map((event) => event.id),
      ...(eventPlanWindow.unfinishedEventIds ?? []),
    ])];
  const initialRecords = eventPlanWindow.savedChecklistRecords ?? null;
  const activeIds = new Set(activeEventIds);
  const savedDates = new Map(initialRecords?.map((record) => [record.eventId, record.eventDate]));
  const staffingEvents = initialRecords ? checklistEvents.flatMap((event) => {
    if (!activeIds.has(event.id) || savedDates.get(event.id) === event.date) return [];
    const window = operationalEventWindow(event);
    return window ? [{
      eventId: event.source_event_id ?? String(event.id), date: event.date,
      startAt: window.startsAt, endAt: window.endsAt,
    }] : [];
  }) : [];
  const allowAdminPreview = staffingEvents.length > 0 && requiresStrongAdminSession() && hasAdminSession(await cookies());
  const staffingPrefills = allowAdminPreview
    ? await loadStaffingPrefills(staffingEvents, { allowAdminPreview: true }).catch(() => ({})) : {};

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
      initialRecords={initialRecords}
      staffingPrefills={staffingPrefills}
      sourceWarning={eventPlanWindow.sourceWarning}
    />
  );
}
