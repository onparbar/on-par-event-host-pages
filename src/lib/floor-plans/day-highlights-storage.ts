import "server-only";
import { buildAdminStateRequest, loadAdminStateSnapshot } from "@/lib/admin-state";
import { saveChecklist } from "@/lib/checklist-storage";
import { StaleSaveError } from "@/lib/stale-save";
import { floorPlanHighlightKey, floorPlanHighlightsFromState, FloorPlanHighlightValidationError, validateFloorPlanHighlights } from "./day-highlights";

type Dependencies = { load?: typeof loadAdminStateSnapshot; save?: typeof saveChecklist };
export type FloorPlanHighlightsChange = { date: string; highlights: unknown; expectedUpdatedAt: string | null };

export async function loadFloorPlanHighlights(date: string, dependencies: Pick<Dependencies, "load"> = {}) {
  floorPlanHighlightKey(date);
  const snapshot = await (dependencies.load ?? loadAdminStateSnapshot)();
  return { date, highlights: floorPlanHighlightsFromState(snapshot.state, date), updatedAt: snapshot.updatedAt };
}

/** One checked Admin-state write. It never changes a floor-plan document, reservation or approval. */
export async function saveFloorPlanHighlights(change: FloorPlanHighlightsChange, dependencies: Dependencies = {}) {
  const key = floorPlanHighlightKey(change.date);
  const highlights = validateFloorPlanHighlights(change.highlights);
  if (change.expectedUpdatedAt !== null && (typeof change.expectedUpdatedAt !== "string" ||
      change.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(change.expectedUpdatedAt)))) {
    throw new FloorPlanHighlightValidationError("Reload the saved highlights before saving.");
  }
  const snapshot = await (dependencies.load ?? loadAdminStateSnapshot)();
  if (snapshot.updatedAt !== change.expectedUpdatedAt) throw new StaleSaveError();
  const overlaysByAsset = { ...snapshot.state.overlaysByAsset };
  if (highlights.length) overlaysByAsset[key] = highlights;
  else delete overlaysByAsset[key];
  const saved = await (dependencies.save ?? saveChecklist)({
    ...buildAdminStateRequest({ ...snapshot.state, overlaysByAsset }), expectedUpdatedAt: change.expectedUpdatedAt,
  });
  return { date: change.date, highlights, updatedAt: saved.updatedAt };
}
