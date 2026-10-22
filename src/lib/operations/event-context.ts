import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import type { EventPlan } from "@/lib/event-plans/types";

/** Navigation preference only. Operational edits are never stored here. */
export type SelectedOperationalEvent = {
  eventId: string;
  eventName: string;
  date: string;
  area: string;
  guestCount?: number;
  time?: string;
  foodRunner?: string;
  poc?: string;
};

export const EVENT_CONTEXT_STORAGE_KEY = "event-host:selected-event:v1";

function safeText(value: unknown, limit = 200) {
  return typeof value === "string" && value.trim().length <= limit
    ? value.trim()
    : "";
}

export function validatedOperationalEvent(value: unknown): SelectedOperationalEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const eventId = safeText(item.eventId, 120);
  const eventName = safeText(item.eventName);
  const date = safeText(item.date, 10);
  if (!/^[A-Za-z0-9:_-]+$/.test(eventId) || !eventName || !isValidEntertainmentDate(date)) return null;
  return {
    eventId,
    eventName,
    date,
    area: safeText(item.area),
    ...(typeof item.guestCount === "number" && Number.isFinite(item.guestCount) && item.guestCount >= 0
      ? { guestCount: item.guestCount }
      : {}),
    ...(safeText(item.time, 100) ? { time: safeText(item.time, 100) } : {}),
    ...(safeText(item.foodRunner) ? { foodRunner: safeText(item.foodRunner) } : {}),
    ...(safeText(item.poc) ? { poc: safeText(item.poc) } : {}),
  };
}

export function readPersistedEventContext(raw: string | null): SelectedOperationalEvent | null {
  if (!raw || raw.length > 2_000) return null;
  try {
    const value = JSON.parse(raw) as { version?: unknown; event?: unknown };
    return value?.version === 1 ? validatedOperationalEvent(value.event) : null;
  } catch {
    return null;
  }
}

export function persistedEventContext(event: SelectedOperationalEvent) {
  // Staff assignments are live operational information, not a browser preference.
  const { foodRunner: _foodRunner, poc: _poc, ...preference } = event;
  return JSON.stringify({ version: 1, event: preference });
}

export function eventMatchesNavigation(
  event: SelectedOperationalEvent,
  eventId: string | null,
  date: string | null,
) {
  return (!eventId || event.eventId === eventId) && (!date || event.date === date);
}

export function operationalEventHref(path: string, event: SelectedOperationalEvent | null) {
  return operationalEventRequestHref(path, event?.eventId ?? null, event?.date ?? null);
}

/** Keep explicit identity during navigation even while its metadata is unresolved. */
export function operationalEventRequestHref(path: string, eventId: string | null, date: string | null) {
  if ((!eventId && !date) || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/admin")) return path;
  const url = new URL(path, "https://event-host.invalid");
  if (date) url.searchParams.set("date", date);
  if (eventId) url.searchParams.set("eventId", eventId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function operationalEventFromPlan(plan: Pick<EventPlan, "id" | "name" | "date" | "rooms" | "guest_count" | "time">): SelectedOperationalEvent {
  return {
    eventId: String(plan.id),
    eventName: plan.name,
    date: plan.date,
    area: plan.rooms.join(" · "),
    guestCount: plan.guest_count,
    time: plan.time,
  };
}
