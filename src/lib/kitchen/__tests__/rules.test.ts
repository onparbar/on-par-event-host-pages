import { describe, expect, it } from "vitest";

import { translateEventHostFoodAddOns } from "../addons";
import { KITCHEN_RULE_CONFIG } from "../config";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { normalizeKitchenSelection } from "../normalize";
import {
  generateKitchenChecklist,
  getRequiredPanCount,
  getTacoBatchCount,
  packHotPlatters,
} from "../rules";
import type {
  KitchenChecklist,
  KitchenFoodKey,
  KitchenSourceEvent,
  KitchenSourceSelection,
} from "../types";

function sourceEvent(
  selections: readonly KitchenSourceSelection[],
  overrides: Partial<KitchenSourceEvent> = {},
): KitchenSourceEvent {
  return {
    eventId: "test-event",
    bookingId: "test-booking",
    eventName: "Redacted Test Event",
    localDate: "2026-07-28",
    startTime: "17:00",
    endTime: "19:00",
    guestCount: 24,
    status: "Definite",
    room: "Test Room",
    selections,
    specialNotes: [],
    sourceUpdatedAt: "2026-07-28T12:00:00Z",
    sourceState: "fresh",
    ...overrides,
  };
}

function packageEvent(
  bar: "Taco Bar" | "Wing Bar" | "Appetizer Bar",
  guestCount: number,
  extraSelections: readonly KitchenSourceSelection[] = [],
): KitchenSourceEvent {
  return sourceEvent(
    [
      { name: "The Full Course", isFood: true },
      { name: bar, isFood: true },
      ...extraSelections,
    ],
    { guestCount },
  );
}

function row(
  checklist: KitchenChecklist,
  key: KitchenFoodKey,
) {
  const found = checklist.sections
    .flatMap((section) => section.rows)
    .find((candidate) => candidate.key === key);
  expect(found, `Expected checklist row ${key}`).toBeDefined();
  return found!;
}

function warningCodes(checklist: KitchenChecklist) {
  return checklist.warnings.map((warning) => warning.code);
}

describe("pan capacity calculations", () => {
  it.each([
    [0, 25, 0],
    [25, 25, 1],
    [26, 25, 2],
    [3, 3, 1],
    [4, 3, 2],
    [5, 2.5, 2],
    [10, 2.5, 4],
  ])(
    "packs quantity %i at capacity %i into %i pans",
    (quantity: number, capacity: number, expected: number) => {
      expect(getRequiredPanCount(quantity, capacity)).toBe(expected);
    },
  );

  it("rejects invalid quantities and capacities", () => {
    expect(() => getRequiredPanCount(-1, 25)).toThrow(RangeError);
    expect(() => getRequiredPanCount(1, 0)).toThrow(RangeError);
    expect(() => getRequiredPanCount(Number.NaN, 25)).toThrow(
      RangeError,
    );
  });
});

describe("time calculations", () => {
  it("uses America/New_York and calculates ready/prep time backward from food ready", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 24),
    );

    expect(checklist.timezone).toBe("America/New_York");
    expect(checklist.timing).toEqual({
      startTime: "2026-07-28T17:00",
      foodReadyBy: "2026-07-28T16:45",
      earliestPrepTime: "2026-07-28T13:45",
    });
  });

  it("handles local-date crossover rather than formatting in UTC", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([{ name: "Dessert Platter", isFood: true }], {
        startTime: "00:10",
        guestCount: 35,
      }),
    );

    expect(checklist.timing).toEqual({
      startTime: "2026-07-28T00:10",
      foodReadyBy: "2026-07-27T23:55",
      earliestPrepTime: "2026-07-27T22:55",
    });
  });

  it("accepts Tripleseat ISO timestamps while formatting in the kitchen timezone", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([{ name: "Dessert Platter", isFood: true }], {
        startTime: "2026-07-28T17:00:00-04:00",
        guestCount: 35,
      }),
    );
    expect(checklist.timing).toEqual({
      startTime: "2026-07-28T17:00",
      foodReadyBy: "2026-07-28T16:45",
      earliestPrepTime: "2026-07-28T15:45",
    });
  });

  it("does not replace invalid or missing times with zero", () => {
    const missing = generateKitchenChecklist(
      sourceEvent([{ name: "Dessert Platter", isFood: true }], {
        startTime: null,
      }),
    );
    expect(missing.timing).toEqual({
      startTime: null,
      foodReadyBy: null,
      earliestPrepTime: null,
    });
    expect(warningCodes(missing)).toContain("MISSING_START_TIME");

    const invalid = generateKitchenChecklist(
      sourceEvent([{ name: "Dessert Platter", isFood: true }], {
        startTime: "25:00",
      }),
    );
    expect(invalid.timing.startTime).toBeNull();
    expect(warningCodes(invalid)).toContain("INVALID_START_TIME");
  });

  it("does not calculate guest-driven quantities from a missing guest count", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Wing Bar", 24),
    );
    const missingGuestEvent = {
      ...packageEvent("Wing Bar", 24),
      guestCount: null,
    };
    const missing = generateKitchenChecklist(missingGuestEvent);
    expect(row(checklist, "wing-wings").quantity).toBe(192);
    expect(
      missing.sections.some((section) => section.category === "wing"),
    ).toBe(false);
    expect(missing.chafingDishes.bars).toBeNull();
    expect(warningCodes(missing)).toContain("MISSING_GUEST_COUNT");
  });

  it("uses a composite bar quantity as the guest count when the event guest count is blank", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Front Nine | TACO BAR- Food Only",
            quantity: 12,
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: null },
      ),
    );

    expect(checklist.event.guestCount).toBe(12);
    expect(checklist.event.guestCountSource).toBe(
      "bar-selection-quantity",
    );
    expect(row(checklist, "taco-beef").quantity).toBe(5);
    expect(row(checklist, "taco-black-beans")).toMatchObject({
      quantity: 1,
      numberOfPans: 2,
      panSize: "1/3",
    });
    expect(row(checklist, "taco-tortillas").quantity).toBe(2);
    expect(checklist.chafingDishes.bars).toBe(1);
    expect(warningCodes(checklist)).not.toContain(
      "MISSING_GUEST_COUNT",
    );
  });

  it("does not treat a standalone menu modifier quantity as a guest count", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          { name: "The Full Course", isFood: true },
          {
            name: "Appetizer Bar",
            quantity: 1,
            isFood: true,
          },
        ],
        { guestCount: null },
      ),
    );

    expect(checklist.event.guestCount).toBeNull();
    expect(checklist.chafingDishes.bars).toBeNull();
    expect(warningCodes(checklist)).toContain("MISSING_GUEST_COUNT");
  });

  it("keeps an explicit event guest count authoritative over the bar quantity", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Front Nine | TACO BAR- Food Only",
            quantity: 12,
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: 24 },
      ),
    );

    expect(checklist.event.guestCount).toBe(24);
    expect(checklist.event.guestCountSource).toBe("event");
    expect(row(checklist, "taco-tortillas").quantity).toBe(3);
  });

  it("does not infer a guest count from conflicting bar quantities", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Front Nine | TACO BAR- Food Only",
            quantity: 12,
            sourceCategory: "Food",
            isFood: true,
          },
          {
            name: "The Full Course | WING BAR- Food Only",
            quantity: 20,
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: null },
      ),
    );

    expect(checklist.event.guestCount).toBeNull();
    expect(checklist.event.guestCountSource).toBeNull();
    expect(checklist.chafingDishes.bars).toBeNull();
    expect(warningCodes(checklist)).toContain("MISSING_GUEST_COUNT");
  });
});

