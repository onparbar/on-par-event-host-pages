import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import { ensureDistinctFloorPlanEventColors } from "./configuration/colors";
import { getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import type { FloorPlanDocument } from "./types";

export function floorPlanPublicationDates(startDate: string, requestedDate?: string | null) {
  return [...new Set([
    ...Array.from({ length: 15 }, (_, offset) => addCalendarDays(startDate, offset)),
    ...(requestedDate && isValidEntertainmentDate(requestedDate) ? [requestedDate] : []),
  ])].sort();
}

export async function loadFloorPlanPublicationWindow(
  startDate: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
  requestedDate?: string | null,
) {
  const dates = floorPlanPublicationDates(startDate, requestedDate);
  const plans = await Promise.all(
    dates.map((date) => storage.get(date).catch(() => null)),
  );
  return plans
    .filter(
      (plan): plan is FloorPlanDocument => Boolean(plan?.events.length),
    )
    .map((plan) => ({
      ...plan,
      events: ensureDistinctFloorPlanEventColors(plan.events),
    }));
}

export function nearestFloorPlanDate(
  plans: readonly FloorPlanDocument[],
  startDate: string,
  fallbackDate = startDate,
) {
  return [...plans]
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate))
    .find((plan) => plan.eventDate >= startDate)?.eventDate ?? fallbackDate;
}
