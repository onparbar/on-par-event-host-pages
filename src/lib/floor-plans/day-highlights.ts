import type { AdminAssetOverlay, AdminState } from "@/lib/admin-types";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { readableOverlayText } from "./configuration/colors";

export const FLOOR_PLAN_HIGHLIGHT_PREFIX = "floor-plan-day:";
export const MAX_FLOOR_PLAN_HIGHLIGHTS = 50;
type HighlightState = Pick<AdminState, "overlaysByAsset"> | null | undefined;

export class FloorPlanHighlightValidationError extends Error {}

export function floorPlanHighlightKey(date: string) {
  if (typeof date !== "string" || !isValidEntertainmentDate(date)) {
    throw new FloorPlanHighlightValidationError("Choose a valid floor-plan date.");
  }
  return `${FLOOR_PLAN_HIGHLIGHT_PREFIX}${date}`;
}

function number(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Decorative notes only: no event, seating, timing, resource or approval fields are accepted. */
export function validateFloorPlanHighlights(value: unknown): AdminAssetOverlay[] {
  if (!Array.isArray(value) || value.length > MAX_FLOOR_PLAN_HIGHLIGHTS) {
    throw new FloorPlanHighlightValidationError(`Use at most ${MAX_FLOOR_PLAN_HIGHLIGHTS} special-event highlights.`);
  }
  const seen = new Set<string>();
  return value.map((item): AdminAssetOverlay => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new FloorPlanHighlightValidationError("A special-event highlight is invalid.");
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !/^[A-Za-z0-9:_-]{1,120}$/.test(row.id) || seen.has(row.id) || row.kind !== "highlight") {
      throw new FloorPlanHighlightValidationError("Choose distinct highlight IDs and highlight-only shapes.");
    }
    if (!number(row.x, 0, 100) || !number(row.y, 0, 100) || !number(row.width, Number.MIN_VALUE, 100) ||
        !number(row.height, Number.MIN_VALUE, 100) || (row.x as number) + (row.width as number) > 100 ||
        (row.y as number) + (row.height as number) > 100) {
      throw new FloorPlanHighlightValidationError("Keep each highlight inside the floor map with a positive width and height.");
    }
    if (typeof row.fill !== "string" || !/^#[0-9a-f]{6}$/i.test(row.fill) ||
        typeof row.text !== "string" || !row.text.trim() || row.text.trim().length > 80 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.text)) {
      throw new FloorPlanHighlightValidationError("Give each highlight a valid #RRGGBB color and a name of 1–80 characters.");
    }
    const fill = row.fill.toUpperCase();
    const opacity = row.opacity === undefined ? 0.5 : row.opacity;
    const textColor = row.textColor === undefined ? readableOverlayText(fill) : row.textColor;
    const fontSize = row.fontSize === undefined ? 18 : row.fontSize;
    if (!number(opacity, 0, 1) || typeof textColor !== "string" || !/^#[0-9a-f]{6}$/i.test(textColor) || !number(fontSize, 8, 72)) {
      throw new FloorPlanHighlightValidationError("Choose valid highlight opacity, text color and font size.");
    }
    seen.add(row.id);
    return { id: row.id, kind: "highlight", x: row.x as number, y: row.y as number, width: row.width as number,
      height: row.height as number, fill, opacity: opacity as number, text: row.text.trim(), textColor: textColor.toUpperCase(), fontSize: fontSize as number };
  });
}

/** Exact-date, allowlisted public projection; malformed saved data never becomes a map overlay. */
export function floorPlanHighlightsFromState(state: HighlightState, date: string): AdminAssetOverlay[] {
  try {
    const key = floorPlanHighlightKey(date), overlays = state?.overlaysByAsset;
    return overlays && Object.hasOwn(overlays, key) ? validateFloorPlanHighlights(overlays[key]) : [];
  } catch { return []; }
}

export function floorPlanHighlightDates(state: HighlightState): string[] {
  return Object.keys(state?.overlaysByAsset ?? {}).flatMap((key) => {
    if (!key.startsWith(FLOOR_PLAN_HIGHLIGHT_PREFIX)) return [];
    const date = key.slice(FLOOR_PLAN_HIGHLIGHT_PREFIX.length);
    return floorPlanHighlightsFromState(state, date).length ? [date] : [];
  }).sort();
}
