import { createHash } from "node:crypto";
import { canonicalCategoryForText } from "@/lib/entertainment/resources";
import { parseTimeRange } from "@/lib/entertainment/time";
import type { EntertainmentDayPayload, EntertainmentReservation } from "@/lib/entertainment/types";
import type { EventPlan, EventPlanSyncState, ItineraryAsset } from "@/lib/event-plans/types";
import { floorPlanEventSourceIds } from "@/lib/floor-plans/identity";
import type { FloorPlanDocument, FloorPlanValidationItem } from "@/lib/floor-plans/types";
import {
  hasAmbiguousLegacyItineraryIdentity,
  itineraryIdentityScope,
  itineraryReservationMatchesPlan,
  itinerarySnapshotMatchesPlan,
} from "./entertainment";

// A readable copy remains available after this window; it cannot claim to be current.
export const ITINERARY_SYNC_FRESHNESS_HOURS = 24;
const MAX_SYNC_AGE_MS = ITINERARY_SYNC_FRESHNESS_HOURS * 60 * 60 * 1_000;

type RevisionInput = {
  plan: EventPlan;
  sourcePlan?: EventPlan;
  candidatePlans?: readonly EventPlan[];
  sourceSync: EventPlanSyncState | null;
  entertainmentDay: EntertainmentDayPayload | null;
  floorPlan: FloorPlanDocument | null;
  floorPlanPersisted: boolean;
  floorPlanValidation: readonly FloorPlanValidationItem[];
  pdf?: string;
  pdfFingerprint?: string;
  now: Date;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function validTimestamp(value: string | null | undefined) {
  return Boolean(value) && Number.isFinite(Date.parse(value!));
}

function freshTimestamp(value: string | null | undefined, now: Date) {
  if (!validTimestamp(value)) return false;
  const age = now.getTime() - Date.parse(value!);
  return age >= -60_000 && age <= MAX_SYNC_AGE_MS;
}

function reservationRevisionValue(reservation: EntertainmentReservation) {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    lastTripleseatSyncAt: _lastTripleseatSyncAt,
    ...revision
  } = reservation;
  return revision;
}

