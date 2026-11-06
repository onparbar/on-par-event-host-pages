import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChecklistRecord, resetLocalChecklistStorageForTests, saveChecklist } from "@/lib/checklist-storage";
import { AUTO_SUBMISSION_KEY, isAutomaticSubmission, readAutomaticSubmission, type AutomaticChecklistSubmission } from "../checklist-auto-submission";
import { numericVipEventId } from "@/lib/vip-prep/identity";

const receipt: AutomaticChecklistSubmission = {
  version: 1, actor: "SYSTEM", sourceEventId: "88", sourceFingerprint: "a".repeat(64),
  eventEndedAt: "2026-10-26T18:00:00Z", scheduledFor: "2026-10-26T19:00:00Z", submittedAt: "2026-10-26T19:00:00Z",
  missingTaskKeys: ["shift-lead-checkout"], missingBwa: true, missingPoc: true, contractWarnings: ["Contract source needs review."],
};
const state = { bwa: "", poc: "", extrasAdded: "Saved staff note", remainingDrinkCardBalance: "35.00",
  tasks: { "event-tables-cleaned": true, "shift-lead-checkout": false },
  taskEvidence: { "event-tables-cleaned": { employeeName: "Recorded staff", completedAt: "2026-10-26T17:00:00Z" } },
  food: { wings: { quantity: "2", manualPrice: "", panSize: "1/2" as const, notes: "Saved food note" } },
  entertainment: { "mini-golf": { quantity: "16", manualPrice: "", selectedRateKey: "" } },
};
const base = { eventId: 88, eventName: "Sanitized event", eventDate: "2026-10-26" };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"]) vi.stubEnv(key, "");
  vi.useFakeTimers(); vi.setSystemTime("2026-10-26T19:00:00Z");
  resetLocalChecklistStorageForTests();
});
afterEach(() => { resetLocalChecklistStorageForTests(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("trusted automatic checklist receipt", () => {
  it("submits saved state as-is with system evidence, never fabricating staff or completing tasks", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const draft = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: null, checklist: state });
    const saved = await saveChecklist({ ...base, action: "submit", expectedUpdatedAt: draft.updatedAt, checklist: draft, autoSubmission: receipt });
    expect(saved).toMatchObject({ status: "submitted", bwa: "", poc: "", extrasAdded: state.extrasAdded,
      remainingDrinkCardBalance: state.remainingDrinkCardBalance, food: state.food, entertainment: state.entertainment,
      tasks: { "event-tables-cleaned": true, "shift-lead-checkout": false, [AUTO_SUBMISSION_KEY]: true } });
    expect(saved.taskEvidence?.["event-tables-cleaned"]).toEqual(state.taskEvidence["event-tables-cleaned"]);
    expect(saved.taskEvidence?.["shift-lead-checkout"]).toBeUndefined();
    expect(readAutomaticSubmission(saved)).toEqual(receipt);
    expect(saved.taskEvidence?.[AUTO_SUBMISSION_KEY]?.employeeName).toBe("Event Host automation (system)");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores client-forged automatic badges, receipts and Admin exemptions on save or submit", async () => {
    for (const action of ["save", "submit"] as const) {
      resetLocalChecklistStorageForTests();
      const saved = await saveChecklist({ ...base, action, expectedUpdatedAt: null, checklist: { ...state,
        tasks: { ...state.tasks, [AUTO_SUBMISSION_KEY]: false }, taskEvidence: { ...state.taskEvidence,
          [AUTO_SUBMISSION_KEY]: { employeeName: "Forged system", completedAt: receipt.submittedAt, automaticSubmission: receipt } } } });
      expect(Object.hasOwn(saved.tasks, AUTO_SUBMISSION_KEY)).toBe(false);
      expect(readAutomaticSubmission(saved)).toBeNull();
    }
  });

  it("preserves the historical system receipt and exempts Admin-reopened drafts from auto-closing again", async () => {
    const submitted = await saveChecklist({ ...base, action: "submit", expectedUpdatedAt: null, checklist: state, autoSubmission: receipt });
    const reopened = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: submitted.updatedAt, checklist: state, allowReopen: true });
    expect(reopened).toMatchObject({ status: "draft", tasks: { [AUTO_SUBMISSION_KEY]: false } });
    expect(readAutomaticSubmission(reopened)).toEqual(receipt);
    await expect(saveChecklist({ ...base, action: "submit", expectedUpdatedAt: reopened.updatedAt, checklist: reopened, autoSubmission: receipt })).rejects.toThrow("Admin reopening must be preserved");
    const manual = await saveChecklist({ ...base, action: "submit", expectedUpdatedAt: reopened.updatedAt, checklist: reopened });
    expect(manual.tasks[AUTO_SUBMISSION_KEY]).toBe(false);
    expect(readAutomaticSubmission(manual)).toEqual(receipt);
  });

  it("also preserves an Admin exemption when the original submission was manual", async () => {
    const submitted = await saveChecklist({ ...base, action: "submit", expectedUpdatedAt: null, checklist: state });
    const reopened = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: submitted.updatedAt, checklist: state, allowReopen: true });
    expect(reopened.tasks[AUTO_SUBMISSION_KEY]).toBe(false);
    expect(readAutomaticSubmission(reopened)).toBeNull();
    const edited = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: reopened.updatedAt, checklist: state });
    expect(edited.tasks[AUTO_SUBMISSION_KEY]).toBe(false);
  });

  it("rejects stale automatic closeout instead of overwriting a staff edit", async () => {
    const draft = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: null, checklist: state });
    const staff = await saveChecklist({ ...base, action: "save", expectedUpdatedAt: draft.updatedAt, checklist: { ...state, extrasAdded: "New staff edit" } });
    await expect(saveChecklist({ ...base, action: "submit", expectedUpdatedAt: draft.updatedAt, checklist: draft, autoSubmission: receipt })).rejects.toThrow("newer");
    expect(await getChecklistRecord(88)).toMatchObject({ status: "draft", updatedAt: staff.updatedAt, extrasAdded: "New staff edit" });
  });

  it("binds receipt identity to the exact numeric compatibility key, including canonical VIP IDs", async () => {
    await expect(saveChecklist({ ...base, action: "submit", expectedUpdatedAt: null, checklist: state,
      autoSubmission: { ...receipt, sourceEventId: "89" } })).rejects.toThrow("Invalid automatic");
    const sourceEventId = "vip-sanitized-reservation";
    const saved = await saveChecklist({ ...base, eventId: numericVipEventId(sourceEventId), action: "submit", expectedUpdatedAt: null,
      checklist: state, autoSubmission: { ...receipt, sourceEventId } });
    expect(readAutomaticSubmission(saved)?.sourceEventId).toBe(sourceEventId);
  });

  it.each([
    { scheduledFor: "2026-10-26T18:59:59Z" }, { submittedAt: "2026-10-26T18:59:59Z" },
    { actor: "STAFF" }, { sourceFingerprint: "not-a-hash" }, { missingBwa: "yes" }, { missingPoc: undefined },
  ])("rejects malformed automatic evidence: %j", async (change) => {
    const malformed = { ...receipt, ...change };
    expect(isAutomaticSubmission(malformed)).toBe(false);
    await expect(saveChecklist({ ...base, action: "submit", expectedUpdatedAt: null, checklist: state,
      autoSubmission: malformed as AutomaticChecklistSubmission })).rejects.toThrow("Invalid automatic");
  });
});
