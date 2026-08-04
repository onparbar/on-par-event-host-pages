import { describe, expect, it } from "vitest";
import {
  extractEventPlanOperationalNotes,
  MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH,
  MAX_EVENT_PLAN_OPERATIONAL_NOTES,
} from "../notes";

describe("Event Host operational-note extraction", () => {
  it("keeps broad operational details while excluding unrelated and financial noise", () => {
    const result = extractEventPlanOperationalNotes([
      {
        id: 10,
        createdAt: "2026-07-30T12:00:00Z",
        updatedAt: "2026-07-30T13:00:00Z",
        body: [
          "Main Dining Room setup starts at 4 PM.",
          "Seat the group near the stage.",
          "Serve the gluten-free meal first.",
          "Drink service begins after the presentation.",
          "Bowling lanes 5-8 are reserved.",
          "Use the wheelchair-accessible entrance.",
          "Final payment balance is $250.",
          "Left a generic voicemail.",
        ].join("\n"),
      },
    ]);

    expect(result.notes.map((note) => note.text)).toEqual([
      "Main Dining Room setup starts at 4 PM.",
      "Seat the group near the stage.",
      "Serve the gluten-free meal first.",
      "Drink service begins after the presentation.",
      "Bowling lanes 5-8 are reserved.",
      "Use the wheelchair-accessible entrance.",
    ]);
    expect(result).toMatchObject({
      available: true,
      truncated: false,
      omittedFragmentCount: 0,
      shortenedFragmentCount: 0,
    });
  });

  it("strips markup and redacts contact details before returning a note", () => {
    const result = extractEventPlanOperationalNotes([
      {
        id: "note-1",
        body:
          "<p>Setup at 4 PM.</p><p>Contact host@example.com, (937) 555-0199, or https://example.com/plan.</p>",
      },
    ]);
    const serialized = JSON.stringify(result.notes);

    expect(result.notes.map((note) => note.text)).toEqual([
      "Setup at 4 PM.",
      "Contact [email redacted], [phone redacted], or [link redacted]",
    ]);
    expect(serialized).not.toContain("host@example.com");
    expect(serialized).not.toContain("937");
    expect(serialized).not.toContain("example.com");
  });

  it("deduplicates normalized text and keeps the newest source provenance", () => {
    const result = extractEventPlanOperationalNotes([
      {
        id: 1,
        createdAt: "2026-07-29T12:00:00Z",
        updatedAt: "2026-07-29T12:00:00Z",
        body: "Set up three tables near the TV.",
      },
      {
        id: 2,
        createdAt: "2026-07-30T12:00:00Z",
        updatedAt: "2026-07-30T13:00:00Z",
        body: "  Set up three tables near the TV  ",
      },
    ]);

    expect(result.notes).toEqual([
      {
        source: "event-note",
        sourceId: "2",
        sourceCreatedAt: "2026-07-30T12:00:00Z",
        sourceUpdatedAt: "2026-07-30T13:00:00Z",
        text: "Set up three tables near the TV",
      },
    ]);
  });

  it("keeps quantity-like wording as text without creating inferred fields", () => {
    const result = extractEventPlanOperationalNotes([
      {
        id: 99,
        body: "Prepare 200 wings in five pans for 100 guests.",
      },
    ]);

    expect(result.notes).toEqual([
      {
        source: "event-note",
        sourceId: "99",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        text: "Prepare 200 wings in five pans for 100 guests.",
      },
    ]);
    expect(Object.keys(result.notes[0]).sort()).toEqual([
      "source",
      "sourceCreatedAt",
      "sourceId",
      "sourceUpdatedAt",
      "text",
    ]);
  });

  it("keeps the newest notes at the deterministic cap and reports omissions", () => {
    const candidates = Array.from(
      { length: MAX_EVENT_PLAN_OPERATIONAL_NOTES + 2 },
      (_, index) => ({
        id: String(index).padStart(3, "0"),
        createdAt: new Date(
          Date.UTC(2026, 6, 1, 0, index),
        ).toISOString(),
        body: `Setup instruction ${index}.`,
      }),
    );

    const result = extractEventPlanOperationalNotes(candidates);

    expect(result.notes).toHaveLength(
      MAX_EVENT_PLAN_OPERATIONAL_NOTES,
    );
    expect(result.notes[0].text).toBe("Setup instruction 2.");
    expect(result.notes.at(-1)?.text).toBe(
      `Setup instruction ${MAX_EVENT_PLAN_OPERATIONAL_NOTES + 1}.`,
    );
    expect(result).toMatchObject({
      available: true,
      truncated: true,
      omittedFragmentCount: 2,
      shortenedFragmentCount: 0,
    });
  });

  it("shortens oversized fragments explicitly and preserves whole Unicode code points", () => {
    const result = extractEventPlanOperationalNotes([
      {
        id: "long-note",
        body: `Setup ${"😀".repeat(
          MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH,
        )}`,
      },
    ]);
    const [note] = result.notes;

    expect(Array.from(note.text)).toHaveLength(
      MAX_EVENT_PLAN_OPERATIONAL_NOTE_LENGTH,
    );
    expect(note.text.endsWith("…")).toBe(true);
    expect(result).toMatchObject({
      truncated: true,
      omittedFragmentCount: 0,
      shortenedFragmentCount: 1,
    });
  });

  it("distinguishes an unavailable source from a verified empty notes list", () => {
    expect(extractEventPlanOperationalNotes(null)).toEqual({
      notes: [],
      available: false,
      truncated: false,
      omittedFragmentCount: 0,
      shortenedFragmentCount: 0,
    });
    expect(extractEventPlanOperationalNotes([])).toEqual({
      notes: [],
      available: true,
      truncated: false,
      omittedFragmentCount: 0,
      shortenedFragmentCount: 0,
    });
  });
});
