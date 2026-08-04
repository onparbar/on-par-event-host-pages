import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { activeEvents } from "@/lib/event-lifecycle";
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
    />
  );
}
