import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "../../../lib/admin-auth";
import { checklistEventsForPlans } from "../../../lib/checklist-events";
import type { EventChecklistState } from "../../../lib/checklist-model";
import { findEventPlanById } from "../../../lib/event-plans/sync";
import {
  listChecklistRecords,
  saveChecklist,
} from "../../../lib/checklist-storage";
import { updateKitchenEventFoodAddOns } from "../../../lib/kitchen/sync";

export const dynamic = "force-dynamic";

type SaveChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
  syncFoodAddOns?: boolean;
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

  const plan = await findEventPlanById(body.eventId);
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
      const kitchenAddOns = await updateKitchenEventFoodAddOns(
        String(event.id),
        body.checklist.food,
      );
      return NextResponse.json({
        record,
        kitchenSync: {
          status: "live",
          updatedAt: kitchenAddOns.updatedAt,
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
