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

/** December 2026 planning exception only; never a cancellation or an arrival/food rule. */
export function isDecemberOwnerHoldVip(evidence: OwnerHoldPlanningEvidence) {
  return /^2026-12-(?:0[1-9]|[12]\d|3[01])$/.test(evidence.operatingDate) &&
    /^vip-[A-Za-z0-9-]+$/.test(evidence.sourceEventId ?? "") &&
    (!evidence.sourceSystem || evidence.sourceSystem === "vip-prep") &&
    DECEMBER_OWNER_HOLD_LABELS.has(evidence.eventName.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")) &&
    !evidence.linkedTripleseatEventIds?.length &&
    (evidence.foodCount === undefined || evidence.foodCount === 0) &&
    (evidence.extraCount === undefined || evidence.extraCount === 0);
}
