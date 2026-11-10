import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";
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
  const rolloutEnabled = staffLoginRequired();
  const now = new Date();
  const state = rolloutEnabled ? await loadStaffingState().catch(() => null) : null;
  const { eventId, date } = await searchParams;
  const selected = typeof eventId === "string"
    ? state?.events.find((event) => event.eventId === eventId && (!date || event.date === date))
    : state?.events[0];
  return <StaffingDashboard
    rolloutEnabled={rolloutEnabled}
    initialState={state ? { ...state, shifts: state.shifts.map(({ notes: _notes, ...shift }) => shift) } : null}
    initialFresh={state ? staffingSnapshotIsFresh(state, now) : false}
    initialEventId={selected?.eventId ?? ""}
    window={staffingWindow(now)}
  />;
}
