import { describe, expect, it } from "vitest";
import { MemoryFloorPlanStorage } from "../storage";
import {
  loadFloorPlanPublicationWindow,
  nearestFloorPlanDate,
} from "../publication";
import type { FloorPlanDocument } from "../types";

function plan(
  eventDate: string,
  status: FloorPlanDocument["status"] = "Needs Review",
): FloorPlanDocument {
  return {
    id: `floor-plan-${eventDate}`,
    eventDate,
    status,
    version: 1,
    ruleVersion: "floor-plan-v1.2.0",
    lastTripleseatSyncAt: "2026-08-04T16:00:00.000Z",
    createdAt: "2026-08-04T16:00:00.000Z",
    updatedAt: "2026-08-04T16:00:00.000Z",
    approvedAt: status === "Approved" ? "2026-08-04T17:00:00.000Z" : null,
    approvedBy: status === "Approved" ? "authenticated-event-host-staff" : null,
    events: [
      {
        id: `event-${eventDate}`,
        floorPlanId: `floor-plan-${eventDate}`,
        tripleseatEventId: "redacted-event",
        name: "Redacted Event",
        status: "DEFINITE",
        guestCount: 24,
        startAt: `${eventDate}T17:00:00-04:00`,
        endAt: `${eventDate}T19:00:00-04:00`,
        contractedAreaIds: ["vip-1"],
        unresolvedAreaNames: [],
        color: "#297025",
        beoLastModifiedAt: null,
        fullBuyout: false,
        source: {
          rooms: ["VIP 1"],
          food: [],
          entertainment: [],
          operationalNotes: [],
          reviewReasons: [],
        },
      },
    ],
    reservations: [],
  };
}

describe("floor-plan publication window", () => {
  it("loads saved event dates for today through two weeks ahead", async () => {
    const storage = new MemoryFloorPlanStorage();
    await storage.save(plan("2026-08-05"), "Saved pending plan.");
    await storage.save(plan("2026-08-18", "Approved"), "Saved approved plan.");
    await storage.save(plan("2026-08-19"), "Outside the window.");

    const result = await loadFloorPlanPublicationWindow(
      "2026-08-04",
      storage,
    );

    expect(result.map((item) => item.eventDate)).toEqual([
      "2026-08-05",
      "2026-08-18",
    ]);
    expect(nearestFloorPlanDate(result, "2026-08-04")).toBe(
      "2026-08-05",
    );
  });

  it("repairs duplicate party colors before a saved plan is displayed", async () => {
    const storage = new MemoryFloorPlanStorage();
    const saved = plan("2026-08-07");
    saved.events = [
      { ...saved.events[0], id: "event-one", color: "#BE123C" },
      { ...saved.events[0], id: "event-two", color: "#BE123C" },
    ];
    await storage.save(saved, "Duplicate saved party colors.");

    const [result] = await loadFloorPlanPublicationWindow(
      "2026-08-05",
      storage,
    );

    expect(result.events[0].color).not.toBe(result.events[1].color);
  });

  it("uses the supplied fallback when no saved event plan is available", () => {
    expect(nearestFloorPlanDate([], "2026-08-04", "2026-08-06")).toBe(
      "2026-08-06",
    );
  });
});
