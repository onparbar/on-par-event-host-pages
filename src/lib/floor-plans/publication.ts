import { addCalendarDays } from "@/lib/entertainment/time";
import { getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import type { FloorPlanDocument } from "./types";

export async function loadFloorPlanPublicationWindow(
  startDate: string,
  storage: FloorPlanStorage = getFloorPlanStorage(),
) {
  const dates = Array.from({ length: 15 }, (_, offset) =>
    addCalendarDays(startDate, offset),
  );
  const plans = await Promise.all(
    dates.map((date) => storage.get(date).catch(() => null)),
  );
  return plans.filter(
    (plan): plan is FloorPlanDocument => Boolean(plan?.events.length),
  );
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
