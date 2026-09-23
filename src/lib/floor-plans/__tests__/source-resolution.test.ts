import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import {
  floorPlanSourceNamesMatch,
  resolveFloorPlanSourceRows,
  type FloorPlanSourceRow,
} from "../source-resolution";

const DATE = "2026-09-14";
const START = "2026-09-14T18:00:00-04:00";
const END = "2026-09-14T22:00:00-04:00";

function plan(overrides: Partial<EventPlan>): EventPlan {
  return {
    id: 1,
    name: "Work Outing - No Host Social",
    date: DATE,
    day: "Monday",
    time: "6:00 PM - 10:00 PM",
    guest_count: 60,
    rooms: ["Main Dining Room"],
    color: "#BE123C",
    food: [],
    drink_options: [],
    entertainment: [],
    verification_status: "Tripleseat contract",
    source_updated_at: "2026-06-17T20:37:00Z",
    ...overrides,
  };
}

function row(
  sourceEventId: string,
  eventPlan: EventPlan,
  sourceSystem: "tripleseat" | "vip-prep",
): FloorPlanSourceRow {
  return {
    plan: eventPlan,
    source: {
      status: "DEFINITE",
      rooms: eventPlan.rooms,
      eventStartAt: START,
      eventEndAt: END,
      sourceUpdatedAt: eventPlan.source_updated_at,
      sourceSystem,
    },
    sourceEventId,
  };
}

function vipRow(
  id: string,
  numericId: number,
  room: "VIP 1" | "VIP 2",
  overrides: Partial<EventPlan> = {},
) {
  return row(
    id,
    plan({
      id: numericId,
      name: "No Host Social VIP",
      guest_count: 1,
      rooms: [room],
      color: room === "VIP 1" ? "#7C3AED" : "#1D4ED8",
      verification_status: "OnParBookings reservation",
      source_updated_at: "2026-09-14T14:40:10Z",
      ...overrides,
    }),
    "vip-prep",
  );
}

describe("floor-plan source resolution", () => {
  it("recognizes a Tripleseat event-type prefix and OnPar VIP suffix", () => {
    expect(
      floorPlanSourceNamesMatch(
        "Work Outing - No Host Social",
        "No Host Social VIP",
      ),
    ).toBe(true);
  });

  it("uses one OnPar-referenced event for a matching Tripleseat block and both VIP rooms", () => {
    const resolved = resolveFloorPlanSourceRows([
      row("60526047", plan({}), "tripleseat"),
      vipRow("vip-af28fe8f", 2, "VIP 2"),
      vipRow("vip-60cd18c0", 3, "VIP 1"),
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      sourceEventId: "vip-60cd18c0",
      plan: {
        name: "No Host Social VIP",
        guest_count: 60,
        rooms: ["Main Dining Room", "VIP 1", "VIP 2"],
        time: "6:00 PM - 10:00 PM",
      },
      source: {
        sourceSystem: "vip-prep",
        sourceEventIds: ["60526047", "vip-60cd18c0", "vip-af28fe8f"],
        onParBookingRooms: ["VIP 1", "VIP 2"],
      },
    });
  });

  it("does not merge same-name reservations with different time windows", () => {
    const later = vipRow("vip-later", 4, "VIP 2", {
      time: "10:30 PM - 11:30 PM",
    });
    later.source = {
      ...later.source,
      eventStartAt: "2026-09-14T22:30:00-04:00",
      eventEndAt: "2026-09-14T23:30:00-04:00",
    };

    expect(
      resolveFloorPlanSourceRows([
        vipRow("vip-earlier", 3, "VIP 1"),
        later,
      ]),
    ).toHaveLength(2);
  });

  it("uses the OnPar time when a matching Tripleseat block has a different time", () => {
    const tripleseat = row(
      "60526047",
      plan({ time: "5:00 PM - 9:00 PM" }),
      "tripleseat",
    );
    tripleseat.source = {
      ...tripleseat.source,
      eventStartAt: "2026-09-14T17:00:00-04:00",
      eventEndAt: "2026-09-14T21:00:00-04:00",
    };

    const resolved = resolveFloorPlanSourceRows([
      tripleseat,
      vipRow("vip-60cd18c0", 3, "VIP 1"),
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      sourceEventId: "vip-60cd18c0",
      plan: { time: "6:00 PM - 10:00 PM" },
      source: {
        eventStartAt: START,
        eventEndAt: END,
        sourceEventIds: ["60526047", "vip-60cd18c0"],
      },
    });
  });

  it("does not absorb ambiguous same-name Tripleseat events", () => {
    const resolved = resolveFloorPlanSourceRows([
      row("tripleseat-1", plan({ id: 10 }), "tripleseat"),
      row("tripleseat-2", plan({ id: 11 }), "tripleseat"),
      vipRow("vip-60cd18c0", 3, "VIP 1"),
    ]);

    expect(resolved).toHaveLength(3);
    const onPar = resolved.find(
      (candidate) => candidate.sourceEventId === "vip-60cd18c0",
    );
    expect(onPar).toMatchObject({
      plan: {
        needs_review: true,
        review_reasons: [
          "Multiple same-name source records match this OnPar reservation; floor-plan source needs review.",
        ],
      },
      source: { sourceEventIds: ["vip-60cd18c0"] },
    });
  });

  it("does not match an arbitrary organization prefix", () => {
    expect(
      floorPlanSourceNamesMatch(
        "Acme - Holiday Party",
        "Holiday Party VIP",
      ),
    ).toBe(false);
  });

  it("does not guess which same-name OnPar time block belongs to Tripleseat", () => {
    const later = vipRow("vip-later", 4, "VIP 2", {
      time: "10:30 PM - 11:30 PM",
    });
    later.source = {
      ...later.source,
      eventStartAt: "2026-09-14T22:30:00-04:00",
      eventEndAt: "2026-09-14T23:30:00-04:00",
    };

    const resolved = resolveFloorPlanSourceRows([
      row("60526047", plan({}), "tripleseat"),
      vipRow("vip-earlier", 3, "VIP 1"),
      later,
    ]);

    expect(resolved).toHaveLength(3);
    expect(
      resolved
        .filter((candidate) => candidate.sourceEventId.startsWith("vip-"))
        .every((candidate) => candidate.plan.needs_review),
    ).toBe(true);
  });
});
