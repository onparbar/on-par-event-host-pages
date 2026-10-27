import { describe, expect, it } from "vitest";
import { buildEntertainmentSchedule, mergeReservationsForSync } from "../domain";
import { itineraryEntertainmentFromReservations } from "@/lib/itineraries/entertainment";
import { groupEntertainmentTimingItems } from "../timing";
import type { EntertainmentReservation, EntertainmentSourceEvent, EntertainmentSourceItem } from "../types";

const DATE = "2026-11-17";
const START = "2026-11-17T22:00:00.000Z";
const NOW = "2026-10-26T21:00:00.000Z";

function row(sourceId: string, name: string, categoryName: string | null, quantity: number | null = null): EntertainmentSourceItem {
  return { sourceId, name, categoryName, quantity, description: null, startAt: null, endAt: null };
}

function schedule(items: EntertainmentSourceItem[], existingReservations: EntertainmentReservation[] = []) {
  const source: EntertainmentSourceEvent = {
    tripleseatEventId: "redacted-november-birthday", tripleseatBookingId: null,
    eventName: "Redacted November birthday", localDate: DATE, eventStartAt: START,
    eventEndAt: "2026-11-18T01:00:00.000Z", status: "DEFINITE",
    rooms: [{ id: null, name: "Main Dining Room" }], items,
    categoryNames: [...new Set(items.flatMap((item) => item.categoryName ?? []))], sourceUpdatedAt: NOW, noteCount: 0,
  };
  return buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [{
    id: source.tripleseatEventId, name: source.eventName, date: DATE, color: "#1D4ED8",
    rooms: ["Main Dining Room"], entertainment: [],
  }], existingReservations, now: NOW });
}

