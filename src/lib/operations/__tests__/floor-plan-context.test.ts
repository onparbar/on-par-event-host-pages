import { describe, expect, it } from "vitest";
import type { FloorPlanEvent } from "@/lib/floor-plans/types";
import { numericVipEventId } from "@/lib/vip-prep/identity";
import { findOperationalFloorPlanEvent, operationalFloorPlanEventId } from "../floor-plan-context";

const event: FloorPlanEvent = {
  id: "floor-plan-event-123", floorPlanId: "floor-plan-2026-10-21", tripleseatEventId: "source-123",
  name: "Training event", status: "DEFINITE", guestCount: 20,
  startAt: "2026-10-21T14:00:00-04:00", endAt: "2026-10-21T16:00:00-04:00",
  contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color: "#297025",
  beoLastModifiedAt: null, fullBuyout: false,
  source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [], sourceEventIds: ["linked-456"] },
};

describe("floor-plan operational identity", () => {
  it("uses stable saved-checklist identity and retains source links", () => {
    expect(operationalFloorPlanEventId(event)).toBe("123");
    for (const id of ["123", event.id, "source-123", "linked-456"]) {
      expect(findOperationalFloorPlanEvent([event], id)).toBe(event);
    }
  });
  it("does not choose another party by a matching name or missing ID", () => {
    expect(findOperationalFloorPlanEvent([event], event.name)).toBeNull();
    expect(findOperationalFloorPlanEvent([event], "unavailable")).toBeNull();
    expect(findOperationalFloorPlanEvent([event], null)).toBeNull();
  });
  it("refuses ambiguous source links instead of highlighting either event", () => {
    expect(findOperationalFloorPlanEvent([event, { ...event, id: "other" }], "linked-456")).toBeNull();
  });
  it("uses the existing VIP saved-checklist ID", () => {
    const vip = { ...event, id: "vip-plan", tripleseatEventId: "vip-training" };
    expect(operationalFloorPlanEventId(vip)).toBe(String(numericVipEventId("vip-training")));
    expect(findOperationalFloorPlanEvent([vip], String(numericVipEventId("vip-training")))).toBe(vip);
  });
});
