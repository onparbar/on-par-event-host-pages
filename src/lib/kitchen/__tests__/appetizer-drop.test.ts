import { describe, expect, it } from "vitest";
import { appetizerDropReminder } from "../appetizer-drop";
import { dueKitchenAlerts, kitchenTimedAlerts, newlyObservedDueKitchenAlerts } from "../alerts";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { quantityAwareReadinessKey } from "../readiness";
import { generateKitchenChecklist } from "../rules";
import type { KitchenSourceEvent } from "../types";

function appetizerEvent(overrides: Partial<KitchenSourceEvent> = {}) {
  return generateKitchenChecklist({ ...MOCK_KITCHEN_EVENTS[2], ...overrides });
}

describe("appetizer cooking reminder", () => {
  it("reminds 30 minutes before the event without changing existing prep or food-ready times", () => {
    const checklist = appetizerEvent();
    const originalTiming = { ...checklist.timing };
    expect(appetizerDropReminder(checklist)).toEqual({
      scheduledAt: "2026-07-28T14:00",
      source: "default",
      itemKeys: ["appetizer-tater-kegs", "appetizer-mozzarella-sticks", "appetizer-chicken-tenders"],
      itemNames: ["Tater Kegs", "Mozzarella Sticks", "Chicken Tenders"],
      sourceNotes: [],
    });
    expect(checklist.timing).toEqual(originalTiming);
    expect(checklist.timing.foodReadyBy).toBe("2026-07-28T14:15");
  });

  it("includes hot wing-bar and platter food, excluding cold items and desserts", () => {
    expect(appetizerDropReminder(generateKitchenChecklist(MOCK_KITCHEN_EVENTS[1]))?.itemNames)
      .toEqual(["Wings", "Fries"]);
    expect(appetizerDropReminder(generateKitchenChecklist(MOCK_KITCHEN_EVENTS[3]))?.itemNames)
      .toEqual(["Mozzarella Sticks"]);
    expect(appetizerDropReminder(appetizerEvent({
      selections: [
        { name: "Dessert Platter", quantity: 1, isFood: true },
        { name: "Veggie Tray", quantity: 1, isFood: true },
      ],
    }))).toBeNull();
    expect(appetizerDropReminder(generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]))).toBeNull();
  });

  it.each([
    ["Drop appetizers at 1:45 PM", "2026-07-28T13:45"],
    ["Food drop time: 13:45", "2026-07-28T13:45"],
    ["Appetizers to be dropped 45 minutes prior to the event", "2026-07-28T13:45"],
    ["Drop appetizers 20 minutes after event start", "2026-07-28T14:50"],
  ])("honors explicit contract cooking instructions: %s", (note, scheduledAt) => {
    const checklist = appetizerEvent({
      foodNotes: [{ text: note, source: "booking-document", sourceId: "redacted-doc", sourceUpdatedAt: null }],
    });
    expect(appetizerDropReminder(checklist)).toMatchObject({
      scheduledAt,
      source: "contract",
      sourceNotes: [note],
    });
  });

  it.each([
    ["Food service at 3:00 PM"],
    ["Food 3:00 PM"],
    ["Appetizers should be ready after the guests arrive"],
    ["Drop wings at 1:45 PM"],
    ["Drop appetizers at 13:75"],
    ["Drop appetizers at 0 PM"],
    ["Drop appetizers at 5:00 PM"],
    ["Do not drop appetizers before 2:00 PM"],
    ["Drop appetizers at 1:45 PM", "Drop appetizers at 2:00 PM"],
  ])("requires review for ambiguous, invalid, serving-only or conflicting timing: %s", (...notes) => {
    const checklist = appetizerEvent({ specialNotes: notes });
    expect(appetizerDropReminder(checklist)).toMatchObject({
      scheduledAt: null,
      source: "needs-review",
    });
    expect(checklist.needsReview).toBe(true);
  });

  it("ignores dessert timing, entertainment timing, and ordinary recipe durations", () => {
    expect(appetizerDropReminder(appetizerEvent({
      specialNotes: [
        "Dessert served at 3:00 PM",
        "Bowling starts at 3:00 PM",
        "Fry mozzarella sticks for 5 minutes",
        "Do not cover fried food",
      ],
    }))).toMatchObject({ source: "default", scheduledAt: "2026-07-28T14:00" });
  });

  it("deduplicates matching food and special-note overrides", () => {
    const text = "Drop appetizers at 1:45 PM";
    expect(appetizerDropReminder(appetizerEvent({
      specialNotes: [text],
      foodNotes: [{ text, source: "event-note", sourceId: null, sourceUpdatedAt: null }],
    }))).toMatchObject({ source: "contract", sourceNotes: [text] });
  });

  it.each([
    ["2026-07-29", "00:10", "02:00", "2026-07-28T23:40"],
    ["2026-12-01", "2026-12-01T19:30:00Z", "16:30", "2026-12-01T14:00"],
    ["2026-03-08", "03:10", "05:00", "2026-03-08T01:40"],
  ])("uses Eastern time through date and daylight-saving boundaries (%s)", (localDate, startTime, endTime, scheduledAt) => {
    expect(appetizerDropReminder(appetizerEvent({ localDate, startTime, endTime })))
      .toMatchObject({ source: "default", scheduledAt });
  });

  it("holds an invalid or missing event start for review", () => {
    for (const startTime of [null, "invalid", "2026-11-01T01:45"]) {
      expect(appetizerDropReminder(appetizerEvent({ localDate: "2026-11-01", startTime })))
        .toMatchObject({ source: "needs-review", scheduledAt: null });
    }
  });

  it("does not fire in the wrong repeated hour at the fall daylight-saving boundary", () => {
    expect(appetizerDropReminder(appetizerEvent({
      localDate: "2026-11-01",
      startTime: "2026-11-01T02:10:00-05:00",
      endTime: "04:00",
    }))).toMatchObject({ source: "needs-review", scheduledAt: null });
  });

  it("does not guess a later cooking window when an event has no end time", () => {
    expect(appetizerDropReminder(appetizerEvent({
      endTime: null,
      specialNotes: ["Drop appetizers 20 minutes after event start"],
    }))).toMatchObject({ source: "needs-review", scheduledAt: null });
  });
});

