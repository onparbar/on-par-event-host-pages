import { describe, expect, it } from "vitest";
import { reservationOccupancy, reservationOccupancyOverlap } from "../reservation-buffer";

const START = "2026-10-21T17:00:00-04:00";
const END = "2026-10-21T18:00:00-04:00";

describe("seating setup and cleanup occupancy", () => {
  it("blocks one hour before and 30 minutes after without changing supplied contract values", () => {
    expect(reservationOccupancy(START, END)).toEqual({
      startAt: "2026-10-21T20:00:00.000Z", endAt: "2026-10-21T22:30:00.000Z",
    });
    expect(START).toBe("2026-10-21T17:00:00-04:00");
    expect(END).toBe("2026-10-21T18:00:00-04:00");
  });

  it.each([[89, true], [90, false], [91, false]])("a %i-minute contract gap conflicts=%s", (gap, conflicts) => {
    const nextStart = new Date(Date.parse(END) + gap * 60_000).toISOString();
    const nextEnd = new Date(Date.parse(nextStart) + 60 * 60_000).toISOString();
    expect(Boolean(reservationOccupancyOverlap(START, END, nextStart, nextEnd))).toBe(conflicts);
    expect(Boolean(reservationOccupancyOverlap(nextStart, nextEnd, START, END))).toBe(conflicts);
  });

  it("reports the actual occupancy collision even when contracted windows do not overlap", () => {
    expect(reservationOccupancyOverlap(START, END, "2026-10-21T19:29:00-04:00", "2026-10-21T20:00:00-04:00"))
      .toEqual({ startAt: "2026-10-21T22:29:00.000Z", endAt: "2026-10-21T22:30:00.000Z" });
  });

  it.each([[null, END], [START, null], ["bad-time", END], [END, START], [START, START], ["2026-10-21T17:00:00", END]])(
    "leaves missing, invalid, reversed or unzoned times unresolved (%s, %s)", (start, end) => {
      expect(reservationOccupancy(start, end)).toBeNull();
      expect(reservationOccupancyOverlap(start, end, START, END)).toBeNull();
    },
  );

  it("keeps elapsed-minute protection across the New York daylight-saving boundary", () => {
    expect(reservationOccupancy("2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00")).toEqual({
      startAt: "2026-11-01T04:30:00.000Z", endAt: "2026-11-01T07:00:00.000Z",
    });
  });
});
