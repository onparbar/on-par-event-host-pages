import { TRIPLESEAT_RECONNECT_WARNING } from "@/lib/entertainment/types";
import type { FloorPlanDayPayload } from "./types";

const TRIPLESEAT_SYNC_WARNINGS = new Set([
  "The latest Tripleseat sync failed. The last saved schedule remains visible.",
  "Tripleseat could not be refreshed. On Par Bookings is refreshed independently and saved Tripleseat assignments are retained.",
  "On Par Bookings refreshed independently; Tripleseat is unavailable and its saved reservations were retained.",
  TRIPLESEAT_RECONNECT_WARNING,
]);

type SyncPayload = Pick<FloorPlanDayPayload, "sourceRefresh" | "warnings">;

/** A successful HTTP response may still contain a partial provider refresh. */
export function floorPlanSyncFeedback(payload: SyncPayload): {
  status: "success" | "partial" | "error";
  message: string;
} {
  const refresh = payload.sourceRefresh;
  if (!refresh) return {
    status: "partial",
    message: "Source refresh status could not be confirmed. Saved floor-plan assignments remain visible.",
  };
  const status = refresh.tripleseat === "success" && refresh.onParBookings !== "error" ? "success"
    : refresh.tripleseat === "error" && refresh.onParBookings !== "success" ? "error" : "partial";
  if (refresh.tripleseat === "success" && refresh.onParBookings === "success") return {
    status, message: "Tripleseat and On Par Bookings refreshed successfully.",
  };
  const messages = [refresh.onParBookings === "success" ? "On Par Bookings refreshed."
    : refresh.onParBookings === "error" ? "On Par Bookings could not be refreshed; saved booking assignments were retained."
      : "On Par Bookings is not configured."];
  messages.push(refresh.tripleseat === "success" ? "Tripleseat refreshed successfully."
    : refresh.tripleseat === "partial" ? "Tripleseat did not fully refresh. Saved Tripleseat assignments were retained."
      : "Tripleseat could not be refreshed. Saved Tripleseat assignments were retained.");
  if (refresh.reconnectTripleseat) messages.push("Ask an Admin to reconnect Tripleseat.");
  return { status, message: messages.join(" ") };
}

/** Keep operational warnings; report one provider failure rather than three equivalent messages. */
export function floorPlanSyncWarnings(payload: SyncPayload) {
  const result: string[] = [];
  let providerWarningShown = false;
  const reconnect = payload.warnings.includes(TRIPLESEAT_RECONNECT_WARNING);
  for (const warning of payload.warnings) {
    if (TRIPLESEAT_SYNC_WARNINGS.has(warning)) {
      // Structured feedback is already shown in the sync bar after a refresh.
      if (!payload.sourceRefresh && !providerWarningShown) {
        result.push(reconnect ? TRIPLESEAT_RECONNECT_WARNING : "Tripleseat could not be refreshed. Saved Tripleseat assignments remain visible.");
        providerWarningShown = true;
      }
    } else if (!result.includes(warning)) result.push(warning);
  }
  return result;
}
