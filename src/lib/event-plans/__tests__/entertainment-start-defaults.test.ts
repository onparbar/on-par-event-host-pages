import { describe, expect, it } from "vitest";
import { buildEventPlan } from "../domain";
import type { TripleseatEventPlanSource } from "../types";
import type { EntertainmentSourceItem } from "@/lib/entertainment/types";

function source(item: Partial<EntertainmentSourceItem>, eventStartAt = "2026-10-26T17:30:00-04:00"): TripleseatEventPlanSource {
  return {
    eventId: "62001990", bookingId: "71001990", eventName: "Redacted timing example", localDate: "2026-10-26",
    eventStartAt, eventEndAt: "2026-10-26T21:30:00-04:00", guestCount: 20, status: "DEFINITE", rooms: ["VIP 1"],
    selections: [], documentItems: [{ sourceId: "timing-line", name: "Duckpin Bowling", description: "3 bowling lanes for 2 hours", categoryName: "Bowling", quantity: 3, startAt: null, endAt: null, ...item }],
    operationalNotes: [], operationalNotesAvailable: true, sourceUpdatedAt: "2026-10-25T16:00:00Z",
  };
}

describe("event-plan entertainment timing uses the shared contract rules", () => {
  it.each([["2 hours", "2 hours", "7:30 PM"], ["90 minutes", "1.5 hours", "7:00 PM"], ["1 hour 15 minutes", "1.25 hours", "6:45 PM"], ["20 minutes", "1/3 hour", "5:50 PM"]])("defaults %s to the exact party start without a missing-start review", (purchased, duration, end) => {
    const input = source({ description: `3 bowling lanes for ${purchased}` });
    const original = structuredClone(input);
    const plan = buildEventPlan(input);
    expect(plan.entertainment).toContainEqual(expect.objectContaining({ quantity: "3 lanes", time: `5:30 PM - ${end}`, duration, startTimeSource: "event-start-default" }));
    expect(plan.review_reasons?.some((reason) => /entertainment.*(?:time is missing|start time)/i.test(reason))).toBe(false);
    expect(input).toEqual(original);
  });

  it("uses an explicit start-only contract time and purchased duration, not the party end", () => {
    const plan = buildEventPlan(source({ startAt: "2026-10-26T18:15:00-04:00", description: "3 bowling lanes for 90 minutes" }));
    expect(plan.entertainment[0]).toMatchObject({ time: "6:15 PM - 7:45 PM", duration: "1.5 hours", startTimeSource: "contract-explicit", contractedDurationMinutes: 90 });
  });

  it("moves event-default timing when the party moves, but leaves explicit timing fixed", () => {
    const defaultItem = { description: "3 bowling lanes for 2 hours" };
    expect(buildEventPlan(source(defaultItem, "2026-10-26T18:30:00-04:00")).entertainment[0].time).toBe("6:30 PM - 8:30 PM");
    const explicitItem = { ...defaultItem, startAt: "2026-10-26T19:00:00-04:00" };
    expect(buildEventPlan(source(explicitItem, "2026-10-26T18:30:00-04:00")).entertainment[0]).toMatchObject({ time: "7:00 PM - 9:00 PM", startTimeSource: "contract-explicit" });
  });

  it("does not replace a missing contracted duration with the full event interval", () => {
    const plan = buildEventPlan(source({ description: "3 bowling lanes" }));
    expect(plan.entertainment[0].duration).toBe("Duration not listed on BEO");
    expect(plan.entertainment[0].time).toBe("Time not listed on BEO");
    expect(plan.review_reasons).toContainEqual(expect.stringContaining("duration"));
  });

  it("retains purchased duration while flagging a contradictory explicit end", () => {
    const plan = buildEventPlan(source({ startAt: "2026-10-26T18:30:00-04:00", endAt: "2026-10-26T19:30:00-04:00" }));
    expect(plan.entertainment[0]).toMatchObject({ time: "6:30 PM - 8:30 PM", duration: "2 hours", contractedDurationMinutes: 120 });
    expect(plan.review_reasons).toContainEqual(expect.stringContaining("contradicts"));
  });

  it("keeps Mini Golf untimed and quantity-only", () => {
    const plan = buildEventPlan(source({ name: "Mini Golf", categoryName: "Mini Golf", description: "20 Mini Golf guests", quantity: 20 }));
    expect(plan.entertainment).toEqual([{ name: "Mini Golf", quantity: "20 guests", time: "", duration: "" }]);
  });

  it("honors an activity-specific contract note rather than defaulting to the party start", () => {
    const input = source({});
    input.operationalNotes = [{ source: "event-note", sourceId: "note-1", sourceCreatedAt: null, sourceUpdatedAt: null, text: "Bowling from 6:15 PM to 8:15 PM" }];
    expect(buildEventPlan(input).entertainment[0]).toMatchObject({ time: "6:15 PM - 8:15 PM", duration: "2 hours", startTimeSource: "contract-explicit" });
  });

  it("does not treat an unrelated food-service note as an entertainment start", () => {
    const input = source({});
    input.operationalNotes = [{ source: "event-note", sourceId: "note-1", sourceCreatedAt: null, sourceUpdatedAt: null, text: "Food at 6:15 PM" }];
    expect(buildEventPlan(input).entertainment[0]).toMatchObject({ time: "5:30 PM - 7:30 PM", duration: "2 hours", startTimeSource: "event-start-default" });
  });
});
