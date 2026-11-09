import ItinerariesClient, { type ItineraryChoice } from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { activeEvents } from "@/lib/event-lifecycle";
import { itineraries } from "@/lib/events";
import { readSavedEntertainmentDay } from "@/lib/entertainment/saved-day";
import { addCalendarDays, isValidEntertainmentDate, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { addOneCalendarMonthClamped } from "@/lib/event-plans/horizon";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import {
  findEventPlanById,
} from "@/lib/event-plans/sync";
import { buildItineraryAsset } from "@/lib/itineraries/asset";
import { applyItineraryEdit } from "@/lib/itineraries/edits";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
import type { EventPlan, ItineraryAsset } from "@/lib/event-plans/types";

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
  searchParams: Promise<{ eventId?: string | string[]; date?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedEventId = typeof query.eventId === "string" && query.eventId ? query.eventId : null;
  const legacyId = Number(requestedEventId);
  const requestedDate = typeof query.date === "string" && isValidEntertainmentDate(query.date) ? query.date : null;
  const invalidSelection = (query.date !== undefined && !requestedDate) || (query.eventId !== undefined && !requestedEventId);
  const storedRequestedEvent = !invalidSelection && !requestedDate && Number.isSafeInteger(legacyId) && legacyId > 0
    ? await findEventPlanById(legacyId)
    : null;
  const now = new Date();
  const today = todayInEntertainmentTimeZone(now);
  const date = requestedDate ?? storedRequestedEvent?.date ?? today;
  // Opening an event already in the browse window should not shift that window.
  const browseDate = date >= addCalendarDays(today, -1) && date <= addOneCalendarMonthClamped(today) ? today : date;
  const [adminState, eventPlanWindow] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(browseDate, { includeUpcomingVip: true }),
  ]);
  const matchesRequest = (plan: EventPlan) => Boolean(!invalidSelection && requestedEventId &&
    (plan.source_event_id === requestedEventId || String(plan.id) === requestedEventId) &&
    (!requestedDate || plan.date === requestedDate));
  const requestedEvent = eventPlanWindow.plans.find(matchesRequest) ?? storedRequestedEvent ??
    (!invalidSelection && requestedDate && Number.isSafeInteger(legacyId) && legacyId > 0 ? await findEventPlanById(legacyId) : null);
  const matchedEvent = requestedEvent && matchesRequest(requestedEvent) ? requestedEvent : null;
  const sourceItineraries = [
    ...eventPlanWindow.plans,
    ...(matchedEvent &&
    !eventPlanWindow.plans.some((plan) => plan.id === matchedEvent.id)
      ? [matchedEvent]
      : []),
  ];
  const editFor = (plan: EventPlan) => adminState.itineraryEditsByEvent?.[String(plan.id)];
  const displayPlans = sourceItineraries.map((plan) => applyItineraryEdit(plan, editFor(plan)));
  const visiblePlans = activeEvents(displayPlans, adminState.archivedEventIds, now);
  const explicitChoice = matchedEvent && !adminState.archivedEventIds.includes(matchedEvent.id)
    ? displayPlans.find(matchesRequest)
    : undefined;
  if (explicitChoice && !visiblePlans.some((plan) => plan.id === explicitChoice.id)) visiblePlans.unshift(explicitChoice);
  const choice = invalidSelection ? undefined : requestedEventId ? explicitChoice
    : requestedDate ? visiblePlans.find((plan) => plan.date === requestedDate)
    : visiblePlans[0];
  const plan = choice && sourceItineraries.find((item) => item.id === choice.id && item.date === choice.date);
  let selectedItinerary: ItineraryAsset | null = null;
  if (plan) {
    const floorPlanStorage = getFloorPlanStorage();
    const [floorPlan, day] = await Promise.all([
      floorPlanStorage.get(plan.date).catch(() => null),
      readSavedEntertainmentDay(plan.date).catch(() => null),
    ]);
    const savedPdf = itineraries.find((item) => item.id === plan.id && item.pdf);
    selectedItinerary = buildItineraryAsset({ plan, candidates: sourceItineraries, day, floorPlan, floorPlanPersisted: floorPlanStorage.persistence === "database", sourceSync: eventPlanWindow.sync, savedPdf, edit: editFor(plan), now });
  }
  const items: ItineraryChoice[] = visiblePlans.map(({ id, source_event_id, name, date, time, guest_count, rooms }) => ({ id, source_event_id, name, date, time, guest_count, rooms }));
  return (
    <ItinerariesClient
      items={items}
      selectedItinerary={selectedItinerary}
      sourceWarning={eventPlanWindow.sourceWarning}
    />
  );
}
