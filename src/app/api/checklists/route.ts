import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "../../../lib/admin-auth";
import { checklistEventsForPlans } from "../../../lib/checklist-events";
import type { EventChecklistState } from "../../../lib/checklist-model";
import { findEventPlanById } from "../../../lib/event-plans/sync";
import { rollingEventPlanHorizon } from "../../../lib/event-plans/horizon";
import {
  findVipPrepReservationByEventId,
  vipPrepEventPlan,
  vipPrepExternalId,
} from "../../../lib/vip-prep/client";
import {
  listChecklistRecords,
  saveChecklist,
} from "../../../lib/checklist-storage";
import { synchronizeChecklistFoodAddOns } from "../../../lib/gotab/sync-checklist-addons";

export const dynamic = "force-dynamic";

type SaveChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
  syncFoodAddOns?: boolean;
  syncFoodAddOnKeys?: string[];
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

export async function GET() {
  if (!(await authorized())) {
    return unauthorized();
  }

  try {
    const records = await listChecklistRecords();
    return NextResponse.json({ records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load saved checklists.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!(await authorized())) {
    return unauthorized();
  }

  let body: SaveChecklistRequest;

  try {
    body = (await request.json()) as SaveChecklistRequest;
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
      action: "save",
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date,
      poc: event.poc,
      checklist: body.checklist,
    });

    if (!body.syncFoodAddOns) {
      return NextResponse.json({ record });
    }

    try {
      const kitchenSync = body.syncFoodAddOnKeys
        ? await synchronizeChecklistFoodAddOns(
            kitchenEventId,
            body.checklist.food,
            body.syncFoodAddOnKeys,
          )
        : await synchronizeChecklistFoodAddOns(
            kitchenEventId,
            body.checklist.food,
          );
      const dispatchedToKds =
        kitchenSync.queued > 0 &&
        kitchenSync.exceptions === 0 &&
        kitchenSync.sent === kitchenSync.queued;
      return NextResponse.json({
        record,
        kitchenSync: {
          status: dispatchedToKds ? "live" : "error",
          updatedAt: kitchenSync.saved.updatedAt,
          queued: kitchenSync.queued,
          exceptions: kitchenSync.exceptions,
          sent: kitchenSync.sent,
          error: dispatchedToKds
            ? undefined
            : kitchenSync.exceptions > 0
              ? "This food item is not fully mapped to a verified GoTab Event Food product."
              : kitchenSync.queued === 0
                ? "No new food quantity change was available to send to the KDS."
                : "GoTab did not confirm that the complete order reached the KDS.",
        },
      });
    } catch {
      return NextResponse.json({
        record,
        kitchenSync: {
          status: "error",
          error:
            "Draft saved, but Kitchen live sync is unavailable until this event is synchronized.",
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save checklist.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
