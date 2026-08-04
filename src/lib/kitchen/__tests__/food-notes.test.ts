import { describe, expect, it } from "vitest";

import {
  extractKitchenFoodNotes,
  mergeKitchenFoodNotes,
} from "../food-notes";

describe("Kitchen food-note extraction", () => {
  it("keeps food and dietary fragments while excluding unrelated and financial notes", () => {
    expect(
      extractKitchenFoodNotes([
        {
          body: [
            "Guest has celiac disease; use gluten-free prep.",
            "Call the host after 4 PM.",
            "Final payment balance is $250.",
            "Dessert must be served after the awards.",
          ].join("\n"),
          source: "event-note",
          sourceId: "10",
          sourceUpdatedAt: "2026-07-29T14:00:00Z",
        },
      ]).map((note) => note.text),
    ).toEqual([
      "Guest has celiac disease; use gluten-free prep.",
      "Dessert must be served after the awards.",
    ]);
  });

  it("redacts contact details before a food note is stored", () => {
    const [note] = extractKitchenFoodNotes([
      {
        body:
          "Ask chef@example.com or 937-555-0199 about the taco meal at https://example.com/contract.",
        source: "event-description",
      },
    ]);

    expect(note.text).toContain("[email redacted]");
    expect(note.text).toContain("[phone redacted]");
    expect(note.text).toContain("[link redacted]");
    expect(note.text).not.toContain("chef@example.com");
    expect(note.text).not.toContain("937-555-0199");
  });

  it("accepts a non-keyword contract fragment only inside verified Food context", () => {
    expect(
      extractKitchenFoodNotes([
        {
          body: "Leave jalapeños off the left half.",
          source: "booking-document",
          foodContext: true,
        },
        {
          body: "Leave jalapeños off the left half.",
          source: "booking-note",
        },
      ]),
    ).toEqual([
      {
        text: "Leave jalapeños off the left half.",
        source: "booking-document",
        sourceId: null,
        sourceUpdatedAt: null,
      },
    ]);
  });

  it("deduplicates matching notes across contract sources", () => {
    const eventNotes = extractKitchenFoodNotes([
      {
        body: "One guest has a nut allergy.",
        source: "event-note",
      },
    ]);
    const bookingNotes = extractKitchenFoodNotes([
      {
        body: "  One guest has a nut allergy.  ",
        source: "booking-note",
      },
    ]);

    expect(mergeKitchenFoodNotes(eventNotes, bookingNotes)).toHaveLength(1);
  });
});
