import { describe, expect, it } from "vitest";
import { projectDayEventColors } from "@/lib/floor-plans/event-colors";
import { floorPlanEventColorsAreDistinct } from "@/lib/floor-plans/configuration/colors";
import type { FloorPlanEvent } from "@/lib/floor-plans/types";
import { numericVipEventId } from "@/lib/vip-prep/identity";
import { buildEntertainmentSchedule } from "../domain";
import { deterministicEventColor } from "../resources";
import type { EntertainmentEventSnapshot, EntertainmentSourceEvent } from "../types";

const DATE = "2026-11-11";
const START = "2026-11-11T21:00:00.000Z";
const END = "2026-11-11T23:00:00.000Z";
const NOW = "2026-10-26T20:00:00.000Z";
const IDS = ["63534616", "62528504", "63122949"];

function sample(id: string, color = "#7C3AED") {
  const source: EntertainmentSourceEvent = {
    tripleseatEventId: id, tripleseatBookingId: null, eventName: `Redacted ${id}`,
    localDate: DATE, eventStartAt: START, eventEndAt: END, status: "DEFINITE",
    rooms: [], categoryNames: ["Bowling"], sourceUpdatedAt: NOW, noteCount: 0,
    sourceSystem: id.startsWith("vip-") ? "vip-prep" : "tripleseat",
    items: [{ sourceId: `line:${id}`, name: "Bowling Lane 1", description: "Bowling Lane 1", categoryName: "Bowling", quantity: 1, startAt: START, endAt: END }],
  };
  const built = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [], now: NOW });
  const event = { ...built.events[0], eventColor: color };
  const reservation = { ...built.reservations[0], eventColor: color };
  const floor: FloorPlanEvent = {
    id: `floor-event:${id}`, floorPlanId: `floor:${DATE}`, tripleseatEventId: id,
    name: source.eventName, status: "DEFINITE", guestCount: 20, startAt: START, endAt: END,
    contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color, beoLastModifiedAt: NOW, fullBuyout: false,
    source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
  };
  return { event, reservation, floor };
}

function eventColors(events: readonly EntertainmentEventSnapshot[]) {
  return Object.fromEntries(events.map((event) => [event.tripleseatEventId, event.eventColor]));
}

