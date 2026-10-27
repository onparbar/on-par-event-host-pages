import { describe, expect, it, vi } from "vitest";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument } from "@/lib/floor-plans/types";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { withKitchenReservedAreas } from "../reserved-area";
import { generateKitchenChecklist } from "../rules";
import { createMemoryKitchenStorage } from "../storage";
import { getKitchenDay } from "../sync";
import type { TripleseatAdapter } from "../tripleseat";

const source = { ...MOCK_KITCHEN_EVENTS[0], room: "VIP 1" };
const checklist = generateKitchenChecklist(source);

function floorPlan(areaIds: string[] = ["vip-2"]): FloorPlanDocument {
  return {
    id: "saved-plan",
    eventDate: source.localDate,
    status: "Draft",
    version: 1,
    ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: null,
    createdAt: "2026-07-28T12:00:00Z",
    updatedAt: "2026-07-28T12:00:00Z",
    approvedAt: null,
    approvedBy: null,
    events: [{
      id: "saved-event",
      floorPlanId: "saved-plan",
      tripleseatEventId: String(source.eventId),
      name: source.eventName,
      status: "DEFINITE",
      guestCount: 20,
      startAt: null,
      endAt: null,
      contractedAreaIds: ["vip-1"],
      unresolvedAreaNames: [],
      color: "#18332F",
      beoLastModifiedAt: null,
      fullBuyout: false,
      source: {
        rooms: ["VIP 1"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    }],
    reservations: areaIds.map((areaId, index) => ({
      id: `assignment-${index}`,
      floorPlanEventId: "saved-event",
      areaId,
      reservationType: "seating",
      startAt: null,
      endAt: null,
      label: "",
      source: "manual",
      lockedByUser: true,
    })),
  };
}

describe("kitchen reserved areas", () => {
  it("uses saved assignments rather than the contracted room without mutating the source", () => {
    expect(withKitchenReservedAreas([checklist], floorPlan())[0].event.room).toBe("VIP 2");
    expect(checklist.event.room).toBe("VIP 1");
  });

  it.each([["ge-table-1", "GEG Tables"], ["ge-table-2", "GEG Tables"], ["ge-table-3", "GEG Tables"], ["main-rect-left-4", "Main Dining"], ["main-rect-right-3", "Main Dining"]])(
    "includes food-capable %s when it is used for seating",
    (areaId, expectedRoom) => {
      const plan = floorPlan([areaId]);
      expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe(expectedRoom);
      plan.reservations[0].reservationType = "food-table";
      expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBeNull();
    },
  );

  it("matches corporate kitchen prep through verified source IDs on a linked VIP floor-plan event", () => {
    const plan = floorPlan();
    plan.events[0].tripleseatEventId = "vip-booking";
    plan.events[0].source.sourceEventIds = ["vip-booking", String(source.eventId)];
    plan.events[0].source.verifiedSourceEventIds = [String(source.eventId)];
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("VIP 2");
  });

  it("does not use a legacy name-derived VIP alias to move another party's kitchen area", () => {
    const plan = floorPlan();
    plan.events[0].tripleseatEventId = "vip-other-booking";
    plan.events[0].source.sourceEventIds = ["vip-other-booking", String(source.eventId)];
    expect(withKitchenReservedAreas([checklist], plan)[0]).toBe(checklist);
    const vip = { ...checklist, event: { ...checklist.event, eventId: "vip-this-booking" } };
    plan.events[0].tripleseatEventId = "corporate-other-booking";
    plan.events[0].source.sourceEventIds = ["corporate-other-booking", "vip-this-booking"];
    expect(withKitchenReservedAreas([vip], plan)[0]).toBe(vip);
  });

  it("does not label ancillary conversation seating as a second reserved VIP room", () => {
    // Redacted shape shared by the October 23 and 24 saved plans.
    const plan = floorPlan(["vip-2", "vip1-extra-convo"]);
    plan.events[0].contractedAreaIds = ["vip-2"];
    plan.events[0].source.rooms = ["VIP 2"];
    plan.reservations.forEach((reservation) => { reservation.reservationType = "room"; });
    const before = structuredClone(plan);
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("VIP 2");
    expect(plan).toEqual(before);
    expect(checklist.event.room).toBe("VIP 1");
  });

  it("still lists both VIP rooms when both main rooms are assigned", () => {
    const plan = floorPlan(["vip-1", "vip-2", "vip1-extra-convo"]);
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("VIP 1, VIP 2");
  });

  it("retains separately assigned dining seating beside a reserved VIP room", () => {
    const plan = floorPlan(["vip-2", "vip1-extra-convo", "main-rect-left-1"]);
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("Main Dining, VIP 2");
  });

  it("ignores custom notes anchored to another VIP room", () => {
    const plan = floorPlan(["vip-2", "vip-1"]);
    plan.reservations[1].reservationType = "custom";
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("VIP 2");
  });

  it("groups tables under their seating area and excludes food tables and entertainment", () => {
    const plan = floorPlan([
      "vip-1", "vip1-extra-front-1", "vip-2",
      "main-rect-left-1", "main-rect-left-2", "main-dining",
      "pool-1", "bowling-1", "vip1-food-table",
    ]);
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("Main Dining, VIP 1, VIP 2");
    plan.reservations[0].reservationType = "food-table";
    plan.reservations = plan.reservations.slice(0, 1);
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBeNull();
  });

  it("does not restore a contracted area after saved highlights have been cleared", () => {
    expect(withKitchenReservedAreas([checklist], floorPlan([]))[0].event.room).toBeNull();
  });

  it("labels a saved full buyout as the entire facility", () => {
    const plan = floorPlan([]);
    plan.events[0].fullBuyout = true;
    expect(withKitchenReservedAreas([checklist], plan)[0].event.room).toBe("Entire Facility");
  });

  it("falls back to the source room without a plan or an exact same-date source identity", () => {
    expect(withKitchenReservedAreas([checklist], null)[0]).toBe(checklist);
    const plan = floorPlan();
    plan.eventDate = "2026-07-29";
    expect(withKitchenReservedAreas([checklist], plan)[0]).toBe(checklist);
    plan.eventDate = source.localDate;
    plan.events[0].tripleseatEventId = "different-event-with-the-same-name";
    expect(withKitchenReservedAreas([checklist], plan)[0]).toBe(checklist);
  });

  it("does not choose between duplicate exact source identities", () => {
    const plan = floorPlan();
    plan.events.push({ ...plan.events[0], id: "duplicate" });
    expect(withKitchenReservedAreas([checklist], plan)[0]).toBe(checklist);
  });
});

describe("kitchen day saved-area projection", () => {
  const adapter: TripleseatAdapter = {
    sourceMode: "mock",
    fetchEventsForDate: async () => [],
    fetchEventDateById: async () => null,
    getDiagnostics: () => ({
      sourceMode: "mock",
      missingEnvironmentVariables: [],
      warnings: [],
      locationId: "26059",
    }),
  };

  it("reads saved areas for the response and preserves stored kitchen source data", async () => {
    const storage = createMemoryKitchenStorage();
    await storage.saveEvent({ sourceEvent: source, checklist });
    const get = vi.fn(async () => floorPlan());
    const day = await getKitchenDay(source.localDate, {
      storage, adapter,
      floorPlanStorage: { get },
      vipPrepClient: { configured: false, fetchRange: vi.fn() },
      now: new Date(`${source.localDate}T12:00:00-04:00`),
    });
    expect(get).toHaveBeenCalledExactlyOnceWith(source.localDate);
    expect(day.events.find((item) => item.event.eventId === source.eventId)?.event.room).toBe("VIP 2");
    expect((await storage.getDay(source.localDate)).events[0].event.room).toBe("VIP 1");
  });

  it("keeps kitchen prep available with an area warning if the floor-plan lookup fails", async () => {
    const storage = createMemoryKitchenStorage();
    await storage.saveEvent({ sourceEvent: source, checklist });
    const day = await getKitchenDay(source.localDate, {
      storage, adapter,
      floorPlanStorage: { get: async () => { throw new Error("Unavailable"); } },
      vipPrepClient: { configured: false, fetchRange: vi.fn() },
      now: new Date(`${source.localDate}T12:00:00-04:00`),
    });
    expect(day.events.find((item) => item.event.eventId === source.eventId)?.event.room).toBe("VIP 1");
    expect(day.warnings).toContain("Saved floor-plan areas could not be loaded; booking areas are shown.");
  });
});
