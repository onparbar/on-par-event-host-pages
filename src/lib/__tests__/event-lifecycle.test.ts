import { describe, expect, it } from "vitest";
import {
  activeDatedAssets,
  activeEvents,
  availableChecklistEvents,
  easternDateValue,
  isEventOver,
} from "../event-lifecycle";

const event = {
  id: 1,
  date: "2026-07-30",
  time: "11:00 AM - 2:00 PM",
};

describe("event lifecycle", () => {
  it("keeps an event active until its end time in America/New_York", () => {
    expect(isEventOver(event, new Date("2026-07-30T17:59:00.000Z"))).toBe(false);
    expect(isEventOver(event, new Date("2026-07-30T18:00:00.000Z"))).toBe(true);
  });

  it("keeps an event active through an after-midnight end time", () => {
    const overnight = {
      ...event,
      time: "6:00 PM - 12:00 AM",
    };

    expect(isEventOver(overnight, new Date("2026-07-31T03:59:00.000Z"))).toBe(false);
    expect(isEventOver(overnight, new Date("2026-07-31T04:00:00.000Z"))).toBe(true);
  });

  it("sorts active events by their next start time and excludes archived events", () => {
    const events = [
      { id: 3, date: "2026-08-01", time: "5:00 PM - 7:00 PM" },
      { id: 1, date: "2026-07-29", time: "5:00 PM - 7:00 PM" },
      { id: 2, date: "2026-07-31", time: "6:00 PM - 8:00 PM" },
      { id: 4, date: "2026-07-31", time: "11:00 AM - 2:00 PM" },
    ];

    expect(
      activeEvents(events, [3], new Date("2026-07-30T16:00:00.000Z")).map(
        (item) => item.id,
      ),
    ).toEqual([4, 2]);
  });

  it("keeps an event visible when its time is malformed instead of guessing", () => {
    const needsReview = {
      ...event,
      time: "Time not listed",
    };

    expect(isEventOver(needsReview, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(activeEvents([needsReview], [], new Date("2027-01-01T00:00:00.000Z"))).toEqual([
      needsReview,
    ]);
  });

  it("keeps unfinished checklist events through the full following day", () => {
    const checklistEvent = {
      id: 8,
      date: "2026-08-06",
      time: "12:00 PM - 3:00 PM",
    };

    expect(
      availableChecklistEvents(
        [checklistEvent],
        [8],
        new Date("2026-08-08T03:59:00.000Z"),
      ),
    ).toEqual([checklistEvent]);
    expect(
      availableChecklistEvents(
        [checklistEvent],
        [],
        new Date("2026-08-08T04:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("archives a dated floor plan after every attached event has ended", () => {
    const plan = {
      date: "2026-07-30",
      image: "/floor-plans/july-30.png",
      events: ["Lunch", "Dinner"],
    };
    const events = [
      {
        id: 1,
        name: "Lunch",
        date: "2026-07-30",
        time: "11:00 AM - 2:00 PM",
      },
      {
        id: 2,
        name: "Dinner",
        date: "2026-07-30",
        time: "7:00 PM - 9:00 PM",
      },
    ];

    expect(
      activeDatedAssets(
        [plan],
        events,
        [],
        new Date("2026-07-30T18:00:00.000Z"),
      ),
    ).toEqual([plan]);
    expect(
      activeDatedAssets(
        [plan],
        events,
        [],
        new Date("2026-07-31T01:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("archives a plan tied to one event without hiding another plan on the same date", () => {
    const lunchPlan = {
      date: "2026-07-30",
      image: "/floor-plans/lunch.png",
      events: ["Lunch"],
    };
    const dinnerPlan = {
      date: "2026-07-30",
      image: "/floor-plans/dinner.png",
      events: ["Dinner"],
    };
    const events = [
      {
        id: 1,
        name: "Lunch",
        date: "2026-07-30",
        time: "11:00 AM - 2:00 PM",
      },
      {
        id: 2,
        name: "Dinner",
        date: "2026-07-30",
        time: "7:00 PM - 9:00 PM",
      },
    ];

    expect(
      activeDatedAssets(
        [lunchPlan, dinnerPlan],
        events,
        [],
        new Date("2026-07-30T18:00:00.000Z"),
      ),
    ).toEqual([dinnerPlan]);
  });

  it("uses the New York date for unmatched dated assets and manual archives", () => {
    const oldPlan = {
      date: "2026-07-29",
      image: "/floor-plans/old.png",
      events: ["No matching event"],
    };
    const futurePlan = {
      date: "2026-08-01",
      image: "/floor-plans/future.png",
      events: ["No matching event"],
    };

    expect(easternDateValue(new Date("2026-07-30T02:00:00.000Z"))).toBe(
      "2026-07-29",
    );
    expect(
      activeDatedAssets(
        [futurePlan, oldPlan],
        [],
        [futurePlan.image],
        new Date("2026-07-30T16:00:00.000Z"),
      ),
    ).toEqual([]);
  });
});
