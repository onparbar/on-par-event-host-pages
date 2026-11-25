import { describe, expect, it } from "vitest";
import { emptyAdminState } from "@/lib/admin-types";
import { floorPlanHighlightDates, floorPlanHighlightKey, floorPlanHighlightsFromState, FloorPlanHighlightValidationError, validateFloorPlanHighlights } from "../day-highlights";

const date = "2026-12-03";
const note = { id: "special-1", kind: "highlight", x: 10, y: 20, width: 25, height: 15, fill: "#297025", text: " Trivia " };
const normalized = { ...note, text: "Trivia", opacity: 0.5, textColor: "#FFFFFF", fontSize: 18 };

describe("decorative day-only floor-plan highlight validation", () => {
  it("normalizes only safe overlay fields and defaults without creating reservation properties", () => {
    const input = [{ ...note, fill: "#aabbcc", secret: "not projected", floorPlanEventId: "never accepted", reservationType: "seating" }];
    expect(validateFloorPlanHighlights(input)).toEqual([{ ...normalized, fill: "#AABBCC", textColor: "#000000" }]);
    expect(input[0].text).toBe(" Trivia ");
  });

  it("accepts bounded explicitly supplied style and exactly fifty named rectangles", () => {
    expect(validateFloorPlanHighlights([{ ...note, opacity: 0.25, textColor: "#aabbcc", fontSize: 24 }])[0])
      .toMatchObject({ opacity: 0.25, textColor: "#AABBCC", fontSize: 24 });
    expect(validateFloorPlanHighlights(Array.from({ length: 50 }, (_, index) => ({ ...note, id: `note-${index}`, text: "x".repeat(80) })))).toHaveLength(50);
    expect(validateFloorPlanHighlights([])).toEqual([]);
  });

  it.each([null, {}, "notes", [null], [1], [[note]], Array.from({ length: 51 }, (_, index) => ({ ...note, id: `note-${index}` }))])(
    "rejects malformed or excessive highlight lists", (input) => {
      expect(() => validateFloorPlanHighlights(input)).toThrow(FloorPlanHighlightValidationError);
    });

  it.each([
    { kind: "cover" }, { kind: "reservation" }, { kind: undefined }, { id: "" }, { id: "unsafe/id" },
    { fill: "red" }, { fill: "#123" }, { fill: "#12345680" }, { fill: "url(https://invalid.example)" },
    { text: "   " }, { text: "x".repeat(81) }, { text: "Trivia\u0000" },
    { x: -1 }, { y: 101 }, { x: "10" }, { x: NaN }, { y: Infinity },
    { width: 0 }, { height: -1 }, { width: 91 }, { height: 81 }, { width: Infinity },
    { opacity: -0.1 }, { opacity: 1.1 }, { opacity: NaN }, { opacity: "0.5" },
    { textColor: "red" }, { fontSize: 7 }, { fontSize: 73 }, { fontSize: "18" },
  ])("rejects invalid highlight field %j", (patch) => {
    expect(() => validateFloorPlanHighlights([{ ...note, ...patch }])).toThrow(FloorPlanHighlightValidationError);
  });

  it("rejects duplicate IDs instead of collapsing two notes", () => {
    expect(() => validateFloorPlanHighlights([note, { ...note, text: "Bingo" }])).toThrow(FloorPlanHighlightValidationError);
  });

  it("accepts exact bounded edges and real leap dates while rejecting impossible/yearless dates", () => {
    expect(validateFloorPlanHighlights([{ ...note, x: 0, y: 0, width: 100, height: 100 }])).toHaveLength(1);
    expect(floorPlanHighlightKey("2028-02-29")).toBe("floor-plan-day:2028-02-29");
    for (const invalid of ["2026-02-29", "2026-11-31", "12/3/26", "2026-12-03T00:00:00Z", "", "2026-13-01"]) {
      expect(() => floorPlanHighlightKey(invalid)).toThrow(FloorPlanHighlightValidationError);
    }
  });

  it("projects only safe exact-date note records, with no other asset/day/Admin fields", () => {
    const state = { ...emptyAdminState(), overlaysByAsset: {
      [floorPlanHighlightKey(date)]: [note], "floor-plan-day:2026-12-04": [{ ...note, id: "other", text: "Bingo" }],
      "/private-asset.png": [{ ...note, text: "Private asset" }],
      "floor-plan-day:2026-12-03:extra": [{ ...note, text: "Wrong key" }],
      "floor-plan-day:2026-12-05": [{ ...note, kind: "cover" }], "floor-plan-day:2026-12-06": [],
    } };
    expect(floorPlanHighlightsFromState(state as never, date)).toEqual([normalized]);
    expect(floorPlanHighlightDates(state as never)).toEqual([date, "2026-12-04"]);
    expect(floorPlanHighlightsFromState(state as never, "2026-12-03:extra")).toEqual([]);
    expect(floorPlanHighlightsFromState(state as never, "2026-12-05")).toEqual([]);
    expect(floorPlanHighlightsFromState(state as never, "2026-12-07")).toEqual([]);
    expect(floorPlanHighlightsFromState(null, date)).toEqual([]);
    expect(floorPlanHighlightDates(undefined)).toEqual([]);
  });

  it("does not read inherited date keys or return mutable references into saved state", () => {
    const state = { overlaysByAsset: Object.create({ [floorPlanHighlightKey(date)]: [note] }) };
    expect(floorPlanHighlightsFromState(state, date)).toEqual([]);
    expect(floorPlanHighlightDates(state)).toEqual([]);
    const saved = { overlaysByAsset: { [floorPlanHighlightKey(date)]: [normalized] } };
    const projected = floorPlanHighlightsFromState(saved as never, date);
    projected[0].text = "Changed locally";
    expect(saved.overlaysByAsset[floorPlanHighlightKey(date)][0].text).toBe("Trivia");
  });
});
