import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshUpcomingTripleseatEvents } from "@/lib/event-plans/pre-event-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 240;

const headers = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    const result = await refreshUpcomingTripleseatEvents();
    return NextResponse.json(result, { status: result.failedDates.length ? 502 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Scheduled Tripleseat refresh could not complete." }, { status: 502, headers });
  }
}