describe("Taco Bar", () => {
  it.each([
    [24, 1],
    [25, 2],
    [48, 2],
    [49, 3],
    [72, 3],
    [73, 4],
    [96, 4],
    [97, 5],
    [120, 5],
    [121, 6],
    [145, 6],
    [146, 7],
    [170, 7],
    [171, 8],
    [194, 8],
    [195, 9],
    [218, 9],
    [219, 10],
    [242, 10],
  ])("maps %i guests to %i batches", (guestCount: number, batches: number) => {
    expect(getTacoBatchCount(guestCount)).toBe(batches);
  });

  it("does not extrapolate past 242 guests", () => {
    expect(getTacoBatchCount(243)).toBeNull();
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 243),
    );
    expect(warningCodes(checklist)).toContain(
      "GUEST_COUNT_OUT_OF_RANGE",
    );
    expect(checklist.chafingDishes.bars).toBeNull();
  });

  it.each([
    [1, 1],
    [8, 1],
    [9, 2],
    [24, 3],
    [25, 4],
    [40, 5],
    [121, 16],
    [129, 17],
    [242, 31],
  ])(
    "provisionally rounds %i guests up to %i tortilla packs",
    (guestCount: number, packs: number) => {
      const checklist = generateKitchenChecklist(
        packageEvent("Taco Bar", guestCount),
      );
      expect(row(checklist, "taco-tortillas").quantity).toBe(packs);
    },
  );

  it("includes one lettuce wrap per guest without a separate selection", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 40),
    );

    expect(row(checklist, "taco-lettuce-wraps")).toMatchObject({
      description:
        "Fresh lettuce wraps for the Taco Bar; prepare one wrap per guest.",
      quantity: 40,
      unit: "wraps",
      numberOfPans: null,
      panSize: null,
    });
    expect(checklist.liveFoodAddOns).toEqual([]);
    expect(checklist.completedItemKeys).toEqual([]);
    expect(checklist.finalCompletedItemKeys).toEqual([]);
  });

  it("packs Taco Bar chicken at 2.5 pounds per third pan", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 40),
    );
    expect(row(checklist, "taco-beef")).toMatchObject({
      quantity: 10,
      numberOfPans: 2,
      panSize: "1/3",
    });
    expect(row(checklist, "taco-chicken")).toMatchObject({
      quantity: 10,
      numberOfPans: 4,
      panSize: "1/3",
    });
    expect(
      checklist.referenceConflicts.map((conflict) => conflict.code),
    ).not.toContain("TACO_CHICKEN_PANS");

    const fivePoundCapacityConfig = {
      ...KITCHEN_RULE_CONFIG,
      taco: {
        ...KITCHEN_RULE_CONFIG.taco,
        chickenPoundsPerPan: 5,
      },
    };
    const configured = generateKitchenChecklist(
      packageEvent("Taco Bar", 40),
      fivePoundCapacityConfig,
    );
    expect(row(configured, "taco-chicken").numberOfPans).toBe(2);
  });
});

