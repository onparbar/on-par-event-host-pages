import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { buildOperationalEventSummaries, commandCenterEvents, operationalEventWindow } from "../command-center";

const now = new Date("2026-10-21T17:00:00Z"); // 1 PM Eastern
function plan(overrides: Partial<EventPlan> = {}): EventPlan {
  return { id: 1, name: "Training event", date: "2026-10-21", day: "Wednesday", time: "1:30 PM – 3:30 PM", guest_count: 20, rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified", synced_at: now.toISOString(), ...overrides };
}

describe("event command center", () => {
  it("filters today in Eastern time and keeps ended parties visible that day", () => {
    const events = buildOperationalEventSummaries([plan({ time: "10:00 AM – 12:00 PM" }), plan({ id: 2, date: "2026-10-22" })], [], null);
    expect(commandCenterEvents(events, "today", now).map((row) => row.event.eventId)).toEqual(["1"]);
    expect(commandCenterEvents(events, "today", new Date("2026-10-22T02:00:00Z"))).toHaveLength(1);
  });
  it("includes running events and exact next-hour boundary, excluding ended events and 61 minutes away", () => {
    const events = buildOperationalEventSummaries([
      plan({ id: 1, time: "12:00 PM – 2:00 PM" }),
      plan({ id: 2, time: "2:00 PM – 3:00 PM" }),
      plan({ id: 3, time: "2:01 PM – 3:00 PM" }),
      plan({ id: 4, time: "12:00 PM – 1:00 PM" }),
    ], [], null);
    expect(commandCenterEvents(events, "next60", now).map((row) => row.event.eventId)).toEqual(["1", "2"]);
  });
  it("shows source/review issues without fabricating department readiness", () => {
    const [event] = buildOperationalEventSummaries([plan({ needs_review: true, rooms: [], synced_at: null })], null, null);
    expect(event.attention).toEqual(["Contract needs review", "Reserved area missing", "Source refresh not verified", "Checklist status unavailable"]);
    expect(event.checklistStatus).toBe("unavailable");
    expect(event.hostAssigned).toBe(false);
  });
  it("does not claim freshness from a synchronization of a different date window", () => {
    const [event] = buildOperationalEventSummaries([plan({ synced_at: null })], [], { windowStart: "2026-10-01", windowEnd: "2026-10-10", status: "success", eventCount: 1, startedAt: now.toISOString(), completedAt: now.toISOString(), lastSuccessfulSyncAt: now.toISOString(), errorMessage: null });
    expect(event.sourceSyncedAt).toBeNull();
    expect(event.attention).toContain("Source refresh not verified");
  });
  it("requires exact checklist event ID and date and counts only real checklist tasks", () => {
    const [event] = buildOperationalEventSummaries([plan()], [{ eventId: 1, eventDate: "2026-10-21", status: "draft", tasks: { "contract-details-confirmed": true, invented: true }, taskEvidence: { "contract-details-confirmed": { employeeName: "Staff-entered actor", completedAt: "2026-10-21T17:00:00Z" } }, bwa: "" }], null);
    expect(event.checklistCompleted).toBe(1);
    expect(event.checklistStatus).toBe("in-progress");
    expect(buildOperationalEventSummaries([plan()], [{ eventId: 1, eventDate: "2026-10-20", status: "submitted", tasks: {}, bwa: "Staff" }], null)[0].checklistStatus).toBe("not-started");
  });
  it("matches conditional checklist counts and does not count old untimestamped checks as completed", () => {
    const source = plan({ source_updated_at: "2026-10-21T15:00:00Z" });
    const tasks = { "contract-details-confirmed": true, "mini-golf-coins": true, "food-ready": true };
    const [summary] = buildOperationalEventSummaries([source], [{ eventId: 1, eventDate: source.date, status: "draft", tasks, bwa: "Staff" }], null);
    const readiness = checklistReadiness(source, { tasks, bwa: "Staff" });
    expect(summary.checklistCompleted).toBe(0);
    expect(summary.checklistTotal).toBe(readiness.total);
    expect(readiness.tasks.find((task) => task.key === "mini-golf-coins")?.applicability).toBe("not-applicable");
  });
  it("excludes old attention flags from the current work queue", () => {
    const events = buildOperationalEventSummaries([plan({ id: 1, date: "2026-10-20", needs_review: true }), plan({ id: 2, date: "2026-10-22", needs_review: true })], [], null);
    expect(commandCenterEvents(events, "attention", now).map((row) => row.event.eventId)).toEqual(["2"]);
    expect(commandCenterEvents(events, "upcoming", now).map((row) => row.event.eventId)).toEqual(["2"]);
  });
  it("parses midnight rollover, refuses invalid date/time, and does not shift morning events into tomorrow", () => {
    expect(operationalEventWindow(plan({ time: "11:00 PM – 1:00 AM" }))).toEqual({ startsAt: "2026-10-22T03:00:00.000Z", endsAt: "2026-10-22T05:00:00.000Z" });
    expect(operationalEventWindow(plan({ time: "9:00 AM – 10:00 AM" }))?.startsAt).toBe("2026-10-21T13:00:00.000Z");
    expect(operationalEventWindow(plan({ date: "2026-02-30" }))).toBeNull();
    expect(operationalEventWindow(plan({ time: "Time pending" }))).toBeNull();
  });
});
