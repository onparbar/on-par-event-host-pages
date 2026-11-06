import type { PlatterRule } from "./config";
import type { PanSize } from "./types";

export function getPlatterPanAllocation(
  rule: PlatterRule,
  platterCount: number,
  preferredPanSize: PanSize,
): { numberOfPans: number | null; panSize: PanSize | null } {
  if (!rule.pansPerPlatter) {
    return { numberOfPans: null, panSize: null };
  }
  const panSize = rule.pansPerPlatter[preferredPanSize] === null
    ? "1/2"
    : preferredPanSize;
  const pansPerPlatter = rule.pansPerPlatter[panSize];
  return {
    numberOfPans: pansPerPlatter === null ? null : platterCount * pansPerPlatter,
    panSize,
  };
}
