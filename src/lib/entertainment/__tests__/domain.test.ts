import { describe, expect, it } from "vitest";
import {
  buildEntertainmentSchedule,
  conflictForCandidate,
  detectEntertainmentConflicts,
  findAdjacentAvailableResources,
  matchLocalEvent,
  mergeReservationsForSync,
  validEntertainmentInterval,
  validateReservationTimes,
  type LocalEntertainmentEvent,
} from "../domain";
import {
  ENTERTAINMENT_RESOURCES,
  ENTERTAINMENT_SCHEDULE_CATEGORIES,
  canonicalCategoryForText,
  deterministicEventColor,
  exactResourceIdsForText,
  quantityForText,
  resourcesForCategory,
  textColorForBackground,
} from "../resources";
import {
  addCalendarDays,
  isValidEntertainmentDate,
  operatingWindow,
  parseTimeRange,
  zonedDateTimeToIso,
} from "../time";
import type {
  EntertainmentReservation,
  EntertainmentSourceEvent,
  EntertainmentSourceItem,
} from "../types";

const DATE = "2026-07-28";
const START = "2026-07-28T21:00:00.000Z";
const END = "2026-07-28T22:00:00.000Z";
const NOW = "2026-07-28T12:00:00.000Z";

function sourceItem(
  overrides: Partial<EntertainmentSourceItem> = {},
): EntertainmentSourceItem {
  return {
    sourceId: "line-1",
    name: "Bowling Lanes 3-4",
    description: null,
    categoryName: "Bowling",
    quantity: 2,
    startAt: START,
    endAt: END,
    ...overrides,
  };
}

function sourceEvent(
  overrides: Partial<EntertainmentSourceEvent> = {},
): EntertainmentSourceEvent {
  return {
    tripleseatEventId: "ts-100",
    tripleseatBookingId: "booking-50",
    eventName: "Redacted Company Social",
    localDate: DATE,
    eventStartAt: START,
    eventEndAt: END,
    status: "DEFINITE",
    rooms: [],
    items: [sourceItem()],
    categoryNames: ["Bowling"],
    sourceUpdatedAt: "2026-07-28T11:00:00.000Z",
    noteCount: 0,
    ...overrides,
  };
}

function localEvent(
  overrides: Partial<LocalEntertainmentEvent> = {},
): LocalEntertainmentEvent {
  return {
    id: "ts-100",
    bookingId: "booking-50",
    name: "Redacted Company Social",
    date: DATE,
    color: "#297025",
    rooms: [],
    entertainment: [],
    ...overrides,
  };
}

function reservation(
  overrides: Partial<EntertainmentReservation> = {},
): EntertainmentReservation {
  return {
    id: "reservation-1",
    syncKey: "ts-100:line-1:0",
    localEventId: "ts-100",
    tripleseatEventId: "ts-100",
    tripleseatBookingId: "booking-50",
    eventName: "Redacted Company Social",
    operatingDate: DATE,
    resourceId: "bowling-1",
    resourceCategory: "bowling",
    resourceName: "Bowling Lane 1",
    startAt: START,
    endAt: END,
    sourceStartAt: START,
    sourceEndAt: END,
    sourceResourceId: "bowling-1",
    eventColor: "#297025",
    colorSource: "event-plan",
    source: "tripleseat",
    sourceReference: "line-1",
    manualOverride: false,
    hasSourceUpdate: false,
    needsReview: false,
    reviewIssues: [],
    autoAssigned: false,
    notes: "",
    sourceUpdatedAt: "2026-07-28T11:00:00.000Z",
    lastTripleseatSyncAt: NOW,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: "tripleseat-sync",
    ...overrides,
  };
}

