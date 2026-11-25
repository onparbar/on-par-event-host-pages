import { describe, expect, it, vi } from "vitest";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import { drawFloorPlanDayHighlights } from "../day-highlights-canvas";

function drawingContext() {
  return { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    setLineDash: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 56 })) };
}

const note: AdminAssetOverlay = { id: "trivia", kind: "highlight", x: 10, y: 20,
  width: 30, height: 10, fill: "#7C3AED", opacity: 0.5, text: "Trivia",
  textColor: "#FFFFFF", fontSize: 18 };

describe("special event highlight PNG rendering", () => {
  it("draws percent geometry independently with a dashed border and full-opacity label", () => {
    const context = drawingContext();
    const original = structuredClone(note);
    drawFloorPlanDayHighlights(context as unknown as CanvasRenderingContext2D, [note]);
    expect(context.fillRect).toHaveBeenCalledWith(192, 216, 576, 108);
    expect(context.strokeRect).toHaveBeenCalledWith(192, 216, 576, 108);
    expect(context.setLineDash).toHaveBeenCalledWith([10, 5]);
    expect(context.fillText).toHaveBeenCalledWith("Trivia", 480, 270, 568);
    expect(context.fillText).toHaveBeenCalledWith(expect.stringContaining("not party reservations or approved seating"), 34, 1109);
    expect(context.fillRect).toHaveBeenLastCalledWith(0, 1080, 1920, 44);
    expect(context.save).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledTimes(2);
    expect(note).toEqual(original);
  });

  it("leaves an existing map untouched when there are no notes", () => {
    const context = drawingContext();
    drawFloorPlanDayHighlights(context as unknown as CanvasRenderingContext2D, []);
    expect(context.save).not.toHaveBeenCalled();
    expect(context.fillText).not.toHaveBeenCalled();
  });
});
