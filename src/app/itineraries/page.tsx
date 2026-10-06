import ItinerariesClient from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { activeEvents } from "@/lib/event-lifecycle";
import { itineraries } from "@/lib/events";
import { getEntertainmentDay } from "@/lib/entertainment/sync";
import {
  findEventPlanById,
  loadEventPlanWindow,
} from "@/lib/event-plans/sync";
import { applyEntertainmentDayToItinerary } from "@/lib/itineraries/entertainment";
import type { ItineraryAsset } from "@/lib/event-plans/types";

export const metadata = {
  title: "Itineraries | On Par Event Host",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function ItinerariesPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const requestedEventId = Number((await searchParams).eventId);
  const requestedEvent = Number.isSafeInteger(requestedEventId)
    ? await findEventPlanById(requestedEventId)
    : null;
  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadEventPlanWindow(),
  ]);
  const approvedPdfById = new Map(
    itineraries
      .filter((item) => item.pdf)
      .map((item) => [item.id, item.pdf]),
  );
  const itineraryDates = [
    ...eventPlanWindow.plans,
    ...(requestedEvent ? [requestedEvent] : []),
  ];
  const entertainmentDays = new Map(
    (await Promise.all(
      [...new Set(itineraryDates.map((plan) => plan.date))].map(
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
  const currentItineraries: ItineraryAsset[] = [
    ...eventPlanWindow.plans,
    ...(requestedEvent &&
    !eventPlanWindow.plans.some((plan) => plan.id === requestedEvent.id)
      ? [requestedEvent]
      : []),
  ].map((plan) => {
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
  const activeItineraries = activeEvents(
    currentItineraries,
    adminState.archivedEventIds,
  );
  const requestedEventForDisplay = requestedEvent
    ? currentItineraries.find((event) => event.id === requestedEvent.id) ??
      requestedEvent
    : null;
  const requestedEventIsArchived = requestedEvent
    ? adminState.archivedEventIds.includes(requestedEvent.id)
    : false;
  const visibleItineraries =
    requestedEventForDisplay &&
    !requestedEventIsArchived &&
    !activeItineraries.some((event) => event.id === requestedEventForDisplay.id)
      ? [
          requestedEventForDisplay,
          ...activeItineraries,
        ]
      : activeItineraries;
  return (
    <ItinerariesClient
      initialEventId={requestedEvent?.id}
      items={visibleItineraries}
    />
  );
}
