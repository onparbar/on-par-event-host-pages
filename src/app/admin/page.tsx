import { cookies } from "next/headers";
import AdminAccessGate from "./AdminAccessGate";
import AdminClient from "./AdminClient";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState, loadChecklistRecords } from "@/lib/admin-state";
import { emptyAdminState } from "@/lib/admin-types";
import { checklistEvents } from "@/lib/checklist-events";
import {
  entertainmentSchedules,
  floorPlans,
  floorPlanSpecialPages,
  itineraries,
} from "@/lib/events";
import { loadAdminOperations } from "@/lib/admin-operations-loader";
import { loadHistoricalEventPlans } from "@/lib/event-plans/sync";

export const metadata = {
  title: "Admin | On Par Event Host",
};

export const dynamic = "force-dynamic";

async function loadLocalPreviewFallback<T>(
  load: () => Promise<T>,
  fallback: T,
) {
  try {
    return await load();
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    return fallback;
  }
}

function easternToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function AdminPage() {
  const cookieStore = await cookies();

  if (!hasAdminSession(cookieStore)) {
    return <AdminAccessGate />;
  }

  const today = easternToday();
  const [initialState, records, operations, historicalEventPlans] = await Promise.all([
    loadLocalPreviewFallback(loadAdminState, emptyAdminState()),
    loadLocalPreviewFallback(loadChecklistRecords, []),
    loadAdminOperations(),
    loadHistoricalEventPlans(today),
  ]);
  const staticItinerariesById = new Map(
    itineraries.map((item) => [item.id, item]),
  );
  const archivedItineraries = historicalEventPlans
    .filter((item) => item.date < today)
    .map((item) => ({
      ...item,
      ...(staticItinerariesById.get(item.id)?.pdf
        ? { pdf: staticItinerariesById.get(item.id)?.pdf }
        : {}),
    }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const checklistEventSummaries = checklistEvents.map(
    ({ id, name, date, time, poc }) => ({ id, name, date, time, poc }),
  );
  return (
    <AdminClient
      checklistEventSummaries={checklistEventSummaries}
      archivedItineraries={archivedItineraries}
      entertainmentSchedules={entertainmentSchedules}
      floorPlans={[...floorPlans, ...floorPlanSpecialPages]}
      initialState={initialState}
      localPreview={process.env.NODE_ENV !== "production"}
      operations={operations}
      records={records}
      today={today}
    />
  );
}
