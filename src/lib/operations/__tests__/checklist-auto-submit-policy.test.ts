import { describe, expect, it } from "vitest";
import { workspaceEvent } from "./workspace-fixtures";
import { automaticChecklistSourceFingerprint, automaticChecklistTiming, checklistAutoSubmitConfiguration,
  checklistAutoSubmitDateRanges, type AutomaticChecklistSource } from "../checklist-auto-submit-policy";

function source(overrides: Partial<AutomaticChecklistSource> = {}): AutomaticChecklistSource {
  return { sourceEventId: "77", event: { ...workspaceEvent, source_updated_at: "2026-10-23T12:00:00Z" },
    startAt: null, endAt: null, sourceUpdatedAt: "2026-10-23T12:00:00Z", ...overrides };
}

describe("automatic checklist submission timing policy", () => {
  it("requires an explicit enabled flag and activation instant", () => {
    const now = new Date("2026-10-26T18:00:00Z");
    expect(checklistAutoSubmitConfiguration({}, now)).toEqual({ enabled: false, reason: "disabled" });
    for (const value of [undefined, "invalid", "2026-10-26T14:00:00"]) {
      expect(checklistAutoSubmitConfiguration({ CHECKLIST_AUTO_SUBMIT_ENABLED: "true", CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: value }, now)).toEqual({ enabled: false, reason: "invalid-activation" });
    }
    expect(checklistAutoSubmitConfiguration({ CHECKLIST_AUTO_SUBMIT_ENABLED: "true", CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "2026-10-26T17:00:00Z" }, now))
      .toEqual({ enabled: true, activatedAt: "2026-10-26T17:00:00Z", startDate: "2026-10-25", endDate: "2026-10-26" });
  });

  it("reads the activation window in contiguous ranges no longer than31 days", () => {
    expect(checklistAutoSubmitDateRanges("2026-10-25", "2026-11-26")).toEqual([
      { startDate: "2026-10-25", endDate: "2026-11-24" }, { startDate: "2026-11-25", endDate: "2026-11-26" },
    ]);
  });

  it("keeps exact partial-hour clock times in New York", () => {
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, time: "5:30 PM - 9:30 PM" } })))
      .toEqual({ eventEndedAt: "2026-10-24T01:30:00.000Z", scheduledFor: "2026-10-24T02:30:00.000Z" });
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, date: "2026-12-01", time: "5 PM - 9 PM" } })))
      .toEqual({ eventEndedAt: "2026-12-02T02:00:00.000Z", scheduledFor: "2026-12-02T03:00:00.000Z" });
  });

  it("handles an overnight event without using the entertainment operating-day10AM rule", () => {
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, time: "11:00 PM - 1:30 AM" } })))
      .toEqual({ eventEndedAt: "2026-10-24T05:30:00.000Z", scheduledFor: "2026-10-24T06:30:00.000Z" });
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, time: "8:00 AM - 9:00 AM" } })))
      .toEqual({ eventEndedAt: "2026-10-23T13:00:00.000Z", scheduledFor: "2026-10-23T14:00:00.000Z" });
  });

  it("rejects ambiguous or nonexistent DST wall times but honors explicit offset evidence", () => {
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, date: "2026-10-31", time: "11:00 PM - 1:30 AM" } }))).toBeNull();
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, date: "2026-10-31", time: "11:00 PM - 1:30 AM" },
      startAt: "2026-10-31T23:00:00-04:00", endAt: "2026-11-01T01:30:00-04:00" })))
      .toEqual({ eventEndedAt: "2026-11-01T05:30:00.000Z", scheduledFor: "2026-11-01T06:30:00.000Z" });
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, date: "2026-03-07", time: "11:00 PM - 2:30 AM" } }))).toBeNull();
  });

  it("prefers source instants and refuses contradictory or missing timing", () => {
    expect(automaticChecklistTiming(source({ startAt: "2026-10-23T22:30:00Z", endAt: "2026-10-24T02:45:30Z" })))
      .toEqual({ eventEndedAt: "2026-10-24T02:45:30.000Z", scheduledFor: "2026-10-24T03:45:30.000Z" });
    expect(automaticChecklistTiming(source({ startAt: "2026-10-23T22:30:00Z", endAt: "2026-10-23T20:00:00Z" }))).toBeNull();
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, time: "Not supplied" } }))).toBeNull();
    expect(automaticChecklistTiming(source({ event: { ...workspaceEvent, date: "2026-02-30" } }))).toBeNull();
  });

  it("records a deterministic source hash without storing the raw source in the receipt", () => {
    const initial = source();
    const fingerprint = automaticChecklistSourceFingerprint(initial);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(automaticChecklistSourceFingerprint(structuredClone(initial))).toBe(fingerprint);
    expect(automaticChecklistSourceFingerprint({ ...initial, sourceUpdatedAt: "2026-10-23T13:00:00Z" })).not.toBe(fingerprint);
    expect(automaticChecklistSourceFingerprint({ ...initial, event: { ...initial.event, time: "6:00 PM - 10:00 PM" } })).not.toBe(fingerprint);
  });
});
