import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { getChecklistRecord, saveChecklist } from "@/lib/checklist-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

type RouteContext = { params: Promise<{ eventId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  if (!hasAdminSession(await cookies())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401, headers: PRIVATE_HEADERS });
  }

  const { eventId: rawEventId } = await context.params;
  if (!/^[1-9]\d{0,15}$/.test(rawEventId)) {
    return NextResponse.json({ error: "Event ID is invalid." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const eventId = Number(rawEventId);
  if (!Number.isSafeInteger(eventId) || eventId === 99990001) {
    return NextResponse.json({ error: "Event ID is invalid." }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const existing = await getChecklistRecord(eventId);
    if (!existing) {
      return NextResponse.json({ error: "Checklist was not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (existing.status !== "submitted") {
      return NextResponse.json({ error: "Checklist is already a draft." }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const record = await saveChecklist({
      action: "save",
      eventId: existing.eventId,
      eventName: existing.eventName,
      eventDate: existing.eventDate,
      poc: existing.poc,
      checklist: {
        bwa: existing.bwa,
        extrasAdded: existing.extrasAdded,
        remainingDrinkCardBalance: existing.remainingDrinkCardBalance,
        tasks: existing.tasks,
        entertainment: existing.entertainment,
        food: existing.food,
      },
    });
    return NextResponse.json({ record }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to un-submit checklist." }, { status: 502, headers: PRIVATE_HEADERS });
  }
}
