import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAdminSessionSecret } from "@/lib/admin-auth";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { StaleSaveError } from "@/lib/stale-save";
import { staffingWindow, type CorporateStaffShift, type StaffingAssignment, type StaffingEvent, type StaffingEventStatus } from "./domain";
import { refreshStaffing, STAFFING_FRESHNESS_MINUTES, staffingEditorRoster, staffingSnapshotIsFresh, StaffingReviewError, updateStaffingOverride, type StaffingAssignmentChoice } from "./service";
import { loadStaffingState, saveStaffingState, type StaffingState } from "./storage";

export const OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH = 2 * 1024 * 1024;
const tokenScope = "event-host:operational-staffing:v1";
const reviewMessage = "Reload the event's published schedule before assigning staff.";
type Window = ReturnType<typeof staffingWindow>;
export type OperationalStaffingDependencies = {
  now?: Date;
  load?: typeof loadStaffingState;
  save?: typeof saveStaffingState;
  readEvents?: (window: Window) => Promise<StaffingEvent[]>;
  readShifts?: (window: Window) => Promise<CorporateStaffShift[]>;
  getSecret?: typeof getAdminSessionSecret;
};
export type OperationalStaffingChoice = StaffingAssignmentChoice;
export type OperationalStaffingTeamChange = {
  eventId: string;
  eventDate: string;
  expectedVersion: number;
  reviewToken: string;
  choices: OperationalStaffingChoice[];
};
type Review = {
  eventId: string;
  eventDate: string;
  version: number;
  issuedAt: number;
  expiresAt: number;
  candidate: StaffingState;
};

function reviewKey(dependencies: OperationalStaffingDependencies) {
  const secret = (dependencies.getSecret ?? getAdminSessionSecret)();
  if (!secret || secret.length < 32) throw new StaffingReviewError(reviewMessage);
  return createHash("sha256").update(`${tokenScope}\0`).update(secret).digest();
}

function encryptReview(review: Review, dependencies: OperationalStaffingDependencies) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", reviewKey(dependencies), iv);
  cipher.setAAD(Buffer.from(tokenScope));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(review), "utf8"), cipher.final()]);
  const token = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  if (token.length > OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH) throw new StaffingReviewError(reviewMessage);
  return token;
}

