import { describe, expect, it } from "vitest";
import { formatEntertainmentDurationHours, formatEntertainmentIntervalHours, normalizeEntertainmentDurationHours, parseEntertainmentDurationMinutes } from "../duration";

describe("exact entertainment durations in hours", () => {
  it.each([[60, "1 hour"], [120, "2 hours"], [180, "3 hours"], [90, "1.5 hours"], [15, "0.25 hours"], [45, "0.75 hours"], [10, "1/6 hour"], [20, "1/3 hour"], [80, "1 1/3 hours"]] as const)("formats %s purchased minutes as %s without rounding", (minutes, expected) => {
    expect(formatEntertainmentDurationHours(minutes)).toBe(expected);
    expect(parseEntertainmentDurationMinutes(expected)).toBe(minutes);
  });
  it.each(["90 minutes", "1 hour 30 minutes", "1.5 hrs", "1.5 hours 1.5 hours"])("normalizes %s", (value) => {
    expect(parseEntertainmentDurationMinutes(value)).toBe(90);
    expect(normalizeEntertainmentDurationHours(value)).toBe("1.5 hours");
  });
  it.each(["", "20 guests", "9 holes", "5:30 PM", "0 hours", "-2 hours", "1/0 hours", "2 hours or 3 hours", "0.0000001 hours"])("does not guess a duration from %s", (value) => expect(parseEntertainmentDurationMinutes(value)).toBeNull());
  it.each([0, -1, NaN, Infinity])("does not display invalid duration %s", (value) => expect(formatEntertainmentDurationHours(value)).toBe(""));
  it("keeps exact half-hour starts and midnight crossings", () => {
    expect(formatEntertainmentIntervalHours("2026-10-26T17:30:00-04:00", "2026-10-26T19:00:00-04:00")).toBe("1.5 hours");
    expect(formatEntertainmentIntervalHours("2026-10-26T23:30:00-04:00", "2026-10-27T01:00:00-04:00")).toBe("1.5 hours");
  });
});