describe("parent contract rentals and their purchased duration details", () => {
  it("keeps each one-hour activity from the full redacted November contract without losing parent quantities", () => {
    const items = [
      row("bowling-parent", "Duckpin Bowling Lanes", "Bowling", 1),
      row("bowling-base", "1 Hour Bowling Lane Rental - Sunday-Thursday (6 players/lane)", "Bowling"),
      row("pool-parent", "Pool Tables", "Pool Tables", 1),
      row("pool-base", "1 Hour Pool Table Rental - Sunday-Thursday", "Pool Tables"),
      row("darts-parent", "Dartsee-Darts", "Darts", 1),
      row("darts-base", "1 Hour Dart Lane Rental - Sunday-Thursday (8 players/lane)", "Darts"),
      row("golf", "Mini Golf", "Mini Golf", 1),
    ];
    const before = structuredClone(items);
    const built = schedule(items);
    expect(built.reservations).toHaveLength(3);
    expect(built.reservations.map((reservation) => reservation.resourceCategory).sort()).toEqual(["bowling", "darts", "pool"]);
    for (const reservation of built.reservations) expect(reservation).toMatchObject({
      startAt: START, endAt: "2026-11-17T23:00:00.000Z", contractedDurationMinutes: 60,
      startTimeSource: "event-start-default",
    });
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
    expect(built.events[0].sourceSnapshot.items.find((item) => item.sourceId === "golf")?.quantity).toBe(1);
    expect(itineraryEntertainmentFromReservations(built.reservations).map((item) => item.duration)).toEqual(["1 hour", "1 hour", "1 hour"]);
    expect(items).toEqual(before);
  });

  it.each([
    ["bowling", "Bowling", "Duckpin Bowling Lanes", "1 Hour Bowling Lane Rental"],
    ["darts", "Darts", "Dartsee-Darts", "1 Hour Dart Lane Rental"],
    ["pool", "Pool Tables", "Pool Tables", "1 Hour Pool Table Rental"],
    ["shuffleboard", "Shuffleboard", "Shuffleboard Tables", "1 Hour Shuffleboard Table Rental"],
  ])("takes %s inventory count from its structured booking parent, not its hour-detail wording", (category, categoryName, name, rental) => {
    const built = schedule([row("parent", name, categoryName, 2), row("base", rental, categoryName)]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.resourceCategory === category && reservation.sourceReference === "parent" && reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW" || issue.code === "SOURCE_DETAILS_UNAVAILABLE")).toEqual([]);
  });

  it.each([
    ["Bowling", "1 Hour Bowling Lane Rental"],
    ["Darts", "1 Hour Dart Lane Rental"],
    ["Pool Tables", "1 Hour Pool Table Rental"],
    ["Shuffleboard", "1 Hour Shuffleboard Table Rental"],
  ])("does not interpret a billed-unit Qty on %s rental detail as six physical resources", (categoryName, rental) => {
    const built = schedule([row("billed-hour", rental, categoryName, 6)]);
    expect(built.reservations).toHaveLength(1);
    expect(built.reservations[0].contractedDurationMinutes).toBe(60);
  });

  it.each([
    ["bowling", "Bowling", "2 Duckpin Bowling Lanes", "1 Hour Bowling Lane Rental - Sunday-Thursday"],
    ["darts", "Darts", "2 Dart Lanes", "1 Hour Dart Lane Rental - Sunday-Thursday"],
    ["pool", "Pool Tables", "2 Pool Tables", "1 Hour Pool Table Rental - Sunday-Thursday"],
    ["shuffleboard", "Shuffleboard", "2 Shuffleboard Tables", "1 Hour Shuffleboard Table Rental - Sunday-Thursday"],
  ])("adds a bare extra hour to %s without increasing its physical resource count", (category, categoryName, name, rental) => {
    const items = [
      row("parent", name, categoryName, 2),
      row("base", rental, categoryName, 2),
      row("extra", "Extra Hour", categoryName, 2),
    ];
    const built = schedule(items);
    expect(built.reservations).toHaveLength(2);
    for (const reservation of built.reservations) expect(reservation).toMatchObject({
      resourceCategory: category, sourceReference: "parent", startAt: START,
      endAt: "2026-11-18T00:00:00.000Z", contractedDurationMinutes: 120,
    });
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
    expect(itineraryEntertainmentFromReservations(built.reservations)).toMatchObject([{ duration: "2 hours" }]);
  });

  it("does not attach an extra hour from a different activity to a preceding bowling rental", () => {
    const built = schedule([
      row("bowling", "2 Duckpin Bowling Lanes for 1 hour", "Bowling", 2),
      row("pool-extra", "Extra Hour", "Pool Tables", 2),
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.resourceCategory === "bowling" && reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not extend every resource when the extra-hour quantity contradicts the base rental", () => {
    const built = schedule([
      row("bowling", "2 Duckpin Bowling Lanes for 1 hour", "Bowling", 2),
      row("extra", "Extra Hour of Bowling", "Bowling", 1),
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it.each([
    ["bowling", "Duckpin Bowling Lanes", "1 Hour Bowling Lane Rental"],
    ["darts", "Dartsee-Darts", "1 Hour Dart Lane Rental"],
    ["pool", "Pool Tables", "1 Hour Pool Table Rental"],
    ["shuffleboard", "Shuffleboard Tables", "1 Hour Shuffleboard Table Rental"],
  ])("recognizes flat %s menu rows with no category metadata and a bare extra-hour detail", (category, name, rental) => {
    const built = schedule([
      row("parent", name, null, 2),
      row("base", rental, null),
      row("extra", "Extra Hour", null),
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.resourceCategory === category && reservation.contractedDurationMinutes === 120 && reservation.sourceReference === "parent")).toBe(true);
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
  });

  it("adds the extra hour when base rental and extension share one booking description", () => {
    const booking = {
      ...row("parent", "Duckpin Bowling Lanes", null, 2),
      description: "1 Hour Bowling Lane Rental - Sunday-Thursday (6 players/lane) · Extra Hour of Bowling - Sunday-Thursday",
    };
    const built = schedule([booking]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.sourceReference === "parent" && reservation.contractedDurationMinutes === 120)).toBe(true);
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
  });

  it("keeps the parent quantity when one child detail contains both base rental and extra hour", () => {
    const built = schedule([
      row("parent", "Duckpin Bowling Lanes", null, 2),
      { ...row("base", "1 Hour Bowling Lane Rental", null), description: "Extra Hour of Bowling - Sunday-Thursday" },
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.sourceReference === "parent" && reservation.contractedDurationMinutes === 120)).toBe(true);
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
  });

  it("does not infer a count when a bare parent and its base rental have no quantity", () => {
    const built = schedule([row("parent", "Duckpin Bowling Lanes", null), row("base", "1 Hour Bowling Lane Rental", null)]);
    expect(built.reservations).toEqual([]);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "SOURCE_DETAILS_UNAVAILABLE" }));
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
  });

  it.each([null, "Bowling"])("flags an orphan extra hour rather than creating a rental when its category is %s", (category) => {
    const built = schedule([row("orphan", "Extra Hour", category, 2)]);
    expect(built.reservations).toEqual([]);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not carry a bare extra hour across an intervening unrelated contract section", () => {
    const built = schedule([
      row("parent", "Duckpin Bowling Lanes", null, 2),
      row("base", "1 Hour Bowling Lane Rental", null),
      row("food", "Dessert Platter", "Food", 1),
      row("extra", "Extra Hour", null),
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it.each([["0.5 Extra Hour", 90], ["1/2 Extra Hour", 90], ["1 1/2 Extra Hours", 150], ["2 Extra Hours", 180]])("preserves the exact extension %s", (extension, minutes) => {
    const built = schedule([
      row("parent", "Duckpin Bowling Lanes", null, 2),
      row("base", "1 Hour Bowling Lane Rental", null),
      row("extra", extension, null),
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.contractedDurationMinutes === minutes && Date.parse(reservation.endAt) - Date.parse(reservation.startAt) === minutes * 60_000)).toBe(true);
    expect(built.events[0].reviewIssues.filter((issue) => issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
  });

  it.each(["2 Extra Hours of Bowling", "Bowling for 2 hours", "Bowling for 30 minutes"])("retains the base and flags contradictory extra-hour evidence %s", (description) => {
    const built = schedule([
      row("parent", "Duckpin Bowling Lanes", null, 2),
      row("base", "1 Hour Bowling Lane Rental", null),
      { ...row("extra", "Extra Hour", "Bowling"), description },
    ]);
    expect(built.reservations).toHaveLength(2);
    expect(built.reservations.every((reservation) => reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not add an extra hour again when grouped source rows are reprocessed", () => {
    const source = [
      row("parent", "Duckpin Bowling Lanes", null, 2),
      row("base", "1 Hour Bowling Lane Rental", null),
      row("extra", "Extra Hour", null),
    ];
    const once = groupEntertainmentTimingItems(source);
    const twice = groupEntertainmentTimingItems(once);
    expect(twice).toEqual(once);
    expect(once).toHaveLength(1);
    expect(once[0].contractedDurationMinutes).toBe(120);
    expect(schedule(twice).reservations.every((reservation) => reservation.contractedDurationMinutes === 120)).toBe(true);
  });

  it("preserves a saved child-detail pool assignment when its booking parent becomes available", () => {
    const detail = row("pool-base", "1 Hour Pool Table Rental - Sunday-Thursday", null);
    const original = schedule([detail]).reservations[0];
    const staff: EntertainmentReservation = {
      ...original, manualOverride: true, startTimeSource: "staff-override",
      resourceId: "pool-3", resourceName: "Pool Table 3", notes: "Keep staff placement.",
      startAt: "2026-11-17T22:30:00.000Z", endAt: "2026-11-17T23:30:00.000Z",
    };
    const refreshed = schedule([row("pool-parent", "Pool Tables", null, 1), detail], [staff]);
    const merged = mergeReservationsForSync([staff], refreshed.reservations, NOW, refreshed.events);
    expect(merged.filter((reservation) => reservation.active)).toHaveLength(1);
    expect(merged.find((reservation) => reservation.id === original.id)).toMatchObject({
      id: original.id, syncKey: original.syncKey, sourceReference: "pool-base", active: true,
      resourceId: "pool-3", resourceName: "Pool Table 3", manualOverride: true,
      startTimeSource: "staff-override", startAt: staff.startAt, endAt: staff.endAt,
      notes: staff.notes,
    });
  });
});
