import { describe, expect, it } from "vitest";
import type { EntertainmentDayPayload, EntertainmentReservation } from "@/lib/entertainment/types";
import type { EventPlan, EventPlanSyncState } from "@/lib/event-plans/types";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import { detectFloorPlanConflicts } from "@/lib/floor-plans/conflicts";
import { validateFloorPlan } from "@/lib/floor-plans/validator";
import { buildItineraryRevision } from "../readiness";
import { mergeReservationsForSync } from "@/lib/entertainment/domain";
import { changedItinerarySections, itineraryEntertainmentGroups } from "../presentation";

const now = new Date("2026-10-21T16:00:00Z");
const sourceUpdatedAt = "2026-10-21T10:00:00Z";
const syncedAt = "2026-10-21T15:00:00Z";
const plan: EventPlan = {
  id: 123,
  name: "Training event",
  date: "2026-10-21",
  day: "Wednesday",
  time: "6:00 PM - 8:00 PM",
  guest_count: 20,
  rooms: ["VIP 1"],
  color: "#297025",
  food: ["Chicken Tender Platter: 1"],
  drink_options: [],
  entertainment: [{ name: "Mini Golf", quantity: "20", time: "", duration: "" }],
  verification_status: "Verified source",
  source_updated_at: sourceUpdatedAt,
  synced_at: syncedAt,
  rule_version: "training-rule-v1",
};
const sourceSync: EventPlanSyncState = {
  windowStart: "2026-10-01",
  windowEnd: "2026-10-31",
  status: "success",
  eventCount: 1,
  startedAt: syncedAt,
  completedAt: syncedAt,
  lastSuccessfulSyncAt: syncedAt,
  errorMessage: null,
};
const entertainmentDay: EntertainmentDayPayload = {
  date: plan.date,
  events: [],
  reservations: [],
  conflicts: [],
  sync: { operatingDate: plan.date, status: "success", eventsProcessed: 1, reservationsCreated: 0, reservationsUpdated: 0, warningsCreated: 0, conflictsFound: 0, errorSummary: null, startedAt: syncedAt, completedAt: syncedAt, lastSuccessfulSyncAt: syncedAt },
  sourceMode: "live",
  warnings: [],
  missingEnvironmentVariables: [],
  canEdit: false,
};
const reservation: EntertainmentReservation = {
  id: "training-bowling", syncKey: null, localEventId: "123", tripleseatEventId: "123", tripleseatBookingId: null,
  eventName: plan.name, operatingDate: plan.date, resourceId: "bowling-1", resourceCategory: "bowling", resourceName: "Bowling Lane 1",
  startAt: "2026-10-21T22:00:00Z", endAt: "2026-10-21T23:00:00Z", sourceStartAt: null, sourceEndAt: null, sourceResourceId: null,
  eventColor: plan.color, colorSource: "manual", source: "manual", sourceReference: null, manualOverride: true, hasSourceUpdate: false,
  needsReview: false, reviewIssues: [], autoAssigned: false, notes: "", sourceUpdatedAt, lastTripleseatSyncAt: syncedAt,
  active: true, createdAt: syncedAt, updatedAt: syncedAt, updatedBy: "training-staff",
};
const floorPlan: FloorPlanDocument = {
  id: "training-floor-plan",
  eventDate: plan.date,
  status: "Approved",
  version: 5,
  ruleVersion: "training-floor-rule-v1",
  lastTripleseatSyncAt: syncedAt,
  createdAt: syncedAt,
  updatedAt: syncedAt,
  approvedAt: syncedAt,
  approvedBy: "training-staff",
  events: [{ id: "training-floor-event", floorPlanId: "training-floor-plan", tripleseatEventId: "123", name: plan.name, status: "DEFINITE", guestCount: 20, startAt: "2026-10-21T22:00:00Z", endAt: "2026-10-22T00:00:00Z", contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: sourceUpdatedAt, fullBuyout: false, source: { rooms: ["VIP 1"], food: plan.food, entertainment: plan.entertainment, operationalNotes: [], reviewReasons: [] } }],
  reservations: [
    { id: "training-seating", floorPlanEventId: "training-floor-event", areaId: "vip-1", reservationType: "room", startAt: "2026-10-21T22:00:00Z", endAt: "2026-10-22T00:00:00Z", label: "VIP 1", source: "generated", lockedByUser: false },
    { id: "training-food", floorPlanEventId: "training-floor-event", areaId: "vip1-food-table", reservationType: "food-table", startAt: "2026-10-21T22:00:00Z", endAt: "2026-10-22T00:00:00Z", label: "F", source: "generated", lockedByUser: false },
  ],
};

