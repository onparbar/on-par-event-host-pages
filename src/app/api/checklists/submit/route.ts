import { NextResponse } from "next/server";
import { checklistEventsForPlans } from "../../../../lib/checklist-events";
import { hydrateChecklistState, type EventChecklistState } from "../../../../lib/checklist-model";
import { checklistReadiness } from "../../../../lib/checklist-readiness";
import { StaleSaveError } from "../../../../lib/stale-save";
import { saveChecklist } from "../../../../lib/checklist-storage";
import { findEventPlanById } from "../../../../lib/event-plans/sync";
import { rollingEventPlanHorizon } from "../../../../lib/event-plans/horizon";
import {
  findVipPrepReservationByEventId,
  vipPrepEventPlan,
  vipPrepExternalId,
} from "../../../../lib/vip-prep/client";
import { synchronizeChecklistFoodAddOns } from "../../../../lib/gotab/sync-checklist-addons";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "../../../../lib/operational-access";

export const dynamic = "force-dynamic";

type SubmitChecklistRequest = {
  eventId?: number;
  checklist?: EventChecklistState;
  expectedUpdatedAt?: string | null;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
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
  if (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
    return badRequest("Load the saved checklist revision before submitting.");
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
  const state = hydrateChecklistState(event.date, body.checklist);
  const readiness = checklistReadiness(event, state);
  if (!readiness.canSubmit) {
    return NextResponse.json({
      error: "Complete critical tasks with an employee name and timestamp, resolve contract review items, and enter the BWA before closing this event. Only Admin can reopen a submitted checklist.",
      incompleteTasks: readiness.missing.map((task) => task.key),
      reviewTasks: readiness.review.map((task) => task.key),
    }, { status: 422 });
  }

  try {
    const record = await saveChecklist({
      action: "submit",
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date,
      poc: event.poc,
      checklist: state,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });

    try {
      const kitchenSync = await synchronizeChecklistFoodAddOns(
        kitchenEventId,
        body.checklist.food,
      );
      const accepted = kitchenSync.exceptions === 0 && kitchenSync.deliveryVerified === true;
      return NextResponse.json({
        record,
        kitchenSync: {
          status: accepted ? "live" : kitchenSync.noFoodRequired ? "not-required" : "error",
          updatedAt: kitchenSync.saved.updatedAt,
          queued: kitchenSync.queued,
          exceptions: kitchenSync.exceptions,
          sent: kitchenSync.sent,
          accepted: kitchenSync.acceptedDeliveryCount,
          deliveries: kitchenSync.deliveries ?? [],
          ...(!accepted && !kitchenSync.noFoodRequired ? { error: kitchenSync.error ?? "Final record submitted to Admin, but GoTab acceptance was not verified for every food item. Review delivery status before retrying." } : {}),
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
    return NextResponse.json({ error: message }, { status: error instanceof StaleSaveError ? 409 : 502 });
  }
}
