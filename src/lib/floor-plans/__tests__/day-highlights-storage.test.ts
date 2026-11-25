import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAdminState, type AdminState } from "@/lib/admin-types";
import type { saveChecklist } from "@/lib/checklist-storage";
import { StaleSaveError } from "@/lib/stale-save";
import { floorPlanHighlightKey, FloorPlanHighlightValidationError, validateFloorPlanHighlights } from "../day-highlights";
import { loadFloorPlanHighlights, saveFloorPlanHighlights } from "../day-highlights-storage";

vi.mock("server-only", () => ({}));
const date = "2026-12-03", stamp = "2026-11-25T15:00:00Z", nextStamp = "2026-11-25T15:00:01Z";
const notes = validateFloorPlanHighlights([{ id: "trivia", kind: "highlight", x: 5, y: 10, width: 20, height: 15, text: "Trivia", fill: "#297025" }]);

function fixture() {
  const state: AdminState = { ...emptyAdminState(), archivedAssetKeys: ["/kept.png"], archivedEventIds: [123],
    itineraryEditsByEvent: { retained: { opaque: "preserve fixture exactly" } } as never,
    overlaysByAsset: { "/kept.png": [{ ...notes[0], text: "Existing asset" }],
      "floor-plan-day:2026-12-04": [{ ...notes[0], text: "Bingo" }] } };
  return { state, load: vi.fn(async () => ({ state: structuredClone(state), updatedAt: stamp })),
    save: vi.fn(async () => ({ updatedAt: nextStamp })) as unknown as ReturnType<typeof vi.fn<typeof saveChecklist>> };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Storage fixtures must never contact providers or databases."); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("date-only decorative highlight storage", () => {
  it("loads an empty date without a party or floor-plan document and never writes", async () => {
    const deps = fixture();
    expect(await loadFloorPlanHighlights(date, deps)).toEqual({ date, highlights: [], updatedAt: stamp });
    expect(deps.load).toHaveBeenCalledOnce(); expect(deps.save).not.toHaveBeenCalled();
  });

  it("merges one date into the latest full Admin state, preserving every unrelated field and using one CAS write", async () => {
    const deps = fixture(), before = structuredClone(deps.state);
    expect(await saveFloorPlanHighlights({ date, highlights: notes, expectedUpdatedAt: stamp }, deps))
      .toEqual({ date, highlights: notes, updatedAt: nextStamp });
    expect(deps.save).toHaveBeenCalledOnce();
    const input = deps.save.mock.calls[0][0];
    expect(input).toMatchObject({ action: "save", eventId: 99990001, expectedUpdatedAt: stamp });
    const savedState = input.checklist.tasks!.adminState as AdminState;
    expect(savedState).toEqual({ ...before, overlaysByAsset: { ...before.overlaysByAsset, [floorPlanHighlightKey(date)]: notes } });
    expect(deps.state).toEqual(before);
    expect(input).not.toHaveProperty("plan"); expect(input).not.toHaveProperty("reservations");
  });

  it("clears only the requested date's notes without deleting other date or asset overlays", async () => {
    const deps = fixture();
    deps.state.overlaysByAsset[floorPlanHighlightKey(date)] = notes;
    await saveFloorPlanHighlights({ date, highlights: [], expectedUpdatedAt: stamp }, deps);
    const state = deps.save.mock.calls[0][0].checklist.tasks!.adminState as AdminState;
    expect(state.overlaysByAsset).not.toHaveProperty(floorPlanHighlightKey(date));
    expect(state.overlaysByAsset["/kept.png"]).toEqual(deps.state.overlaysByAsset["/kept.png"]);
    expect(state.overlaysByAsset["floor-plan-day:2026-12-04"]).toEqual(deps.state.overlaysByAsset["floor-plan-day:2026-12-04"]);
  });

  it("rejects stale state before saving and preserves a final CAS race error without retrying", async () => {
    const deps = fixture();
    await expect(saveFloorPlanHighlights({ date, highlights: notes, expectedUpdatedAt: null }, deps)).rejects.toBeInstanceOf(StaleSaveError);
    expect(deps.save).not.toHaveBeenCalled();
    deps.save.mockRejectedValueOnce(new StaleSaveError());
    await expect(saveFloorPlanHighlights({ date, highlights: notes, expectedUpdatedAt: stamp }, deps)).rejects.toBeInstanceOf(StaleSaveError);
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it("accepts an initially empty Admin state with a null expected timestamp", async () => {
    const deps = fixture();
    deps.load.mockResolvedValueOnce({ state: emptyAdminState(), updatedAt: null as never });
    expect(await saveFloorPlanHighlights({ date, highlights: notes, expectedUpdatedAt: null }, deps)).toMatchObject({ date, highlights: notes, updatedAt: nextStamp });
    expect(deps.save.mock.calls[0][0].expectedUpdatedAt).toBeNull();
  });

  it("validates the complete request before loading or saving any state", async () => {
    const deps = fixture();
    await expect(loadFloorPlanHighlights("2026-02-29", deps)).rejects.toBeInstanceOf(FloorPlanHighlightValidationError);
    await expect(saveFloorPlanHighlights({ date, highlights: [{ ...notes[0], kind: "cover" }], expectedUpdatedAt: stamp }, deps)).rejects.toBeInstanceOf(FloorPlanHighlightValidationError);
    await expect(saveFloorPlanHighlights({ date, highlights: notes, expectedUpdatedAt: undefined as never }, deps)).rejects.toBeInstanceOf(FloorPlanHighlightValidationError);
    expect(deps.load).not.toHaveBeenCalled(); expect(deps.save).not.toHaveBeenCalled();
  });
});