export function buildItineraryRevision(input: RevisionInput): NonNullable<ItineraryAsset["revision"]> {
  const { plan, sourceSync, entertainmentDay: day, floorPlan, now } = input;
  const reasons = new Set<string>();
  const identityScope = itineraryIdentityScope(plan, floorPlan, input.floorPlanPersisted, input.candidatePlans);
  const reservations = (day?.reservations ?? [])
    .filter((item) => item.active && itineraryReservationMatchesPlan(item, plan, identityScope))
    .sort((left, right) => left.id.localeCompare(right.id));
  const snapshots = (day?.events ?? [])
    .filter((item) => item.active && itinerarySnapshotMatchesPlan(item, plan, identityScope));
  const reservationIds = new Set(reservations.map((item) => item.id));
  const linkedFloorEvents = floorPlan?.events.filter((item) => floorPlanEventSourceIds(item).has(String(plan.id))) ?? [];
  const floorEvent = linkedFloorEvents.length === 1 ? linkedFloorEvents[0] : undefined;
  const floorReservations = (floorPlan?.reservations ?? [])
    .filter((item) => item.floorPlanEventId === floorEvent?.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const hasTimedEntertainment = (input.sourcePlan ?? plan).entertainment.some((item) => canonicalCategoryForText(item.name) !== "mini-golf");

  if (plan.needs_review || plan.review_reasons?.length) {
    reasons.add("Resolve the event's source review items before issuing a staff itinerary.");
  }
  if (!validTimestamp(plan.source_updated_at) || !validTimestamp(plan.synced_at)) {
    reasons.add("The event's source revision or successful sync timestamp is missing.");
  }
  if (!sourceSync || sourceSync.status !== "success") {
    reasons.add(sourceSync?.status === "error"
      ? "The latest Tripleseat event sync failed; saved information is not verified current."
      : "A successful Tripleseat event sync has not been verified.");
  } else if (plan.date < sourceSync.windowStart || plan.date > sourceSync.windowEnd) {
    reasons.add("The latest successful Tripleseat sync did not cover this event date.");
  }
  if (!freshTimestamp(plan.synced_at, now) || !freshTimestamp(sourceSync?.lastSuccessfulSyncAt, now)) {
    reasons.add(`Refresh Tripleseat: source verification must be within ${ITINERARY_SYNC_FRESHNESS_HOURS} hours.`);
  }
  if (validTimestamp(plan.source_updated_at) && validTimestamp(plan.synced_at) && Date.parse(plan.source_updated_at!) > Date.parse(plan.synced_at!)) {
    reasons.add("The source revision is newer than the event's recorded sync.");
  }

  if (!day) {
    reasons.add("The shared Entertainment Schedule could not be read; listed activities may be outdated.");
  } else {
    if (hasAmbiguousLegacyItineraryIdentity(day, plan, identityScope)) {
      reasons.add("An entertainment record has no source ID and cannot be uniquely linked to this event. Review its identity before issuing the itinerary.");
    }
    if (day.sourceMode !== "live" || day.sync?.status !== "success") {
      reasons.add("A successful live Entertainment Schedule sync has not been verified.");
    }
    if (!freshTimestamp(day.sync?.lastSuccessfulSyncAt, now)) {
      reasons.add(`Refresh Entertainment: schedule verification must be within ${ITINERARY_SYNC_FRESHNESS_HOURS} hours.`);
    }
    if (hasTimedEntertainment && snapshots.length === 0 && reservations.length === 0) {
      reasons.add("Contracted entertainment has not been linked to the shared schedule.");
    }
    if (hasTimedEntertainment && reservations.length === 0) {
      reasons.add("Contracted timed entertainment has no saved active reservations.");
    }
    if (snapshots.some((item) => item.needsReview) || reservations.some((item) => item.needsReview || item.hasSourceUpdate)) {
      reasons.add("Entertainment has unresolved review items or newer source information.");
    }
    if (day.conflicts.some((conflict) => conflict.reservationIds.some((id) => reservationIds.has(id)))) {
      reasons.add("Resolve overlapping entertainment reservations before issuing the itinerary.");
    }
    if (day.warnings.length > 0) {
      reasons.add("The Entertainment Schedule reports source or persistence warnings; review them before issuing the itinerary.");
    }
  }

  if (!floorPlan || !floorEvent || !input.floorPlanPersisted) {
    reasons.add("A saved, database-backed floor plan linked to this event has not been verified.");
  } else {
    if (floorPlan.status !== "Approved" || !floorPlan.approvedAt || !floorPlan.approvedBy) {
      reasons.add(`The floor plan is ${floorPlan.status}; staff approval is required.`);
    }
    if (input.floorPlanValidation.some((item) => item.blocking && item.status === "Failed" && (!item.eventId || item.eventId === floorEvent.id))) {
      reasons.add("The saved floor plan has blocking seating, source, or entertainment validation failures.");
    }
    if (!input.floorPlanValidation.some((item) => item.eventId === floorEvent.id)) {
      reasons.add("Floor-plan validation has not been completed for this event snapshot.");
    }
    if (floorPlan.eventDate !== plan.date) {
      reasons.add("The saved floor plan is for a different event date.");
    }
    if (floorEvent.beoLastModifiedAt !== plan.source_updated_at) {
      reasons.add("The floor plan and itinerary do not reference the same BEO revision.");
    }
    const eventWindow = parseTimeRange(plan.time, plan.date);
    if (floorEvent.guestCount !== plan.guest_count || !eventWindow || Date.parse(floorEvent.startAt ?? "") !== Date.parse(eventWindow.startAt) || Date.parse(floorEvent.endAt ?? "") !== Date.parse(eventWindow.endAt)) {
      reasons.add("The saved floor plan's guest count or event time differs from the itinerary.");
    }
    if (floorPlan.approvedAt && reservations.some((item) => Date.parse(item.updatedAt) > Date.parse(floorPlan.approvedAt!))) {
      reasons.add("Entertainment changed after floor-plan approval; review and approve the updated plan.");
    }
    if (floorPlan.approvedAt && Date.parse(plan.source_updated_at ?? "") > Date.parse(floorPlan.approvedAt)) {
      reasons.add("The BEO changed after floor-plan approval; review and approve the updated plan.");
    }
  }

  const sections = {
    event: fingerprint({ id: plan.id, bookingId: plan.tripleseat_booking_id, name: plan.name, date: plan.date, time: plan.time, guests: plan.guest_count, rooms: plan.rooms }),
    food: fingerprint({ food: plan.food, drinks: plan.drink_options }),
    entertainment: fingerprint({ displayed: plan.entertainment, reservations: reservations.map(reservationRevisionValue), sourceRevisions: snapshots.map((item) => [item.eventId, item.sourceUpdatedAt]).sort() }),
    seating: fingerprint({ planId: floorPlan?.id, version: floorPlan?.version, updatedAt: floorPlan?.updatedAt, status: floorPlan?.status, approvedAt: floorPlan?.approvedAt, event: floorEvent, reservations: floorReservations }),
    notes: fingerprint({ instructions: plan.special_instructions, notes: plan.operational_notes, reasons: plan.review_reasons }),
  };
  const revisionFingerprint = fingerprint({ version: "itinerary-v1", sections, sourceUpdatedAt: plan.source_updated_at, ruleVersion: plan.rule_version, contractedEntertainment: input.sourcePlan?.entertainment ?? plan.entertainment });
  return {
    fingerprint: revisionFingerprint,
    label: `IT-${revisionFingerprint.slice(0, 12).toUpperCase()}`,
    generatedAt: now.toISOString(),
    sourceUpdatedAt: plan.source_updated_at ?? null,
    lastSourceSyncAt: sourceSync?.lastSuccessfulSyncAt ?? null,
    lastEntertainmentSyncAt: day?.sync?.lastSuccessfulSyncAt ?? null,
    floorPlanVersion: floorPlan?.version ?? null,
    floorPlanStatus: floorPlan?.status ?? null,
    ready: reasons.size === 0,
    reasons: [...reasons],
    sections,
    savedPdfStatus: !input.pdf ? "none" : !input.pdfFingerprint ? "unverified" : input.pdfFingerprint === revisionFingerprint ? "matching" : "outdated",
  };
}
