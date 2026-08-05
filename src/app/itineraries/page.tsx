import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import ItinerariesClient from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { activeEvents } from "@/lib/event-lifecycle";
import { itineraries } from "@/lib/events";
import { getEntertainmentDay } from "@/lib/entertainment/sync";
import { loadEventPlanWindow } from "@/lib/event-plans/sync";
import { applyEntertainmentDayToItinerary } from "@/lib/itineraries/entertainment";
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
  const entertainmentDays = new Map(
    (await Promise.all(
      [...new Set(eventPlanWindow.plans.map((plan) => plan.date))].map(
        async (date) => {
          const day = await getEntertainmentDay(date).catch(() => null);
          return day ? ([date, day] as const) : null;
        },
      ),
    )).filter(
      (entry): entry is readonly [string, Awaited<ReturnType<typeof getEntertainmentDay>>] =>
        entry !== null,
    ),
  );
  const currentItineraries: ItineraryAsset[] =
    eventPlanWindow.plans.map((plan) => {
      const day = entertainmentDays.get(plan.date);
      const current = day
        ? applyEntertainmentDayToItinerary(plan, day)
        : plan;
      return {
        ...current,
        ...(approvedPdfById.get(plan.id)
          ? { pdf: approvedPdfById.get(plan.id) }
          : {}),
      };
    });
  const visibleItineraries = activeEvents(
    currentItineraries,
    adminState.archivedEventIds,
  );
  return <ItinerariesClient items={visibleItineraries} />;
}
