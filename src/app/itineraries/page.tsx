import ItinerariesClient from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { activeEvents } from "@/lib/event-lifecycle";
import { itineraries } from "@/lib/events";
import { readSavedEntertainmentDay } from "@/lib/entertainment/saved-day";
import { isValidEntertainmentDate, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import {
  findEventPlanById,
} from "@/lib/event-plans/sync";
import { buildItineraryAsset } from "@/lib/itineraries/asset";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
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
  searchParams: Promise<{ eventId?: string; date?: string }>;
}) {
  const query = await searchParams;
  const requestedEventId = Number(query.eventId);
  const storedRequestedEvent = Number.isSafeInteger(requestedEventId)
    ? await findEventPlanById(requestedEventId)
    : null;
  const date = query.date && isValidEntertainmentDate(query.date) ? query.date : storedRequestedEvent?.date ?? todayInEntertainmentTimeZone();
  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(date),
  ]);
  const requestedEvent = eventPlanWindow.plans.find((plan) => plan.id === requestedEventId) ?? storedRequestedEvent;
  const savedPdfById = new Map(
    itineraries
      .filter((item) => item.pdf)
      .map((item) => [item.id, item]),
  );
  const itineraryDates = [
    ...eventPlanWindow.plans,
    ...(requestedEvent ? [requestedEvent] : []),
  ];
  const now = new Date();
  const floorPlanStorage = getFloorPlanStorage();
  const operationalDays = await Promise.all(
    [...new Set(itineraryDates.map((plan) => plan.date))].map(async (date) => {
      const [floorPlan, day] = await Promise.all([
        floorPlanStorage.get(date).catch(() => null),
        readSavedEntertainmentDay(date).catch(() => null),
      ]);
      return { date, floorPlan, day };
    }),
  );
  const savedFloorPlans = new Map(operationalDays.map(({ date, floorPlan }) => [date, floorPlan]));
  const entertainmentDays = new Map(operationalDays.map(({ date, day }) => [date, day]));
  const sourceItineraries = [
    ...eventPlanWindow.plans,
    ...(requestedEvent &&
    !eventPlanWindow.plans.some((plan) => plan.id === requestedEvent.id)
      ? [requestedEvent]
      : []),
  ];
  const currentItineraries: ItineraryAsset[] = sourceItineraries.map((plan) => {
      const day = entertainmentDays.get(plan.date);
      const floorPlan = savedFloorPlans.get(plan.date) ?? null;
      const savedPdf = savedPdfById.get(plan.id);
      return buildItineraryAsset({ plan, candidates: sourceItineraries, day: day ?? null, floorPlan, floorPlanPersisted: floorPlanStorage.persistence === "database", sourceSync: eventPlanWindow.sync, savedPdf, edit: adminState.itineraryEditsByEvent?.[String(plan.id)], now });
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
