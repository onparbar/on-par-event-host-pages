import type { FloorPlanStatus } from "./types";

export function floorPlanStatusAfterSourceChange(
  status: FloorPlanStatus,
  changed: boolean,
) {
  return changed && status === "Approved" ? "Updated After Approval" : status;
}
