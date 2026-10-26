import { getKitchenStorage, type KitchenStorage } from "@/lib/kitchen/storage";
import { vipPrepExternalId } from "./identity";

/** Read durable successful-feed membership evidence; never initialize or sync Kitchen. */
export async function knownInactiveVipBookings(date: string, storage?: Pick<KitchenStorage, "getDay">) {
  try {
    const day = await (storage ?? getKitchenStorage()).getDay(date);
    const observations = new Map(day.events.flatMap((event): Array<[string, string]> => {
      const booking = event.event.vipBooking;
      return booking?.activeInSource === false && booking.operatingDate === date &&
        String(event.event.eventId) === vipPrepExternalId(booking) && Number.isFinite(Date.parse(booking.lastRefreshedAt ?? ""))
        ? [[vipPrepExternalId(booking), booking.lastRefreshedAt!]] : [];
    }));
    return { ids: new Set(observations.keys()), observations, warnings: [] as string[] };
  } catch {
    return { ids: new Set<string>(), observations: new Map<string, string>(), warnings: ["Known inactive booking evidence could not be read. Saved VIP fallback is unverified until On Par Bookings refreshes."] };
  }
}

export function inactiveVipIsNewer(observations: ReadonlyMap<string, string>, id: string, activeObservation: string | null | undefined) {
  const inactive = observations.get(id);
  if (!inactive) return false;
  const activeTime = Date.parse(activeObservation ?? "");
  return !Number.isFinite(activeTime) || Date.parse(inactive) >= activeTime;
}

export const KNOWN_INACTIVE_VIP_WARNING = "On Par Bookings is unavailable. Known inactive VIP bookings are not projected; saved source and staff history are retained.";
