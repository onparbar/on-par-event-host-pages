import { describe, expect, it } from "vitest";
import { TRIPLESEAT_RECONNECT_WARNING } from "@/lib/entertainment/types";
import { floorPlanSyncFeedback, floorPlanSyncWarnings } from "../sync-feedback";

const oldWarnings = [
  "The latest Tripleseat sync failed. The last saved schedule remains visible.",
  "Tripleseat could not be refreshed. On Par Bookings is refreshed independently and saved Tripleseat assignments are retained.",
  "On Par Bookings refreshed independently; Tripleseat is unavailable and its saved reservations were retained.",
];

describe("floor-plan source refresh feedback", () => {
  it("reports On Par-only refresh as partial without claiming the displayed event count was updated", () => {
    const result = floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "error", onParBookings: "success", reconnectTripleseat: true }, warnings: oldWarnings });
    expect(result.status).toBe("partial");
    expect(result.message).toContain("On Par Bookings refreshed.");
    expect(result.message).toContain("Tripleseat could not be refreshed.");
    expect(result.message).toContain("Saved Tripleseat assignments were retained.");
    expect(result.message).toContain("Ask an Admin to reconnect Tripleseat.");
    expect(result.message).not.toMatch(/events? updated|Not synced yet|successfully/);
  });

  it("reports complete provider success without an invented update count", () => {
    expect(floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "success", onParBookings: "success", reconnectTripleseat: false }, warnings: [] }))
      .toEqual({ status: "success", message: "Tripleseat and On Par Bookings refreshed successfully." });
  });

  it("does not treat one successful Tripleseat domain as a complete refresh", () => {
    const result = floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "partial", onParBookings: "success", reconnectTripleseat: false }, warnings: [] });
    expect(result.status).toBe("partial");
    expect(result.message).toContain("Tripleseat did not fully refresh.");
    expect(result.message).not.toContain("reconnect");
  });

  it("reports both-provider failure and preserves the saved-data explanation", () => {
    const result = floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "error", onParBookings: "error", reconnectTripleseat: false }, warnings: [] });
    expect(result.status).toBe("error");
    expect(result.message).toContain("On Par Bookings could not be refreshed");
    expect(result.message).toContain("Tripleseat could not be refreshed");
    expect(result.message).toContain("retained");
  });

  it("keeps a failed On Par refresh partial even when Tripleseat succeeded", () => {
    const result = floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "success", onParBookings: "error", reconnectTripleseat: false }, warnings: [] });
    expect(result.status).toBe("partial");
    expect(result.message).toContain("Tripleseat refreshed successfully.");
    expect(result.message).toContain("On Par Bookings could not be refreshed");
  });

  it("does not count an unconfigured optional feed as successful or as a provider failure", () => {
    const result = floorPlanSyncFeedback({ sourceRefresh: { tripleseat: "success", onParBookings: "not-configured", reconnectTripleseat: false }, warnings: [] });
    expect(result.status).toBe("success");
    expect(result.message).toContain("On Par Bookings is not configured.");
    expect(result.message).toContain("Tripleseat refreshed successfully.");
  });

  it("does not infer refresh success from a legacy response lacking provider outcomes", () => {
    const result = floorPlanSyncFeedback({ warnings: [] });
    expect(result.status).toBe("partial");
    expect(result.message).toContain("could not be confirmed");
    expect(result.message).not.toMatch(/successfully|updated/);
  });

  it("collapses the three historical provider warnings without hiding seating and contract warnings", () => {
    expect(floorPlanSyncWarnings({ warnings: [oldWarnings[0], "Seating is eight seats short.", ...oldWarnings.slice(1), "Contract area needs review."] }))
      .toEqual(["Tripleseat could not be refreshed. Saved Tripleseat assignments remain visible.", "Seating is eight seats short.", "Contract area needs review."]);
  });

  it("uses the safe reconnect warning once for a saved authorization failure", () => {
    expect(floorPlanSyncWarnings({ warnings: [oldWarnings[0], TRIPLESEAT_RECONNECT_WARNING, ...oldWarnings, "Check accessible food placement."] }))
      .toEqual([TRIPLESEAT_RECONNECT_WARNING, "Check accessible food placement."]);
  });

  it("shows provider feedback only in the sync bar when structured results are available", () => {
    expect(floorPlanSyncWarnings({ sourceRefresh: { tripleseat: "error", onParBookings: "success", reconnectTripleseat: true }, warnings: [...oldWarnings, TRIPLESEAT_RECONNECT_WARNING, "Missing BEO quantity.", "Missing BEO quantity."] }))
      .toEqual(["Missing BEO quantity."]);
  });

  it("preserves warnings that do not match a known duplicate sync message", () => {
    expect(floorPlanSyncWarnings({ warnings: ["VIP Prep could not be refreshed; the last saved VIP schedule remains visible.", "A source reservation changed."] }))
      .toEqual(["VIP Prep could not be refreshed; the last saved VIP schedule remains visible.", "A source reservation changed."]);
  });
});
