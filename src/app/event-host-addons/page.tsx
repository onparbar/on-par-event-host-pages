import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import ChecklistsClient from "@/app/checklists/ChecklistsClient";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import { rollingEventPlanHorizon } from "@/lib/event-plans/horizon";
import type { EventPlan } from "@/lib/event-plans/types";
import { VipPrepClient, vipPrepEventPlan } from "@/lib/vip-prep/client";

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
  const horizon = rollingEventPlanHorizon();
  const vipClient = new VipPrepClient();
  let vipPlans: EventPlan[] = [];
  if (vipClient.configured) {
    try {
      vipPlans = (await vipClient.fetchRange(
        horizon.startDate,
        horizon.endDate,
      )).reservations.map(vipPrepEventPlan);
    } catch {
      // Keep Tripleseat add-on sheets available during a temporary VIP API outage.
    }
  }
  const checklistEvents = checklistEventsForPlans([
    ...eventPlanWindow.plans,
    ...vipPlans,
  ]).sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.time.localeCompare(right.time) ||
      left.name.localeCompare(right.name),
  );
  const archivedEventIds = new Set(adminState.archivedEventIds);
  const activeEventIds = checklistEvents
    .filter((event) => !archivedEventIds.has(event.id))
    .map((event) => event.id);

  return (
    <ChecklistsClient
      activeEventIds={activeEventIds}
      events={checklistEvents}
      workspace="addons"
    />
  );
}
