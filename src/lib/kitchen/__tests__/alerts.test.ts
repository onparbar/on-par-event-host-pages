import { describe, expect, it } from "vitest";
import {
  currentEventHostCompletionAlerts,
  currentKitchenAddOnAlerts,
  dueKitchenAlerts,
  easternMinuteKey,
  kitchenTimedAlerts,
  newlyObservedDueKitchenAlerts,
} from "../alerts";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { generateKitchenChecklist } from "../rules";

describe("kitchen timed alerts", () => {
  it("uses the America/New_York wall clock", () => {
    expect(easternMinuteKey(new Date("2026-07-29T16:05:00.000Z"))).toBe(
      "2026-07-29T12:05",
    );
    expect(easternMinuteKey(new Date("2026-12-01T16:05:00.000Z"))).toBe(
      "2026-12-01T11:05",
    );
  });

  it("builds one prep and one food-ready alert from calculated local times", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
    const alerts = kitchenTimedAlerts(
      [checklist],
      checklist.event.localDate,
    );

    expect(alerts.map((alert) => alert.kind).sort()).toEqual([
      "prep",
      "ready",
    ]);
    expect(
      alerts.every((alert) =>
        alert.scheduledAt.startsWith(`${checklist.event.localDate}T`),
      ),
    ).toBe(true);
  });

  it("keeps prior-day alert times associated with an after-midnight event", () => {
    const checklist = generateKitchenChecklist({
      ...MOCK_KITCHEN_EVENTS[0],
      localDate: "2026-07-29",
      startTime: "00:10",
    });
    const alerts = kitchenTimedAlerts([checklist], "2026-07-29");

    expect(alerts).toHaveLength(2);
    expect(
      alerts.find((alert) => alert.kind === "ready"),
    ).toMatchObject({
      eventId: "mock-taco-001",
      eventName: "Redacted Taco Package",
      scheduledAt: "2026-07-28T23:55",
    });
    expect(
      alerts.find((alert) => alert.kind === "prep")?.scheduledAt,
    ).toBe("2026-07-28T20:55");
  });

  it("does not borrow an adjacent date alert from a different event date", () => {
    const checklist = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);

    expect(kitchenTimedAlerts([checklist], "2026-07-29")).toEqual([]);
  });

  it("queues crossed alerts once and excludes dismissed alerts", () => {
    const alerts = [
      {
        id: "1:prep:2026-07-29T10:00",
        eventId: "1",
        eventName: "First",
        kind: "prep" as const,
        scheduledAt: "2026-07-29T10:00",
      },
      {
        id: "2:ready:2026-07-29T10:01",
        eventId: "2",
        eventName: "Second",
        kind: "ready" as const,
        scheduledAt: "2026-07-29T10:01",
      },
    ];

    expect(
      dueKitchenAlerts(
        alerts,
        "2026-07-29T09:59",
        "2026-07-29T10:01",
        new Set([alerts[0].id]),
      ).map((alert) => alert.id),
    ).toEqual([alerts[1].id]);
  });

  it("queues a newly introduced overdue prep alert unless it is known or dismissed", () => {
    const alerts = [
      {
        id: "123:prep:2026-07-29T15:15",
        eventId: "123",
        eventName: "Late food add-on",
        kind: "prep" as const,
        scheduledAt: "2026-07-29T15:15",
      },
    ];

    expect(
      newlyObservedDueKitchenAlerts(
        alerts,
        new Set(),
        "2026-07-29T16:00",
        new Set(),
      ),
    ).toEqual(alerts);
    expect(
      newlyObservedDueKitchenAlerts(
        alerts,
        new Set([alerts[0].id]),
        "2026-07-29T16:00",
        new Set(),
      ),
    ).toEqual([]);
    expect(
      newlyObservedDueKitchenAlerts(
        alerts,
        new Set(),
        "2026-07-29T16:00",
        new Set([alerts[0].id]),
      ),
    ).toEqual([]);
  });
});

describe("live add-on alerts", () => {
  it("identifies each kitchen order update by exact event and revision", () => {
    const activity = [
      {
        eventId: "event-123",
        eventName: "Redacted event",
        revision: 4,
        updatedAt: "2026-07-29T18:00:00.000Z",
        itemNames: ["Wings", "Ranch"],
      },
    ];

    expect(currentKitchenAddOnAlerts(activity, new Set())).toEqual([
      {
        id: "event-123:add-on-revision:4",
        eventId: "event-123",
        eventName: "Redacted event",
        kind: "add-on",
        itemNames: ["Wings", "Ranch"],
        receivedAt: "2026-07-29T18:00:00.000Z",
      },
    ]);
    expect(
      currentKitchenAddOnAlerts(
        activity,
        new Set(["event-123:add-on-revision:4"]),
      ),
    ).toEqual([]);
    expect(
      currentKitchenAddOnAlerts(
        [{ ...activity[0], revision: 5 }],
        new Set(["event-123:add-on-revision:4"]),
      )[0]?.id,
    ).toBe("event-123:add-on-revision:5");
  });

  it("does not alert the kitchen for an empty add-on snapshot", () => {
    expect(
      currentKitchenAddOnAlerts(
        [
          {
            eventId: "event-123",
            eventName: "Redacted event",
            revision: 5,
            updatedAt: "2026-07-29T18:01:00.000Z",
            itemNames: [],
          },
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("identifies Ready alerts by the readiness timestamp so rechecks alert again", () => {
    const completion = {
      eventId: "event-123",
      eventName: "Redacted event",
      itemKey: "addon:wings",
      foodName: "Wings",
      readinessUpdatedAt: "2026-07-29T18:02:00.000Z",
    };
    const first = currentEventHostCompletionAlerts(
      [completion],
      new Set(),
    );

    expect(first).toEqual([
      {
        id: "event-123:add-on-ready:addon:wings:2026-07-29T18:02:00.000Z",
        eventId: "event-123",
        eventName: "Redacted event",
        itemNames: ["Wings"],
      },
    ]);
    expect(
      currentEventHostCompletionAlerts(
        [completion],
        new Set([first[0].id]),
      ),
    ).toEqual([]);
    expect(
      currentEventHostCompletionAlerts(
        [
          {
            ...completion,
            readinessUpdatedAt: "2026-07-29T18:04:00.000Z",
          },
        ],
        new Set([first[0].id]),
      )[0]?.id,
    ).toContain("2026-07-29T18:04:00.000Z");
  });

  it("keeps completion alerts attached to their exact events", () => {
    const alerts = currentEventHostCompletionAlerts(
      [
        {
          eventId: "event-a",
          eventName: "Event A",
          itemKey: "addon:ranch",
          foodName: "Ranch",
          readinessUpdatedAt: "2026-07-29T18:05:00.000Z",
        },
        {
          eventId: "event-b",
          eventName: "Event B",
          itemKey: "addon:ranch",
          foodName: "Ranch",
          readinessUpdatedAt: "2026-07-29T18:05:00.000Z",
        },
      ],
      new Set(),
    );

    expect(alerts.map((alert) => alert.eventId)).toEqual([
      "event-a",
      "event-b",
    ]);
  });
});
