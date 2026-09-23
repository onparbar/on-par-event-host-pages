import { NextResponse } from "next/server";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { KITCHEN_STAFF_ROSTER } from "@/lib/kitchen/storage";
import { assertKitchenDate } from "@/lib/kitchen/sync";
import { isSameOriginOperationalRequest, operationalAccessDenied } from "@/lib/operational-access";
import { confirmVipArrival, listVipCheckins } from "@/lib/vip-checkin/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? todayInEntertainmentTimeZone();
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json({ error: "VIP check-in date must use YYYY-MM-DD." }, { status: 400 });
  }
  try {
    return NextResponse.json({
      date,
      reservations: await listVipCheckins(date),
      employees: KITCHEN_STAFF_ROSTER,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "VIP reservations could not be loaded." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) return operationalAccessDenied();
  let body: { reservationId?: unknown; date?: unknown; employeeName?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid VIP check-in request." }, { status: 400 });
  }
  if (typeof body.reservationId !== "string" ||
      typeof body.date !== "string" ||
      typeof body.employeeName !== "string") {
    return NextResponse.json({ error: "Select a reservation, date, and employee." }, { status: 400 });
  }
  try {
    const reservation = await confirmVipArrival(body.reservationId, body.date, body.employeeName);
    return NextResponse.json({ reservation });
  } catch (error) {
    const message = error instanceof Error && [
      "Select an employee from the approved roster.",
      "Invalid VIP reservation.",
      "This VIP reservation is no longer active. No food was sent.",
      "OnPar bookings is not configured.",
    ].includes(error.message) ? error.message : "VIP check-in could not be completed.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
