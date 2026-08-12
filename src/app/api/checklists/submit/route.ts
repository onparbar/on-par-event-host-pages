import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "../../../../lib/admin-auth";
import { checklistEventsForPlans } from "../../../../lib/checklist-events";
import type { EventChecklistState } from "../../../../lib/checklist-model";
import { saveChecklist } from "../../../../lib/checklist-storage";
import { findEventPlanById } from "../../../../lib/event-plans/sync";
import { rollingEventPlanHorizon } from "../../../../lib/event-plans/horizon";
import {
  findVipPrepReservationByEventId,
  vipPrepEventPlan,
  vipPrepExternalId,
} from "../../../../lib/vip-prep/client";
import { synchronizeChecklistFoodAddOns } from "../../../../lib/gotab/sync-checklist-addons";

export const dynamic = "force-dynamic";

type SubmitChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function authorized() {
  return hasAdminSession(await cookies());
}

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  if (!(await authorized())) {
    return unauthorized();
  }

  let body: SubmitChecklistRequest;

  try {
    body = (await request.json()) as SubmitChecklistRequest;
  } catch {
    return badRequest("Invalid checklist payload.");
  }

  if (typeof body.eventId !== "number" || !body.checklist) {
    return badRequest("Missing eventId or checklist.");
  }

  let plan = await findEventPlanById(body.eventId);
  let kitchenEventId = String(body.eventId);
  if (!plan) {
    const horizon = rollingEventPlanHorizon();
    const reservation = await findVipPrepReservationByEventId(
      body.eventId,
      horizon.startDate,
      horizon.endDate,
    );
    if (reservation) {
      plan = vipPrepEventPlan(reservation);
      kitchenEventId = vipPrepExternalId(reservation);
    }
  }
  if (!plan) {
    return badRequest("Unknown event.");
  }
  const [event] = checklistEventsForPlans([plan]);

  try {
    const record = await saveChecklist({
      action: "submit",
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date,
      poc: event.poc,
      checklist: body.checklist,
    });

    try {
      const kitchenSync = await synchronizeChecklistFoodAddOns(
        kitchenEventId,
        body.checklist.food,
      );
      return NextResponse.json({
        record,
        kitchenSync: {
          status: "live",
          updatedAt: kitchenSync.saved.updatedAt,
          queued: kitchenSync.queued,
          exceptions: kitchenSync.exceptions,
          sent: kitchenSync.sent,
        },
      });
    } catch {
      return NextResponse.json({
        record,
        kitchenSync: {
          status: "error",
          error:
            "Final record submitted to Admin, but Kitchen live sync was unavailable.",
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit checklist.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