describe("Wing Bar", () => {
  it.each([
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
    [75, 3],
    [76, 4],
    [125, 5],
    [126, 6],
    [150, 6],
    [151, 7],
    [175, 7],
    [176, 8],
    [200, 8],
    [201, 9],
    [225, 9],
    [226, 10],
    [250, 10],
  ])(
    "calculates exact quantities and started 25-guest groups at %i",
    (guestCount: number, groups: number) => {
      const checklist = generateKitchenChecklist(
        packageEvent("Wing Bar", guestCount),
      );
      expect(row(checklist, "wing-wings")).toMatchObject({
        quantity: guestCount * 8,
        numberOfPans: Math.ceil((guestCount * 8) / 25),
        panSize: "1/3",
      });
      expect(row(checklist, "wing-fries")).toMatchObject({
        quantity: groups * 5,
        numberOfPans: groups,
        panSize: "1/2",
      });
      expect(row(checklist, "wing-celery")).toMatchObject({
        quantity: guestCount,
        unit: "half-sticks",
      });
    },
  );

  it.each([
    [3, 24, 1],
    [4, 32, 2],
    [8, 64, 3],
    [11, 88, 4],
    [12, 96, 4],
  ])(
    "rounds %i guests (%i wings) up to %i third pans",
    (guestCount: number, quantity: number, pans: number) => {
      const checklist = generateKitchenChecklist(
        packageEvent("Wing Bar", guestCount),
      );
      expect(row(checklist, "wing-wings")).toMatchObject({
        quantity,
        numberOfPans: pans,
        panSize: "1/3",
      });
    },
  );

  it("uses one table through 75 and two mirrored tables above 75", () => {
    expect(
      generateKitchenChecklist(packageEvent("Wing Bar", 75))
        .chafingDishes.bars,
    ).toBe(1);
    expect(
      generateKitchenChecklist(packageEvent("Wing Bar", 76))
        .chafingDishes.bars,
    ).toBe(2);
  });

  it("counts one chafing dish per selected bar per buffet table", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          { name: "The Full Course", isFood: true },
          { name: "Wing Bar", isFood: true },
          { name: "Appetizer Bar", isFood: true },
        ],
        { guestCount: 80 },
      ),
    );
    expect(checklist.chafingDishes.bars).toBe(4);
  });

  it("stops at the approved maximum of 250", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Wing Bar", 251),
    );
    expect(warningCodes(checklist)).toContain(
      "GUEST_COUNT_OUT_OF_RANGE",
    );
    expect(checklist.chafingDishes.bars).toBeNull();
  });
});

describe("Appetizer Bar", () => {
  it.each([
    [1, 1],
    [25, 1],
    [26, 2],
    [50, 2],
    [51, 3],
    [75, 3],
    [76, 4],
    [100, 4],
    [101, 5],
    [125, 5],
    [126, 6],
    [150, 6],
    [151, 7],
    [175, 7],
    [176, 8],
    [200, 8],
    [201, 9],
    [225, 9],
    [226, 10],
    [250, 10],
  ])(
    "calculates every approved 25-guest boundary at %i",
    (guestCount: number, groups: number) => {
      const checklist = generateKitchenChecklist(
        packageEvent("Appetizer Bar", guestCount),
      );
      expect(row(checklist, "appetizer-tater-kegs")).toMatchObject({
        quantity: groups * 42,
        numberOfPans: Math.ceil((groups * 42) / 25),
        panSize: "1/3",
      });
      expect(
        row(checklist, "appetizer-chicken-tenders"),
      ).toMatchObject({
        quantity: groups * 60,
        numberOfPans: Math.ceil((groups * 60) / 25),
        panSize: "1/3",
      });
      expect(
        row(checklist, "appetizer-mozzarella-sticks"),
      ).toMatchObject({
        quantity: groups * 6,
        numberOfPans: Math.ceil((groups * 6) / 3),
        panSize: "1/3",
      });
      expect(row(checklist, "sauce-marinara")).toMatchObject({
        quantity: 1,
        unit: "bowl",
        numberOfPans: null,
        panSize: null,
      });
      expect(row(checklist, "sauce-ranch")).toMatchObject({
        quantity: 1,
        unit: "bowl",
        numberOfPans: null,
        panSize: null,
      });
      expect(warningCodes(checklist)).not.toContain(
        "UNRESOLVED_SAUCE_QUANTITY",
      );
    },
  );

  it("does not extrapolate food quantities to 251 guests but still provides both sauce bowls", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Appetizer Bar", 251),
    );
    expect(warningCodes(checklist)).toContain(
      "GUEST_COUNT_OUT_OF_RANGE",
    );
    expect(row(checklist, "sauce-marinara")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
    expect(checklist.chafingDishes.bars).toBeNull();
  });

  it("matches the exact 44-guest Appetizer Bar pan setup", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Appetizer Bar", 44),
    );

    expect(row(checklist, "appetizer-tater-kegs")).toMatchObject({
      quantity: 84,
      numberOfPans: 4,
      panSize: "1/3",
    });
    expect(
      row(checklist, "appetizer-mozzarella-sticks"),
    ).toMatchObject({
      quantity: 12,
      numberOfPans: 4,
      panSize: "1/3",
    });
    expect(
      row(checklist, "appetizer-chicken-tenders"),
    ).toMatchObject({
      quantity: 120,
      numberOfPans: 5,
      panSize: "1/3",
    });
  });

  it("provides both sauce bowls when the guest count is missing", () => {
    const checklist = generateKitchenChecklist({
      ...packageEvent("Appetizer Bar", 25),
      guestCount: null,
    });
    expect(row(checklist, "sauce-marinara")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });
});

