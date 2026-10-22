import { NextResponse } from "next/server";
import {
  assertKitchenDate,
  getKitchenDay,
} from "@/lib/kitchen/sync";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";

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
    const delivery = await new GoTabIntegrationStorage()
      .listEventFoodDelivery(day.events.map((event) => String(event.event.eventId)))
      .then((items) => ({ foodDelivery: items, foodDeliveryError: null }))
      .catch(() => ({ foodDelivery: [], foodDeliveryError: "Food-order delivery could not be verified. Do not resubmit an uncertain order." }));
    return NextResponse.json({
      ...day,
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
