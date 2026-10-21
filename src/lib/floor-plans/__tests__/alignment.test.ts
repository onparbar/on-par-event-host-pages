import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryEntertainmentStorage,
  setEntertainmentStorageForTests,
} from "@/lib/entertainment/storage";
import { getEntertainmentResource } from "@/lib/entertainment/resources";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { updateEntertainmentReservation } from "@/lib/entertainment/sync";
import { buildEntertainmentSchedule, mergeReservationsForSync } from "@/lib/entertainment/domain";
import type { EntertainmentSourceEvent } from "@/lib/entertainment/types";
import { alignGeneratedEntertainment } from "../service";
import { selectEntertainmentResources } from "../configuration/adjacency";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument, type FloorPlanEvent } from "../types";

const DATE = "2026-10-20";
const START = "2026-10-20T18:00:00-04:00";
const END = "2026-10-20T20:00:00-04:00";

function event(id: string, areaId = "main-dining"): FloorPlanEvent {
  return {
    id, floorPlanId: `floor-plan-${DATE}`, tripleseatEventId: id,
    name: `Redacted ${id}`, status: "DEFINITE", guestCount: 20,
    startAt: START, endAt: END, contractedAreaIds: [areaId],
    unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: START,
    fullBuyout: false,
    source: { rooms: [areaId], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
  };
}

function plan(events: FloorPlanEvent[]): FloorPlanDocument {
  return {
    id: `floor-plan-${DATE}`, eventDate: DATE, status: "Draft", version: 1,
    ruleVersion: FLOOR_PLAN_RULE_VERSION, lastTripleseatSyncAt: START,
    createdAt: START, updatedAt: START, approvedAt: null, approvedBy: null,
    events, reservations: [],
  };
}

function lane(id: string, owner: FloorPlanEvent, number: number, overrides: Partial<EntertainmentReservation> = {}): EntertainmentReservation {
  const resource = getEntertainmentResource(`bowling-${number}`)!;
  return {
    id, syncKey: id, localEventId: owner.tripleseatEventId,
    tripleseatEventId: owner.tripleseatEventId, tripleseatBookingId: null,
    eventName: owner.name, operatingDate: DATE, resourceId: resource.id,
    resourceCategory: "bowling", resourceName: resource.canonicalName,
    startAt: START, endAt: END, sourceStartAt: START, sourceEndAt: END,
    sourceResourceId: resource.id, sourceReference: null, hasSourceUpdate: false,
    lastTripleseatSyncAt: START, eventColor: owner.color, colorSource: "event-plan",
    manualOverride: false, needsReview: false, reviewIssues: [], autoAssigned: true,
    source: "tripleseat", sourceUpdatedAt: START,
    notes: "", active: true, createdAt: START, updatedAt: START, updatedBy: "tripleseat-sync",
    ...overrides,
  };
}

async function seed(reservations: EntertainmentReservation[]) {
  const storage = createMemoryEntertainmentStorage();
  setEntertainmentStorageForTests(storage);
  for (const reservation of reservations) {
    await storage.saveManualReservation(reservation, {
      id: `seed-${reservation.id}`, reservationId: reservation.id,
      action: "manual-create", createdAt: START, changedBy: "test", changeSource: "manual",
      previousValue: null, newValue: reservation, reason: "Redacted test fixture",
      intentionalConflict: false,
    });
  }
  return storage;
}

afterEach(() => setEntertainmentStorageForTests(null));

describe("floor-plan shared bowling alignment", () => {
  it("uses the same nearest-area assignment during ordinary schedule sync", () => {
    const source: EntertainmentSourceEvent = {
      tripleseatEventId: "source-a", tripleseatBookingId: null,
      eventName: "Redacted schedule event", localDate: DATE,
      eventStartAt: START, eventEndAt: END, status: "DEFINITE",
      rooms: [{ id: "main-room", name: "Main Dining Room" }], categoryNames: [],
      sourceUpdatedAt: START, noteCount: 0,
      items: [{ sourceId: "bowling-line", name: "Duckpin Bowling", quantity: 2,
        startAt: START, endAt: END, description: "2 bowling lanes", categoryName: "Bowling" }],
    };
    const first = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
    const expected = selectEntertainmentResources("main-dining", "bowling", 2).sort();
    expect(first.reservations.map((item) => item.resourceId).sort()).toEqual(expected);
    const next = buildEntertainmentSchedule({
      sourceEvents: [source], localEvents: [], existingReservations: first.reservations,
    });
    const merged = mergeReservationsForSync(first.reservations, next.reservations);
    expect(merged.map((item) => item.resourceId).sort()).toEqual(expected);
    expect(merged.every((item) => !item.manualOverride)).toBe(true);
  });

  it("moves automatic lanes to the closest block without converting them to manual assignments", async () => {
    const owner = event("event-a");
    const original = [lane("lane-a", owner, 1), lane("lane-b", owner, 2)];
    const storage = await seed(original);

    expect(await alignGeneratedEntertainment(plan([owner]), original)).toBeNull();
    const updated = await Promise.all(original.map((item) => storage.getReservation(item.id)));
    expect(updated.map((item) => item!.resourceId).sort()).toEqual(
      selectEntertainmentResources("main-dining", "bowling", 2).sort(),
    );
    expect(updated.every((item) => item!.autoAssigned && !item!.manualOverride)).toBe(true);

    const moved = { ...owner, contractedAreaIds: ["big-show-karaoke"] };
    await alignGeneratedEntertainment(plan([moved]), updated as EntertainmentReservation[]);
    expect((await storage.getReservation("lane-a"))?.manualOverride).toBe(false);
    expect((await storage.getReservation("lane-a"))?.resourceId).toBe("bowling-1");
  });

  it("keeps an already-selected lane to avoid an intermediate same-group collision", async () => {
    const owner = event("event-a");
    const preferred = selectEntertainmentResources("main-dining", "bowling", 2);
    const keptNumber = Number(preferred[0].split("-")[1]);
    const original = [lane("lane-a", owner, 1), lane("lane-b", owner, keptNumber)];
    const storage = await seed(original);

    await expect(alignGeneratedEntertainment(plan([owner]), original)).resolves.toBeNull();
    expect((await storage.getReservation("lane-b"))?.resourceId).toBe(preferred[0]);
    expect((await storage.getReservation("lane-a"))?.resourceId).toBe(preferred[1]);
  });

  it("uses updated availability for later parties and permits reuse at non-overlapping times", async () => {
    const first = event("event-a");
    const second = event("event-b");
    const later = { ...event("event-c"), startAt: END, endAt: "2026-10-20T22:00:00-04:00" };
    const original = [
      lane("lane-a", first, 1), lane("lane-b", second, 2),
      lane("lane-c", later, 3, { startAt: later.startAt!, endAt: later.endAt! }),
    ];
    const storage = await seed(original);

    await expect(alignGeneratedEntertainment(plan([first, second, later]), original)).resolves.toBeNull();
    const a = (await storage.getReservation("lane-a"))!;
    const b = (await storage.getReservation("lane-b"))!;
    const c = (await storage.getReservation("lane-c"))!;
    expect(a.resourceId).not.toBe(b.resourceId);
    expect(c.resourceId).toBe(a.resourceId);
  });

  it("preserves explicit/manual lane choices and their assignment mode when synchronizing color", async () => {
    const owner = event("event-a");
    const original = [lane("manual-a", owner, 1, {
      manualOverride: true, autoAssigned: false, eventColor: "#7C3AED", colorSource: "manual",
    }), lane("auto-b", owner, 2)];
    const storage = await seed(original);
    await alignGeneratedEntertainment(plan([owner]), original);
    expect(await storage.getReservation("manual-a")).toMatchObject({
      resourceId: "bowling-1", manualOverride: true, autoAssigned: false, eventColor: owner.color,
    });
  });

  it("does not assume Main Dining when a contracted section is unresolved", async () => {
    const owner = event("event-a", "unknown-section");
    const original = [lane("lane-a", owner, 1)];
    const storage = await seed(original);
    expect(await alignGeneratedEntertainment(plan([owner]), original)).toContain("no verified reserved seating area");
    expect((await storage.getReservation("lane-a"))?.resourceId).toBe("bowling-1");
  });

  it("still marks an actual staff edit as manual", async () => {
    const owner = event("event-a");
    const original = lane("lane-a", owner, 1);
    const storage = await seed([original]);
    await updateEntertainmentReservation(original.id, {
      operatingDate: DATE, eventId: owner.id, eventName: owner.name,
      resourceId: "bowling-2", startAt: START, endAt: END,
      eventColor: owner.color, notes: "", reason: "Staff choice", forceConflict: false,
    }, { storage });
    expect((await storage.getReservation(original.id))?.manualOverride).toBe(true);
  });
});