describe("dessert and platter quantities", () => {
  it("uses the explicit Assorted Deserts contract quantity as pretzel plates", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "Assorted DesertsA shareable assortment of eight sweet treats, featuring a delicious mix of rich, fruity, and classic dessert favorites.",
            quantity: 4,
            sourceCategory: "Food Platters",
            isFood: true,
          },
        ],
        { guestCount: 35 },
      ),
    );

    expect(row(checklist, "dessert-platter")).toMatchObject({
      foodName: "Assorted Desserts",
      quantity: 4,
      unit: "pretzel plates",
      numberOfPans: 4,
      panSize: null,
    });
    expect(warningCodes(checklist)).not.toContain("UNKNOWN_FOOD_ITEM");
    expect(
      checklist.referenceConflicts.map((conflict) => conflict.code),
    ).not.toContain("DESSERT_30_VS_35");
  });

  it.each([
    [1, 1],
    [35, 1],
    [36, 2],
    [70, 2],
    [71, 3],
  ])(
    "uses the current written dessert threshold for %i guests",
    (guestCount: number, platters: number) => {
      const checklist = generateKitchenChecklist(
        sourceEvent([{ name: "Dessert Platter", isFood: true }], {
          guestCount,
        }),
      );
      expect(row(checklist, "dessert-platter")).toMatchObject({
        quantity: platters,
        numberOfPans: platters,
        panSize: null,
      });
      expect(
        checklist.referenceConflicts.map((conflict) => conflict.code),
      ).toContain("DESSERT_30_VS_35");
    },
  );

  const platterCases = [
    [
      "Tater Keg Platter",
      "platter-tater-kegs",
      64,
      "Food Platters",
      25,
      "1/3",
    ],
    [
      "Chicken Tender Platter",
      "platter-chicken-tenders",
      64,
      "Food Platters",
      25,
      "1/3",
    ],
    [
      "Mozzarella Sticks",
      "platter-mozzarella-sticks",
      4,
      "Food Platters",
      2,
      "1/2",
    ],
    ["Wing Platter", "platter-wings", 64, "Food Platters", 25, "1/3"],
    [
      "Veggie Tray",
      "platter-veggie-tray",
      1,
      "Food Platters",
      null,
      null,
    ],
    ["Fry Platter", "platter-fries", 1, "Food Platters", null, null],
  ] as const;

  for (const [
    name,
    key,
    multiplier,
    sourceCategory,
    panCapacity,
    panSize,
  ] of platterCases) {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
      `multiplies ${name} quantity and packs %i platter(s)`,
      (platterCount: number) => {
        const checklist = generateKitchenChecklist(
          sourceEvent([
            {
              name,
              quantity: platterCount,
              sourceCategory,
              isFood: true,
            },
          ]),
        );
        const generatedRow = row(checklist, key);
        const expectedQuantity = platterCount * multiplier;
        expect(generatedRow.quantity).toBe(expectedQuantity);
        expect(generatedRow.numberOfPans).toBe(
          panCapacity == null
            ? null
            : Math.ceil(expectedQuantity / panCapacity),
        );
        expect(generatedRow.panSize).toBe(panSize);
      },
    );
  }

  it.each([
    [
      "Tater Keg PlatterSuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives.",
      "platter-tater-kegs",
      2,
      128,
    ],
    [
      "Wing PlatterDeep fried traditional wings served with celery and served with ranch.",
      "platter-wings",
      3,
      192,
    ],
    [
      "Chicken Tender PlatterFried chicken tenders with ranch dipping sauce.",
      "platter-chicken-tenders",
      4,
      256,
    ],
    [
      "Veggie TrayAssorted fresh vegetables served with ranch dressing.",
      "platter-veggie-tray",
      1,
      1,
    ],
    [
      "Tater Keg PlatterSuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives",
      "platter-tater-kegs",
      1,
      64,
    ],
    [
      "Wing PlatterDeep fried traditional wings served with celery and served with ranch",
      "platter-wings",
      1,
      64,
    ],
    [
      "Chicken Tender PlatterFried chicken tenders with ranch dipping sauce",
      "platter-chicken-tenders",
      1,
      64,
    ],
    [
      "Veggie TrayAssorted fresh vegetables served with ranch dressing",
      "platter-veggie-tray",
      1,
      1,
    ],
  ] as const)(
    "recognizes a Tripleseat platter name with its appended description",
    (name, key, platterCount, expectedQuantity) => {
      const checklist = generateKitchenChecklist(
        sourceEvent([
          {
            name,
            quantity: platterCount,
            isFood: true,
          },
        ]),
      );

      expect(row(checklist, key).quantity).toBe(expectedQuantity);
      expect(warningCodes(checklist)).not.toContain("UNKNOWN_FOOD_ITEM");
      expect(warningCodes(checklist)).not.toContain("NO_FOOD_SELECTIONS");
    },
  );

  it("does not infer a platter from an unapproved appended description", () => {
    const selection = normalizeKitchenSelection({
      name: "Wing PlatterChef special description.",
      quantity: 1,
      sourceCategory: "Food Platters",
      isFood: true,
    });

    expect(selection.kinds).toEqual([]);
  });

  it("does not infer one platter when the source quantity is missing", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Tater Keg Platter",
          quantity: null,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(warningCodes(checklist)).toContain(
      "INVALID_SELECTION_QUANTITY",
    );
    expect(checklist.needsReview).toBe(true);
    expect(
      checklist.sections.flatMap((section) => section.rows),
    ).toHaveLength(0);
  });

  it("does not extrapolate a platter multiplier above 10", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Wing Platter",
          quantity: 11,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );
    expect(warningCodes(checklist)).toContain(
      "UNAPPROVED_PLATTER_QUANTITY",
    );
    expect(
      checklist.sections.flatMap((section) => section.rows),
    ).toHaveLength(0);
  });
});

