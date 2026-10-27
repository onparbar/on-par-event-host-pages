import { describe, expect, it } from "vitest";
import { validateReservationTimes } from "../domain";

describe("contract duration is not rounded to the editor grid", () => {
  it.each([
    ["2026-10-26T17:30:00-04:00", "2026-10-26T17:50:00-04:00"],
    ["2026-10-26T17:35:00-04:00", "2026-10-26T19:05:00-04:00"],
    ["2026-10-26T23:40:00-04:00", "2026-10-27T00:50:00-04:00"],
  ])("accepts the exact purchased interval %s to %s", (start, end) => expect(() => validateReservationTimes(start, end)).not.toThrow());
  it.each([
    ["2026-10-26T17:30:00", "2026-10-26T19:00:00"],
    ["2026-10-26T17:30:00-04:00", "2026-10-26T17:30:00-04:00"],
    ["2026-10-26T19:00:00-04:00", "2026-10-26T17:30:00-04:00"],
    ["invalid", "2026-10-26T19:00:00-04:00"],
  ])("still rejects invalid/ambiguous interval %s to %s", (start, end) => expect(() => validateReservationTimes(start, end)).toThrow());
});
