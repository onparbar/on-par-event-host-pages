import { NextResponse } from "next/server";
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
  getChecklistRecord,
  saveChecklist,
} from "../../../lib/checklist-storage";
import { synchronizeChecklistFoodAddOns } from "../../../lib/gotab/sync-checklist-addons";
import { StaleSaveError } from "../../../lib/stale-save";
import { reconcileChecklistSetup } from "../../../lib/operations/setup";
import { normalizeKitchenOrderNotes } from "../../../lib/kitchen/addons";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "../../../lib/operational-access";

export const dynamic = "force-dynamic";

type SaveChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
  syncFoodAddOns?: boolean;
  syncFoodAddOnKeys?: string[];
  sourceType?: string;
  expectedUpdatedAt?: string | null;
  requesterName?: string;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const eventId = new URL(request.url).searchParams.get("eventId");
    if (eventId !== null) {
      if (!/^\d+$/.test(eventId) || !Number.isSafeInteger(Number(eventId)) || Number(eventId) <= 0) return badRequest("Invalid eventId.");
      const record = await getChecklistRecord(Number(eventId));
      return NextResponse.json({ records: record ? [record] : [] });
    }
    const records = await listChecklistRecords();
    return NextResponse.json({ records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load saved checklists.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
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
  if (body.requesterName !== undefined && (typeof body.requesterName !== "string" || body.requesterName.trim().length > 120 || /[\r\n\x00-\x1f\x7f]/.test(body.requesterName))) return badRequest("Requester name must be a single line of up to 120 characters.");
  const requesterName = body.requesterName?.trim();
  try {
    for (const item of Object.values(body.checklist.food ?? {})) normalizeKitchenOrderNotes(item?.notes);
  } catch (error) { return badRequest(error instanceof Error ? error.message : "Invalid food request notes."); }
  if (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
    return badRequest("Load the saved checklist revision before saving.");
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
      checklist: reconcileChecklistSetup(event, body.checklist),
      expectedUpdatedAt: body.expectedUpdatedAt,
    });

    if (!body.syncFoodAddOns) {
      return NextResponse.json({ record });
    }

    try {
      const sourceType = body.sourceType === "REFILL" ? "REFILL" as const : undefined;
      const kitchenSync = requesterName
        ? await synchronizeChecklistFoodAddOns(kitchenEventId, body.checklist.food, body.syncFoodAddOnKeys, sourceType ?? "EVENT_HOST_ADDON", { requesterName })
        : body.syncFoodAddOnKeys
        ? sourceType
          ? await synchronizeChecklistFoodAddOns(
              kitchenEventId,
              body.checklist.food,
              body.syncFoodAddOnKeys,
              sourceType,
            )
          : await synchronizeChecklistFoodAddOns(
              kitchenEventId,
              body.checklist.food,
              body.syncFoodAddOnKeys,
            )
        : sourceType
          ? await synchronizeChecklistFoodAddOns(
              kitchenEventId,
              body.checklist.food,
              undefined,
              sourceType,
            )
          : await synchronizeChecklistFoodAddOns(
              kitchenEventId,
              body.checklist.food,
            );
      const dispatchedToKds =
        kitchenSync.exceptions === 0 &&
        kitchenSync.deliveryVerified === true;
      const deliveryPending = kitchenSync.exceptions === 0 && kitchenSync.deliveryPending === true;
      return NextResponse.json({
        record,
        kitchenSync: {
          status: dispatchedToKds ? "live" : kitchenSync.noFoodRequired ? "not-required" : deliveryPending ? "pending" : "error",
          eventId: kitchenEventId,
          requestIds: kitchenSync.requestIds ?? [],
          updatedAt: kitchenSync.saved.updatedAt,
          queued: kitchenSync.queued,
          exceptions: kitchenSync.exceptions,
          sent: kitchenSync.sent,
          accepted: kitchenSync.acceptedDeliveryCount,
          deliveries: kitchenSync.deliveries ?? [],
          error: dispatchedToKds || kitchenSync.noFoodRequired || deliveryPending
            ? undefined
            : kitchenSync.error ?? (kitchenSync.exceptions > 0
              ? "This food item is not fully mapped to a verified GoTab Event Food product."
              : kitchenSync.queued === 0
                ? "No new food quantity change was available to send to the KDS."
                : "This item is saved, but GoTab acceptance has not been verified. Check the saved order before submitting again."),
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
    return NextResponse.json({ error: message }, { status: error instanceof StaleSaveError ? 409 : 502 });
  }
}