describe("shared day-level floor-plan and entertainment event colors", () => {
  it("resolves the three November screenshot ID collisions in every view", () => {
    const rows = IDS.map((id) => sample(id));
    expect(new Set(IDS.map(deterministicEventColor))).toEqual(new Set(["#7C3AED"]));
    const projected = projectDayEventColors(rows.map((row) => row.floor), rows.map((row) => row.event), rows.map((row) => row.reservation));
    const colors = eventColors(projected.events);
    expect(new Set(Object.values(colors)).size).toBe(3);
    for (const [index, event] of projected.events.entries()) {
      expect(projected.floorEvents.find((floor) => floor.tripleseatEventId === event.tripleseatEventId)?.color).toBe(event.eventColor);
      expect(projected.reservations.find((row) => row.tripleseatEventId === event.tripleseatEventId)?.eventColor).toBe(event.eventColor);
      for (const previous of projected.events.slice(0, index)) expect(floorPlanEventColorsAreDistinct(event.eventColor, previous.eventColor)).toBe(true);
    }
  });

  it("projects existing stale colors without mutating source objects or operational metadata", () => {
    const rows = IDS.map((id) => sample(id));
    rows[1].reservation = { ...rows[1].reservation, manualOverride: true, startTimeSource: "staff-override",
      resourceId: "bowling-8", resourceName: "Bowling Lane 8", startAt: "2026-11-11T21:30:00.000Z",
      endAt: "2026-11-11T23:30:00.000Z", notes: "Keep staff choice", hasSourceUpdate: true };
    const floorEvents = rows.map((row) => row.floor);
    const events = rows.map((row) => row.event);
    const reservations = rows.map((row) => row.reservation);
    const before = structuredClone({ floorEvents, events, reservations });
    const projected = projectDayEventColors(floorEvents, events, reservations);
    expect({ floorEvents, events, reservations }).toEqual(before);
    for (const [index, row] of projected.floorEvents.entries()) expect({ ...row, color: before.floorEvents[index].color }).toEqual(before.floorEvents[index]);
    for (const [index, row] of projected.events.entries()) expect({ ...row, eventColor: before.events[index].eventColor }).toEqual(before.events[index]);
    for (const [index, row] of projected.reservations.entries()) expect({ ...row, eventColor: before.reservations[index].eventColor }).toEqual(before.reservations[index]);
  });

  it("preserves distinct saved floor-plan choices instead of replacing them with fallback colors", () => {
    const rows = IDS.map((id) => sample(id));
    const saved = rows.map((row, index) => ({ ...row.floor, color: ["#B45309", "#1D4ED8", "#0F766E"][index] }));
    const projected = projectDayEventColors(rows.map((row) => row.floor), rows.map((row) => row.event), rows.map((row) => row.reservation), saved);
    expect(eventColors(projected.events)).toEqual(Object.fromEntries(saved.map((row) => [row.tripleseatEventId, row.color])));
  });

  it("does not let a newly arriving colliding party steal existing saved colors", () => {
    const existing = [sample(IDS[0]), sample(IDS[2], "#1D4ED8")];
    const saved = existing.map((row) => row.floor);
    const newcomer = sample(IDS[1]);
    const rows = [newcomer, ...existing];
    const projected = projectDayEventColors(rows.map((row) => row.floor), rows.map((row) => row.event), rows.map((row) => row.reservation), saved);
    const colors = eventColors(projected.events);
    expect(colors[IDS[0]]).toBe("#7C3AED");
    expect(colors[IDS[2]]).toBe("#1D4ED8");
    expect(new Set(Object.values(colors)).size).toBe(3);
    expect(projected.floorEvents[0].color).toBe(colors[IDS[1]]);
    expect(projected.reservations[0].eventColor).toBe(colors[IDS[1]]);
  });

  it("gives an explicit manual entertainment choice priority and shares it with the floor plan", () => {
    const first = sample(IDS[0]);
    const second = sample(IDS[1]);
    first.event = { ...first.event, eventColor: "#B45309", colorSource: "manual" };
    const projected = projectDayEventColors([first.floor, second.floor], [first.event, second.event], [first.reservation, second.reservation], [{ ...first.floor, color: "#1D4ED8" }]);
    expect(projected.events[0].eventColor).toBe("#B45309");
    expect(projected.floorEvents[0].color).toBe("#B45309");
    expect(projected.reservations[0].eventColor).toBe("#B45309");
    expect(projected.events[1].eventColor).not.toBe("#B45309");
  });

  it.each([false, true])("uses a manual reservation color only when its snapshot has no manual choice: %s", (snapshotManual) => {
    const first = sample(IDS[0]);
    if (snapshotManual) first.event = { ...first.event, eventColor: "#1D4ED8", colorSource: "manual" };
    first.reservation = { ...first.reservation, eventColor: "#B45309", colorSource: "manual", manualOverride: true };
    const projected = projectDayEventColors([first.floor], [first.event], [first.reservation]);
    const expected = snapshotManual ? "#1D4ED8" : "#B45309";
    expect(projected.events[0].eventColor).toBe(expected);
    expect(projected.floorEvents[0].color).toBe(expected);
    expect(projected.reservations[0].eventColor).toBe(expected);
  });

  it("repairs duplicated legacy manual colors rather than preserving a same-color day", () => {
    const rows = IDS.map((id) => sample(id));
    const events = rows.map((row) => ({ ...row.event, colorSource: "manual" as const }));
    const projected = projectDayEventColors(rows.map((row) => row.floor), events, rows.map((row) => row.reservation), rows.map((row) => row.floor));
    expect(new Set(projected.events.map((event) => event.eventColor)).size).toBe(3);
    expect(projected.events.map((event) => event.colorSource)).toEqual(["manual", "manual", "manual"]);
  });

  it("repairs existing entertainment data even when no floor-plan document exists", () => {
    const rows = IDS.map((id) => sample(id));
    const events = rows.map((row) => row.event);
    const reservations = rows.map((row) => row.reservation);
    const projected = projectDayEventColors([], events, reservations);
    const withFloor = projectDayEventColors(rows.map((row) => row.floor), events, reservations);
    expect(eventColors(projected.events)).toEqual(eventColors(withFloor.events));
    expect(new Set(projected.reservations.map((row) => row.eventColor)).size).toBe(3);
  });

  it("does not let a fresh floor-only party change the shared entertainment palette", () => {
    const existing = [sample(IDS[0]), sample(IDS[2])];
    const newcomer = sample(IDS[1]);
    const events = existing.map((row) => row.event);
    const reservations = existing.map((row) => row.reservation);
    const entertainment = projectDayEventColors([], events, reservations);
    const floor = projectDayEventColors([newcomer.floor, ...existing.map((row) => row.floor)], events, reservations);
    expect(eventColors(floor.events)).toEqual(eventColors(entertainment.events));
    for (const event of entertainment.events) {
      expect(floor.floorEvents.find((row) => row.tripleseatEventId === event.tripleseatEventId)?.color).toBe(event.eventColor);
    }
    expect(new Set(floor.floorEvents.map((row) => row.color)).size).toBe(3);
  });

  it("keeps canonical event colors stable across ordering and name changes", () => {
    const rows = IDS.map((id) => sample(id));
    const first = projectDayEventColors(rows.map((row) => row.floor), rows.map((row) => row.event), rows.map((row) => row.reservation));
    const reversed = [...rows].reverse();
    const second = projectDayEventColors(reversed.map((row) => ({ ...row.floor, name: "Renamed party" })), reversed.map((row) => ({ ...row.event, eventName: "Renamed party" })), reversed.map((row) => ({ ...row.reservation, eventName: "Renamed party" })));
    expect(eventColors(second.events)).toEqual(eventColors(first.events));
    expect(new Set(second.events.map((event) => event.eventColor)).size).toBe(3);
  });

  it("uses one color for an explicitly linked VIP/BEO party, not a same-name unrelated event", () => {
    const corporate = sample(IDS[0]);
    const vip = sample("vip-explicit-party");
    const unrelated = sample(IDS[1]);
    vip.event = { ...vip.event, sourceSnapshot: { ...vip.event.sourceSnapshot, linkedTripleseatEventIds: [IDS[0]] } };
    vip.floor = { ...vip.floor, source: { ...vip.floor.source, sourceEventIds: ["vip-explicit-party", IDS[0]], verifiedSourceEventIds: ["vip-explicit-party", IDS[0]] } };
    unrelated.event = { ...unrelated.event, eventName: corporate.event.eventName };
    unrelated.floor = { ...unrelated.floor, name: corporate.floor.name };
    const projected = projectDayEventColors([vip.floor, unrelated.floor], [corporate.event, vip.event, unrelated.event], [corporate.reservation, vip.reservation, unrelated.reservation]);
    const colors = eventColors(projected.events);
    expect(colors["vip-explicit-party"]).toBe(colors[IDS[0]]);
    expect(colors[IDS[1]]).not.toBe(colors[IDS[0]]);
    expect(projected.floorEvents[0].color).toBe(colors[IDS[0]]);
    expect(projected.reservations.slice(0, 2).map((row) => row.eventColor)).toEqual([colors[IDS[0]], colors[IDS[0]]]);
  });

  it("keeps linked-family colors identical with and without a fresh unsaved VIP floor row", () => {
    const corporate = sample(IDS[0]);
    const vip = sample("vip-linked-family", "#1D4ED8");
    vip.event = { ...vip.event, sourceSnapshot: { ...vip.event.sourceSnapshot, linkedTripleseatEventIds: [IDS[0]] } };
    vip.floor = { ...vip.floor, source: { ...vip.floor.source, verifiedSourceEventIds: ["vip-linked-family", IDS[0]] } };
    const events = [corporate.event, vip.event];
    const reservations = [corporate.reservation, vip.reservation];
    const entertainment = projectDayEventColors([], events, reservations);
    const floor = projectDayEventColors([vip.floor], events, reservations);
    expect(eventColors(floor.events)).toEqual(eventColors(entertainment.events));
    expect(floor.floorEvents[0].color).toBe(entertainment.events[0].eventColor);
  });

  it("does not merge a canonical VIP with an unrelated event whose numeric legacy hash matches", () => {
    const vip = sample("vip-legacy-party");
    const legacyId = String(numericVipEventId("vip-legacy-party"));
    const corporate = sample(legacyId);
    vip.event = { ...vip.event, localEventId: legacyId };
    vip.reservation = { ...vip.reservation, localEventId: legacyId };
    vip.floor = { ...vip.floor, source: { ...vip.floor.source, sourceEventIds: ["vip-legacy-party", legacyId] } };
    const projected = projectDayEventColors([vip.floor, corporate.floor], [vip.event, corporate.event], [vip.reservation, corporate.reservation]);
    expect(projected.events[0].eventColor).not.toBe(projected.events[1].eventColor);
    expect(projected.reservations[0].eventColor).toBe(projected.events[0].eventColor);
    expect(projected.reservations[1].eventColor).toBe(projected.events[1].eventColor);
  });

  it("does not choose the first party when a VIP link ambiguously points at two independent events", () => {
    const first = sample(IDS[0]);
    const second = sample(IDS[1]);
    const vip = sample("vip-ambiguous-party");
    vip.event = { ...vip.event, sourceSnapshot: { ...vip.event.sourceSnapshot, linkedTripleseatEventIds: [IDS[0], IDS[1]] } };
    const projected = projectDayEventColors([first.floor, second.floor], [first.event, second.event, vip.event], [first.reservation, second.reservation, vip.reservation]);
    const colors = eventColors(projected.events);
    expect(new Set(Object.values(colors)).size).toBe(3);
    expect(colors["vip-ambiguous-party"]).not.toBe(colors[IDS[0]]);
    expect(colors["vip-ambiguous-party"]).not.toBe(colors[IDS[1]]);
    expect(projected.reservations[2].eventColor).toBe(colors["vip-ambiguous-party"]);
  });

  it("does not repeat colors when the day has more events than either original palette", () => {
    const rows = Array.from({ length: 20 }, (_, index) => sample(String(64000000 + index)));
    const projected = projectDayEventColors(rows.map((row) => row.floor), rows.map((row) => row.event), rows.map((row) => row.reservation));
    expect(new Set(projected.events.map((event) => event.eventColor)).size).toBe(20);
    expect(projected.events.every((event) => /^#[0-9A-F]{6}$/.test(event.eventColor))).toBe(true);
    for (const [index, event] of projected.events.entries()) {
      for (const previous of projected.events.slice(0, index)) expect(floorPlanEventColorsAreDistinct(event.eventColor, previous.eventColor)).toBe(true);
    }
    for (const row of projected.floorEvents) expect(row.color).toBe(eventColors(projected.events)[row.tripleseatEventId]);
  });
});
