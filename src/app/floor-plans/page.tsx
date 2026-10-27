import { loadAdminState } from "@/lib/admin-state";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { floorPlans, floorPlanSpecialPages } from "@/lib/events";
import {
  ensureConfirmedContractFloorPlanWindow,
  loadLiveFloorPlanPublicationWindow,
} from "@/lib/floor-plans/service";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
import FloorPlansClient from "./FloorPlansClient";

export const metadata = {
  title: "Floor Plans | On Par Event Host",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function FloorPlansPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const today = todayInEntertainmentTimeZone();
  const planningMonth = "2026-12";
  const params = await searchParams;
  const requestedDate = typeof params.date === "string" ? params.date : null;
  const storage = getFloorPlanStorage();
  if (!isPreviewReviewOnly()) await ensureConfirmedContractFloorPlanWindow(today, storage);
  const [adminState, publications] = await Promise.all([
    loadAdminState(),
    loadLiveFloorPlanPublicationWindow(today, storage, requestedDate, undefined, planningMonth),
  ]);
  return (
    <FloorPlansClient
      initialState={adminState}
      plans={floorPlans}
      planningMonth={planningMonth}
      publications={publications}
      specialPages={floorPlanSpecialPages}
      today={today}
    />
  );
}
