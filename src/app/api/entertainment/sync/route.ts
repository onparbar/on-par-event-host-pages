import { NextResponse } from "next/server";
import { syncEventPlanWindow } from "@/lib/event-plans/sync";
import {
  assertEntertainmentDate,
  EntertainmentSyncError,
  syncEntertainmentDay,
} from "@/lib/entertainment/sync";
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
    return NextResponse.json(
      { error: "Invalid entertainment sync payload." },
      { status: 400 },
    );
  }
  const date = typeof body.date === "string" ? body.date : "";
  try {
    assertEntertainmentDate(date);
  } catch {
    return NextResponse.json(
      { error: "Sync date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }
  try {
    await syncEventPlanWindow(
      { startDate: date, endDate: date },
      { legacyPlans: [] },
    );
  } catch {
    return NextResponse.json(
      { error: "Event details could not refresh. Entertainment was not rescheduled; try syncing again." },
      { status: 502 },
    );
  }
  try {
    return NextResponse.json(await syncEntertainmentDay(date));
  } catch (error) {
    const message =
      error instanceof EntertainmentSyncError
        ? error.message
        : "Entertainment synchronization failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
