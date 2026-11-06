import { describe, expect, it } from "vitest";
import { buildEntertainmentSchedule, detectEntertainmentConflicts, mergeReservationsForSync } from "../domain";
import { groupEntertainmentTimingItems, resolveEntertainmentItemTiming } from "../timing";
import type { EntertainmentReservation, EntertainmentSourceEvent, EntertainmentSourceItem } from "../types";

const DATE = "2026-07-28";
const START = "2026-07-28T21:30:00.000Z";
const NOW = "2026-07-28T12:00:00.000Z";
function item(overrides: Partial<EntertainmentSourceItem> = {}): EntertainmentSourceItem {
  return { sourceId: "contract-line", name: "Bowling Lane 1", description: "1 bowling lane for 2 hours", categoryName: "Bowling", quantity: 1, startAt: null, endAt: null, ...overrides };
}
function source(overrides: Partial<EntertainmentSourceEvent> = {}): EntertainmentSourceEvent {
  return { tripleseatEventId: "redacted-event", tripleseatBookingId: null, eventName: "Redacted Event", localDate: DATE, eventStartAt: START, eventEndAt: "2026-07-29T01:30:00.000Z", status: "DEFINITE", rooms: [], items: [item()], categoryNames: ["Bowling"], sourceUpdatedAt: NOW, noteCount: 0, ...overrides };
}
function schedule(event = source(), existingReservations: EntertainmentReservation[] = []) {
  return buildEntertainmentSchedule({ sourceEvents: [event], localEvents: [{ id: event.tripleseatEventId, name: event.eventName, date: DATE, color: "#297025", rooms: [], entertainment: [] }], existingReservations, now: NOW });
}

