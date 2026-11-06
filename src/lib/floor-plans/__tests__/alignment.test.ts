import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryEntertainmentStorage,
  setEntertainmentStorageForTests,
} from "@/lib/entertainment/storage";
import { getEntertainmentResource } from "@/lib/entertainment/resources";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import { updateEntertainmentReservation } from "@/lib/entertainment/sync";
import { buildEntertainmentSchedule, detectEntertainmentConflicts, mergeReservationsForSync } from "@/lib/entertainment/domain";
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

function bowlingSource(
  id: string,
  room: string,
  description: string,
  quantity: number,
  startAt = START,
  endAt = END,
): EntertainmentSourceEvent {
  return {
    tripleseatEventId: id, tripleseatBookingId: null,
    eventName: `Redacted ${id}`, localDate: DATE,
    eventStartAt: startAt, eventEndAt: endAt, status: "DEFINITE",
    rooms: [{ id: room, name: room }], categoryNames: [],
    sourceUpdatedAt: START, noteCount: 0,
    items: [{ sourceId: "bowling-line", name: "Duckpin Bowling", quantity,
      startAt, endAt, description, categoryName: "Bowling" }],
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
    const source = bowlingSource("source-a", "Main Dining Room", "2 bowling lanes", 2);
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

  it.each([
    ["2026-10-20T19:45:00-04:00", "2026-10-20T22:00:00-04:00", false],
    [END, "2026-10-20T22:00:00-04:00", true],
    ["2026-10-20T17:00:00-04:00", START, true],
  ])("honors a saved Lane 1 booking from %s to %s during VIP assignment (reusable=%s)", (startAt, endAt, reusable) => {
    const source = bowlingSource("source-vip", "VIP 1", "5 bowling lanes", 5);
    const occupied = lane("saved-lane-1", event("other-event"), 1, { startAt, endAt });
    const built = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [], existingReservations: [occupied] });
    const bowling = built.reservations.filter((item) => item.resourceCategory === "bowling");
    expect(bowling).toHaveLength(5);
    expect(bowling.some((item) => item.resourceId === "bowling-1")).toBe(reusable);
    expect(detectEntertainmentConflicts([occupied, ...bowling])).toEqual([]);
  });

  it("leaves Lane 1 for a later-sorted event with an overlapping explicit contract assignment", () => {
    const vip = bowlingSource("source-vip", "VIP 2", "5 bowling lanes", 5);
    const explicit = bowlingSource("source-explicit", "Main Dining Room", "Bowling Lane 1", 1,
      "2026-10-20T19:00:00-04:00", "2026-10-20T21:00:00-04:00");
    const built = buildEntertainmentSchedule({ sourceEvents: [vip, explicit], localEvents: [] });
    const bowling = built.reservations.filter((item) => item.resourceCategory === "bowling");
    const vipLanes = bowling.filter((item) => item.tripleseatEventId === vip.tripleseatEventId);
    expect(vipLanes).toHaveLength(5);
    expect(vipLanes.map((item) => item.resourceId)).not.toContain("bowling-1");
    expect(bowling.filter((item) => item.tripleseatEventId === explicit.tripleseatEventId)).toEqual([
      expect.objectContaining({ resourceId: "bowling-1", autoAssigned: false }),
    ]);
    expect(detectEntertainmentConflicts(bowling)).toEqual([]);
  });

  it("lets VIP use Lane 1 when staff moved a later exact Lane 1 booking to Lane 3", () => {
    const vip = bowlingSource("source-vip", "VIP 1", "5 bowling lanes", 5);
    const explicit = bowlingSource("source-explicit", "Main Dining Room", "Bowling Lane 1", 1,
      "2026-10-20T19:00:00-04:00", "2026-10-20T21:00:00-04:00");
    const original = buildEntertainmentSchedule({ sourceEvents: [explicit], localEvents: [] }).reservations[0];
    expect(original).toMatchObject({ resourceId: "bowling-1", autoAssigned: false });
    const override = { ...original, resourceId: "bowling-3", resourceName: "Bowling Lane 3", manualOverride: true };
    const existingReservations = [override];
    const built = buildEntertainmentSchedule({ sourceEvents: [vip, explicit], localEvents: [], existingReservations });
    const bowling = mergeReservationsForSync(existingReservations, built.reservations, undefined, built.events)
      .filter((item) => item.active && item.resourceCategory === "bowling");
    expect(bowling.filter((item) => item.tripleseatEventId === vip.tripleseatEventId).map((item) => item.resourceId)).toEqual([
      "bowling-1", "bowling-2", "bowling-4", "bowling-5", "bowling-6",
    ]);
    expect(bowling.find((item) => item.id === override.id)).toMatchObject({
      resourceId: "bowling-3", sourceResourceId: "bowling-1", manualOverride: true,
    });
    expect(detectEntertainmentConflicts(bowling)).toEqual([]);
  });

  it("retains a synced staff override in a nonfirst slot without assigning Lane 1 twice", () => {
    const source = bowlingSource("source-vip", "VIP 1", "2 bowling lanes", 2);
    const owner = event(source.tripleseatEventId, "vip-1");
    const first = lane("auto-first", owner, 4, { syncKey: `${source.tripleseatEventId}:bowling-line:0`, sourceReference: "bowling-line" });
    const override = lane("staff-second", owner, 1, {
      syncKey: `${source.tripleseatEventId}:bowling-line:1`, sourceReference: "bowling-line",
      manualOverride: true, sourceResourceId: "bowling-5",
    });
    const existingReservations = [first, override];
    const built = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [], existingReservations });
    const bowling = mergeReservationsForSync(existingReservations, built.reservations, undefined, built.events)
      .filter((item) => item.active && item.resourceCategory === "bowling");
    expect(bowling).toHaveLength(2);
    expect(bowling.find((item) => item.id === override.id)).toMatchObject({ resourceId: "bowling-1", manualOverride: true });
    expect(bowling.filter((item) => item.resourceId === "bowling-1")).toHaveLength(1);
    expect(detectEntertainmentConflicts(bowling)).toEqual([]);
  });

  it("realigns a saved automatic VIP block from lanes 3–7 to 1–5 without changing booking details", async () => {
    const owner = event("event-vip", "vip-1");
    const original = [3, 4, 5, 6, 7].map((number) => lane(`lane-${number}`, owner, number));
    const storage = await seed(original);

    await expect(alignGeneratedEntertainment(plan([owner]), original)).resolves.toBeNull();
    const updated = await Promise.all(original.map((item) => storage.getReservation(item.id)));
    expect(updated.map((item) => item?.resourceId).sort()).toEqual([
      "bowling-1", "bowling-2", "bowling-3", "bowling-4", "bowling-5",
    ]);
    expect(updated.slice(0, 3)).toEqual(original.slice(0, 3));
    for (const item of updated) {
      expect(item).toMatchObject({ startAt: START, endAt: END, autoAssigned: true, manualOverride: false });
    }
  });

  it("keeps numbered VIP contract lanes through schedule build and floor-plan alignment", async () => {
    const source = bowlingSource("source-vip", "VIP 1", "Bowling Lanes 8 through 9", 2);
    const { reservations } = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
    const bowling = reservations.filter((item) => item.resourceCategory === "bowling");
    expect(bowling).toEqual([8, 9].map((number) =>
      expect.objectContaining({ resourceId: `bowling-${number}`, autoAssigned: false }),
    ));
    const owner = { ...event(source.tripleseatEventId, "vip-1"), color: bowling[0].eventColor };
    const storage = await seed(bowling);

    await expect(alignGeneratedEntertainment(plan([owner]), bowling)).resolves.toBeNull();
    expect(await Promise.all(bowling.map((item) => storage.getReservation(item.id)))).toEqual(bowling);
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

  it.each([
    ["2026-10-20T19:45:00-04:00", false],
    [END, true],
    ["2026-10-20T20:15:00-04:00", true],
  ])("aligns entertainment using exact booked times (%s, lane reusable=%s)", async (startAt, reusable) => {
    const first = event("event-a");
    const second = event("event-b");
    const later = { ...event("event-c"), startAt, endAt: "2026-10-20T22:00:00-04:00" };
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
    expect(c.resourceId === a.resourceId).toBe(reusable);
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
