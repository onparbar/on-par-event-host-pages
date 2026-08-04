const EVENT_COLORS = [
  "#0F766E",
  "#1D4ED8",
  "#7C3AED",
  "#B45309",
  "#BE123C",
  "#047857",
  "#4338CA",
  "#9F1239",
] as const;

export function floorPlanEventColor(index: number, used: readonly string[]) {
  const normalizedUsed = new Set(used.map((color) => color.toUpperCase()));
  for (let offset = 0; offset < EVENT_COLORS.length; offset += 1) {
    const candidate = EVENT_COLORS[(index + offset) % EVENT_COLORS.length];
    if (!normalizedUsed.has(candidate)) {
      return candidate;
    }
  }
  return EVENT_COLORS[index % EVENT_COLORS.length];
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
