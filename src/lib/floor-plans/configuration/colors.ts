const EVENT_COLORS = [
  "#15803D",
  "#1D4ED8",
  "#7C3AED",
  "#BE123C",
  "#CA8A04",
  "#C026D3",
  "#0E7490",
  "#334155",
  "#65A30D",
  "#854D0E",
] as const;

const MIN_EVENT_COLOR_DISTANCE = 70;

function rgb(color: string) {
  const match = color.match(/^#([0-9A-F]{6})$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

export function floorPlanEventColorsAreDistinct(
  left: string,
  right: string,
) {
  const leftRgb = rgb(left);
  const rightRgb = rgb(right);
  if (!leftRgb || !rightRgb) return false;
  const red = leftRgb.red - rightRgb.red;
  const green = leftRgb.green - rightRgb.green;
  const blue = leftRgb.blue - rightRgb.blue;
  return Math.sqrt(red ** 2 + green ** 2 + blue ** 2) >= MIN_EVENT_COLOR_DISTANCE;
}

export function floorPlanEventColor(index: number, used: readonly string[]) {
  const normalizedUsed = used.map((color) => color.toUpperCase());
  for (let offset = 0; offset < EVENT_COLORS.length; offset += 1) {
    const candidate = EVENT_COLORS[(index + offset) % EVENT_COLORS.length];
    if (
      normalizedUsed.every((color) =>
        floorPlanEventColorsAreDistinct(candidate, color),
      )
    ) {
      return candidate;
    }
  }
  return EVENT_COLORS[index % EVENT_COLORS.length];
}

export function distinctFloorPlanEventColor(
  preferred: string | null,
  index: number,
  used: readonly string[],
) {
  const normalized = preferred?.toUpperCase() ?? null;
  if (
    normalized &&
    used.every((color) => floorPlanEventColorsAreDistinct(normalized, color))
  ) {
    return normalized;
  }
  return floorPlanEventColor(index, used);
}

export function ensureDistinctFloorPlanEventColors<T extends { color: string }>(
  events: readonly T[],
) {
  const used: string[] = [];
  return events.map((event, index) => {
    const color = distinctFloorPlanEventColor(
      rgb(event.color) ? event.color : null,
      index,
      used,
    );
    used.push(color);
    return color === event.color.toUpperCase()
      ? event
      : { ...event, color };
  });
}

export function readableOverlayText(color: string) {
  const match = color.match(/^#([0-9A-F]{6})$/i);
  if (!match) return "#000000";
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000 >= 145
    ? "#000000"
    : "#FFFFFF";
}
