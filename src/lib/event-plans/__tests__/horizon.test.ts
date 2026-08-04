import { describe, expect, it } from "vitest";
import {
  addOneCalendarMonthClamped,
  enumerateEventPlanDates,
  eventPlanToday,
  isValidEventPlanDate,
  rollingEventPlanHorizon,
} from "../horizon";

describe("event-plan rolling horizon", () => {
  it("uses the America/New_York date at the UTC day boundary", () => {
    expect(eventPlanToday(new Date("2026-07-30T03:59:59.000Z"))).toBe(
      "2026-07-29",
    );
    expect(eventPlanToday(new Date("2026-07-30T04:00:00.000Z"))).toBe(
      "2026-07-30",
    );
  });

  it("clamps January 31 to the final day of February", () => {
    expect(addOneCalendarMonthClamped("2027-01-31")).toBe("2027-02-28");
    expect(addOneCalendarMonthClamped("2028-01-31")).toBe("2028-02-29");
  });

  it("rolls December into the next year", () => {
    expect(addOneCalendarMonthClamped("2026-12-31")).toBe("2027-01-31");
  });

  it("enumerates both endpoints of the rolling window", () => {
    const horizon = rollingEventPlanHorizon(
      new Date("2026-07-30T16:00:00.000Z"),
    );

    expect(horizon).toMatchObject({
      startDate: "2026-07-30",
      endDate: "2026-08-30",
    });
    expect(horizon.dates).toHaveLength(32);
    expect(horizon.dates[0]).toBe("2026-07-30");
    expect(horizon.dates.at(-1)).toBe("2026-08-30");
  });

  it("enumerates a single-date inclusive range", () => {
    expect(enumerateEventPlanDates("2026-08-30", "2026-08-30")).toEqual([
      "2026-08-30",
    ]);
  });

  it("accepts only real zero-padded YYYY-MM-DD dates", () => {
    expect(isValidEventPlanDate("2028-02-29")).toBe(true);
    expect(isValidEventPlanDate("2027-02-29")).toBe(false);
    expect(isValidEventPlanDate("2026-2-03")).toBe(false);
    expect(isValidEventPlanDate("2026-02-3")).toBe(false);
    expect(isValidEventPlanDate("2026-13-01")).toBe(false);
    expect(() => addOneCalendarMonthClamped("2026-02-30")).toThrow(
      "valid YYYY-MM-DD",
    );
    expect(() =>
      enumerateEventPlanDates("2026-08-31", "2026-08-30"),
    ).toThrow("on or before");
  });
});
