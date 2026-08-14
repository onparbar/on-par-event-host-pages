import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState } from "@/lib/admin-state";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { floorPlans, floorPlanSpecialPages } from "@/lib/events";
import {
  ensureConfirmedContractFloorPlanWindow,
  getFloorPlanDay,
} from "@/lib/floor-plans/service";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
import { loadFloorPlanPublicationWindow } from "@/lib/floor-plans/publication";
import FloorPlansClient, {
  type FloorPlanPublication,
} from "./FloorPlansClient";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
};

export const dynamic = "force-dynamic";

export default async function FloorPlansPage() {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const today = todayInEntertainmentTimeZone();
  const storage = getFloorPlanStorage();
  await ensureConfirmedContractFloorPlanWindow(today, storage);
  const [adminState, publicationPlans] = await Promise.all([
    loadAdminState(),
    loadFloorPlanPublicationWindow(today, storage),
  ]);
  const publications = await Promise.all(
    publicationPlans.map(async (plan): Promise<FloorPlanPublication> => ({
      plan,
      payload: await getFloorPlanDay(plan.eventDate, storage).catch(() => null),
    })),
  );
  return (
    <FloorPlansClient
      initialState={adminState}
      plans={floorPlans}
      publications={publications}
      specialPages={floorPlanSpecialPages}
      today={today}
    />
  );
}
