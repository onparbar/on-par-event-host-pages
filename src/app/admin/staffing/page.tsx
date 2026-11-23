import { cookies } from "next/headers";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import { isValidEntertainmentDate, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { staffingWindow } from "@/lib/staffing/domain";
import { staffingSnapshotIsFresh } from "@/lib/staffing/service";
import { loadStaffingState } from "@/lib/staffing/storage";
import AdminAccessGate from "../AdminAccessGate";
import StaffingDashboard from "./StaffingDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staffing Review | On Par Event Host" };

export default async function AdminStaffingPage({ searchParams }: {
  searchParams: Promise<{ eventId?: string; date?: string }>;
}) {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const rolloutEnabled = requiresStrongAdminSession();
  const now = new Date();
  const state = rolloutEnabled ? await loadStaffingState().catch(() => null) : null;
  const { eventId, date } = await searchParams;
  let requestedDate = typeof date === "string" && isValidEntertainmentDate(date) ? date : undefined;
  const today = todayInEntertainmentTimeZone(now);
  if (requestedDate && requestedDate >= today) {
    try { staffingWindow(now, requestedDate); }
    catch { requestedDate = undefined; }
  }
  const targetDate = requestedDate && requestedDate >= today ? requestedDate : today;
  const savedWindow = state?.reconciliation?.window;
  const requestedEventId = typeof eventId === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(eventId) ? eventId : "";
  const selected = typeof eventId === "string"
    ? state?.events.find((event) => event.eventId === requestedEventId && (!requestedDate || event.date === requestedDate))
    : state?.events[0];
  return <StaffingDashboard
    rolloutEnabled={rolloutEnabled}
    initialState={state ? { ...state, shifts: state.shifts.map(({ notes: _notes, ...shift }) => shift) } : null}
    initialFresh={state ? staffingSnapshotIsFresh(state, now) && Boolean(savedWindow && targetDate >= savedWindow.startDate && targetDate <= savedWindow.endDate) : false}
    initialEventId={selected?.eventId ?? requestedEventId}
    requestedDate={requestedDate}
    window={staffingWindow(now, targetDate)}
  />;
}
