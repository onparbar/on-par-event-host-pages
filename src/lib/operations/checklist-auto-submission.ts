export const AUTO_SUBMISSION_KEY = "workspace:closeout:auto-submit";

export type AutomaticChecklistSubmission = {
  version: 1;
  actor: "SYSTEM";
  sourceEventId: string;
  sourceFingerprint: string;
  eventEndedAt: string;
  scheduledFor: string;
  submittedAt: string;
  missingTaskKeys: string[];
  missingBwa: boolean;
  missingPoc: boolean;
  contractWarnings: string[];
};

function timestamp(value: unknown): value is string {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

export function isAutomaticSubmission(value: unknown): value is AutomaticChecklistSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as AutomaticChecklistSubmission;
  return receipt.version === 1 && receipt.actor === "SYSTEM" &&
    typeof receipt.sourceEventId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(receipt.sourceEventId) &&
    typeof receipt.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(receipt.sourceFingerprint) &&
    timestamp(receipt.eventEndedAt) && timestamp(receipt.scheduledFor) && timestamp(receipt.submittedAt) &&
    Date.parse(receipt.scheduledFor) === Date.parse(receipt.eventEndedAt) + 3_600_000 &&
    Date.parse(receipt.submittedAt) >= Date.parse(receipt.scheduledFor) &&
    typeof receipt.missingBwa === "boolean" && typeof receipt.missingPoc === "boolean" &&
    Array.isArray(receipt.missingTaskKeys) && receipt.missingTaskKeys.every((key) => typeof key === "string" && Boolean(key.trim())) &&
    Array.isArray(receipt.contractWarnings) && receipt.contractWarnings.every((warning) => typeof warning === "string" && Boolean(warning.trim()));
}

/** Historical receipt survives Admin reopening; the tasks flag identifies current automatic submission. */
export function readAutomaticSubmission(record: { taskEvidence?: Record<string, unknown> }) {
  const evidence = record.taskEvidence?.[AUTO_SUBMISSION_KEY];
  const receipt = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? (evidence as { automaticSubmission?: unknown }).automaticSubmission : null;
  return isAutomaticSubmission(receipt) ? receipt : null;
}
