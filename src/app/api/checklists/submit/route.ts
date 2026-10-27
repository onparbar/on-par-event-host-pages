import { NextResponse } from "next/server";
import { checklistEventsForPlans } from "../../../../lib/checklist-events";
import { hydrateChecklistState, type EventChecklistState } from "../../../../lib/checklist-model";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY, checklistReadiness } from "../../../../lib/checklist-readiness";
import { StaleSaveError } from "../../../../lib/stale-save";
import { reconcileChecklistSetup } from "../../../../lib/operations/setup";
import { normalizeKitchenOrderNotes } from "../../../../lib/kitchen/addons";
import { saveChecklist } from "../../../../lib/checklist-storage";
import { ChecklistSourceError, resolveChecklistSource } from "@/lib/operations/checklist-source";
import { synchronizeChecklistFoodAddOns } from "../../../../lib/gotab/sync-checklist-addons";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "../../../../lib/operational-access";

export const dynamic = "force-dynamic";

type SubmitChecklistRequest = {
  eventId?: number;
  sourceEventId?: string;
  eventDate?: string;
  checklist?: EventChecklistState;
  expectedUpdatedAt?: string | null;
  requesterName?: string;
  warningConfirmation?: { sourceFingerprint: string };
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
  if (body.warningConfirmation !== undefined && (!body.warningConfirmation || typeof body.warningConfirmation !== "object" || Array.isArray(body.warningConfirmation) || Object.keys(body.warningConfirmation).length !== 1 || typeof body.warningConfirmation.sourceFingerprint !== "string" || !body.warningConfirmation.sourceFingerprint.trim())) {
    return badRequest("Warning confirmation must contain the current sourceFingerprint.");
  }
  if (body.requesterName !== undefined && (typeof body.requesterName !== "string" || body.requesterName.trim().length > 120 || /[\r\n\x00-\x1f\x7f]/.test(body.requesterName))) return badRequest("Requester name must be a single line of up to 120 characters.");
  const requesterName = body.requesterName?.trim();
  try {
    for (const item of Object.values(body.checklist.food ?? {})) normalizeKitchenOrderNotes(item?.notes);
  } catch (error) { return badRequest(error instanceof Error ? error.message : "Invalid food request notes."); }
  if (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) {
    return badRequest("Load the saved checklist revision before submitting.");
  }

  let source: Awaited<ReturnType<typeof resolveChecklistSource>>;
  try { source = await resolveChecklistSource({ eventId: body.eventId, sourceEventId: body.sourceEventId, eventDate: body.eventDate }); }
  catch (error) { return NextResponse.json({ error: error instanceof ChecklistSourceError ? error.message : "The event source could not be verified." }, { status: error instanceof ChecklistSourceError ? error.status : 503 }); }
  const { plan, kitchenEventId } = source;
  const [event] = checklistEventsForPlans([plan]);
  const state = reconcileChecklistSetup(event, hydrateChecklistState(event.date, body.checklist));
  if (!Object.prototype.hasOwnProperty.call(body.checklist, "poc")) delete state.poc;
  // A saved or client-provided receipt is not a new closeout confirmation.
  delete state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY];
  if (state.taskEvidence) delete state.taskEvidence[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY];
  const confirmationActor = requesterName || (typeof state.bwa === "string" ? state.bwa.trim() : "");
  if (body.warningConfirmation && (!confirmationActor || confirmationActor.length > 120 || /[\r\n\x00-\x1f\x7f]/.test(confirmationActor))) {
    return badRequest("Warning confirmation requires a staff name on a single line of up to 120 characters.");
  }
  const readiness = checklistReadiness(event, state, body.warningConfirmation?.sourceFingerprint);
  if (body.warningConfirmation && body.warningConfirmation.sourceFingerprint !== readiness.warningFingerprint) {
    return NextResponse.json({ error: "Contract warnings changed; refresh and confirm the current warnings before submitting." }, { status: 422 });
  }
  if (!readiness.canSubmit) {
    return NextResponse.json({
      error: "Complete critical tasks with a name and timestamp, enter the BWA, and explicitly confirm any unresolved contract warnings before closing this event. Only Admin can reopen a submitted checklist.",
      incompleteTasks: readiness.missing.map((task) => task.key),
      reviewTasks: readiness.review.map((task) => task.key),
    }, { status: 422 });
  }

  try {
    if (body.warningConfirmation && readiness.warningFingerprint) {
      state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = true;
      state.taskEvidence = {
        ...state.taskEvidence,
        [CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]: {
          employeeName: confirmationActor,
          completedAt: new Date().toISOString(),
          sourceFingerprint: readiness.warningFingerprint,
          contractWarnings: readiness.warningMessages,
        },
      };
    }
    const record = await saveChecklist({
      action: "submit",
      eventId: event.id,
      eventName: event.name,
      eventDate: event.date,
      checklist: state,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });

    try {
      const kitchenSync = requesterName ? await synchronizeChecklistFoodAddOns(kitchenEventId, body.checklist.food, undefined, "EVENT_HOST_ADDON", { requesterName }) : await synchronizeChecklistFoodAddOns(
        kitchenEventId,
        body.checklist.food,
      );
      const accepted = kitchenSync.exceptions === 0 && kitchenSync.deliveryVerified === true;
      const pending = kitchenSync.exceptions === 0 && kitchenSync.deliveryPending === true;
      return NextResponse.json({
        record,
        kitchenSync: {
          status: accepted ? "live" : kitchenSync.noFoodRequired ? "not-required" : pending ? "pending" : "error",
          eventId: kitchenEventId,
          requestIds: kitchenSync.requestIds ?? [],
          updatedAt: kitchenSync.saved.updatedAt,
          queued: kitchenSync.queued,
          exceptions: kitchenSync.exceptions,
          sent: kitchenSync.sent,
          accepted: kitchenSync.acceptedDeliveryCount,
          deliveries: kitchenSync.deliveries ?? [],
          ...(!accepted && !kitchenSync.noFoodRequired && !pending ? { error: kitchenSync.error ?? "Final record submitted to Admin, but GoTab acceptance was not verified for every food item. Check the saved orders before submitting again." } : {}),
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