describe("live Event Host add-on calculations", () => {
  it("shows separate Taco Bar add-ons while preserving the base Cold Sides row", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      {
        "taco-tomatoes": { quantity: 2 },
        "taco-lettuce": { quantity: 3 },
        "taco-sour-cream": { quantity: 1 },
        "taco-diced-onion": { quantity: 1 },
        "taco-shredded-cheese": { quantity: 2 },
        "taco-salsa": { quantity: 2 },
      },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          { name: "The Full Course", isFood: true },
          { name: "Taco Bar", isFood: true },
        ],
        { guestCount: 48 },
      ),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(row(checklist, "taco-cold-sides").foodName).toBe(
      "Cold Side Sets",
    );
    expect(
      checklist.sections
        .flatMap((section) => section.rows)
        .filter((item) =>
          [
            "Tomatoes",
            "Lettuce",
            "Sour Cream",
            "Diced Onion",
            "Shredded Cheese",
            "Salsa",
          ].includes(item.foodName),
        ),
    ).toEqual([]);
    expect(checklist.liveFoodAddOns.map((item) => item.foodName)).toEqual([
      "Tomatoes",
      "Lettuce",
      "Sour Cream",
      "Diced Onion",
      "Shredded Cheese",
      "Salsa",
    ]);
    expect(warningCodes(checklist)).toContain(
      "UNRESOLVED_TACO_ADD_ON",
    );
    expect(checklist.needsReview).toBe(true);
  });

  it("keeps add-on rows separate while applying hot-platter packing, ranch, and prep", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      { wings: { quantity: 2 } },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent([]),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(
      checklist.sections.some(
        (section) => section.category === "platters",
      ),
    ).toBe(false);
    expect(checklist.selectedCategories).toEqual([
      "platters",
      "sauces",
    ]);
    expect(checklist.liveFoodAddOns).toEqual(liveFoodAddOns);
    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 2,
      unit: "bowls",
    });
    expect(checklist.chafingDishes).toEqual({
      bars: 0,
      hotPlatters: 1,
      total: 1,
    });
    expect(checklist.timing.earliestPrepTime).toBe(
      "2026-07-28T16:15",
    );
    expect(warningCodes(checklist)).not.toContain(
      "NO_FOOD_SELECTIONS",
    );
    expect(checklist.needsReview).toBe(false);
  });

  it("combines contract and live hot platters before calculating chafing", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      { "tater-kegs": { quantity: 1 } },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Wing Platter",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(row(checklist, "platter-wings").quantity).toBe(64);
    expect(
      checklist.sections
        .flatMap((section) => section.rows)
        .some((candidate) => candidate.key === "platter-tater-kegs"),
    ).toBe(false);
    expect(checklist.chafingDishes.hotPlatters).toBe(1);
    expect(warningCodes(checklist)).not.toContain(
      "UNAPPROVED_PLATTER_PACKING",
    );
  });

  it("resolves live mozzarella marinara while keeping veggie ranch under review", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      {
        "mozzarella-sticks": { quantity: 1 },
        "veggie-tray": { quantity: 1 },
      },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent([]),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(row(checklist, "sauce-marinara")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(row(checklist, "sauce-ranch").quantity).toBeNull();
    expect(warningCodes(checklist)).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_PREP_LEAD",
        "UNCONFIGURED_KITCHEN_MORNING",
        "UNRESOLVED_SAUCE_QUANTITY",
      ]),
    );
    expect(warningCodes(checklist)).not.toContain(
      "UNAPPROVED_PLATTER_PACKING",
    );
    expect(checklist.timing.earliestPrepTime).toBeNull();
    expect(checklist.needsReview).toBe(true);
  });

  it("uses exact dessert add-ons for prep without applying the contract divisor", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      { "dessert-platter": { quantity: 2 } },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent([]),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(checklist.timing.earliestPrepTime).toBe(
      "2026-07-28T15:45",
    );
    expect(checklist.chafingDishes.hotPlatters).toBe(0);
    expect(
      checklist.referenceConflicts.map((conflict) => conflict.code),
    ).not.toContain("DESSERT_30_VS_35");
    expect(warningCodes(checklist)).not.toContain(
      "NO_FOOD_SELECTIONS",
    );
    expect(checklist.needsReview).toBe(false);
  });

  it("keeps exact secondary sauces display-only until a derived rule is approved", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      { "bbq-sauce": { quantity: 2 } },
      "2026-07-28T13:00:00Z",
    );
    const checklist = generateKitchenChecklist(
      sourceEvent([]),
      KITCHEN_RULE_CONFIG,
      liveFoodAddOns,
    );

    expect(checklist.sections).toEqual([]);
    expect(checklist.liveFoodAddOns).toEqual(liveFoodAddOns);
    expect(checklist.chafingDishes).toEqual({
      bars: 0,
      hotPlatters: 0,
      total: 0,
    });
    expect(checklist.timing.earliestPrepTime).toBeNull();
    expect(checklist.needsReview).toBe(false);
  });
});

describe("platter ranch bowls", () => {
  const platterSelection = (
    name:
      | "Wing Platter"
      | "Chicken Tender Platter"
      | "Veggie Tray",
    quantity: number,
  ): KitchenSourceSelection => ({
    name,
    quantity,
    sourceCategory: "Food Platters",
    isFood: true,
  });

  it("provides one ranch bowl for one Wing Platter", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([platterSelection("Wing Platter", 1)]),
    );

    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("provides one ranch bowl for one Chicken Tender Platter", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        platterSelection("Chicken Tender Platter", 1),
      ]),
    );

    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("adds ranch bowls across Wing and Chicken Tender Platters", () => {
    const oneEach = generateKitchenChecklist(
      sourceEvent([
        platterSelection("Wing Platter", 1),
        platterSelection("Chicken Tender Platter", 1),
      ]),
    );
    expect(row(oneEach, "sauce-ranch")).toMatchObject({
      quantity: 2,
      unit: "bowls",
    });

    const threePlatters = generateKitchenChecklist(
      sourceEvent([
        platterSelection("Wing Platter", 2),
        platterSelection("Chicken Tender Platter", 1),
      ]),
    );
    expect(row(threePlatters, "sauce-ranch")).toMatchObject({
      quantity: 3,
      unit: "bowls",
    });
    expect(warningCodes(threePlatters)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("adds the Appetizer Bar ranch bowl to platter-derived bowls without duplicate rows", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Appetizer Bar", 25, [
        platterSelection("Wing Platter", 1),
        platterSelection("Chicken Tender Platter", 1),
      ]),
    );
    const ranchRows = checklist.sections
      .flatMap((section) => section.rows)
      .filter((candidate) => candidate.key === "sauce-ranch");

    expect(ranchRows).toHaveLength(1);
    expect(ranchRows[0]).toMatchObject({
      quantity: 3,
      unit: "bowls",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("keeps Veggie Tray ranch quantity unresolved", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([platterSelection("Veggie Tray", 1)]),
    );

    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: null,
      unit: "quantity needs review",
    });
    expect(
      warningCodes(checklist).filter(
        (code) => code === "UNRESOLVED_SAUCE_QUANTITY",
      ),
    ).toHaveLength(1);
  });

  it("shows the confirmed Wing Platter bowl while keeping Veggie Tray ranch under review", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        platterSelection("Wing Platter", 1),
        platterSelection("Veggie Tray", 1),
      ]),
    );

    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(
      warningCodes(checklist).filter(
        (code) => code === "UNRESOLVED_SAUCE_QUANTITY",
      ),
    ).toHaveLength(1);
    expect(checklist.needsReview).toBe(true);
  });

  it("shows platter ranch bowls while keeping Wing Bar ranch under review", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Wing Bar", 25, [
        platterSelection("Wing Platter", 1),
      ]),
    );

    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(warningCodes(checklist)).toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });
});

