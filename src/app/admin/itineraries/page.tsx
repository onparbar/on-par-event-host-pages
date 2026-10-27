import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminStateSnapshot } from "@/lib/admin-state";
import { findEventPlanById, loadEventPlanWindow, loadHistoricalEventPlans } from "@/lib/event-plans/sync";
import { getEntertainmentDay } from "@/lib/entertainment/sync";
import { getFloorPlanStorage } from "@/lib/floor-plans/storage";
import { buildItineraryAsset } from "@/lib/itineraries/asset";
import AdminAccessGate from "../AdminAccessGate";
import ItineraryEditor from "./ItineraryEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Itineraries | On Par Event Host" };

export default async function AdminItinerariesPage({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const requestedValue = (await searchParams).eventId;
  const requestedId = Number(requestedValue);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [snapshot, window, history, requested] = await Promise.all([
    loadAdminStateSnapshot(), loadEventPlanWindow(), loadHistoricalEventPlans(today),
    Number.isSafeInteger(requestedId) && requestedId > 0 ? findEventPlanById(requestedId) : null,
  ]);
  const plans = [...new Map([...history, ...window.plans, ...(requested ? [requested] : [])].map((plan) => [plan.id, plan])).values()];
  const selected = requestedValue !== undefined ? plans.find((plan) => plan.id === requestedId) : window.plans[0] ?? plans.at(-1);
  const storage = getFloorPlanStorage();
  const [floorPlan, day] = selected ? await Promise.all([storage.get(selected.date).catch(() => null), getEntertainmentDay(selected.date).catch(() => null)]) : [null, null];
  const base = selected ? buildItineraryAsset({ plan: selected, candidates: plans, day, floorPlan, floorPlanPersisted: storage.persistence === "database", sourceSync: window.sync, now: new Date() }) : null;
  return <ItineraryEditor key={selected?.id ?? "none"} base={base} events={plans.map(({ id, name, date }) => ({ id, name, date })).sort((left, right) => right.date.localeCompare(left.date) || left.name.localeCompare(right.name))} initialState={snapshot.state} initialUpdatedAt={snapshot.updatedAt} />;
}
