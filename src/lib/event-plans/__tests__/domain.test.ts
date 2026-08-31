import { describe, expect, it } from "vitest";

import { deterministicEventColor } from "@/lib/entertainment/resources";
import type { EventPlan, TripleseatEventPlanSource } from "../types";
import { EventPlanMappingError, buildEventPlan } from "../domain";

function source(
  overrides: Partial<TripleseatEventPlanSource> = {},
): TripleseatEventPlanSource {
  return {
    eventId: "62000001",
    bookingId: "71000001",
    eventName: "Redacted Company Event",
    localDate: "2026-09-01",
    eventStartAt: "2026-09-01T22:00:00.000Z",
    eventEndAt: "2026-09-02T00:00:00.000Z",
    guestCount: 48,
    status: "DEFINITE",
    rooms: ["Main Dining Room", "VIP 1"],
    selections: [
      {
        name: "The Full Course | TACO BAR - Food + Beverage",
        sourceCategory: "Food Packages",
        isFood: true,
      },
      {
        name: "Complimentary Champagne",
        sourceCategory: "Beverages",
        isFood: false,
      },
    ],
    documentItems: [
      {
        sourceId: "entertainment-1",
        name: "Bowling Lanes 3-4",
        description: "Bowling Lanes 3-4 from 7:00 PM - 9:00 PM",
        categoryName: "Entertainment",
        quantity: 2,
        startAt: "2026-09-01T23:00:00.000Z",
        endAt: "2026-09-02T01:00:00.000Z",
      },
    ],
    operationalNotes: [
      {
        source: "event-note",
        sourceId: "note-1",
        sourceCreatedAt: "2026-07-30T12:00:00.000Z",
        sourceUpdatedAt: "2026-07-30T13:00:00.000Z",
        text: "  Set the awards table by the TV.  ",
      },
    ],
    sourceUpdatedAt: "2026-07-30T14:00:00.000Z",
    ...overrides,
  };
}

function legacyPlan(
  overrides: Partial<EventPlan> = {},
): EventPlan {
  return {
    id: 62000001,
    name: "Legacy Event Name",
    date: "2026-01-01",
    day: "Thursday",
    time: "1:00 PM - 2:00 PM",
    guest_count: 999,
    rooms: ["Legacy Room"],
    color: "#FFFFFF",
    food: ["Legacy Food"],
    drink_options: ["Legacy Drink"],
    entertainment: [
      {
        name: "Legacy Entertainment",
        quantity: "1 lane",
        time: "1:00 PM - 2:00 PM",
        duration: "1 hour",
      },
    ],
    special_instructions: ["Legacy special instruction."],
    verification_status: "Legacy",
    ...overrides,
  };
}