function decryptReview(change: OperationalStaffingTeamChange, now: Date, dependencies: OperationalStaffingDependencies): Review {
  try {
    if (change.reviewToken.length > OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH) throw new Error();
    const [format, iv, tag, encrypted, extra] = change.reviewToken.split(".");
    if (format !== "v1" || extra !== undefined || ![iv, tag, encrypted].every((part) => part && /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const nonce = Buffer.from(iv, "base64url"), authTag = Buffer.from(tag, "base64url");
    if (nonce.length !== 12 || authTag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", reviewKey(dependencies), nonce);
    decipher.setAAD(Buffer.from(tokenScope));
    decipher.setAuthTag(authTag);
    const review = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")) as Review;
    if (review.eventId !== change.eventId || review.eventDate !== change.eventDate || review.version !== change.expectedVersion ||
        review.candidate.version !== change.expectedVersion || !Number.isFinite(review.issuedAt) || !Number.isFinite(review.expiresAt) ||
        review.issuedAt > now.getTime() || review.expiresAt < now.getTime() || review.expiresAt < review.issuedAt ||
        review.expiresAt - review.issuedAt > STAFFING_FRESHNESS_MINUTES * 60_000 ||
        todayInEntertainmentTimeZone(new Date(review.issuedAt)) !== todayInEntertainmentTimeZone(now) ||
        !staffingSnapshotIsFresh(review.candidate, now)) throw new Error();
    return review;
  } catch { throw new StaffingReviewError(reviewMessage); }
}

function sameEvent(row: StaffingAssignment, eventId: string, date: string) {
  return row.eventId === eventId && row.eventDate === date;
}

// A read-only refresh can invalidate an older automatic match. It must not hide a
// still-saved assignment when checking whether an explicit move is safe.
function retainSavedAssignments(candidate: StaffingState, previous: StaffingState, eventId: string, date: string): StaffingState {
  const kept = (previous.reconciliation?.assignments ?? []).filter((row) => !sameEvent(row, eventId, date));
  return { ...candidate, reconciliation: candidate.reconciliation && { ...candidate.reconciliation, assignments: [
    ...kept,
    ...candidate.reconciliation.assignments.filter((row) => !kept.some((saved) =>
      saved.eventId === row.eventId && saved.eventDate === row.eventDate && saved.employeeId === row.employeeId)),
  ] } };
}

/** Provider verification is read-only, including its failure path; nothing is saved by opening a card. */
export async function loadOperationalStaffingRoster(eventId: string, date: string, dependencies: OperationalStaffingDependencies = {}) {
  const now = dependencies.now ?? new Date();
  if (eventId.startsWith("vip-") || date < todayInEntertainmentTimeZone(now)) return null;
  try { staffingWindow(now, date); } catch { throw new StaffingReviewError(reviewMessage); }
  const previous = await (dependencies.load ?? loadStaffingState)();
  let candidate = previous;
  let roster: ReturnType<typeof staffingEditorRoster> = null;
  try { roster = staffingEditorRoster(candidate, eventId, date, now); }
  catch (error) { if (!(error instanceof StaffingReviewError)) throw error; }
  if (!roster) {
    try {
      candidate = await refreshStaffing({ now, date, load: async () => previous,
        save: async (next) => next, readEvents: dependencies.readEvents, readShifts: dependencies.readShifts });
    } catch { throw new StaffingReviewError(reviewMessage); }
    if (candidate.failure || !staffingSnapshotIsFresh(candidate, now)) throw new StaffingReviewError(reviewMessage);
    candidate = retainSavedAssignments(candidate, previous, eventId, date);
    roster = staffingEditorRoster(candidate, eventId, date, now);
  }
  if (!roster) return null;
  const observedAt = Date.parse(candidate.reconciliation!.lastSuccessfulSyncAt!);
  const reviewToken = encryptReview({ eventId, eventDate: date, version: previous.version, issuedAt: now.getTime(),
    expiresAt: observedAt + STAFFING_FRESHNESS_MINUTES * 60_000, candidate }, dependencies);
  return { ...roster, reviewToken };
}

function assignmentSet(rows: StaffingAssignment[]) {
  return rows.map((row) => JSON.stringify([row.eventId, row.eventDate, row.employeeId, row.employeeName, row.shiftId, row.source])).sort();
}
function assignmentsEqual(left: StaffingAssignment[], right: StaffingAssignment[]) {
  const a = assignmentSet(left), b = assignmentSet(right);
  return a.length === b.length && a.every((row, index) => row === b[index]);
}

/** Save only the explicit team and confirmed shift moves, with one versioned storage write. */
export async function saveOperationalStaffingTeam(change: OperationalStaffingTeamChange, dependencies: OperationalStaffingDependencies = {}) {
  const now = dependencies.now ?? new Date();
  const previous = await (dependencies.load ?? loadStaffingState)();
  if (previous.version !== change.expectedVersion) throw new StaleSaveError();
  const { candidate } = decryptReview(change, now, dependencies);
  if (!staffingEditorRoster(candidate, change.eventId, change.eventDate, now)) throw new StaffingReviewError(reviewMessage);
  const updated = await updateStaffingOverride({ action: "replace-team", ...change }, {
    now, load: async () => candidate, save: async (next) => next,
  });
  const selected = new Set(change.choices.map(({ shiftId }) => shiftId));
  const priorAssignments = previous.reconciliation?.assignments ?? [];
  const calculated = updated.reconciliation!;
  const assignments = [
    ...priorAssignments.filter((row) => !sameEvent(row, change.eventId, change.eventDate) && !(row.shiftId && selected.has(row.shiftId))),
    ...calculated.assignments.filter((row) => sameEvent(row, change.eventId, change.eventDate)),
  ];
  const eventStatuses: Record<string, StaffingEventStatus> = {};
  for (const eventId of new Set([...Object.keys(previous.reconciliation?.eventStatuses ?? {}), ...Object.keys(calculated.eventStatuses)])) {
    eventStatuses[eventId] = eventId === change.eventId || assignmentsEqual(
      assignments.filter((row) => row.eventId === eventId), calculated.assignments.filter((row) => row.eventId === eventId),
    ) ? calculated.eventStatuses[eventId] ?? "unverified" : "unverified";
  }
  const changedEvents = new Set([change.eventId, ...priorAssignments.filter((row) => row.shiftId && selected.has(row.shiftId)).map((row) => row.eventId)]);
  const alerts = [
    ...(previous.reconciliation?.alerts ?? []).filter((alert) => !changedEvents.has(alert.eventId)),
    ...calculated.alerts.filter((alert) => changedEvents.has(alert.eventId)),
  ];
  const saved = await (dependencies.save ?? saveStaffingState)({ ...updated, version: previous.version, policy: previous.policy,
    keepClearEventIds: previous.keepClearEventIds, reconciliation: { ...calculated, assignments, eventStatuses, alerts } }, previous.version);
  return saved.version;
}
