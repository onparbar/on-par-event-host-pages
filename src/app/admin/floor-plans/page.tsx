import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import FloorPlanDashboard from "@/app/floor-plans/FloorPlanDashboard";
import { hasAdminSession } from "@/lib/admin-auth";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { floorPlans } from "@/lib/events";

export const metadata = {
  title: "Admin Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function AdminFloorPlansPage() {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;

  const today = todayInEntertainmentTimeZone();
  const initialDate =
    floorPlans.find((plan) => plan.date >= today)?.date ?? today;

  return <FloorPlanDashboard initialDate={initialDate} />;
}
