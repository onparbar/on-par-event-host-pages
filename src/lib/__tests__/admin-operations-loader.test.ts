import { describe, expect, it } from "vitest";
import { decodeStoredEventPlan } from "../admin-operations-loader";
import type { StoredEventPlan } from "../event-plans/storage";

function storedRow(): StoredEventPlan {
  return {
    eventId: "1001",
    eventDate: "2026-08-06",
    plan: {
      id: 1001,
      name: "Example Event",
      date: "2026-08-06",
      day: "Thursday",
      time: "1:00 PM - 3:00 PM",
      guest_count: 40,
      rooms: ["VIP 1"],
      color: "#297025",
      food: ["Taco Bar"],
      drink_options: [],
      entertainment: [],
      verification_status: "Verified",
    },
    sourceSnapshot: {
      eventId: "1001",
      bookingId: null,
      eventName: "Example Event",
      localDate: "2026-08-06",
      eventStartAt: "2026-08-06T13:00:00-04:00",
      eventEndAt: "2026-08-06T15:00:00-04:00",
      guestCount: 40,
      status: "DEFINITE",
      rooms: ["VIP 1"],
      selections: [],
      documentItems: [],
      operationalNotes: [],
      sourceUpdatedAt: "2026-08-03T14:00:00Z",
    },
    sourceUpdatedAt: "2026-08-03T14:00:00Z",
    syncedAt: "2026-08-03T14:00:00Z",
    active: true,
  };
}

describe("stored admin operation input", () => {
  it("keeps a valid plan but limits evidence for an older partial source snapshot", () => {
    const row = storedRow();
    delete row.sourceSnapshot.rooms;

    expect(decodeStoredEventPlan(row)).toMatchObject({
      plan: { id: 1001 },
      source: null,
    });
  });

  it("rejects a malformed stored plan instead of crashing the admin page", () => {
    const row = storedRow();
    row.plan.entertainment = "not-an-array";

    expect(decodeStoredEventPlan(row)).toBeNull();
  });
});
