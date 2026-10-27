import { NextResponse } from "next/server";
import { isSameOriginOperationalRequest, operationalAccessDenied } from "@/lib/operational-access";
import { DECEMBER_PLANNING_MONTH, prepareDecemberFloorPlanDrafts } from "@/lib/floor-plans/planning-month";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) return operationalAccessDenied();
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Choose December 2026 to prepare floor-plan drafts." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { month?: unknown }).month !== DECEMBER_PLANNING_MONTH) {
    return NextResponse.json({ error: "Only December 2026 floor-plan preparation is available here." }, { status: 400 });
  }
  try {
    return NextResponse.json(await prepareDecemberFloorPlanDrafts(), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "December planning could not finish. Existing floor plans and entertainment bookings were not replaced. Check the source connection and try again." },
      { status: 502, headers: { "cache-control": "private, no-store" } });
  }
}