describe("platter packing and chafing dishes", () => {
  it("packs one mozzarella platter into two half pans and one chafing dish", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 11, [
        {
          name: "Mozzarella Sticks",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(row(checklist, "platter-mozzarella-sticks")).toMatchObject({
      quantity: 4,
      unit: "pounds",
      numberOfPans: 2,
      panSize: "1/2",
    });
    expect(row(checklist, "sauce-marinara")).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(checklist.chafingDishes).toEqual({
      bars: 1,
      hotPlatters: 1,
      total: 2,
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNAPPROVED_PLATTER_PACKING",
    );
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("adds one marinara bowl for every mozzarella platter", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Mozzarella Sticks",
          quantity: 3,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(row(checklist, "sauce-marinara")).toMatchObject({
      quantity: 3,
      unit: "bowls",
    });
    expect(warningCodes(checklist)).not.toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it.each([
    [1, 2, "1/2", 1],
    [2, 2, "1/2", 1],
    [3, 3, "1/3", 1],
    [4, 4, "1/2", 2],
    [6, 6, "1/3", 1],
  ] as const)(
    "approves %i same-food hot platters",
    (
      platterCount: number,
      panCount: number,
      panSize: "1/2" | "1/3",
      chafingDishes: number,
    ) => {
      expect(
        packHotPlatters([
          { key: "platter-wings", platterCount },
        ]),
      ).toEqual({
        status: "approved",
        totalHotPlatters: platterCount,
        panCount,
        panSize,
        chafingDishes,
      });
    },
  );

  it.each([
    [5, 2],
    [7, 3],
    [8, 3],
    [9, 3],
    [10, 4],
  ])(
    "keeps a numeric chafing count for the unapproved pan layout %i",
    (platterCount: number, chafingDishes: number) => {
      expect(
        packHotPlatters([
          { key: "platter-wings", platterCount },
        ]),
      ).toMatchObject({
        status: "needs-review",
        reason: "unapproved-total",
        chafingDishes,
      });
    },
  );

  it("applies approved total-hot-platter packing across mixed food types", () => {
    expect(
      packHotPlatters([
        { key: "platter-wings", platterCount: 1 },
        { key: "platter-tater-kegs", platterCount: 1 },
      ]),
    ).toEqual({
      status: "approved",
      totalHotPlatters: 2,
      panCount: 2,
      panSize: "1/2",
      chafingDishes: 1,
    });
  });

  it("packs the redacted four-platter contract into the approved three-hot-platter setup", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Tater Keg Platter",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
        {
          name: "Wing Platter",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
        {
          name: "Chicken Tender Platter",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
        {
          name: "Veggie Tray",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(row(checklist, "platter-tater-kegs")).toMatchObject({
      quantity: 64,
      unit: "each",
      numberOfPans: 3,
      panSize: "1/3",
    });
    expect(row(checklist, "platter-wings")).toMatchObject({
      quantity: 64,
      unit: "each",
      numberOfPans: 3,
      panSize: "1/3",
    });
    expect(row(checklist, "platter-chicken-tenders")).toMatchObject({
      quantity: 64,
      unit: "each",
      numberOfPans: 3,
      panSize: "1/3",
    });
    expect(row(checklist, "platter-veggie-tray")).toMatchObject({
      quantity: 1,
      unit: "pretzel plates",
      numberOfPans: null,
      panSize: null,
    });
    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: 2,
      unit: "bowls",
    });
    expect(checklist.chafingDishes).toEqual({
      bars: 0,
      hotPlatters: 1,
      total: 1,
    });
    expect(warningCodes(checklist)).not.toContain("UNKNOWN_FOOD_ITEM");
    expect(warningCodes(checklist)).not.toContain(
      "NO_FOOD_SELECTIONS",
    );
    expect(warningCodes(checklist)).toContain(
      "UNRESOLVED_SAUCE_QUANTITY",
    );
  });

  it("excludes veggie and dessert trays from pans and chafing dishes", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "Veggie Tray",
            quantity: 2,
            sourceCategory: "Food Platters",
            isFood: true,
          },
          { name: "Dessert Platter", isFood: true },
        ],
        { guestCount: 35 },
      ),
    );
    expect(row(checklist, "platter-veggie-tray")).toMatchObject({
      numberOfPans: null,
      panSize: null,
    });
    expect(row(checklist, "dessert-platter")).toMatchObject({
      numberOfPans: 1,
      panSize: null,
    });
    expect(checklist.chafingDishes).toEqual({
      bars: 0,
      hotPlatters: 0,
      total: 0,
    });
  });

  it("uses the configured kitchen morning time for veggie prep", () => {
    const morningConfig = {
      ...KITCHEN_RULE_CONFIG,
      kitchenMorningTime: "07:00",
    };
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Veggie Tray",
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
      morningConfig,
    );
    expect(checklist.timing.earliestPrepTime).toBe(
      "2026-07-28T07:00",
    );
    expect(warningCodes(checklist)).not.toContain(
      "UNCONFIGURED_KITCHEN_MORNING",
    );
  });

  it("adds approved platter chafing to mirrored bar chafing", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 80, [
        {
          name: "Wing Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );
    expect(checklist.chafingDishes).toEqual({
      bars: 2,
      hotPlatters: 1,
      total: 3,
    });
  });

  it("packs the redacted Veterans setup into two total chafing dishes", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Taco Bar", 50, [
        {
          name: "Tater Keg Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
        {
          name: "Wing Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
        {
          name: "Chicken Tender Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(checklist.chafingDishes).toEqual({
      bars: 1,
      hotPlatters: 1,
      total: 2,
    });
  });
});

