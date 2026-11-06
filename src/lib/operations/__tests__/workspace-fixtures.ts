import type { EventPlan } from "@/lib/event-plans/types";
import type { ChecklistRecord } from "@/lib/checklist-model";
import type { EntertainmentReservation } from "@/lib/entertainment/types";

export const workspaceEvent: EventPlan = {
  id: 77, name: "Redacted event", date: "2026-10-23", day: "Friday", time: "6:00 PM - 9:00 PM",
  guest_count: 30, rooms: ["VIP 1"], color: "#18332F", food: ["2 Tater Keg Platters"], drink_options: [],
  entertainment: [{ name: "Mini Golf per person", quantity: "20", time: "6:00 PM - 7:00 PM", duration: "1 hour" }], verification_status: "Verified",
};
export function workspaceRecord(overrides: Partial<ChecklistRecord> = {}): ChecklistRecord {
  return { eventId: 77, eventName: workspaceEvent.name, eventDate: workspaceEvent.date, poc: "POC test", bwa: "BWA test",
    extrasAdded: "Preserve extras", remainingDrinkCardBalance: "12", tasks: { existing: true }, taskEvidence: {}, food: { wings: { quantity: "2", manualPrice: "120" } },
    entertainment: { darts: { quantity: "1", selectedRateKey: "rate", manualPrice: "" } }, status: "draft", updatedAt: "2026-10-23T19:00:00.000Z", submittedAt: null, ...overrides };
}
export function workspaceReservation(overrides: Partial<EntertainmentReservation> = {}): EntertainmentReservation {
  return {
    id: "reservation-1", syncKey: null, localEventId: "77", tripleseatEventId: "77", tripleseatBookingId: null,
    eventName: workspaceEvent.name, operatingDate: workspaceEvent.date, resourceId: "bowling-1", resourceCategory: "bowling", resourceName: "Bowling Lane 1",
    startAt: "2026-10-23T22:30:00.000Z", endAt: "2026-10-24T00:30:00.000Z", sourceStartAt: null, sourceEndAt: null, sourceResourceId: null,
    eventColor: "#18332F", colorSource: "manual", source: "manual", sourceReference: null, manualOverride: true, hasSourceUpdate: false,
    needsReview: false, reviewIssues: [], autoAssigned: false, notes: "", sourceUpdatedAt: null, lastTripleseatSyncAt: null, active: true,
    createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", updatedBy: "test", ...overrides,
  };
}
