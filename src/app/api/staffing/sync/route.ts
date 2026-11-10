import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";
import { refreshStaffing, staffingSnapshotIsFresh } from "@/lib/staffing/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  if (!staffLoginRequired() || process.env.EVENT_HOST_STAFFING_SYNC_ENABLED !== "true") return new Response(null, { status: 204, headers });
  try {
    const state = await refreshStaffing();
    return NextResponse.json({ ok: staffingSnapshotIsFresh(state), lastSuccessfulSyncAt: state.reconciliation?.lastSuccessfulSyncAt ?? null },
      { status: state.failure ? 503 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Staffing refresh could not complete." }, { status: 503, headers });
  }
}