describe("classification, aliases, and review behavior", () => {
  it("classifies an event without a package marker as platter-only", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Tater Keg Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );
    expect(checklist.classification).toBe("platter-only");
    expect(checklist.packageMarkers).toEqual([]);
  });

  it("does not activate a bar selection without an approved package marker", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([{ name: "Taco Bar", isFood: true }]),
    );
    expect(checklist.classification).toBe("platter-only");
    expect(warningCodes(checklist)).toContain(
      "BAR_WITHOUT_PACKAGE_MARKER",
    );
    expect(
      checklist.sections.some((section) => section.category === "taco"),
    ).toBe(false);
  });

  it("recognizes the exact live composite aliases without fuzzy matching", () => {
    const taco = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Full Course | TACO BAR - Food + Beverage",
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: 40 },
      ),
    );
    expect(taco.packageMarkers).toEqual(["the-full-course"]);
    expect(taco.selectedBars).toEqual(["taco"]);

    const frontNine = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Front Nine | TACO BAR- Food Only",
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: 24 },
      ),
    );
    expect(frontNine.packageMarkers).toEqual(["the-front-nine"]);
    expect(frontNine.selectedBars).toEqual(["taco"]);

    const appetizerDessert = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Full Course w/Assorted Desserts | APPETIZER BAR - Food + Beverage +Cookies",
            quantity: 44,
            sourceCategory: "Food",
            isFood: true,
          },
        ],
        { guestCount: 44 },
      ),
    );
    expect(appetizerDessert.packageMarkers).toEqual([
      "the-full-course",
    ]);
    expect(appetizerDessert.selectedBars).toEqual(["appetizer"]);
    expect(row(appetizerDessert, "dessert-platter").quantity).toBe(2);
    expect(warningCodes(appetizerDessert)).not.toContain(
      "CONFLICTING_QUANTITY",
    );
  });

  it("recognizes the August 7 Direct Book package and bar descriptions", () => {
    const parkerLord = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Full Course - Food + $20 Drink Cards",
            quantity: 18,
          },
          {
            name: "Premium Taco Bar — A refined, build-your-own experience featuring fresh, high-quality ingredients.",
          },
          { name: "Duckpin Bowling Lanes", quantity: 1 },
          { name: "Dartsee-Darts", quantity: 1 },
        ],
        { eventName: "Parker Lord 08/07/2026", guestCount: 18 },
      ),
    );
    expect(parkerLord.packageMarkers).toEqual(["the-full-course"]);
    expect(parkerLord.selectedBars).toEqual(["taco"]);
    expect(row(parkerLord, "taco-beef").quantity).toBe(5);
    expect(warningCodes(parkerLord)).not.toContain("UNKNOWN_FOOD_ITEM");

    const wedding = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "The Full Course - Food + $20 Drink Cards",
            quantity: 50,
          },
          {
            name: "Appetizer Bar — A curated selection of elevated bites, designed for effortless group enjoyment.",
          },
          {
            name: "Cookies — Premium, generously sized cookies designed to be shared.",
            quantity: 50,
            sourceCategory: "Dessert",
          },
        ],
        {
          eventName:
            "We are celebrating our Wedding with friends and family!",
          guestCount: 50,
        },
      ),
    );
    expect(wedding.packageMarkers).toEqual(["the-full-course"]);
    expect(wedding.selectedBars).toEqual(["appetizer"]);
    expect(row(wedding, "appetizer-tater-kegs").quantity).toBe(84);
    expect(row(wedding, "dessert-platter")).toMatchObject({
      foodName: "Assorted Desserts",
      quantity: 2,
      unit: "pretzel plates",
    });
    expect(warningCodes(wedding)).not.toContain("UNKNOWN_FOOD_ITEM");
  });

  it.each([
    ["Premium Taco Bar — Contract description", "bar:taco"],
    ["Wing Bar — Contract description", "bar:wing"],
    ["Appetizer Bar — Contract description", "bar:appetizer"],
  ] as const)(
    "maps the full-contract bar label %s",
    (name, expectedKind) => {
      expect(
        normalizeKitchenSelection({ name, isFood: true }).kinds,
      ).toContain(expectedKind);
    },
  );

  it("maps plain Mozzarella Sticks only in the Food Platters category", () => {
    expect(
      normalizeKitchenSelection({
        name: "Mozzarella Sticks",
        sourceCategory: "Food Platters",
        isFood: true,
      }).kinds,
    ).toEqual(["platter:mozzarella-sticks"]);
    expect(
      normalizeKitchenSelection({
        name: "Mozzarella Sticks",
        sourceCategory: "Appetizer Bar",
        isFood: true,
      }).kinds,
    ).toEqual([]);
  });

  it("maps the live Tripleseat Mozzarella Sticks document label", () => {
    const liveName =
      "Mozzarella SticksGolden fried mozzarella sticks with a crispy seasoned coating and warm melted cheese inside, served with marinara for dipping";
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: liveName,
          quantity: 1,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );

    expect(row(checklist, "platter-mozzarella-sticks").quantity).toBe(4);
    expect(
      checklist.warnings.some(
        (warning) =>
          warning.code === "UNKNOWN_FOOD_ITEM" &&
          warning.selectionName === liveName,
      ),
    ).toBe(false);
  });

  it("marks unknown Food-category items and special notes for review", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [
          {
            name: "Legacy Pretzel Bites",
            sourceCategory: "Food Platters",
          },
        ],
        {
          specialNotes: ["Mirror an extra table."],
        },
      ),
    );
    expect(warningCodes(checklist)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_FOOD_ITEM",
        "SPECIAL_NOTE_REQUIRES_REVIEW",
      ]),
    );
    expect(checklist.needsReview).toBe(true);
  });

  it("keeps a definite event with no food blank without creating a review warning", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([
        {
          name: "Bowling",
          sourceCategory: "Bowling",
          isFood: false,
        },
        {
          name: "Darts",
          sourceCategory: "Darts",
          isFood: false,
        },
      ]),
    );
    expect(warningCodes(checklist)).not.toContain("UNKNOWN_FOOD_ITEM");
    expect(
      checklist.sections.every((section) => section.rows.length === 0),
    ).toBe(true);
    expect(warningCodes(checklist)).not.toContain("NO_FOOD_SELECTIONS");
  });

  it("requires an identified bar when a package marker exists", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent([{ name: "The Full Course", isFood: true }]),
    );
    expect(warningCodes(checklist)).toContain("PACKAGE_BAR_MISSING");
    expect(checklist.needsReview).toBe(true);
  });

  it("marks an unverified source date and source timestamp for review", () => {
    const checklist = generateKitchenChecklist(
      sourceEvent(
        [{ name: "Dessert Platter", isFood: true }],
        {
          localDateVerified: false,
          sourceUpdatedAt: null,
        },
      ),
    );

    expect(warningCodes(checklist)).toEqual(
      expect.arrayContaining([
        "INVALID_EVENT_DATE",
        "SOURCE_STALE",
      ]),
    );
    expect(checklist.needsReview).toBe(true);
  });

  it("resolves each Appetizer Bar sauce once", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Appetizer Bar", 25),
    );
    const sauceRows = checklist.sections
      .find((section) => section.category === "sauces")
      ?.rows;
    expect(sauceRows?.map((candidate) => candidate.key)).toEqual([
      "sauce-marinara",
      "sauce-ranch",
    ]);
    expect(sauceRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "sauce-marinara",
          quantity: 1,
          unit: "bowl",
        }),
        expect.objectContaining({
          key: "sauce-ranch",
          quantity: 1,
          unit: "bowl",
        }),
      ]),
    );
    expect(
      warningCodes(checklist).filter(
        (code) => code === "UNRESOLVED_SAUCE_QUANTITY",
      ),
    ).toHaveLength(0);
  });

  it("keeps non-Appetizer sauce quantities unresolved", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Wing Bar", 25),
    );
    expect(row(checklist, "sauce-ranch")).toMatchObject({
      quantity: null,
      unit: "quantity needs review",
    });
    expect(
      warningCodes(checklist).filter(
        (code) => code === "UNRESOLVED_SAUCE_QUANTITY",
      ),
    ).toHaveLength(1);
  });

  it("keeps fries and mozzarella prep leads unresolved", () => {
    const checklist = generateKitchenChecklist(
      packageEvent("Appetizer Bar", 25, [
        {
          name: "Fry Platter",
          quantity: 2,
          sourceCategory: "Food Platters",
          isFood: true,
        },
      ]),
    );
    expect(
      row(checklist, "appetizer-mozzarella-sticks").prepTiming,
    ).toEqual({ kind: "unresolved" });
    expect(row(checklist, "platter-fries").prepTiming).toEqual({
      kind: "unresolved",
    });
    expect(warningCodes(checklist)).toContain(
      "UNRESOLVED_PREP_LEAD",
    );
  });
});

