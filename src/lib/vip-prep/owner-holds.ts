import { vipPrepExternalId } from "./identity";
import type { VipPrepReservation } from "./types";

type OwnerHoldPlanningEvidence = {
  operatingDate: string;
  eventName: string;
  sourceEventId: string | null | undefined;
  sourceSystem?: string | null;
  linkedTripleseatEventIds?: readonly string[];
  foodCount?: number;
  extraCount?: number;
};

const DECEMBER_OWNER_HOLD_LABELS = new Set([
  "owner hold vip",
  "vip unavailable",
  "vip unavailable vip",
]);

/** Exact December 2026 internal-placeholder evidence; never a source cancellation. */
export function isDecemberOwnerHoldVip(evidence: OwnerHoldPlanningEvidence) {
  return /^2026-12-(?:0[1-9]|[12]\d|3[01])$/.test(evidence.operatingDate) &&
    /^vip-[A-Za-z0-9-]+$/.test(evidence.sourceEventId ?? "") &&
    (!evidence.sourceSystem || evidence.sourceSystem === "vip-prep") &&
    DECEMBER_OWNER_HOLD_LABELS.has(evidence.eventName.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")) &&
    !evidence.linkedTripleseatEventIds?.length &&
    (evidence.foodCount === undefined || evidence.foodCount === 0) &&
    (evidence.extraCount === undefined || evidence.extraCount === 0);
}

/** Staff visibility only: keep the raw booking and its source-membership evidence. */
export function isDecemberOwnerHoldReservation(reservation: VipPrepReservation) {
  return isDecemberOwnerHoldVip({
    operatingDate: reservation.operatingDate,
    eventName: reservation.eventName,
    sourceEventId: vipPrepExternalId(reservation),
    linkedTripleseatEventIds: reservation.linkedTripleseatEventIds,
    foodCount: reservation.foodPrep.length,
    extraCount: reservation.extras.length,
  });
}
