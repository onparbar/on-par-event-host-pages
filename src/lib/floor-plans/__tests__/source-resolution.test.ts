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

function verifiedLink(row: FloorPlanSourceRow, ids = ["60526047"]) {
  return { ...row, source: { ...row.source, linkedTripleseatEventIds: ids } };
}

describe("floor-plan source resolution", () => {
  it("uses the BEO attendance for an explicitly verified linked VIP block", () => {
    const [resolved] = resolveFloorPlanSourceRows([
      row("60526047", plan({ guest_count: 25 }), "tripleseat"),
      verifiedLink(vipRow("vip-room", 2, "VIP 1", { guest_count: 60 })),
    ]);

    expect(resolved.plan.guest_count).toBe(25);
    expect(resolved.plan.review_reasons).toContain(
      "VIP booking guest count differs from the BEO; floor-plan seating uses the BEO guest count.",
    );
    expect(resolved.source?.onParBookingRooms).toEqual(["VIP 1"]);
  });

  it("does not fill a missing BEO attendance from a duplicate VIP booking", () => {
    const [resolved] = resolveFloorPlanSourceRows([
      row("60526047", plan({
        guest_count: 0,
        needs_review: true,
        review_reasons: ["Guest count is missing or invalid."],
      }), "tripleseat"),
      verifiedLink(vipRow("vip-room", 2, "VIP 1", { guest_count: 20 })),
    ]);

    expect(resolved.plan.guest_count).toBe(0);
    expect(resolved.plan.needs_review).toBe(true);
    expect(resolved.plan.review_reasons).toContain("Guest count is missing or invalid.");
  });

  it("retains OnPar attendance for VIP-only reservations without a matching BEO", () => {
    const [resolved] = resolveFloorPlanSourceRows([
      vipRow("vip-room", 2, "VIP 1", { guest_count: 18 }),
    ]);
    expect(resolved.plan.guest_count).toBe(18);
  });

  it("retains purchased extras from a secondary linked VIP source without treating unknown legacy counts as zero", () => {
    const first = verifiedLink(vipRow("vip-a", 2, "VIP 1"));
    const second = verifiedLink(vipRow("vip-b", 3, "VIP 2"));
    first.source = { ...first.source, vipExtraCount: 0 };
    second.source = { ...second.source, vipExtraCount: 2 };
    const before = structuredClone([first, second]);
    expect(resolveFloorPlanSourceRows([first, second])[0].source?.vipExtraCount).toBe(2);
    expect([first, second]).toEqual(before);
    const legacy = { ...second, source: { ...second.source, vipExtraCount: undefined } };
    expect(resolveFloorPlanSourceRows([first, legacy])[0].source?.vipExtraCount).toBeUndefined();
    expect(resolveFloorPlanSourceRows([{ ...first, source: { ...first.source, vipExtraCount: undefined } }, second])[0].source?.vipExtraCount).toBe(2);
  });

  it("recognizes a Tripleseat event-type prefix and OnPar VIP suffix", () => {
    expect(
      floorPlanSourceNamesMatch(
        "Work Outing - No Host Social",
        "No Host Social VIP",
      ),
    ).toBe(true);
  });

  it("uses one OnPar-referenced event for verified linked sources with the same interval", () => {
    const resolved = resolveFloorPlanSourceRows([
      row("60526047", plan({}), "tripleseat"),
      verifiedLink(vipRow("vip-af28fe8f", 2, "VIP 2")),
      verifiedLink(vipRow("vip-60cd18c0", 3, "VIP 1")),
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

  it("preserves both physical intervals when verified linked sources have different times", () => {
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
      verifiedLink(vipRow("vip-60cd18c0", 3, "VIP 1")),
    ]);

    expect(resolved).toHaveLength(2);
    expect(resolved.find((row) => row.sourceEventId === "vip-60cd18c0")).toMatchObject({
      sourceEventId: "vip-60cd18c0",
      plan: { time: "6:00 PM - 10:00 PM" },
      source: {
        eventStartAt: START,
        eventEndAt: END,
        sourceEventIds: ["vip-60cd18c0"],
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
        needs_review: false,
        review_reasons: [],
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
        .every((candidate) => !candidate.plan.needs_review),
    ).toBe(true);
  });

  it("does not merge distinct same-name reservations without verified source IDs", () => {
    const resolved = resolveFloorPlanSourceRows([row("60526047", plan({ guest_count: 25 }), "tripleseat"), vipRow("vip-one", 2, "VIP 1", { guest_count: 16 }), vipRow("vip-two", 3, "VIP 2", { guest_count: 18 })]);
    expect(resolved).toHaveLength(3);
    expect(resolved.find((row) => row.sourceEventId === "vip-one")?.plan.guest_count).toBe(16);
    expect(resolved.find((row) => row.sourceEventId === "vip-two")?.plan.guest_count).toBe(18);
  });

  it("does not turn legacy name-derived source aliases into a verified relationship", () => {
    const vip = vipRow("vip-one", 2, "VIP 1");
    vip.source = { ...vip.source, sourceEventIds: ["60526047", "vip-one"] };
    expect(resolveFloorPlanSourceRows([row("60526047", plan({}), "tripleseat"), vip])).toHaveLength(2);
  });
});
