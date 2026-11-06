import { NextResponse } from "next/server";
import { loadVipSyncHealth } from "@/lib/vip-prep/sync-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  try {
    const health = await loadVipSyncHealth(query.get("date") ?? "", query.get("reservationId") ?? "");
    return NextResponse.json({ health }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "VIP view verification could not be completed. No operational action was performed." }, { status: 400 });
  }
}
