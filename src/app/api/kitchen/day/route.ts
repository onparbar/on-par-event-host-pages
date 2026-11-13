import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { canPrefillKitchenFoodRunner } from "@/app/kitchen/staff-prefill";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import {
  assertKitchenDate,
  getKitchenDay,
} from "@/lib/kitchen/sync";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { loadStaffingPrefills } from "@/lib/staffing/service";
import { vipFoodReleaseState } from "@/lib/vip-checkin/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json(
      { error: "Query parameter date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const day = await getKitchenDay(date, { staffPrep: true });
    const candidates = day.events.filter(canPrefillKitchenFoodRunner);
    const staffingDefaults = candidates.length ? loadStaffingForKitchenDay(candidates) : Promise.resolve({});
    const integrationStorage = new GoTabIntegrationStorage();
    const delivery = await integrationStorage
      .listEventFoodDelivery(day.events.map((event) => String(event.event.eventId)))
      .then((items) => ({ foodDelivery: items, foodDeliveryError: null }))
      .catch(() => ({ foodDelivery: [], foodDeliveryError: "Food-order delivery could not be verified. Do not resubmit an uncertain order." }));
    const vipEvents = day.events.filter((event) => event.event.vipBooking || String(event.event.eventId).startsWith("vip-"));
    const arrival = vipEvents.length ? await integrationStorage.listVipCheckinsForDate(date)
      .then((rows) => ({ rows, error: false }))
      .catch(() => ({ rows: [], error: true })) : { rows: [], error: false };
    const events = await Promise.all(day.events.map(async (checklist) => {
      if (!vipEvents.includes(checklist)) return checklist;
      const eventId = String(checklist.event.eventId);
      const checkin = arrival.rows.find((row) => row.event_id === eventId);
      if (arrival.error) return { ...checklist, vipArrival: { checkedInAt: null, checkedInBy: null, foodStatus: "STATUS_UNAVAILABLE", scheduledReleaseAt: null, itemIssues: ["Event Host check-in status could not be verified. No food release is implied."] } };
      if (!checkin) return { ...checklist, vipArrival: { checkedInAt: null, checkedInBy: null, foodStatus: "NOT_CHECKED_IN", scheduledReleaseAt: null, itemIssues: [] } };
      const release = await vipFoodReleaseState(eventId, integrationStorage, checklist.event.vipBooking).catch(() => ({ foodStatus: "FOOD_UNCERTAIN", scheduledReleaseAt: null, itemIssues: ["Saved food delivery could not be verified. Do not resubmit blindly."] }));
      return { ...checklist, vipArrival: { checkedInAt: checkin.checked_in_at, checkedInBy: checkin.employee_name, foodStatus: release.foodStatus, scheduledReleaseAt: release.scheduledReleaseAt, itemIssues: release.itemIssues } };
    }));
    const prefills: Record<string, string[]> = await staffingDefaults;
    const candidatesSet = new Set(candidates);
    return NextResponse.json({
      ...day,
      events: events.map((checklist) => {
        const staffingFoodRunners = candidatesSet.has(checklist) ? prefills[String(checklist.event.eventId)] : undefined;
        return staffingFoodRunners?.length ? { ...checklist, staffingFoodRunners } : checklist;
      }),
      ...delivery,
      serverTime: new Date().toISOString(),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Unable to load the kitchen day." },
      { status: 502 },
    );
  }
}

async function loadStaffingForKitchenDay(events: Awaited<ReturnType<typeof getKitchenDay>>["events"]): Promise<Record<string, string[]>> {
  try {
    const allowAdminPreview = requiresStrongAdminSession() && hasAdminSession(await cookies());
    if (!allowAdminPreview) return {};
    return await loadStaffingPrefills(events.map(({ event }) => ({
      eventId: String(event.eventId), date: event.localDate, startAt: event.startTime, endAt: event.endTime,
    })), { allowAdminPreview: true });
  } catch {
    // Staffing is optional; an outage can't hide or rewrite a kitchen sheet.
    return {};
  }
}
