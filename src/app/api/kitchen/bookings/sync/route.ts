import { NextResponse } from "next/server";
import {
  assertKitchenDate,
  KitchenSyncError,
  syncVipBookingDay,
} from "@/lib/kitchen/sync";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }

  let body: { date?: unknown };
  try {
    body = (await request.json()) as { date?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid Booking Sync payload." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json({ error: "Sync date must use YYYY-MM-DD." }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncVipBookingDay(date));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof KitchenSyncError ? error.message : "Booking Sync failed." },
      { status: 502 },
    );
  }
}