function revision(overrides: Partial<Parameters<typeof buildItineraryRevision>[0]> = {}) {
  const savedPlan = overrides.floorPlan === undefined ? floorPlan : overrides.floorPlan;
  const day = overrides.entertainmentDay === undefined ? entertainmentDay : overrides.entertainmentDay;
  const validation = savedPlan && day ? validateFloorPlan(savedPlan, day.reservations, detectFloorPlanConflicts(savedPlan), day.conflicts) : [];
  return buildItineraryRevision({ plan, sourceSync, entertainmentDay, floorPlan, floorPlanPersisted: true, floorPlanValidation: validation, now, ...overrides });
}

describe("itinerary readiness and revision evidence", () => {
  it("passes only with verified syncs and an approved matching source floor plan", () => {
    expect(revision()).toMatchObject({ ready: true, reasons: [], floorPlanVersion: 5, floorPlanStatus: "Approved" });
  });

  it("does not call an ID-matched static PDF approved or current", () => {
    expect(revision({ pdf: "/itinerary-pdfs/training.pdf" }).savedPdfStatus).toBe("unverified");
  });

  it("requires exact fingerprint evidence for a matching saved PDF", () => {
    const original = revision();
    expect(revision({ pdf: "/training.pdf", pdfFingerprint: original.fingerprint }).savedPdfStatus).toBe("matching");
    expect(revision({ pdf: "/training.pdf", pdfFingerprint: original.fingerprint, plan: { ...plan, guest_count: 21 } }).savedPdfStatus).toBe("outdated");
  });

  it("is stable across read refreshes but changes with food quantities or source revision", () => {
    const original = revision();
    expect(revision({ now: new Date("2026-10-21T16:05:00Z") }).fingerprint).toBe(original.fingerprint);
    const changedFood = revision({ plan: { ...plan, food: ["Chicken Tender Platter: 2"] } });
    expect(changedFood.fingerprint).not.toBe(original.fingerprint);
    expect(changedItinerarySections(original, changedFood)).toEqual(["Food / drinks"]);
    const changedSource = revision({ plan: { ...plan, source_updated_at: "2026-10-21T11:00:00Z" } });
    expect(changedSource.fingerprint).not.toBe(original.fingerprint);
    expect(changedItinerarySections(original, changedSource)).toEqual(["Source revision / calculation rules"]);
  });

  it("fingerprints displayed Admin edits and retains screen review reasons", () => {
    const original = revision();
    const edited = revision({ plan: { ...plan, itinerary_edit: { updatedAt: syncedAt, sourceUpdatedAt, fields: { drinkLines: ["Water station"] } } } });
    expect(edited.ready).toBe(false);
    expect(edited.reasons.join(" ")).toContain("Admin display edits");
    expect(changedItinerarySections(original, edited)).toEqual(["Food / drinks"]);
    const stale = revision({ plan: { ...plan, itinerary_edit: { updatedAt: syncedAt, sourceUpdatedAt: "2026-10-20T10:00:00Z", fields: { food: ["Dessert Platter: 1"] } } } });
    expect(stale.reasons.join(" ")).toContain("source changed after the itinerary was edited");
  });

  it("changes the revision when the saved floor-plan version changes", () => {
    const original = revision();
    const updated = revision({ floorPlan: { ...floorPlan, version: 6 } });
    expect(updated.fingerprint).not.toBe(original.fingerprint);
    expect(changedItinerarySections(original, updated)).toEqual(["Seating / approval"]);
  });

  it("never treats a failed entertainment read as a current empty schedule", () => {
    const result = revision({ entertainmentDay: null });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("could not be read");
  });

  it.each(["error", "partial", "running"] as const)("requires review for a %s entertainment sync", (status) => {
    expect(revision({ entertainmentDay: { ...entertainmentDay, sync: { ...entertainmentDay.sync!, status } } }).ready).toBe(false);
  });

  it("changes the exact revision when a shared reservation changes", () => {
    const original = revision({ entertainmentDay: { ...entertainmentDay, reservations: [reservation] } });
    const updated = revision({ entertainmentDay: { ...entertainmentDay, reservations: [{ ...reservation, resourceId: "bowling-2", resourceName: "Bowling Lane 2" }] } });
    expect(updated.fingerprint).not.toBe(original.fingerprint);
    expect(changedItinerarySections(original, updated)).toEqual(["Entertainment"]);
  });

  it("keeps an approved itinerary revision stable through unchanged entertainment resyncs", () => {
    const sourceReservation = { ...reservation, source: "tripleseat" as const, manualOverride: false, syncKey: "training-bowling", updatedAt: "2026-10-21T14:00:00Z" };
    const original = revision({ entertainmentDay: { ...entertainmentDay, reservations: [sourceReservation] } });
    const syncedReservations = mergeReservationsForSync([sourceReservation], [{ ...sourceReservation, updatedAt: "2026-10-21T15:30:00Z", lastTripleseatSyncAt: "2026-10-21T15:30:00Z" }], "2026-10-21T15:30:00Z");
    const refreshed = revision({ entertainmentDay: { ...entertainmentDay, reservations: syncedReservations } });
    expect(original.ready).toBe(true);
    expect(refreshed.ready).toBe(true);
    expect(refreshed.fingerprint).toBe(original.fingerprint);
    expect(changedItinerarySections(original, refreshed)).toEqual([]);
  });

  it("ignores observation-only timestamps in the itinerary content fingerprint", () => {
    const original = revision({ entertainmentDay: { ...entertainmentDay, reservations: [reservation] } });
    const refreshed = revision({ entertainmentDay: { ...entertainmentDay, reservations: [{ ...reservation, lastTripleseatSyncAt: "2026-10-21T15:30:00Z", updatedBy: "tripleseat-sync" }] } });
    expect(refreshed.fingerprint).toBe(original.fingerprint);
  });

  it("blocks relevant conflicts, source updates, and entertainment edits after approval", () => {
    const updated = { ...reservation, hasSourceUpdate: true, updatedAt: "2026-10-21T15:30:00Z" };
    const result = revision({ entertainmentDay: { ...entertainmentDay, reservations: [updated], conflicts: [{ id: "training-conflict", resourceId: "bowling-1", resourceName: "Bowling Lane 1", startAt: reservation.startAt, endAt: reservation.endAt, reservationIds: [reservation.id, "other-training-booking"], eventNames: [plan.name, "Other training event"] }] } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("overlapping entertainment");
    expect(result.reasons.join(" ")).toContain("newer source information");
    expect(result.reasons.join(" ")).toContain("changed after floor-plan approval");
  });

  it("does not verify timed entertainment supplied only by a different same-name source ID", () => {
    const sourcePlan = { ...plan, entertainment: [{ name: "Bowling", quantity: "1 lane", time: "6:00 PM - 7:00 PM", duration: "1 hour" }] };
    const otherReservation = { ...reservation, localEventId: "456", tripleseatEventId: "456" };
    const result = revision({ sourcePlan, entertainmentDay: { ...entertainmentDay, reservations: [otherReservation] } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("no saved active reservations");
  });

  it("accepts an alternate source ID only from a unique persisted floor-plan link", () => {
    const sourcePlan = { ...plan, entertainment: [{ name: "Bowling", quantity: "1 lane", time: "6:00 PM - 7:00 PM", duration: "1 hour" }] };
    const linkedFloorPlan = { ...floorPlan, events: [{ ...floorPlan.events[0], source: { ...floorPlan.events[0].source, verifiedSourceEventIds: ["vip-linked-source"] } }] };
    const linkedReservation = { ...reservation, localEventId: "vip-linked-source", tripleseatEventId: null };
    expect(revision({ sourcePlan, floorPlan: linkedFloorPlan, entertainmentDay: { ...entertainmentDay, reservations: [linkedReservation] } }).ready).toBe(true);
  });

  it("requires review when a legacy no-ID record could belong to two same-name parties", () => {
    const legacy = { ...reservation, localEventId: null, tripleseatEventId: null };
    const ambiguous = revision({ candidatePlans: [plan, { ...plan, id: 456 }], entertainmentDay: { ...entertainmentDay, reservations: [legacy] } });
    expect(ambiguous.ready).toBe(false);
    expect(ambiguous.reasons.join(" ")).toContain("cannot be uniquely linked");
    expect(revision({ candidatePlans: [plan], entertainmentDay: { ...entertainmentDay, reservations: [legacy] } }).ready).toBe(true);
  });

  it("cannot verify a legacy same-name source record with missing event timing", () => {
    const sourceSnapshot = { eventId: "legacy", localEventId: null, tripleseatEventId: "", eventName: plan.name, operatingDate: plan.date, active: true, eventStartAt: null, eventEndAt: null } as EntertainmentDayPayload["events"][number];
    const result = revision({ candidatePlans: [plan], entertainmentDay: { ...entertainmentDay, events: [sourceSnapshot] } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("cannot be uniquely linked");
  });

  it.each(["error", "running"] as const)("a %s source sync retains review status even with previous successful data", (status) => {
    const result = revision({ sourceSync: { ...sourceSync, status } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/sync failed|not been verified/);
  });

  it("marks missing source timestamps and uncovered dates for review", () => {
    const result = revision({ plan: { ...plan, source_updated_at: null }, sourceSync: { ...sourceSync, windowEnd: "2026-10-20" } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("revision or successful sync timestamp is missing");
    expect(result.reasons.join(" ")).toContain("did not cover this event date");
  });

  it("uses an explicit 24-hour verification boundary", () => {
    const atBoundary = new Date(Date.parse(syncedAt) + 24 * 60 * 60 * 1_000);
    expect(revision({ now: atBoundary }).ready).toBe(true);
    expect(revision({ now: new Date(atBoundary.getTime() + 1) }).ready).toBe(false);
  });

  it("does not infer floor-plan approval or database persistence", () => {
    expect(revision({ floorPlan: { ...floorPlan, status: "Draft", approvedAt: null, approvedBy: null } }).ready).toBe(false);
    expect(revision({ floorPlanPersisted: false }).ready).toBe(false);
    expect(revision({ floorPlan: null }).ready).toBe(false);
    expect(revision({ floorPlanValidation: [] }).ready).toBe(false);
  });

  it("requires matching BEO and guest-count/time revisions", () => {
    const result = revision({ plan: { ...plan, guest_count: 30, source_updated_at: "2026-10-21T11:00:00Z" } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("same BEO revision");
    expect(result.reasons.join(" ")).toContain("guest count or event time differs");
  });

  it("blocks unresolved event and floor-plan review failures", () => {
    expect(revision({ plan: { ...plan, needs_review: true } }).ready).toBe(false);
    expect(revision({ floorPlanValidation: [{ code: "SEATING_CAPACITY", eventId: "training-floor-event", label: "Capacity", status: "Failed", message: "Insufficient capacity", blocking: true }] }).ready).toBe(false);
  });

  it("keeps contracted mini golf quantity-only even if legacy timing exists", () => {
    expect(itineraryEntertainmentGroups({ entertainment: [{ name: "Mini Golf", quantity: "20", time: "6:00 PM - 8:00 PM", duration: "2 hours" }] })).toEqual([{ title: "Mini Golf", detail: "20" }]);
  });

  it("does not silently clear contracted timed entertainment and mark the result ready", () => {
    const result = revision({ sourcePlan: { ...plan, entertainment: [{ name: "Bowling", quantity: "2 lanes", time: "6:00 PM - 7:00 PM", duration: "1 hour" }] } });
    expect(result.ready).toBe(false);
    expect(result.reasons.join(" ")).toContain("no saved active reservations");
  });
});