describe("canonical entertainment resources", () => {
  it("defines exactly 33 active physical resources in canonical order", () => {
    expect(ENTERTAINMENT_RESOURCES).toHaveLength(33);
    expect(ENTERTAINMENT_RESOURCES.every((resource) => resource.active)).toBe(
      true,
    );
    expect(ENTERTAINMENT_RESOURCES[0].canonicalName).toBe("Bowling Lane 1");
    expect(ENTERTAINMENT_RESOURCES.at(-1)?.canonicalName).toBe("The Big Show");
  });

  it("keeps mini golf out of the reservable schedule categories", () => {
    expect(ENTERTAINMENT_SCHEDULE_CATEGORIES).not.toContain("mini-golf");
  });

  it("keeps every schedule resource in its intended layout category", () => {
    expect(ENTERTAINMENT_SCHEDULE_CATEGORIES).toEqual([
      "bowling",
      "darts",
      "pool",
      "shuffleboard",
      "private-rooms",
    ]);
    expect(resourcesForCategory("bowling")).toHaveLength(12);
    expect(resourcesForCategory("darts")).toHaveLength(5);
    expect(resourcesForCategory("pool")).toHaveLength(3);
    expect(resourcesForCategory("shuffleboard")).toHaveLength(2);
    expect(resourcesForCategory("private-rooms")).toHaveLength(8);
  });

  it.each([
    ["duckpin bowling", "bowling"],
    ["Dart Boards", "darts"],
    ["billiards", "pool"],
    ["Neo Shuffle", "shuffleboard"],
    ["Mini Golf", "mini-golf"],
    ["The Disco Inferno", "private-rooms"],
  ] as const)("maps %s to %s", (label, expected) => {
    expect(canonicalCategoryForText(label)).toBe(expected);
  });

  it("parses exact resource ranges and conjunctions", () => {
    expect(exactResourceIdsForText("Bowling Lanes 3 through 5")).toEqual([
      "bowling-3",
      "bowling-4",
      "bowling-5",
    ]);
    expect(exactResourceIdsForText("Dart Boards 1 and 3")).toEqual([
      "darts-1",
      "darts-3",
    ]);
  });

  it("uses an explicit resource count before billable unit-hours", () => {
    expect(quantityForText("2 bowling lanes", "bowling", 4)).toBe(2);
    expect(quantityForText("3 lanes for 4 hours", "bowling", 12)).toBe(3);
    expect(
      quantityForText(
        "Duckpin Bowling per hour, per lane Sunday-Thursday*6 people per lane4 lanes for 3 hours7p-10p",
        "bowling",
        12,
      ),
    ).toBe(4);
    expect(quantityForText("1 lane for 4 hours", "darts", 4)).toBe(1);
    expect(
      quantityForText("Pool Table Sunday-Thursday1 table for 2 hours8p-10p", "pool", 2),
    ).toBe(1);
    expect(quantityForText("1 pool table for 2 hours", "pool", 2)).toBe(1);
    expect(quantityForText("1 shuffleboard table for 2 hours", "shuffleboard", 2)).toBe(1);
    expect(quantityForText("3 dart boards", "darts", null)).toBe(3);
    expect(
      quantityForText(
        "1 Hour Bowling Lane Rental - Friday-Saturday",
        "bowling",
        1,
      ),
    ).toBe(1);
    expect(quantityForText("Duckpin Bowling per hour", "bowling", 12)).toBeNull();
    expect(quantityForText("Level Up Mini Golf", "mini-golf", 50)).toBe(50);
    expect(quantityForText("Level Up Mini Golf", "mini-golf", null)).toBeNull();
  });

  it("produces stable accessible fallback colors and contrast text", () => {
    expect(deterministicEventColor("event-42")).toBe(
      deterministicEventColor("event-42"),
    );
    expect(textColorForBackground("#FFFFFF")).toBe("#000000");
    expect(textColorForBackground("#18332F")).toBe("#FFFFFF");
  });
});