describe("redacted mock fixtures", () => {
  it("provides all eight acceptance scenarios on the default Eastern day", () => {
    expect(MOCK_KITCHEN_EVENTS).toHaveLength(8);
    expect(
      new Set(MOCK_KITCHEN_EVENTS.map((event) => event.localDate)),
    ).toEqual(new Set(["2026-07-28"]));

    const checklists = MOCK_KITCHEN_EVENTS.map((event) =>
      generateKitchenChecklist(event),
    );
    expect(
      checklists.some((checklist) =>
        checklist.selectedBars.includes("taco"),
      ),
    ).toBe(true);
    expect(
      checklists.some((checklist) =>
        checklist.selectedBars.includes("wing"),
      ),
    ).toBe(true);
    expect(
      checklists.some((checklist) =>
        checklist.selectedBars.includes("appetizer"),
      ),
    ).toBe(true);
    expect(
      checklists.some(
        (checklist) => checklist.classification === "platter-only",
      ),
    ).toBe(true);
    expect(
      checklists.some((checklist) =>
        checklist.selectedCategories.includes("dessert"),
      ),
    ).toBe(true);
    expect(
      checklists.some((checklist) =>
        warningCodes(checklist).includes("UNKNOWN_FOOD_ITEM"),
      ),
    ).toBe(true);
    expect(
      checklists.some((checklist) =>
        warningCodes(checklist).includes("NO_FOOD_SELECTIONS"),
      ),
    ).toBe(false);
  });

  it("defaults manual BWA to blank without deriving it from source data", () => {
    for (const fixture of MOCK_KITCHEN_EVENTS) {
      expect(generateKitchenChecklist(fixture).foodRunnerOrBwa).toBe("");
    }
  });
});
