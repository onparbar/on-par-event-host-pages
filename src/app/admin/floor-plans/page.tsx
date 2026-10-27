import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import FloorPlanDashboard from "@/app/floor-plans/FloorPlanDashboard";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  isValidEntertainmentDate,
  todayInEntertainmentTimeZone,
} from "@/lib/entertainment/time";
import { floorPlans } from "@/lib/events";
import {
  loadFloorPlanPublicationWindow,
  nearestFloorPlanDate,
} from "@/lib/floor-plans/publication";

export const metadata = {
  title: "Admin Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function AdminFloorPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;

  const today = todayInEntertainmentTimeZone();
  const requestedDate = (await searchParams).date ?? "";
  const publicationPlans = await loadFloorPlanPublicationWindow(today);
  const initialDate = isValidEntertainmentDate(requestedDate)
    ? requestedDate
    : nearestFloorPlanDate(
        publicationPlans,
        today,
        floorPlans.find((plan) => plan.date >= today)?.date ?? today,
      );

  return <FloorPlanDashboard initialDate={initialDate} />;
}