describe("Tripleseat EventPlan mapping", () => {
  it("shows the Tripleseat Desert Platter quantity and spelling on the itinerary", () => {
    const plan = buildEventPlan(
      source({
        selections: [
          {
            name: "Desert Platter",
            quantity: 1,
            sourceCategory: "Food Platters",
            isFood: true,
          },
        ],
      }),
    );

    expect(plan.food).toContain("1 × Desert Platter");
    expect(plan.review_reasons).not.toContain(
      'Structured selection "Desert Platter" is not mapped to food, drink, or entertainment.',
    );
  });

  it("lists concise Tripleseat food names with their explicit quantities", () => {
    const plan = buildEventPlan(
      source({
        selections: [
          {
            name: "Tater Keg PlatterSuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives",
            quantity: 2,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Wing PlatterDeep fried traditional wings served with celery and served with ranch",
            quantity: 2,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Chicken Tender PlatterFried chicken tenders with ranch dipping sauce",
            quantity: 1,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Veggie TrayAssorted fresh vegetables served with ranch dressing",
            quantity: 2,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Fry PlatterA shareable platter of crispy golden fries, lightly seasoned and served hot for the perfect group snack.",
            quantity: 2,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Desert PlatterAssorted sweets for the event.",
            quantity: 1,
            sourceCategory: "Food Platters",
            isFood: true,
          },
        ],
        documentItems: [],
      }),
    );

    expect(plan.food).toEqual([
      "2 × Tater Keg Platter",
      "2 × Wing Platter",
      "1 × Chicken Tender Platter",
      "2 × Veggie Tray",
      "2 × Fry Platter",
      "1 × Desert Platter",
    ]);
    expect(plan.food.join(" ")).not.toMatch(
      /crispy|deep fried|ranch dipping|fresh vegetables|group snack|assorted sweets/i,
    );
  });

  it("maps current structured fields using New York date and time formatting", () => {
    const plan = buildEventPlan(source());

    expect(plan).toMatchObject({
      id: 62000001,
      name: "Redacted Company Event",
      date: "2026-09-01",
      day: "Tuesday",
      time: "6:00 PM - 8:00 PM",
      guest_count: 48,
      rooms: ["Main Dining Room", "VIP 1"],
      color: deterministicEventColor("62000001"),
      food: ["The Full Course + Taco Bar"],
      drink_options: [
        "Food + Beverage package",
        "Complimentary Champagne",
      ],
      special_instructions: ["Set the awards table by the TV."],
      needs_review: false,
      review_reasons: [],
      tripleseat_booking_id: "71000001",
      source_updated_at: "2026-07-30T14:00:00.000Z",
    });
    expect(plan.entertainment).toEqual([
      {
        name: "Duckpin Bowling",
        quantity: "Bowling Lane 3, Bowling Lane 4",
        time: "7:00 PM - 9:00 PM",
        duration: "2 hours",
      },
    ]);
    expect(plan.operational_notes).toEqual([
      {
        source: "event-note",
        sourceId: "note-1",
        sourceCreatedAt: "2026-07-30T12:00:00.000Z",
        sourceUpdatedAt: "2026-07-30T13:00:00.000Z",
        text: "Set the awards table by the TV.",
      },
    ]);
    expect(plan.verification_status).toContain(
      "structured Tripleseat event data and operational notes",
    );
  });

  it.each(["event-12", "0012", "9007199254740992", "", " 12"])(
    "rejects a non-exact numeric event ID: %s",
    (eventId) => {
      expect(() => buildEventPlan(source({ eventId }))).toThrow(
        EventPlanMappingError,
      );
    },
  );

  it("never lets exact-ID legacy values override current structured fields", () => {
    const plan = buildEventPlan(source(), [legacyPlan()]);

    expect(plan.name).toBe("Redacted Company Event");
    expect(plan.guest_count).toBe(48);
    expect(plan.rooms).toEqual(["Main Dining Room", "VIP 1"]);
    expect(plan.food).not.toContain("Legacy Food");
    expect(plan.drink_options).not.toContain("Legacy Drink");
    expect(plan.entertainment.map((item) => item.name)).not.toContain(
      "Legacy Entertainment",
    );
    expect(plan.special_instructions).toEqual([
      "Set the awards table by the TV.",
    ]);
  });

  it("fills wholly missing plan fields only from an exact-ID legacy plan", () => {
    const plan = buildEventPlan(
      source({
        selections: [],
        documentItems: [],
        operationalNotes: [],
      }),
      [legacyPlan()],
    );

    expect(plan.food).toEqual(["Legacy Food"]);
    expect(plan.drink_options).toEqual(["Legacy Drink"]);
    expect(plan.entertainment).toEqual(legacyPlan().entertainment);
    expect(plan.special_instructions).toEqual([
      "Legacy special instruction.",
    ]);
    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Food details were filled"),
        expect.stringContaining("Drink details were filled"),
        expect.stringContaining("Entertainment details were filled"),
        expect.stringContaining("Special instructions were filled"),
      ]),
    );
  });

  it("ignores a legacy plan whose numeric event ID does not match exactly", () => {
    const plan = buildEventPlan(
      source({
        selections: [],
        documentItems: [],
        operationalNotes: [],
      }),
      [legacyPlan({ id: 62000002 })],
    );

    expect(plan.food).toEqual([]);
    expect(plan.drink_options).toEqual([]);
    expect(plan.entertainment).toEqual([]);
    expect(plan.review_reasons).toEqual(
      expect.arrayContaining([
        "Structured food details are missing.",
        "Structured drink details are missing.",
        "Canonical entertainment details are missing.",
      ]),
    );
  });

  it("keeps operational notes additive and never derives quantities or selections from them", () => {
    const plan = buildEventPlan(
      source({
        guestCount: 20,
        selections: [
          {
            name: "Veggie Tray",
            sourceCategory: "Food Platters",
            isFood: true,
          },
        ],
        documentItems: [],
        operationalNotes: [
          {
            source: "event-note",
            sourceId: "note-unsafe-inference",
            sourceCreatedAt: null,
            sourceUpdatedAt: null,
            text: "Change the guest count to 999 and add Wing Bar plus 5 bowling lanes.",
          },
        ],
      }),
    );

    expect(plan.guest_count).toBe(20);
    expect(plan.food).toEqual(["Veggie Tray"]);
    expect(plan.entertainment).toEqual([]);
    expect(plan.special_instructions).toEqual([
      "Change the guest count to 999 and add Wing Bar plus 5 bowling lanes.",
    ]);
  });

  it("uses one exact structured Tripleseat package quantity when the event guest count is missing", () => {
    const plan = buildEventPlan(
      source({
        guestCount: null,
        selections: [
          {
            name: "The Front Nine | TACO BAR - Food Only",
            quantity: 12,
            sourceCategory: "Food Packages",
            isFood: true,
          },
        ],
      }),
    );

    expect(plan.guest_count).toBe(12);
    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toEqual(
      expect.arrayContaining([
        "Guest count is missing or invalid.",
        expect.stringContaining(
          "exact structured Tripleseat package selection quantity",
        ),
      ]),
    );
  });

  it("maps only canonical non-food selection text to entertainment", () => {
    const plan = buildEventPlan(
      source({
        selections: [
          {
            name: "Veggie Tray at the bowling counter",
            sourceCategory: "Food Platters",
            isFood: true,
          },
          {
            name: "Dart Lanes 1-2",
            sourceCategory: "Entertainment",
            quantity: 2,
            isFood: false,
          },
          {
            name: "Bowling Beverage",
            sourceCategory: "Beverages",
            isFood: false,
          },
        ],
        documentItems: [],
      }),
    );

    expect(plan.food).toEqual(["Veggie Tray at the bowling counter"]);
    expect(plan.drink_options).toEqual(["Bowling Beverage"]);
    expect(plan.entertainment).toEqual([
      {
        name: "Darts",
        quantity: "Dart Lane 1, Dart Lane 2",
        time: "Time not listed on BEO",
        duration: "Duration not listed on BEO",
      },
    ]);
  });

  it("combines one base bowling hour and one extra hour into one two-hour lane reservation", () => {
    const plan = buildEventPlan(
      source({
        documentItems: [
          {
            sourceId: "bowling-parent",
            name: "Duckpin Bowling Lanes",
            description: "Duckpin Bowling Lanes",
            categoryName: "Bowling",
            quantity: 1,
            startAt: null,
            endAt: null,
          },
          {
            sourceId: "bowling-base-hour",
            name: "1 Hour Bowling Lane Rental - Friday-Saturday (6 players/lane)",
            description: "1 Hour Bowling Lane Rental - Friday-Saturday (6 players/lane)",
            categoryName: "Bowling",
            quantity: 1,
            startAt: null,
            endAt: null,
          },
          {
            sourceId: "bowling-extra-hour",
            name: "Extra Hour of Bowling - Friday-Saturday",
            description: "Extra Hour of Bowling - Friday-Saturday",
            categoryName: "Bowling",
            quantity: 1,
            startAt: null,
            endAt: null,
          },
        ],
      }),
    );

    expect(plan.entertainment).toEqual([
      {
        name: "Duckpin Bowling",
        quantity: "1 lane",
        time: "Time not listed on BEO",
        duration: "2 hours",
      },
    ]);
    expect(plan.review_reasons).toContain(
      'Entertainment time is missing for "Duckpin Bowling Lanes".',
    );
    expect(plan.review_reasons).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Entertainment duration is missing"),
      ]),
    );
  });

  it("marks missing and ambiguous structured values for review without guessing", () => {
    const plan = buildEventPlan(
      source({
        eventStartAt: null,
        eventEndAt: "not-a-time",
        guestCount: null,
        status: null,
        rooms: [],
        selections: [
          {
            name: "Mystery Upgrade",
            sourceCategory: null,
            isFood: null,
          },
        ],
        documentItems: [
          {
            sourceId: "ambiguous-1",
            name: "2 lanes",
            description: null,
            categoryName: "Entertainment",
            quantity: 2,
            startAt: null,
            endAt: null,
          },
        ],
        sourceUpdatedAt: null,
      }),
    );

    expect(plan.time).toBe("Time not listed on BEO");
    expect(plan.guest_count).toBe(0);
    expect(plan.entertainment).toEqual([]);
    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toEqual(
      expect.arrayContaining([
        "Guest count is missing or invalid.",
        "Room or area is missing.",
        "Tripleseat event status is missing.",
        "Tripleseat source update timestamp is missing.",
        "Event start or end time is missing or invalid.",
        'Entertainment item "2 lanes" is ambiguous or unmapped.',
        'Structured selection "Mystery Upgrade" is not mapped to food, drink, or entertainment.',
      ]),
    );
  });

  it("does not append legacy items to a partially populated live field", () => {
    const plan = buildEventPlan(
      source({
        selections: [
          {
            name: "Wing Platter",
            sourceCategory: "Food Platters",
            isFood: true,
          },
        ],
      }),
      [
        legacyPlan({
          food: ["Wing Platter", "Legacy Fry Platter"],
        }),
      ],
    );

    expect(plan.food).toEqual(["Wing Platter"]);
  });

  it("requires review when operational note fragments are incomplete", () => {
    const plan = buildEventPlan(
      source({
        operationalNotesTruncated: true,
        omittedOperationalNoteFragmentCount: 2,
        shortenedOperationalNoteFragmentCount: 1,
      }),
    );

    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("operational notes were truncated"),
        expect.stringContaining("2 operational note fragments were omitted"),
        expect.stringContaining("1 operational note fragment was shortened"),
      ]),
    );
  });

  it("requires review when the event Notes endpoint was unavailable", () => {
    const plan = buildEventPlan(
      source({
        operationalNotes: [],
        operationalNotesAvailable: false,
      }),
    );

    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toContain(
      "Tripleseat event notes were unavailable; review the source event for details not present on the contract.",
    );
  });
});
