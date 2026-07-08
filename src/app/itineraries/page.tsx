import ItinerariesClient from "./ItinerariesClient";
import { loadAdminState } from "@/lib/admin-state";
import { itineraries } from "@/lib/events";

export const metadata = {
  title: "Itineraries | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function ItinerariesPage() {
  const adminState = await loadAdminState();
  const visibleItineraries = itineraries.filter((event) => !adminState.archivedEventIds.includes(event.id));
  return <ItinerariesClient items={visibleItineraries} />;
}
