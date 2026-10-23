import { describe, expect, it } from "vitest";
import { buildWorkspacePayload } from "../workspace";
import { workspaceTimeline, workspaceTimelinePosition } from "../workspace-timeline";
import { workspaceEvent, workspaceRecord, workspaceReservation } from "./workspace-fixtures";

describe("event operating timeline", () => {
  it("uses saved activity times, contract mini-golf quantity without time, and separate food deadline", () => {
    const payload = buildWorkspacePayload({ event: workspaceEvent, record: workspaceRecord(), reservations: [workspaceReservation()], scheduleAvailable: true });
    const entries = workspaceTimeline(payload);
    expect(entries[0].id).toBe("setup");
    expect(entries.at(-1)?.label).toBe("Mini Golf: 20");
    expect(entries.find((item) => item.id === "setup")?.at).toBe("2026-10-23T21:00:00.000Z");
    expect(entries.find((item) => item.id === "food")?.at).toBe("2026-10-23T21:45:00.000Z");
    expect(entries.find((item) => item.label.startsWith("Duckpin Bowling:"))?.at).toBe("2026-10-23T22:30:00.000Z");
    expect(entries.find((item) => item.label === "Mini Golf: 20")).toMatchObject({ at: null, instruction: "Untimed contract activity." });
    expect(entries.find((item) => item.id === "breakdown")?.at).toBe(payload.eventEndAt);
  });
  it("keeps dates across midnight, skips cancelled activities, flags missing event timing", () => {
    const payload = buildWorkspacePayload({ event: { ...workspaceEvent, time: "11:00 PM - 1:00 AM" }, record: null, reservations: [workspaceReservation({ active: false })], scheduleAvailable: true });
    expect(workspaceTimeline(payload).find((item) => item.id === "breakdown")?.at).toBe("2026-10-24T05:00:00.000Z");
    expect(workspaceTimeline(payload).some((item) => item.label.startsWith("Duckpin"))).toBe(false);
    const missing = workspaceTimeline({ ...payload, eventStartAt: null, foodReminderAt: null, eventEndAt: null });
    expect(missing.find((item) => item.id === "arrival")).toMatchObject({ at: null, label: "Guest arrival — time needs review" });
    expect(missing.some((item) => item.id === "food")).toBe(false);
  });
  it("identifies current and next outstanding items, not completed food tasks", () => {
    const payload = buildWorkspacePayload({ event: workspaceEvent, record: workspaceRecord({ tasks: { "food-kitchen-window": true } }), reservations: [workspaceReservation()], scheduleAvailable: true });
    const entries = workspaceTimeline(payload);
    expect(workspaceTimelinePosition(entries, new Date("2026-10-23T21:50:00Z"))).toEqual({ current: "setup", next: "arrival" });
  });
});