describe("appetizer timed alerts", () => {
  it("fires when the reminder minute is crossed and excludes dismissed reminders", () => {
    const checklist = appetizerEvent();
    const alerts = kitchenTimedAlerts([checklist], checklist.event.localDate)
      .filter((alert) => alert.kind === "appetizer-drop");
    expect(alerts).toHaveLength(1);
    expect(dueKitchenAlerts(alerts, "2026-07-28T13:58", "2026-07-28T13:59", new Set())).toEqual([]);
    expect(dueKitchenAlerts(alerts, "2026-07-28T13:59", "2026-07-28T14:00", new Set())).toEqual(alerts);
    expect(dueKitchenAlerts(alerts, "2026-07-28T13:59", "2026-07-28T14:00", new Set([alerts[0].id]))).toEqual([]);
  });

  it("does not raise default cooking reminders after the event has started", () => {
    const checklist = appetizerEvent();
    const alerts = kitchenTimedAlerts([checklist], checklist.event.localDate)
      .filter((alert) => alert.kind === "appetizer-drop");
    expect(newlyObservedDueKitchenAlerts(alerts, new Set(), "2026-07-28T14:29", new Set())).toEqual(alerts);
    expect(newlyObservedDueKitchenAlerts(alerts, new Set(), "2026-07-28T14:30", new Set())).toEqual([]);
    expect(dueKitchenAlerts(alerts, "2026-07-28T13:00", "2026-07-29T14:00", new Set())).toEqual([]);
  });

  it("keeps a later contract cooking reminder until event end", () => {
    const checklist = appetizerEvent({ specialNotes: ["Drop appetizers 20 minutes after event start"] });
    const alerts = kitchenTimedAlerts([checklist], checklist.event.localDate)
      .filter((alert) => alert.kind === "appetizer-drop");
    expect(alerts[0]).toMatchObject({ scheduledAt: "2026-07-28T14:50", expiresAt: "2026-07-28T16:30" });
    expect(dueKitchenAlerts(alerts, "2026-07-28T14:49", "2026-07-28T14:50", new Set())).toEqual(alerts);
    expect(newlyObservedDueKitchenAlerts(alerts, new Set(), "2026-07-28T16:30", new Set())).toEqual([]);
  });

  it("skips cooking alarms when every hot appetizer row is already ready", () => {
    const checklist = appetizerEvent();
    checklist.completedItemKeys = checklist.sections.flatMap((section) =>
      section.rows.map((row) => quantityAwareReadinessKey({
        itemKey: row.key,
        quantity: row.quantity,
        numberOfPans: row.numberOfPans,
        panSize: row.panSize,
        unit: row.unit,
        ruleVersion: checklist.ruleVersion,
      })),
    );
    expect(kitchenTimedAlerts([checklist], checklist.event.localDate).some(
      (alert) => alert.kind === "appetizer-drop",
    )).toBe(false);
  });
});
