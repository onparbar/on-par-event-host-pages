import { addCalendarDays, isValidEntertainmentDate } from "@/lib/entertainment/time";
import { ensureDistinctFloorPlanEventColors } from "./configuration/colors";
import { getFloorPlanStorage, type FloorPlanStorage } from "./storage";
import type { FloorPlanDocument } from "./types";

export function floorPlanPlanningMonthRange(month: string) {
  const startDate = `${month}-01`;
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidEntertainmentDate(startDate)) throw new Error("Planning month must use YYYY-MM.");
  const end = new Date(`${startDate}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}

export function floorPlanPublicationDates(startDate: string, requestedDate?: string | null, planningMonth?: string | null) {
  const month = planningMonth ? floorPlanPlanningMonthRange(planningMonth) : null;
  const monthDates: string[] = [];
  if (month) for (let date = month.startDate; date <= month.endDate; date = addCalendarDays(date, 1)) monthDates.push(date);
  return [...new Set([
    ...Array.from({ length: 15 }, (_, offset) => addCalendarDays(startDate, offset)),
    ...(requestedDate && isValidEntertainmentDate(requestedDate) ? [requestedDate] : []),
    ...monthDates,
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
