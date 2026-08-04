import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { floorPlans, floorPlanSpecialPages } from "@/lib/events";
import FloorPlansClient from "./FloorPlansClient";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function FloorPlansPage() {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const adminState = await loadAdminState();
  return (
    <FloorPlansClient
      initialState={adminState}
      plans={floorPlans}
      specialPages={floorPlanSpecialPages}
      today={todayInEntertainmentTimeZone()}
    />
  );
}
