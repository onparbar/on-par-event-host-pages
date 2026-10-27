import { describe, expect, it } from "vitest";
import { operationalEventHref } from "../event-context";
import { STAFF_WORKSPACE_NAVIGATION, eventSelectionHref, isStaffWorkspaceRoute, persistedStaffContext, readPersistedStaffContext, staffEventsForDate, validatedStaffName } from "../staff-workspace";
import { buildOperationalEventSummaries } from "../command-center";
import type { EventPlan } from "@/lib/event-plans/types";

const event = { eventId: "123", eventName: "Staff training", date: "2026-10-23", area: "VIP 1" };
const plan: EventPlan = { id: 123, name: event.eventName, date: event.date, rooms: [event.area], time: "2:00 PM – 4:00 PM", day: "Friday", guest_count: 20, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };

describe("staff workspace display preference", () => {
  it("accepts only existing roster names and does not accept a code or invented employee", () => {
    expect(validatedStaffName(" Carlos ")).toBe("Carlos");
    expect(validatedStaffName("1234")).toBe("");
    expect(validatedStaffName("Unlisted Employee")).toBe("");
    expect(validatedStaffName({ name: "Carlos" })).toBe("");
  });
  it("roundtrips only the selected employee display name", () => {
    const stored = persistedStaffContext("Tina");
    expect(JSON.parse(stored)).toEqual({ version: 1, staffName: "Tina" });
    expect(readPersistedStaffContext(stored)).toBe("Tina");
  });
  it.each([null, "", "{", "null", "[]", '{"version":2,"staffName":"Carlos"}', '{"version":1,"staffName":"New name"}', "x".repeat(251)])("rejects malformed browser identity: %s", (raw) => {
    expect(readPersistedStaffContext(raw)).toBe("");
  });
  it("keeps the exact event ID and date in every workspace tab, never VIP check-in", () => {
    expect(STAFF_WORKSPACE_NAVIGATION.map((item) => item.label)).toEqual(["Checklists", "Floor Plans", "Entertainment", "Add-ons & Refills", "Itineraries"]);
    for (const item of STAFF_WORKSPACE_NAVIGATION) {
      const href = operationalEventHref(item.href, event);
      const url = new URL(href, "https://event-host.invalid");
      expect(url.searchParams.get("eventId")).toBe("123");
      expect(url.searchParams.get("date")).toBe("2026-10-23");
      expect(isStaffWorkspaceRoute(url.pathname)).toBe(true);
    }
    expect(isStaffWorkspaceRoute("/vip-check-in")).toBe(false);
    expect(isStaffWorkspaceRoute("/kitchen")).toBe(false);
    expect(isStaffWorkspaceRoute("/admin")).toBe(false);
  });
  it("switches events on the selected date without retaining a stale party ID", () => {
    expect(eventSelectionHref("2026-10-23")).toBe("/?date=2026-10-23");
    expect(eventSelectionHref("2026-02-30")).toBe("/");
    expect(eventSelectionHref("?eventId=other")).toBe("/");
  });
  it("searches only the chosen date and preserves distinct same-name event identities", () => {
    const summaries = buildOperationalEventSummaries([plan, { ...plan, id: 124 }, { ...plan, id: 125, date: "2026-10-24" }], [], null);
    expect(staffEventsForDate(summaries, "2026-10-23", " TRAINING ").map((row) => row.event.eventId)).toEqual(["123", "124"]);
    expect(staffEventsForDate(summaries, "2026-10-23", "unmatched")).toEqual([]);
  });
});