describe("America/New_York operating time rules", () => {
  it("validates real calendar dates and adds days without host timezone drift", () => {
    expect(isValidEntertainmentDate("2028-02-29")).toBe(true);
    expect(isValidEntertainmentDate("2027-02-29")).toBe(false);
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("uses the 10 AM through next-day 1 AM summer operating window", () => {
    expect(operatingWindow(DATE)).toEqual({
      startAt: "2026-07-28T14:00:00.000Z",
      endAt: "2026-07-29T05:00:00.000Z",
    });
  });

  it("accounts for winter daylight-saving offset", () => {
    expect(zonedDateTimeToIso("2026-12-15", 10, 0)).toBe(
      "2026-12-15T15:00:00.000Z",
    );
  });

  it("parses a cross-midnight reservation into the next calendar day", () => {
    expect(parseTimeRange("11:30 PM - 12:45 AM", DATE)).toEqual({
      startAt: "2026-07-29T03:30:00.000Z",
      endAt: "2026-07-29T04:45:00.000Z",
    });
  });

  it("rejects a nonexistent daylight-saving wall-clock time", () => {
    expect(() => zonedDateTimeToIso("2026-03-08", 2, 30)).toThrow(
      "does not exist",
    );
  });

  it("preserves exact clock times while requiring a positive zoned reservation interval", () => {
    expect(() =>
      validateReservationTimes(
        "2026-07-28T21:07:00.000Z",
        "2026-07-28T22:00:00.000Z",
      ),
    ).not.toThrow();
    expect(() => validateReservationTimes(END, START)).toThrow(
      "after its start",
    );
  });
});

describe("deterministic schedule construction", () => {
  it("matches Event Host events by Tripleseat event ID first", () => {
    const matched = matchLocalEvent(sourceEvent(), [
      localEvent({ name: "Different local label" }),
    ]);
    expect(matched?.matchedBy).toBe("tripleseat-event-id");
  });

  it("falls back to booking ID and then exact normalized name plus date", () => {
    expect(
      matchLocalEvent(sourceEvent({ tripleseatEventId: "different" }), [
        localEvent({ id: "local", name: "Other" }),
      ])?.matchedBy,
    ).toBe("tripleseat-booking-id");
    expect(
      matchLocalEvent(
        sourceEvent({
          tripleseatEventId: "different",
          tripleseatBookingId: null,
          eventName: "  Redacted—Company Social ",
        }),
        [localEvent({ id: "local", bookingId: null })],
      )?.matchedBy,
    ).toBe("name-and-date");
  });

  it("uses exact Tripleseat resources and the Event Host event color", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [sourceEvent()],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations.map((item) => item.resourceId)).toEqual([
      "bowling-3",
      "bowling-4",
    ]);
    expect(
      new Set(result.reservations.map((item) => item.eventColor)),
    ).toEqual(new Set(["#297025"]));
  });

  it("uses reserved-entertainment wording instead of billable quantities", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          items: [
            sourceItem({
              sourceId: "bowling-line",
              name: "Duckpin Bowling",
              description: "3 lanes for 4 hours",
              categoryName: "Bowling",
              quantity: 12,
              startAt: null,
              endAt: null,
            }),
            sourceItem({
              sourceId: "darts-line",
              name: "Darts per hour, per lane Sunday-Thursday",
              description: "1 lane for 4 hours",
              categoryName: "Darts",
              quantity: 4,
              startAt: null,
              endAt: null,
            }),
            sourceItem({
              sourceId: "pool-line",
              name: "Pool Table Sunday-Thursday",
              description: "1 table for 4 hours",
              categoryName: "Pool",
              quantity: 4,
              startAt: null,
              endAt: null,
            }),
          ],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });

    expect(result.reservations).toHaveLength(5);
    expect(
      result.reservations.filter((item) => item.resourceCategory === "bowling"),
    ).toHaveLength(3);
    expect(
      result.reservations.filter((item) => item.resourceCategory === "darts"),
    ).toHaveLength(1);
    expect(
      result.reservations.filter((item) => item.resourceCategory === "pool"),
    ).toHaveLength(1);
    expect(result.reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startAt: START,
          endAt: "2026-07-29T01:00:00.000Z",
        }),
      ]),
    );
    expect(result.events[0].reviewIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }),
      ]),
    );
  });

  it("does not create reservations or timing warnings for open-play mini golf", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          items: [
            sourceItem({
              name: "Mini Golf",
              description: "Mini Golf for event guests",
              categoryName: "Mini Golf",
              quantity: 50,
              startAt: null,
              endAt: null,
            }),
          ],
          categoryNames: ["Mini Golf"],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });

    expect(result.reservations).toHaveLength(0);
    expect(result.events[0].reviewIssues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }),
      ]),
    );
  });

  it("auto-assigns the first contiguous available resources", () => {
    const occupied = [
      reservation({
        id: "occupied",
        resourceId: "bowling-1",
        resourceName: "Bowling Lane 1",
      }),
    ];
    expect(
      findAdjacentAvailableResources(
        "bowling",
        3,
        START,
        END,
        occupied,
      ).map((resource) => resource.id),
    ).toEqual(["bowling-2", "bowling-3", "bowling-4"]);
  });

  it("does not invent a reservation when no usable time exists", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          eventStartAt: null,
          eventEndAt: null,
          items: [
            sourceItem({
              startAt: null,
              endAt: null,
              description: "Bowling Lanes 3-4",
            }),
          ],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations).toHaveLength(0);
    expect(result.events[0].reviewIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TIME_NEEDS_REVIEW" }),
      ]),
    );
  });

  it("does not substitute the full event window when contracted duration is missing", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          items: [
            sourceItem({
              startAt: null,
              endAt: null,
              name: "Bowling Lane 3",
              description: "Bowling Lane 3",
              quantity: 1,
            }),
          ],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations).toEqual([]);
    expect(result.events[0].reviewIssues).toContainEqual(expect.objectContaining({ code: "TIME_NEEDS_REVIEW", message: expect.stringContaining("duration") }));
  });

  it("reports a resource shortage instead of inventing a thirteenth lane", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          items: [
            sourceItem({
              name: "13 bowling lanes",
              description: "13 bowling lanes",
              quantity: 13,
            }),
          ],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations).toHaveLength(12);
    expect(result.events[0].reviewIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INSUFFICIENT_RESOURCES" }),
      ]),
    );
  });

  it("creates private-room reservations from structured Tripleseat rooms", () => {
    const result = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          rooms: [{ id: "room-1", name: "The Gem Room" }],
          items: [],
          categoryNames: [],
        }),
      ],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations).toEqual([
      expect.objectContaining({
        resourceId: "private-room-gem",
        resourceName: "The Gem Room",
      }),
    ]);
  });

  it("removes an exact duplicate event/resource/time block and flags it", () => {
    const item = sourceItem({
      name: "Bowling Lane 3",
      description: "Bowling Lane 3",
      quantity: 1,
    });
    const result = buildEntertainmentSchedule({
      sourceEvents: [sourceEvent({ items: [item, { ...item, sourceId: "line-2" }] })],
      localEvents: [localEvent()],
      now: NOW,
    });
    expect(result.reservations).toHaveLength(1);
    expect(result.events[0].reviewIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ENTERTAINMENT" }),
      ]),
    );
  });

  it.each([false, true])("keeps meaningful revision time through identical repeated syncs (manual override: %s)", (manualOverride) => {
    const firstAt = "2026-07-28T10:00:00.000Z";
    const original = reservation({ manualOverride, updatedAt: firstAt, lastTripleseatSyncAt: firstAt });
    const first = mergeReservationsForSync([original], [reservation({ updatedAt: NOW, lastTripleseatSyncAt: NOW })], NOW);
    const later = "2026-07-28T13:00:00.000Z";
    const second = mergeReservationsForSync(first, [reservation({ updatedAt: later, lastTripleseatSyncAt: later })], later);
    expect(first[0].updatedAt).toBe(firstAt);
    expect(second[0].updatedAt).toBe(firstAt);
    expect(second[0].lastTripleseatSyncAt).toBe(later);
  });

  it.each([
    { resourceId: "bowling-2", resourceName: "Bowling Lane 2" },
    { startAt: "2026-07-28T22:00:00.000Z", endAt: "2026-07-28T23:00:00.000Z" },
    { eventColor: "#18332F" },
    { sourceUpdatedAt: "2026-07-28T11:30:00.000Z" },
    { active: false },
  ])("advances the revision when meaningful synchronized content changes: %j", (change) => {
    const original = reservation({ updatedAt: "2026-07-28T10:00:00.000Z" });
    expect(mergeReservationsForSync([original], [reservation(change)], NOW)[0].updatedAt).toBe(NOW);
  });

  it("does not repeatedly revise a previously deactivated source reservation", () => {
    const original = reservation({ active: false, updatedAt: "2026-07-28T10:00:00.000Z" });
    expect(mergeReservationsForSync([original], [], NOW)[0].updatedAt).toBe(original.updatedAt);
  });

  it("preserves a manual resource/time override across repeated syncs", () => {
    const original = reservation({
      manualOverride: true,
      resourceId: "bowling-8",
      resourceName: "Bowling Lane 8",
      startAt: "2026-07-28T22:00:00.000Z",
      endAt: "2026-07-28T23:00:00.000Z",
      updatedBy: "authenticated-event-host-staff",
    });
    const incoming = reservation({
      id: "new-generated-id",
      sourceUpdatedAt: "2026-07-28T12:00:00.000Z",
    });
    const first = mergeReservationsForSync([original], [incoming], NOW);
    const second = mergeReservationsForSync(first, [incoming], NOW);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      id: original.id,
      resourceId: "bowling-8",
      startAt: "2026-07-28T22:00:00.000Z",
      manualOverride: true,
      hasSourceUpdate: false,
    });
  });

  it("counts same-event manual lanes toward an ambiguous contract quantity", () => {
    const existingManualReservations = [1, 2, 3, 4].map((lane) =>
      reservation({
        id: `manual-bowling-${lane}`,
        syncKey: null,
        localEventId: "ts-100",
        tripleseatEventId: null,
        resourceId: `bowling-${lane}`,
        resourceName: `Bowling Lane ${lane}`,
        source: "manual",
        manualOverride: true,
      }),
    );
    const built = buildEntertainmentSchedule({
      sourceEvents: [
        sourceEvent({
          items: [
            sourceItem({
              name: "Duckpin Bowling",
              description: "5 Duckpin Bowling lanes for 1 hour",
              quantity: 5,
            }),
          ],
        }),
      ],
      localEvents: [localEvent()],
      existingReservations: existingManualReservations,
      now: NOW,
    });
    const merged = mergeReservationsForSync(
      existingManualReservations,
      built.reservations,
      NOW,
    );

    expect(built.reservations).toHaveLength(1);
    expect(built.reservations[0].resourceId).toBe("bowling-5");
    expect(merged.filter((item) => item.active)).toHaveLength(5);
  });

  it("deactivates a removed Tripleseat reservation without deleting it", () => {
    expect(
      mergeReservationsForSync([reservation()], [], NOW)[0],
    ).toMatchObject({
      id: "reservation-1",
      active: false,
      updatedBy: "tripleseat-sync",
    });
  });

  it("detects true overlap but permits back-to-back reservations on the same lane", () => {
    const first = reservation();
    const overlap = reservation({
      id: "reservation-2",
      eventName: "Another Event",
      syncKey: "another",
      startAt: "2026-07-28T21:30:00.000Z",
      endAt: "2026-07-28T22:30:00.000Z",
    });
    const adjacent = reservation({
      id: "reservation-3",
      syncKey: "adjacent",
      startAt: END,
      endAt: "2026-07-28T23:00:00.000Z",
    });
    expect(detectEntertainmentConflicts([first, overlap])).toHaveLength(1);
    expect(detectEntertainmentConflicts([first, adjacent])).toHaveLength(0);
  });

  it.each([[-1, true], [0, false], [1, false], [30, false], [60, false]])("uses actual booked times at a %i-minute gap for conflict, editing, and autoassignment", (gap, conflicts) => {
    const first = reservation();
    const startAt = new Date(Date.parse(END) + gap * 60_000).toISOString();
    const endAt = new Date(Date.parse(startAt) + 60 * 60_000).toISOString();
    const next = reservation({ id: "later", startAt, endAt });
    expect(detectEntertainmentConflicts([first, next])).toHaveLength(conflicts ? 1 : 0);
    expect(conflictForCandidate(next, [first])).toHaveLength(conflicts ? 1 : 0);
    expect(findAdjacentAvailableResources("bowling", 1, startAt, endAt, [first])[0]?.id)
      .toBe(conflicts ? "bowling-2" : "bowling-1");
    expect(first).toMatchObject({ startAt: START, endAt: END });
    expect(next).toMatchObject({ startAt, endAt });
  });

  it.each(ENTERTAINMENT_SCHEDULE_CATEGORIES)("permits back-to-back %s entertainment reservations without seating buffers", (category) => {
    const resource = resourcesForCategory(category)[0];
    const first = reservation({ resourceId: resource.id, resourceCategory: category, resourceName: resource.canonicalName });
    const next = reservation({ ...first, id: "next", startAt: END, endAt: "2026-07-28T23:00:00.000Z" });
    expect(detectEntertainmentConflicts([first, next])).toEqual([]);
    expect(conflictForCandidate(next, [first])).toEqual([]);
    expect(findAdjacentAvailableResources(category, 1, next.startAt, next.endAt, [first])[0]?.id).toBe(resource.id);
  });

  it("requires explicit zoned positive-duration entertainment intervals", () => {
    expect(validEntertainmentInterval(START, END)).toBe(true);
    expect(validEntertainmentInterval("2026-07-28T17:00:00-04:00", "2026-07-28T18:00:00-04:00")).toBe(true);
    expect(validEntertainmentInterval(END, START)).toBe(false);
    expect(validEntertainmentInterval(START, START)).toBe(false);
    expect(validEntertainmentInterval("invalid", END)).toBe(false);
    expect(validEntertainmentInterval("2026-07-28T21:00:00", "2026-07-28T22:00:00")).toBe(false);
  });

  it("does not block different resources or inactive reservations", () => {
    const first = reservation();
    const other = reservation({ id: "other", resourceId: "bowling-2", startAt: END, endAt: "2026-07-28T23:00:00.000Z" });
    expect(detectEntertainmentConflicts([first, other])).toEqual([]);
    expect(conflictForCandidate(other, [first])).toEqual([]);
    expect(findAdjacentAvailableResources("bowling", 1, START, END, [{ ...first, active: false }])[0]?.id).toBe("bowling-1");
  });

  it("does not autoassign invalid candidate times or consider invalid occupied times available", () => {
    expect(findAdjacentAvailableResources("bowling", 1, "invalid", END, [])).toEqual([]);
    expect(findAdjacentAvailableResources("bowling", 1, END, START, [])).toEqual([]);
    expect(findAdjacentAvailableResources("bowling", 1, "2026-07-28T21:00:00", "2026-07-28T22:00:00", [])).toEqual([]);
    expect(findAdjacentAvailableResources("bowling", 1, START, END, [reservation({ startAt: "invalid" })])[0]?.id).toBe("bowling-2");
  });
});
