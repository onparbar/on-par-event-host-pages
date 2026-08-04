import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import ChecklistsClient from "@/app/checklists/ChecklistsClient";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { activeEvents } from "@/lib/event-lifecycle";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";

export const metadata = {
  title: "Event Host Add-Ons | On Par Entertainment",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function EventHostAddOnsPage() {
  const cookieStore = await cookies();

  if (!hasAdminSession(cookieStore)) {
    return <AdminAccessGate />;
  }

  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadEventPlanWindow(),
  ]);
  const checklistEvents = checklistEventsForPlans(eventPlanWindow.plans);
  const activeEventIds = activeEvents(
    checklistEvents,
    adminState.archivedEventIds,
  ).map((event) => event.id);

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
      workspace="addons"
    />
  );
}
