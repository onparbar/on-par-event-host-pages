import { operationalKitchenEventId } from "@/lib/vip-prep/identity";
import type { EntertainmentEventSnapshot } from "./types";

/** Full source IDs are authoritative; numeric saved-checklist IDs are legacy aliases. */
export function findEntertainmentEventByIdentity(events: readonly EntertainmentEventSnapshot[], requestedId: string | null) {
  if (!requestedId) return null;
  const numericCompatibility = /^\d+$/.test(requestedId);
  const matches = events.filter((event) => [event.tripleseatEventId, event.localEventId, event.eventId]
    .some((id) => id && (id === requestedId || numericCompatibility && operationalKitchenEventId(id) === requestedId)));
  return matches.length === 1 ? matches[0] : null;
}
