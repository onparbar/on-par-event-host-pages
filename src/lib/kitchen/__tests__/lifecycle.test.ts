import { describe, expect, it } from "vitest";
import {
  activeKitchenChecklists,
  isKitchenEventOver,
  kitchenEventInterval,
  type KitchenLifecycleEvent,
} from "../lifecycle";

function event(
  overrides: Partial<KitchenLifecycleEvent> = {},
): KitchenLifecycleEvent {
  return {
    localDate: "2026-07-30",
    startTime: "17:00",
    endTime: "19:00",
    ...overrides,
  };
}

describe("kitchen event lifecycle", () => {
  it("resolves the exact New York start and end instants", () => {
    expect(kitchenEventInterval(event())).toEqual({
      startAt: Date.parse("2026-07-30T21:00:00.000Z"),
      endAt: Date.parse("2026-07-30T23:00:00.000Z"),
    });
  });

  it("archives an explicit-offset event at its exact end instant", () => {
    const explicit = event({
      endTime: "2026-07-30T19:00:00-04:00",
    });

    expect(
      isKitchenEventOver(
        explicit,
        new Date("2026-07-30T22:59:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        explicit,
        new Date("2026-07-30T23:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("honors the winter New York offset", () => {
    const winter = event({
      localDate: "2026-12-15",
      startTime: "17:00",
      endTime: "2026-12-15T19:00:00-05:00",
    });

    expect(
      isKitchenEventOver(
        winter,
        new Date("2026-12-15T23:59:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        winter,
        new Date("2026-12-16T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("interprets clock-only values in America/New_York", () => {
    const localClock = event();

    expect(
      isKitchenEventOver(
        localClock,
        new Date("2026-07-30T22:59:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        localClock,
        new Date("2026-07-30T23:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("interprets a naive date-time as New York time instead of server time", () => {
    const naive = event({
      endTime: "2026-07-30T19:00",
    });

    expect(
      isKitchenEventOver(
        naive,
        new Date("2026-07-30T19:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        naive,
        new Date("2026-07-30T23:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("keeps an overnight event active until its next-day end", () => {
    const overnight = event({
      startTime: "23:00",
      endTime: "01:00",
    });

    expect(
      isKitchenEventOver(
        overnight,
        new Date("2026-07-31T04:59:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        overnight,
        new Date("2026-07-31T05:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("fails open for nonexistent or ambiguous local end times", () => {
    const nonexistent = event({
      localDate: "2026-03-08",
      startTime: "00:30",
      endTime: "02:30",
    });
    const ambiguous = event({
      localDate: "2026-11-01",
      startTime: "00:30",
      endTime: "01:30",
    });

    expect(
      isKitchenEventOver(
        nonexistent,
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        ambiguous,
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("uses an explicit offset to disambiguate a repeated local hour", () => {
    const explicitFallback = event({
      localDate: "2026-11-01",
      startTime: "2026-11-01T00:30:00-04:00",
      endTime: "2026-11-01T01:30:00-05:00",
    });

    expect(
      isKitchenEventOver(
        explicitFallback,
        new Date("2026-11-01T06:29:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        explicitFallback,
        new Date("2026-11-01T06:30:00.000Z"),
      ),
    ).toBe(true);
  });

  it("fails open when an end time is missing or malformed", () => {
    expect(
      isKitchenEventOver(
        event({ endTime: null }),
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        event({ endTime: "not a time" }),
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("fails open when a dated end conflicts with the event date", () => {
    expect(
      isKitchenEventOver(
        event({ endTime: "2026-08-15T19:00:00-04:00" }),
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isKitchenEventOver(
        event({ endTime: "2026-08-15T19:00" }),
        new Date("2027-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("filters ended checklists without changing active checklist order", () => {
    const checklists = [
      {
        id: "already-ended",
        event: event({ endTime: "18:00" }),
      },
      {
        id: "still-active",
        event: event({ endTime: "20:00" }),
      },
      {
        id: "needs-review",
        event: event({ endTime: null }),
      },
    ];

    expect(
      activeKitchenChecklists(
        checklists,
        new Date("2026-07-30T23:00:00.000Z"),
      ).map((checklist) => checklist.id),
    ).toEqual(["still-active", "needs-review"]);
  });
});
