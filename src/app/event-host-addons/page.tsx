import ChecklistsClient from "@/app/checklists/ChecklistsClient";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { easternDateValue } from "@/lib/event-lifecycle";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";

export const metadata = {
  title: "Event Host Add-Ons | On Par Entertainment",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function EventHostAddOnsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requestedDate } = await searchParams;
  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(requestedDate && isValidEntertainmentDate(requestedDate) ? requestedDate : easternDateValue(new Date()), {
      exactDate: Boolean(requestedDate && isValidEntertainmentDate(requestedDate)), includeUnsubmitted: true,
    }),
  ]);
  const checklistEvents = checklistEventsForPlans(eventPlanWindow.plans);
  const archivedEventIds = new Set(adminState.archivedEventIds);
  const activeEventIds = checklistEvents
    .filter((event) => !archivedEventIds.has(event.id))
    .map((event) => event.id);

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
      workspace="addons"
      sourceWarning={eventPlanWindow.sourceWarning}
    />
  );
}
