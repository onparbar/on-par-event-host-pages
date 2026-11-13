import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEntertainmentSchedule } from "@/lib/entertainment/domain";
import { deterministicEventColor } from "@/lib/entertainment/resources";
import { MemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { getEntertainmentDay } from "@/lib/entertainment/sync";
import type { EntertainmentEventSnapshot, EntertainmentReservation, EntertainmentSourceEvent } from "@/lib/entertainment/types";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { floorPlanEventColorsAreDistinct } from "../configuration/colors";
import { getFloorPlanDay } from "../service";
import { MemoryFloorPlanStorage } from "../storage";
import { FLOOR_PLAN_RULE_VERSION, type FloorPlanDocument, type FloorPlanEvent } from "../types";

const DATE = "2026-11-11";
const NOW = "2026-10-26T20:00:00.000Z";
const START = "2026-11-11T21:00:00.000Z";
const END = "2026-11-11T23:00:00.000Z";
const IDS = ["63534616", "62528504", "63122949"];
const SAVED_COLORS = ["#B45309", "#1D4ED8", "#0F766E"];

function sample(id: string, index: number): EntertainmentSourceEvent {
  return {
    tripleseatEventId: id, tripleseatBookingId: null, eventName: `Redacted party ${index + 1}`,
    localDate: DATE, eventStartAt: START, eventEndAt: END, status: "DEFINITE",
    rooms: [], categoryNames: ["Bowling"], sourceUpdatedAt: NOW, noteCount: 0,
    items: [{ sourceId: `line:${id}`, name: `Bowling Lane ${index + 1}`, description: `Bowling Lane ${index + 1}`,
      categoryName: "Bowling", quantity: 1, startAt: START, endAt: END }],
  };
}

function floorEvent(id: string, index: number, color: string): FloorPlanEvent {
  return {
    id: `floor-event:${id}`, floorPlanId: `floor:${DATE}`, tripleseatEventId: id,
    name: `Redacted party ${index + 1}`, status: "DEFINITE", guestCount: 20,
    startAt: START, endAt: END, contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color,
    beoLastModifiedAt: NOW, fullBuyout: false,
    source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
  };
}

async function fixture(options: {
  floorColors?: string[];
  manualSnapshot?: { index: number; color: string };
  manualReservation?: { index: number; color: string };
} = {}) {
  const built = buildEntertainmentSchedule({ sourceEvents: IDS.map(sample), localEvents: [], now: NOW });
  const events = built.events.map((event, index): EntertainmentEventSnapshot => ({
    ...event,
    ...(options.manualSnapshot?.index === index ? { eventColor: options.manualSnapshot.color, colorSource: "manual" } : {}),
  }));
  const reservations = built.reservations.map((reservation, index): EntertainmentReservation => ({
    ...reservation, manualOverride: true, autoAssigned: false, startTimeSource: "staff-override",
    notes: "Retain the staff resource and exact times.",
    ...(options.manualReservation?.index === index ? { eventColor: options.manualReservation.color, colorSource: "manual" } : {}),
  }));
  const entertainmentStorage = new MemoryEntertainmentStorage();
  await entertainmentStorage.saveSync({
    date: DATE, events, reservations, existingReservations: [],
    stats: { eventsProcessed: events.length, reservationsCreated: reservations.length,
      reservationsUpdated: 0, warningsCreated: 0, conflictsFound: 0 },
  });
  const floorStorage = new MemoryFloorPlanStorage();
  const plan: FloorPlanDocument = {
    id: `floor:${DATE}`, eventDate: DATE, status: "Draft", version: 0, ruleVersion: FLOOR_PLAN_RULE_VERSION,
    lastTripleseatSyncAt: NOW, createdAt: NOW, updatedAt: NOW, approvedAt: null, approvedBy: null,
    events: IDS.map((id, index) => floorEvent(id, index, options.floorColors?.[index] ?? "#7C3AED")),
    reservations: IDS.map((id, index) => ({
      id: `assignment:${id}`, floorPlanEventId: `floor-event:${id}`, areaId: "vip-1", reservationType: "custom",
      startAt: "2026-11-11T21:30:00.000Z", endAt: "2026-11-11T22:30:00.000Z", label: `Staff note ${index + 1}`,
      source: "manual", lockedByUser: true, timingSource: "staff-override", placementOverride: true,
      customGeometry: { x: 100 + index * 100, y: 200, width: 80, height: 40 },
    })),
  };
  await floorStorage.save(plan, "Seed redacted saved floor plan.");
  const adapter: TripleseatAdapter = {
    sourceMode: "live", fetchEventsForDate: vi.fn(async () => []),
    fetchEventPlansForRange: vi.fn(async () => []), fetchEntertainmentEventsForDate: vi.fn(async () => []),
    fetchEventDateById: vi.fn(async () => null),
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
  };
  const vipPrepClient = { configured: false, fetchRange: vi.fn(async () => { throw new Error("Disabled test provider."); }) };
  const network = vi.fn(async () => { throw new Error("Unexpected network access in memory integration test."); });
  vi.stubGlobal("fetch", network);
  setEntertainmentStorageForTests(entertainmentStorage);
  setEventPlanStorageForTests(createMemoryEventPlanStorage());
  setTripleseatAdapterForTests(adapter);
  const before = {
    entertainment: await entertainmentStorage.getDay(DATE), floor: await floorStorage.get(DATE),
    revisions: await floorStorage.revisions(plan.id),
    audits: await Promise.all(reservations.map((reservation) => entertainmentStorage.getAudit(reservation.id))),
  };
  const writes = [
    vi.spyOn(entertainmentStorage, "saveSync"), vi.spyOn(entertainmentStorage, "saveEventSnapshot"),
    vi.spyOn(entertainmentStorage, "saveManualReservation"), vi.spyOn(entertainmentStorage, "saveContractEvidence"),
    vi.spyOn(entertainmentStorage, "startSync"), vi.spyOn(floorStorage, "save"),
  ];
  const readEntertainment = () => getEntertainmentDay(DATE, {
    storage: entertainmentStorage, adapter, localEvents: [], vipPrepClient, floorPlanStorage: floorStorage,
  });
  const readFloor = () => getFloorPlanDay(DATE, floorStorage, { vipPrepClient });
  const assertUnchanged = async () => {
    expect(await entertainmentStorage.getDay(DATE)).toEqual(before.entertainment);
    expect(await floorStorage.get(DATE)).toEqual(before.floor);
    expect(await floorStorage.revisions(plan.id)).toEqual(before.revisions);
    expect(await Promise.all(reservations.map((reservation) => entertainmentStorage.getAudit(reservation.id)))).toEqual(before.audits);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(adapter.fetchEventsForDate).not.toHaveBeenCalled();
    expect(adapter.fetchEventPlansForRange).not.toHaveBeenCalled();
    expect(adapter.fetchEntertainmentEventsForDate).not.toHaveBeenCalled();
    expect(vipPrepClient.fetchRange).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  };
  return { before, readEntertainment, readFloor, assertUnchanged };
}

afterEach(() => {
  setEntertainmentStorageForTests(null);
  setEventPlanStorageForTests(null);
  setTripleseatAdapterForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saved day event-color read projection", () => {
  it("repairs the November ID collisions immediately without resyncing or changing manual assignments", async () => {
    expect(new Set(IDS.map(deterministicEventColor))).toEqual(new Set(["#7C3AED"]));
    const test = await fixture();
    const day = await test.readEntertainment();
    const repeated = await test.readEntertainment();
    expect(day.events).toHaveLength(3);
    expect(day.reservations).toHaveLength(3);
    expect(new Set(day.events.map((event) => event.eventColor)).size).toBe(3);
    expect(repeated).toEqual(day);
    for (const [index, event] of day.events.entries()) {
      for (const previous of day.events.slice(0, index)) expect(floorPlanEventColorsAreDistinct(event.eventColor, previous.eventColor)).toBe(true);
      expect(day.reservations.find((reservation) => reservation.tripleseatEventId === event.tripleseatEventId)?.eventColor).toBe(event.eventColor);
      const original = test.before.entertainment.events.find((row) => row.eventId === event.eventId)!;
      expect({ ...event, eventColor: original.eventColor }).toEqual(original);
    }
    for (const reservation of day.reservations) {
      const original = test.before.entertainment.reservations.find((row) => row.id === reservation.id)!;
      expect({ ...reservation, eventColor: original.eventColor }).toEqual(original);
    }
    await test.assertUnchanged();
  });

  it("returns matching floor-plan and schedule colors without changing saved seating, timing, locks or revisions", async () => {
    const test = await fixture();
    const day = await test.readEntertainment();
    const floor = await test.readFloor();
    expect(floor.entertainmentReservations).toEqual(day.reservations);
    for (const event of floor.plan.events) {
      expect(event.color).toBe(day.events.find((row) => row.tripleseatEventId === event.tripleseatEventId)?.eventColor);
      expect(day.floorPlanEventColors?.[event.id]).toBe(event.color);
    }
    expect(floor.plan.reservations).toEqual(test.before.floor!.reservations);
    expect(floor.plan.id).toBe(test.before.floor!.id);
    expect(floor.plan.version).toBe(test.before.floor!.version);
    expect(floor.plan.status).toBe(test.before.floor!.status);
    expect(floor.plan.updatedAt).toBe(test.before.floor!.updatedAt);
    await test.assertUnchanged();
  });

  it("retains distinct saved floor-plan color choices in both views", async () => {
    const test = await fixture({ floorColors: SAVED_COLORS });
    const day = await test.readEntertainment();
    const floor = await test.readFloor();
    for (const [index, id] of IDS.entries()) {
      expect(day.events.find((event) => event.tripleseatEventId === id)?.eventColor).toBe(SAVED_COLORS[index]);
      expect(floor.plan.events.find((event) => event.tripleseatEventId === id)?.color).toBe(SAVED_COLORS[index]);
    }
    await test.assertUnchanged();
  });

  it("retains a distinct explicit staff color over an older floor-plan choice in both views", async () => {
    const test = await fixture({ floorColors: SAVED_COLORS, manualSnapshot: { index: 1, color: "#BE123C" } });
    const day = await test.readEntertainment();
    const floor = await test.readFloor();
    expect(day.events.find((event) => event.tripleseatEventId === IDS[1])?.eventColor).toBe("#BE123C");
    expect(day.reservations.find((row) => row.tripleseatEventId === IDS[1])?.eventColor).toBe("#BE123C");
    expect(floor.plan.events.find((event) => event.tripleseatEventId === IDS[1])?.color).toBe("#BE123C");
    for (const index of [0, 2]) expect(day.events.find((event) => event.tripleseatEventId === IDS[index])?.eventColor).toBe(SAVED_COLORS[index]);
    await test.assertUnchanged();
  });

  it("retains a distinct reservation-level staff color when its saved event snapshot is stale", async () => {
    const test = await fixture({ floorColors: SAVED_COLORS, manualReservation: { index: 1, color: "#BE123C" } });
    const day = await test.readEntertainment();
    const floor = await test.readFloor();
    expect(day.events.find((event) => event.tripleseatEventId === IDS[1])?.eventColor).toBe("#BE123C");
    expect(day.reservations.find((row) => row.tripleseatEventId === IDS[1])?.eventColor).toBe("#BE123C");
    expect(floor.plan.events.find((event) => event.tripleseatEventId === IDS[1])?.color).toBe("#BE123C");
    await test.assertUnchanged();
  });
});
