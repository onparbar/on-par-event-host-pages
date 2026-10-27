import { redirect } from "next/navigation";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { availableChecklistEvents } from "@/lib/event-lifecycle";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { easternDateValue } from "@/lib/event-lifecycle";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
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

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
      sourceWarning={eventPlanWindow.sourceWarning}
    />
  );
}
