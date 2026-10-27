import { NextResponse } from "next/server";
import {
  assertKitchenDate,
  getKitchenDay,
} from "@/lib/kitchen/sync";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
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
    const day = await getKitchenDay(date);
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
    return NextResponse.json({
      ...day,
      events,
      ...delivery,
      serverTime: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load the kitchen day." },
      { status: 502 },
    );
  }
}