describe("contract entertainment timing", () => {
  it("defaults a missing start to the exact party start, without a time-review warning", () => {
    const result = resolveEntertainmentItemTiming(item(), source());
    expect(result).toEqual({ startAt: START, endAt: "2026-07-28T23:30:00.000Z", durationMinutes: 120, startTimeSource: "event-start-default", reviewIssues: [] });
    expect(schedule().reservations[0]).toMatchObject({ startAt: START, endAt: result.endAt, startTimeSource: result.startTimeSource, sourceStartTimeSource: result.startTimeSource, contractedDurationMinutes: 120 });
  });

  it.each([["90 minutes", 90], ["1.25 hours", 75], ["1 hour 20 minutes", 80], ["1/3 hour", 20]])("preserves the purchased %s exactly", (description, minutes) => {
    const result = resolveEntertainmentItemTiming(item({ description }), source());
    expect(result.durationMinutes).toBe(minutes);
    expect(Date.parse(result.endAt!) - Date.parse(result.startAt!)).toBe(minutes * 60_000);
    expect(result.reviewIssues).toEqual([]);
  });

  it.each(["2026-07-28T22:15:00.000Z", "6:15 PM", "18:15"])("uses structured explicit start %s rather than party start", (startAt) => {
    const result = resolveEntertainmentItemTiming(item({ startAt }), source());
    expect(result).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", durationMinutes: 120, startTimeSource: "contract-explicit", reviewIssues: [] });
  });

  it("honors a single explicit clock in the entertainment contract wording", () => {
    const result = resolveEntertainmentItemTiming(item({ description: "1 lane for 1.5 hours, bowling starts 6:15 PM" }), source());
    expect(result).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-28T23:45:00.000Z", startTimeSource: "contract-explicit" });
  });

  it("reads compact purchased durations and abbreviated explicit time ranges", () => {
    const result = resolveEntertainmentItemTiming(item({ name: "Duckpin Bowling 4 lanes for 3 hours7p-10p", description: null }), source());
    expect(result).toMatchObject({ startAt: "2026-07-28T23:00:00.000Z", endAt: "2026-07-29T02:00:00.000Z", durationMinutes: 180, startTimeSource: "contract-explicit", reviewIssues: [] });
  });

  it("derives purchased duration from a valid explicit start/end pair", () => {
    const result = resolveEntertainmentItemTiming(item({ description: null, startAt: START, endAt: "2026-07-28T22:45:00.000Z" }), source());
    expect(result).toMatchObject({ durationMinutes: 75, startTimeSource: "contract-explicit", reviewIssues: [] });
  });

  it("keeps the purchased duration and flags a contradictory explicit end", () => {
    const result = resolveEntertainmentItemTiming(item({ startAt: START, endAt: "2026-07-28T22:30:00.000Z" }), source());
    expect(result.endAt).toBe("2026-07-28T23:30:00.000Z");
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW", message: expect.stringContaining("2 hours") }));
  });

  it("does not substitute the whole party window when duration is absent", () => {
    const result = resolveEntertainmentItemTiming(item({ description: null }), source());
    expect(result.endAt).toBeNull();
    const built = schedule(source({ items: [item({ description: null })] }));
    expect(built.reservations).toEqual([]);
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW", message: expect.stringContaining("duration") }));
  });

  it("flags missing starts only when neither the contract nor event provides one", () => {
    expect(resolveEntertainmentItemTiming(item(), source({ eventStartAt: null })).reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not sum equivalent hour/minute duration evidence from duplicated fields", () => {
    expect(resolveEntertainmentItemTiming(item({ name: "Bowling 2 hours", description: "Bowling 120 minutes" }), source())).toMatchObject({ durationMinutes: 120, reviewIssues: [] });
  });

  it("flags contradictory duration evidence rather than silently choosing one", () => {
    expect(resolveEntertainmentItemTiming(item({ name: "Bowling 1 hour", description: "Bowling 2 hours" }), source()).reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("groups base rental and extra-hour lines while retaining the original source identity", () => {
    const rows = [item({ name: "3 Duckpin Bowling Lanes", description: null, quantity: 3 }), item({ sourceId: "duration-line", name: "1 Hour Bowling Lane Rental", description: null, quantity: 3 }), item({ sourceId: "extra-line", name: "Extra Hour of Bowling", description: null, quantity: 3 })];
    const before = structuredClone(rows);
    const grouped = groupEntertainmentTimingItems(rows);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ sourceId: "contract-line", contractedDurationMinutes: 120 });
    expect(resolveEntertainmentItemTiming(grouped[0], source())).toMatchObject({ durationMinutes: 120, startAt: START, endAt: "2026-07-28T23:30:00.000Z" });
    expect(rows).toEqual(before);
    expect(schedule(source({ items: rows })).reservations).toHaveLength(3);
  });

  it("uses the booking-heading quantity rather than the singular duration-detail wording", () => {
    const rows = [item({ name: "Duckpin Bowling Lanes", description: null, quantity: 6 }), item({ sourceId: "duration-line", name: "1 Hour Bowling Lane Rental", description: null, quantity: 6 })];
    const built = schedule(source({ items: rows }));
    expect(built.reservations).toHaveLength(6);
    expect(built.reservations.every((reservation) => reservation.contractedDurationMinutes === 60)).toBe(true);
    expect(built.events[0].reviewIssues).not.toContainEqual(expect.objectContaining({ code: "SOURCE_DETAILS_UNAVAILABLE" }));
  });

  it("retains contradictory evidence on a duration-detail line after grouping", () => {
    const rows = [item({ name: "3 Duckpin Bowling Lanes", description: null }), item({ sourceId: "detail", name: "1 Hour Bowling Lane Rental", description: "Bowling rental for 2 hours" })];
    expect(resolveEntertainmentItemTiming(groupEntertainmentTimingItems(rows)[0], source()).reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("flags a structured start that contradicts a single explicit text clock", () => {
    const result = resolveEntertainmentItemTiming(item({ startAt: "2026-07-28T22:00:00.000Z", description: "1 bowling lane for 2 hours, bowling starts 7:00 PM" }), source());
    expect(result.startAt).toBe("2026-07-28T22:00:00.000Z");
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW", message: expect.stringContaining("contradictory") }));
  });

  it("honors an activity-scoped contract note as an explicit start", () => {
    const result = resolveEntertainmentItemTiming(item(), source({ timingNotes: ["Bowling starts at 6:15 PM"] }));
    expect(result).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", startTimeSource: "contract-explicit", reviewIssues: [] });
  });

  it.each(["Bowling from 6:15 PM to 8:15 PM", "Bowling 6:15 PM–8:15 PM"])("honors the activity-specific range note %s", (note) => {
    expect(resolveEntertainmentItemTiming(item(), source({ timingNotes: [note] }))).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", startTimeSource: "contract-explicit", reviewIssues: [] });
  });

  it("does not treat the same single start repeated in name/description as an all-day range", () => {
    expect(resolveEntertainmentItemTiming(item({ name: "Bowling starts 6:15 PM", description: "Bowling starts 6:15 PM for 2 hours" }), source())).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", reviewIssues: [] });
  });

  it("ignores food/meeting notes rather than treating their clocks as entertainment starts", () => {
    const result = resolveEntertainmentItemTiming(item(), source({ timingNotes: ["Food in bowling area at 6:15 PM", "Meeting starts at 6:30 PM", "Bowling: Food served at 6:45 PM"] }));
    expect(result).toMatchObject({ startAt: START, startTimeSource: "event-start-default", reviewIssues: [] });
  });

  it("flags a contract note that conflicts with the explicit item start", () => {
    const result = resolveEntertainmentItemTiming(item({ startAt: START }), source({ timingNotes: ["Bowling: 6:15 PM–8:15 PM"] }));
    expect(result.startAt).toBe(START);
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not apply one category note blindly to multiple separate contracted activities", () => {
    const first = item();
    const result = resolveEntertainmentItemTiming(first, source({ items: [first, item({ sourceId: "second", startAt: "2026-07-28T23:00:00.000Z" })], timingNotes: ["Bowling starts at 6:15 PM"] }));
    expect(result).toMatchObject({ startAt: START, startTimeSource: "event-start-default" });
    expect(result.reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW", message: expect.stringContaining("uniquely") }));
  });

  it("records generated room intervals as defaults, but lets an explicit room note win", () => {
    const room = item({ name: "VIP 1", categoryName: "Private Rooms", description: null, startAt: START, endAt: "2026-07-28T23:30:00.000Z", startTimeSource: "event-start-default" });
    expect(resolveEntertainmentItemTiming(room, source())).toMatchObject({ startTimeSource: "event-start-default", durationMinutes: 120 });
    expect(resolveEntertainmentItemTiming(room, source({ items: [], timingNotes: ["VIP 1 starts at 6:15 PM"] }))).toMatchObject({ startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", startTimeSource: "contract-explicit", durationMinutes: 120, reviewIssues: [] });
  });
});

describe("source refresh timing and staff overrides", () => {
  it.each([
    ["event-start-default", "2026-07-28T22:30:00.000Z", "2026-07-29T00:30:00.000Z"],
    ["contract-explicit", "2026-07-28T23:00:00.000Z", "2026-07-29T01:00:00.000Z"],
    ["staff-override", "2026-07-28T23:00:00.000Z", "2026-07-29T01:00:00.000Z"],
  ] as const)("preserves %s provenance through local fallback and retimes only known defaults", (origin, startAt, endAt) => {
    const event = source({ eventStartAt: "2026-07-28T22:30:00.000Z", items: [] });
    const built = buildEntertainmentSchedule({ sourceEvents: [event], localEvents: [{ id: event.tripleseatEventId, name: event.eventName, date: DATE, color: "#297025", rooms: [], entertainment: [{ name: "Duckpin Bowling", quantity: "1 lane", time: origin === "event-start-default" ? "5:30 PM–7:30 PM" : "7:00 PM–9:00 PM", duration: "2 hours", startTimeSource: origin, contractedDurationMinutes: 120 }] }] });
    expect(built.reservations[0]).toMatchObject({ startAt, endAt, startTimeSource: origin, contractedDurationMinutes: 120 });
    expect(built.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "SOURCE_DETAILS_UNAVAILABLE" }));
    expect(built.events[0].reviewIssues).not.toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("does not guess provenance for an unknown legacy local fallback clock range", () => {
    const event = source({ eventStartAt: "2026-07-28T22:30:00.000Z", items: [] });
    const built = buildEntertainmentSchedule({ sourceEvents: [event], localEvents: [{ id: event.tripleseatEventId, name: event.eventName, date: DATE, color: "#297025", rooms: [], entertainment: [{ name: "Duckpin Bowling", quantity: "1 lane", time: "5:30 PM–7:30 PM", duration: "2 hours" }] }] });
    expect(built.reservations[0]).toMatchObject({ startAt: START, endAt: "2026-07-28T23:30:00.000Z", startTimeSource: null, sourceStartTimeSource: null });
  });

  it("retimes defaults after a party start change without changing reservation IDs", () => {
    const initial = schedule().reservations;
    const next = schedule(source({ eventStartAt: "2026-07-28T22:15:00.000Z", sourceUpdatedAt: "2026-07-28T13:00:00.000Z" }), initial).reservations;
    const merged = mergeReservationsForSync(initial, next, "2026-07-28T13:00:00.000Z");
    expect(merged[0]).toMatchObject({ id: initial[0].id, startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", startTimeSource: "event-start-default" });
  });

  it("retimes a default after resource/color-only staff edits while preserving those overrides", () => {
    const initial = schedule().reservations;
    const manual = { ...initial[0], manualOverride: true, resourceId: "bowling-8", resourceName: "Bowling Lane 8", eventColor: "#FF0000" };
    const next = schedule(source({ eventStartAt: "2026-07-28T22:15:00.000Z" })).reservations;
    const merged = mergeReservationsForSync([manual], next);
    expect(merged[0]).toMatchObject({ resourceId: "bowling-8", eventColor: "#FF0000", startAt: "2026-07-28T22:15:00.000Z", endAt: "2026-07-29T00:15:00.000Z", startTimeSource: "event-start-default", hasSourceUpdate: false });
  });

  it("preserves explicit entertainment times when the party start moves", () => {
    const explicit = item({ startAt: "2026-07-28T23:00:00.000Z" });
    const original = schedule(source({ items: [explicit] })).reservations;
    const incoming = schedule(source({ eventStartAt: "2026-07-28T22:15:00.000Z", items: [explicit] })).reservations;
    expect(mergeReservationsForSync(original, incoming)[0]).toMatchObject({ startAt: "2026-07-28T23:00:00.000Z", endAt: "2026-07-29T01:00:00.000Z", startTimeSource: "contract-explicit" });
  });

  it("preserves staff timing overrides and flags newer contradictory source timing", () => {
    const initial = schedule().reservations;
    const manual = { ...initial[0], manualOverride: true, startTimeSource: "staff-override" as const, startAt: "2026-07-28T23:00:00.000Z", endAt: "2026-07-29T01:00:00.000Z" };
    const incoming = schedule(source({ eventStartAt: "2026-07-28T22:15:00.000Z" })).reservations;
    expect(mergeReservationsForSync([manual], incoming)[0]).toMatchObject({ startAt: manual.startAt, endAt: manual.endAt, startTimeSource: "staff-override", sourceStartTimeSource: "event-start-default", hasSourceUpdate: true });
  });

  it("retains an active staff override for a still-present source activity with missing duration", () => {
    const original = schedule().reservations[0];
    const manual = { ...original, manualOverride: true, startTimeSource: "staff-override" as const, startAt: "2026-07-28T23:00:00.000Z", endAt: "2026-07-29T01:00:00.000Z" };
    const incomplete = schedule(source({ items: [item({ description: null })] }));
    expect(incomplete.reservations).toEqual([]);
    const merged = mergeReservationsForSync([manual], incomplete.reservations, NOW, incomplete.events);
    expect(merged[0]).toMatchObject({ id: manual.id, active: true, startAt: manual.startAt, endAt: manual.endAt, needsReview: true, hasSourceUpdate: true, sourceEndAt: null });
    expect(merged[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }));
  });

  it("still deactivates overrides when the source item was actually removed or event cancelled", () => {
    const original = schedule().reservations[0];
    const manual = { ...original, manualOverride: true, startTimeSource: "staff-override" as const };
    const removed = schedule(source({ items: [] }));
    expect(mergeReservationsForSync([manual], [], NOW, removed.events)[0].active).toBe(false);
    expect(mergeReservationsForSync([manual], [], NOW, [])[0].active).toBe(false);
  });

  it("retains a source-backed staff override through schedule construction, without duplicate reservations", () => {
    const initial = schedule().reservations;
    const manual = { ...initial[0], manualOverride: true, startTimeSource: "staff-override" as const };
    const built = schedule(source(), [manual]);
    const merged = mergeReservationsForSync([manual], built.reservations);
    expect(merged.filter((reservation) => reservation.active)).toHaveLength(1);
    expect(merged[0].id).toBe(manual.id);
  });

  it("surfaces resulting conflicts after a default retimes onto another reservation", () => {
    const original = schedule().reservations;
    const incoming = schedule(source({ eventStartAt: "2026-07-28T22:15:00.000Z" })).reservations;
    const other = { ...original[0], id: "other-party", syncKey: null, source: "manual" as const, startAt: "2026-07-29T00:00:00.000Z", endAt: "2026-07-29T01:00:00.000Z" };
    expect(detectEntertainmentConflicts([...mergeReservationsForSync(original, incoming), other])).toHaveLength(1);
  });

  it("keeps identical repeated syncs idempotent after timing metadata is recorded", () => {
    const original = schedule().reservations;
    const once = mergeReservationsForSync(original, schedule().reservations, "2026-07-28T13:00:00.000Z");
    const twice = mergeReservationsForSync(once, schedule().reservations, "2026-07-28T14:00:00.000Z");
    expect(twice[0].updatedAt).toBe(original[0].updatedAt);
    expect(twice).toEqual(once);
  });

  it.each([START, "2026-07-28T22:15:00.000Z"])("keeps generic three-lane slots stable after a color-only override when default starts at %s", (eventStartAt) => {
    const event = source({ items: [item({ name: "Duckpin Bowling", description: "3 bowling lanes for 2 hours", quantity: 3 })] });
    const initial = schedule(event).reservations;
    const manual = { ...initial[0], manualOverride: true, eventColor: "#FF0000" };
    const existing = [manual, ...initial.slice(1)];
    const incoming = schedule({ ...event, eventStartAt }, existing).reservations;
    const merged = mergeReservationsForSync(existing, incoming).filter((row) => row.active);
    expect(merged.map((row) => row.resourceId)).toEqual(["bowling-1", "bowling-2", "bowling-3"]);
    expect(merged.map((row) => row.sourceResourceId)).toEqual(["bowling-1", "bowling-2", "bowling-3"]);
    expect(merged.map((row) => row.hasSourceUpdate)).toEqual([false, false, false]);
    expect(merged[0]).toMatchObject({ eventColor: "#FF0000", startAt: eventStartAt, startTimeSource: "event-start-default" });
  });

  it("does not misread a repeated count in the name/description as one numbered lane", () => {
    const event = source({ items: [item({ name: "3 Bowling Lanes", description: "3 bowling lanes for 2 hours", quantity: 3 })] });
    expect(schedule(event).reservations.map((row) => row.resourceId)).toEqual(["bowling-1", "bowling-2", "bowling-3"]);
  });
});
