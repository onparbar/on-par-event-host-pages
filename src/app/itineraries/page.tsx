import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import ItinerariesClient from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { activeEvents } from "@/lib/event-lifecycle";
import { itineraries } from "@/lib/events";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import type { ItineraryAsset } from "@/lib/event-plans/types";

export const metadata = {
  title: "Itineraries | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function ItinerariesPage() {
  if (!hasAdminSession(await cookies())) {
    return <AdminAccessGate />;
  }

  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadEventPlanWindow(),
  ]);
  const approvedPdfById = new Map(
    itineraries
      .filter((item) => item.pdf)
      .map((item) => [item.id, item.pdf]),
  );
  const currentItineraries: ItineraryAsset[] =
    eventPlanWindow.plans.map((plan) => ({
      ...plan,
      ...(approvedPdfById.get(plan.id)
        ? { pdf: approvedPdfById.get(plan.id) }
        : {}),
    }));
  const visibleItineraries = activeEvents(
    currentItineraries,
    adminState.archivedEventIds,
  );
  return <ItinerariesClient items={visibleItineraries} />;
}
