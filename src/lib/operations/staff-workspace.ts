import { KITCHEN_STAFF_ROSTER } from "@/lib/kitchen/staff";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import type { OperationalEventSummary } from "./command-center";

export const STAFF_CONTEXT_STORAGE_KEY = "event-host:selected-staff:v1";
export const STAFF_WORKSPACE_NAVIGATION = [
  { href: "/checklists", label: "Checklists" },
  { href: "/floor-plans", label: "Floor Plans" },
  { href: "/entertainment-schedules", label: "Entertainment" },
  { href: "/event-host-addons", label: "Add-ons & Refills" },
  { href: "/itineraries", label: "Itineraries" },
] as const;

/** Display preference only; it is never a login, BWA assignment, or VIP check-in. */
export function validatedStaffName(value: unknown) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  return KITCHEN_STAFF_ROSTER.find((employee) => employee === name) ?? "";
}

export function persistedStaffContext(value: string) {
  return JSON.stringify({ version: 1, staffName: validatedStaffName(value) });
}

export function readPersistedStaffContext(raw: string | null) {
  if (!raw || raw.length > 250) return "";
  try {
    const value = JSON.parse(raw) as { version?: unknown; staffName?: unknown };
    return value?.version === 1 ? validatedStaffName(value.staffName) : "";
  } catch {
    return "";
  }
}

export function isStaffWorkspaceRoute(pathname: string) {
  return STAFF_WORKSPACE_NAVIGATION.some(({ href }) => pathname === href);
}

export function eventSelectionHref(date: string) {
  return isValidEntertainmentDate(date) ? `/?date=${date}` : "/";
}

export function staffEventsForDate(events: readonly OperationalEventSummary[], date: string, search: string) {
  const term = search.trim().toLocaleLowerCase("en-US");
  return events.filter(({ event }) => event.date === date && (!term || event.eventName.toLocaleLowerCase("en-US").includes(term)));
}
