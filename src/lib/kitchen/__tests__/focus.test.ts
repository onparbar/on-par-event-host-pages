import { describe, expect, it } from "vitest";
import {
  kitchenFocusSnapshot,
  minutesUntil,
  type KitchenFocusEvent,
} from "../focus";

function event(
  id: string,
  startTime: string,
  endTime: string | null,
  foodReadyBy: string | null = null,
): KitchenFocusEvent {
  return {
    event: {
      eventId: id,
      name: `Event ${id}`,
      localDate: "2026-08-06",
      startTime,
      endTime,
    },
    timing: {
      startTime,
      foodReadyBy,
    },
  };
}

describe("kitchen current and next event focus", () => {
  it("selects the active event and the next future event", () => {
    const result = kitchenFocusSnapshot(
      [
        event("current", "12:00 PM", "4:00 PM", "2:30 PM"),
        event("next", "5:30 PM", "7:00 PM"),
      ],
      new Date("2026-08-06T18:12:00.000Z"),
    );

    expect(result.current?.event.event.eventId).toBe("current");
    expect(result.next?.event.event.eventId).toBe("next");
    expect(result.currentEventCount).toBe(1);
    expect(minutesUntil(result.current?.endAt ?? null, new Date("2026-08-06T18:12:00.000Z"))).toBe(108);
    expect(minutesUntil(result.current?.foodReadyAt ?? null, new Date("2026-08-06T18:12:00.000Z"))).toBe(18);
  });

  it("prioritizes the active event ending soonest when events overlap", () => {
    const result = kitchenFocusSnapshot(
      [
        event("long", "12:00 PM", "5:00 PM"),
        event("short", "1:00 PM", "3:00 PM"),
      ],
      new Date("2026-08-06T18:00:00.000Z"),
    );

    expect(result.current?.event.event.eventId).toBe("short");
    expect(result.currentEventCount).toBe(2);
  });

  it("keeps a started event with a missing end time visible", () => {
    const result = kitchenFocusSnapshot(
      [event("missing-end", "12:00 PM", null)],
      new Date("2026-08-06T18:00:00.000Z"),
    );

    expect(result.current?.event.event.eventId).toBe("missing-end");
    expect(result.current?.endAt).toBeNull();
  });

  it("moves an event out of current focus at its exact end instant", () => {
    const result = kitchenFocusSnapshot(
      [event("ended", "12:00 PM", "2:00 PM")],
      new Date("2026-08-06T18:00:00.000Z"),
    );

    expect(result.current).toBeNull();
    expect(result.next).toBeNull();
  });
});
