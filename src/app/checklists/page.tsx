import { redirect } from "next/navigation";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { availableChecklistEvents } from "@/lib/event-lifecycle";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  if (tab === "addons") {
    redirect("/event-host-addons");
  }

  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadEventPlanWindow(),
  ]);
  const checklistEvents = checklistEventsForPlans(eventPlanWindow.plans);
  const activeEventIds = availableChecklistEvents(
    checklistEvents,
    adminState.archivedEventIds,
  ).map((event) => event.id);

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
    />
  );
}
