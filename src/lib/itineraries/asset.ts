import type { EventPlan, EventPlanSyncState, ItineraryAsset } from "@/lib/event-plans/types";
import type { EntertainmentDayPayload } from "@/lib/entertainment/types";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import { detectFloorPlanConflicts } from "@/lib/floor-plans/conflicts";
import { validateFloorPlan } from "@/lib/floor-plans/validator";
import { projectDecemberOwnerHoldFloorPlanVisibility } from "@/lib/floor-plans/owner-holds";
import { applyEntertainmentDayToItinerary, itineraryIdentityScope } from "./entertainment";
import { applyItineraryEdit, type ItineraryEdit } from "./edits";
import { buildItineraryRevision } from "./readiness";

export function buildItineraryAsset(input: {
  plan: EventPlan;
  candidates: readonly EventPlan[];
  day: EntertainmentDayPayload | null;
  floorPlan: FloorPlanDocument | null;
  floorPlanPersisted: boolean;
  sourceSync: EventPlanSyncState | null;
  savedPdf?: Pick<ItineraryAsset, "pdf" | "pdf_fingerprint">;
  edit?: ItineraryEdit;
  now: Date;
}): ItineraryAsset {
  const floorPlan = input.floorPlan ? projectDecemberOwnerHoldFloorPlanVisibility(input.floorPlan) : null;
  const scope = itineraryIdentityScope(input.plan, floorPlan, input.floorPlanPersisted, input.candidates);
  const projected = input.day ? applyEntertainmentDayToItinerary(input.plan, input.day, scope) : input.plan;
  const current = applyItineraryEdit(projected, input.edit);
  return {
    ...current,
    pdf: input.savedPdf?.pdf,
    pdf_fingerprint: input.savedPdf?.pdf_fingerprint,
    revision: buildItineraryRevision({
      plan: current,
      sourcePlan: input.plan,
      candidatePlans: input.candidates,
      sourceSync: input.sourceSync,
      entertainmentDay: input.day,
      floorPlan,
      floorPlanPersisted: input.floorPlanPersisted,
      floorPlanValidation: floorPlan && input.day
        ? validateFloorPlan(floorPlan, input.day.reservations, detectFloorPlanConflicts(floorPlan), input.day.conflicts)
        : [],
      pdf: input.savedPdf?.pdf,
      pdfFingerprint: input.savedPdf?.pdf_fingerprint,
      now: input.now,
    }),
  };
}
