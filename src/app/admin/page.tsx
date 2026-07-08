import { cookies } from "next/headers";
import AdminAccessGate from "./AdminAccessGate";
import AdminClient from "./AdminClient";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminState, loadChecklistRecords } from "@/lib/admin-state";

export const metadata = {
  title: "Admin | On Par Event Host",
};

export const dynamic = "force-dynamic";

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

  const [initialState, records] = await Promise.all([loadAdminState(), loadChecklistRecords()]);
  const today = easternToday();

  return <AdminClient initialState={initialState} records={records} today={today} />;
}
