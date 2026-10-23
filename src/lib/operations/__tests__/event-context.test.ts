import { describe, expect, it } from "vitest";
import { eventMatchesNavigation, operationalEventHref, operationalEventRequestHref, persistedEventContext, readPersistedEventContext, validatedOperationalEvent } from "../event-context";

const event = { eventId: "123", eventName: "Training event", date: "2026-10-21", area: "VIP 1", guestCount: 20, time: "2:00 PM – 4:00 PM" };

describe("event workspace navigation preference", () => {
  it.each([null, "", "{", "[]", "null", '{"version":2}', '{"version":1,"event":{"eventId":"1","eventName":"Party","date":"2026-02-30"}}'])
    ("discards malformed or unsupported storage: %s", (value) => expect(readPersistedEventContext(value)).toBeNull());
  it("round-trips only workflow metadata, not live staff assignments", () => {
    const raw = persistedEventContext({ ...event, foodRunner: "Staff member", poc: "Assigned POC" });
    expect(raw).not.toContain("Staff member");
    expect(raw).not.toContain("Assigned POC");
    expect(readPersistedEventContext(raw)).toEqual(event);
  });
  it("rejects invalid identifiers and ignores unexpected private properties", () => {
    expect(validatedOperationalEvent({ ...event, eventId: "../admin" })).toBeNull();
    expect(validatedOperationalEvent({ ...event, email: "not-needed@example.test", phone: "000" })).toEqual(event);
  });
  it("does not allow persisted preferences to replace a different explicit event or date", () => {
    expect(eventMatchesNavigation(event, "456", event.date)).toBe(false);
    expect(eventMatchesNavigation(event, event.eventId, "2026-10-22")).toBe(false);
    expect(eventMatchesNavigation(event, event.eventId, event.date)).toBe(true);
    expect(eventMatchesNavigation(event, null, null)).toBe(true);
  });
  it("preserves other filters and anchors while adding exact event identity", () => {
    expect(operationalEventHref("/checklists?tab=setup#tasks", event)).toBe("/checklists?tab=setup&date=2026-10-21&eventId=123#tasks");
  });
  it("keeps an unresolved explicit event in navigation instead of switching back to a saved party", () => {
    expect(operationalEventRequestHref("/kitchen", "unresolved-event", "2026-10-21")).toBe("/kitchen?date=2026-10-21&eventId=unresolved-event");
  });
  it.each(["/admin", "/admin/floor-plans", "//other.example", "https://other.example"])("does not propagate event details to %s", (path) => {
    expect(operationalEventHref(path, event)).toBe(path);
  });
});
