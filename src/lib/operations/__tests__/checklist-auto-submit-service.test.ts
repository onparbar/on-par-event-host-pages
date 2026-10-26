import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventPlanStorage, type EventPlanWrite } from "@/lib/event-plans/storage";
import { getChecklistRecord, resetLocalChecklistStorageForTests, saveChecklist } from "@/lib/checklist-storage";
import type { EventChecklistState } from "@/lib/checklist-model";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { VipPrepPayload } from "@/lib/vip-prep/types";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import { autoSubmitChecklists } from "../checklist-auto-submit-service";
import { AUTO_SUBMISSION_KEY, readAutomaticSubmission } from "../checklist-auto-submission";
import { workspaceEvent } from "./workspace-fixtures";

vi.mock("server-only", () => ({}));
const DATE = "2026-10-27";
const NOW = new Date("2026-10-28T02:00:00Z");
const ENV = { CHECKLIST_AUTO_SUBMIT_ENABLED: "true", CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "2026-10-26T19:00:00Z" };
const event = { ...workspaceEvent, date: DATE, source_updated_at: "2026-10-27T16:00:00Z" };
const blank: EventChecklistState = { bwa: "", poc: "", extrasAdded: "", remainingDrinkCardBalance: "", tasks: {}, taskEvidence: {}, food: {}, entertainment: {} };

async function setup() {
  const plans = createMemoryEventPlanStorage();
  const row: EventPlanWrite = { eventId: "77", eventDate: DATE, plan: event as unknown as Record<string, unknown>,
    sourceSnapshot: { status: "DEFINITE", eventStartAt: "2026-10-27T22:00:00Z", eventEndAt: "2026-10-28T01:00:00Z" }, sourceUpdatedAt: event.source_updated_at };
  await plans.replaceWindow({ startDate: DATE, endDate: DATE }, [row]);
  const vipClient = { configured: true, fetchRange: vi.fn<(from: string, to: string) => Promise<VipPrepPayload>>(async (from, to) => ({ ...vipPrepPayload, from, to, reservations: [], reservationCount: 0 })) };
  const saveRecord = vi.fn(saveChecklist);
  return { plans, vipClient, saveRecord, env: ENV, now: NOW };
}

async function seed(state: EventChecklistState = blank, extras: Partial<{ eventDate: string; action: "save" | "submit" }> = {}) {
  return saveChecklist({ action: extras.action ?? "save", eventId: 77, eventName: event.name, eventDate: extras.eventDate ?? DATE,
    poc: state.poc, checklist: state, expectedUpdatedAt: null });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"]) vi.stubEnv(key, "");
  resetLocalChecklistStorageForTests(); vi.useFakeTimers(); vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("automatic checklist Admin closeout", () => {
  it("creates a clearly incomplete record for a never-started event at exactly end plus1 hour, not before", async () => {
    const deps = await setup();
    expect((await autoSubmitChecklists({ ...deps, now: new Date(NOW.getTime() - 1) })).submitted).toBe(0);
    expect(await getChecklistRecord(77)).toBeNull();
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
    const record = (await getChecklistRecord(77))!;
    expect(record).toMatchObject({ status: "submitted", bwa: "", poc: "", food: {}, entertainment: {} });
    const receipt = readAutomaticSubmission(record)!;
    expect(receipt).toMatchObject({ actor: "SYSTEM", sourceEventId: "77", eventEndedAt: "2026-10-28T01:00:00.000Z", scheduledFor: NOW.toISOString(),
      submittedAt: NOW.toISOString(), missingBwa: true, missingPoc: true });
    expect(receipt.missingTaskKeys).toContain("tablet-layout-accurate");
    expect(record.tasks["tablet-layout-accurate"]).toBeUndefined();
  });

  it("preserves saved staff/task/add-on state, including incomplete noncritical tasks, without any KDS or booking action", async () => {
    const deps = await setup();
    const state: EventChecklistState = { ...blank, bwa: "Lex", poc: "Tina", extrasAdded: "Keep this", remainingDrinkCardBalance: "7.50",
      tasks: { "tripleseat-contract-printed": true, "existing-unknown-task": true },
      taskEvidence: { "tripleseat-contract-printed": { employeeName: "Lex", completedAt: "2026-10-27T18:00:00Z" } },
      food: { wings: { quantity: "2", manualPrice: "120", panSize: "1/2" } }, entertainment: { "mini-golf": { quantity: "16", manualPrice: "", selectedRateKey: "" } } };
    await seed(state);
    const network = vi.spyOn(globalThis, "fetch");
    const claim = vi.spyOn(GoTabIntegrationStorage.prototype, "claimDueDispatches");
    const enqueue = vi.spyOn(GoTabIntegrationStorage.prototype, "enqueueRequest");
    const arrival = vi.spyOn(GoTabIntegrationStorage.prototype, "confirmVipCheckin");
    await autoSubmitChecklists(deps);
    const saved = (await getChecklistRecord(77))!;
    expect(saved).toMatchObject({ bwa: state.bwa, poc: state.poc, extrasAdded: state.extrasAdded,
      remainingDrinkCardBalance: state.remainingDrinkCardBalance, food: state.food, entertainment: state.entertainment });
    for (const [key, value] of Object.entries(state.tasks)) expect(saved.tasks[key]).toBe(value);
    expect(saved.taskEvidence?.["tripleseat-contract-printed"]).toEqual(state.taskEvidence?.["tripleseat-contract-printed"]);
    expect(readAutomaticSubmission(saved)?.missingTaskKeys).toContain("food-quality-check");
    expect(network).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled(); expect(arrival).not.toHaveBeenCalled();
  });

  it("records unresolved contract and missing-staff warnings without forging human confirmation", async () => {
    const deps = await setup();
    const row = (await deps.plans.findById("77"))!;
    await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, [{ ...row, plan: { ...event, needs_review: true, review_reasons: ["Redacted food mapping needs review"] } }]);
    await autoSubmitChecklists(deps);
    const record = (await getChecklistRecord(77))!;
    expect(readAutomaticSubmission(record)?.contractWarnings).toContain("Redacted food mapping needs review");
    expect(record.tasks["workspace:closeout:contract-warnings"]).toBeUndefined();
    expect(record.taskEvidence?.[AUTO_SUBMISSION_KEY]?.employeeName).not.toBe("Lex");
  });

  it("is idempotent under cron retries and concurrent cron invocations", async () => {
    const deps = await setup();
    const results = await Promise.all([autoSubmitChecklists(deps), autoSubmitChecklists(deps)]);
    expect(results.reduce((sum, result) => sum + result.submitted, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.conflicts, 0)).toBe(1);
    const record = await getChecklistRecord(77);
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect(await getChecklistRecord(77)).toEqual(record);
  });

  it("does not overwrite a concurrent manual save and retries only after reading its new saved revision", async () => {
    const deps = await setup();
    const first = await seed();
    deps.saveRecord.mockImplementationOnce(async (input) => {
      await saveChecklist({ action: "save", eventId: 77, eventName: event.name, eventDate: DATE, checklist: { ...blank, bwa: "Carlos" }, expectedUpdatedAt: first.updatedAt });
      return saveChecklist(input);
    });
    expect((await autoSubmitChecklists(deps)).conflicts).toBe(1);
    expect((await getChecklistRecord(77))?.bwa).toBe("Carlos");
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
    expect((await getChecklistRecord(77))?.bwa).toBe("Carlos");
  });

  it("retries a failed persistence attempt without recording a false submission", async () => {
    const deps = await setup(); deps.saveRecord.mockRejectedValueOnce(new Error("Temporary saved-record failure"));
    expect((await autoSubmitChecklists(deps)).failed).toBe(1);
    expect(await getChecklistRecord(77)).toBeNull();
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
  });

  it.each(["automatic", "manual"])("never immediately re-closes an Admin-reopened %s submission", async (kind) => {
    const deps = await setup();
    if (kind === "automatic") await autoSubmitChecklists(deps); else await seed(blank, { action: "submit" });
    const submitted = (await getChecklistRecord(77))!;
    await saveChecklist({ action: "save", eventId: 77, eventName: event.name, eventDate: DATE, checklist: submitted,
      expectedUpdatedAt: submitted.updatedAt, allowReopen: true });
    const reopened = await getChecklistRecord(77);
    deps.saveRecord.mockClear();
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect(deps.saveRecord).not.toHaveBeenCalled();
    expect(await getChecklistRecord(77)).toEqual(reopened);
  });

  it("does not touch a manually submitted record or another date's legacy checklist identity", async () => {
    const deps = await setup(); await seed(blank, { action: "submit" });
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    resetLocalChecklistStorageForTests(); await seed(blank, { eventDate: "2026-10-26" });
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect((await getChecklistRecord(77))?.eventDate).toBe("2026-10-26");
  });

  it.each(["cancelled", "rescheduled", "moved"])("revalidates a %s corporate source before saving", async (change) => {
    const deps = await setup(); const row = (await deps.plans.findById("77"))!;
    vi.spyOn(deps.plans, "findById").mockResolvedValue(change === "cancelled" ? { ...row, active: false }
      : change === "moved" ? { ...row, eventDate: "2026-10-28", plan: { ...row.plan, date: "2026-10-28" } }
      : { ...row, sourceSnapshot: { ...row.sourceSnapshot, eventEndAt: "2026-10-28T03:00:00Z" } });
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it.each([
    { offset: -1, expected: 1 },
    { offset: 0, expected: 1 },
    { offset: 1, expected: 0 },
    { offset: 1_800_000, expected: 0 },
    { offset: 3_600_000, expected: 0 },
  ])("uses the event end, not the later closeout deadline, as the activation boundary: $offset", async ({ offset, expected }) => {
    const deps = await setup();
    const activatedAt = new Date(Date.parse("2026-10-28T01:00:00Z") + offset).toISOString();
    expect((await autoSubmitChecklists({ ...deps, env: { ...ENV, CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: activatedAt } })).submitted).toBe(expected);
    expect(deps.saveRecord).toHaveBeenCalledTimes(expected);
  });

  it("rechecks the event-end activation boundary when the source end changes before saving", async () => {
    const deps = await setup();
    const row = (await deps.plans.findById("77"))!;
    vi.spyOn(deps.plans, "findById").mockResolvedValue({ ...row,
      sourceSnapshot: { ...row.sourceSnapshot, eventEndAt: "2026-10-28T00:59:59.998Z" } });
    expect((await autoSubmitChecklists({ ...deps, env: { ...ENV,
      CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: "2026-10-28T00:59:59.999Z" } })).submitted).toBe(0);
    expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it("does no source work before the activation instant", async () => {
    const deps = await setup();
    const read = vi.spyOn(deps.plans, "plansForWindow");
    expect((await autoSubmitChecklists({ ...deps, env: { ...ENV,
      CHECKLIST_AUTO_SUBMIT_ACTIVATED_AT: new Date(NOW.getTime() + 1).toISOString() } })).submitted).toBe(0);
    expect(read).not.toHaveBeenCalled();
    expect(deps.vipClient.fetchRange).not.toHaveBeenCalled();
  });

  it("closes an exact VIP checklist without recording arrival or creating a prepaid-food order", async () => {
    const deps = await setup(); await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, []);
    const reservation = { ...vipPrepPayload.reservations[0], operatingDate: DATE, startAt: "2026-10-27T22:00:00Z", endAt: "2026-10-28T01:00:00Z", updatedAt: "2026-10-27T16:00:00Z" };
    deps.vipClient.fetchRange.mockImplementation(async (from, to) => ({ ...vipPrepPayload, from, to, reservations: [reservation], reservationCount: 1 }));
    const arrival = vi.spyOn(GoTabIntegrationStorage.prototype, "confirmVipCheckin");
    const enqueue = vi.spyOn(GoTabIntegrationStorage.prototype, "enqueueRequest");
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
    const id = numericVipEventId(vipPrepExternalId(reservation));
    expect(readAutomaticSubmission((await getChecklistRecord(id))!)?.sourceEventId).toBe(vipPrepExternalId(reservation));
    expect((await getChecklistRecord(id))?.food).toEqual({});
    expect(arrival).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not repeatedly re-read each already-submitted VIP after the source range is loaded", async () => {
    const deps = await setup(); await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, []);
    const reservation = { ...vipPrepPayload.reservations[0], operatingDate: DATE, startAt: "2026-10-27T22:00:00Z", endAt: "2026-10-28T01:00:00Z" };
    deps.vipClient.fetchRange.mockImplementation(async (from, to) => ({ ...vipPrepPayload, from, to, reservations: [reservation], reservationCount: 1 }));
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
    expect(deps.vipClient.fetchRange).toHaveBeenCalledTimes(2);
    deps.vipClient.fetchRange.mockClear(); deps.saveRecord.mockClear();
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect(deps.vipClient.fetchRange).toHaveBeenCalledExactlyOnceWith("2026-10-25", DATE);
    expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it("retains a specific VIP mapping warning even when the purchased label resembles a known recipe", async () => {
    const deps = await setup(); await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, []);
    const reservation = { ...vipPrepPayload.reservations[0], operatingDate: DATE, startAt: "2026-10-27T22:00:00Z", endAt: "2026-10-28T01:00:00Z",
      foodPrep: [{ code: "unmapped-code", label: "Chicken Tender Platter", quantity: 2, unitPriceCents: 12000, totalCents: 24000 }] };
    deps.vipClient.fetchRange.mockImplementation(async (from, to) => ({ ...vipPrepPayload, from, to, reservations: [reservation], reservationCount: 1 }));
    expect((await autoSubmitChecklists(deps)).submitted).toBe(1);
    const record = (await getChecklistRecord(numericVipEventId(vipPrepExternalId(reservation))))!;
    expect(readAutomaticSubmission(record)?.contractWarnings.join(" ")).toContain("unmapped-code");
    expect(readAutomaticSubmission(record)?.contractWarnings.join(" ")).toContain("no verified kitchen mapping");
    expect(record.food).toEqual({});
  });

  it("fails closed for canonical VIP/hash collisions without merging parties", async () => {
    const deps = await setup();
    const base = { ...vipPrepPayload.reservations[0], operatingDate: DATE, startAt: "2026-10-27T22:00:00Z", endAt: "2026-10-28T01:00:00Z" };
    const reservations = ["test-h4l720-hfbtsa", "test-1k212gj-1rfricb"].map((id) => ({ ...base, id }));
    const collision = numericVipEventId(vipPrepExternalId(reservations[0]));
    expect(numericVipEventId(vipPrepExternalId(reservations[1]))).toBe(collision);
    await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, [{ eventId: String(collision), eventDate: DATE,
      plan: { ...event, id: collision } as unknown as Record<string, unknown>, sourceSnapshot: { status: "DEFINITE" }, sourceUpdatedAt: event.source_updated_at }]);
    deps.vipClient.fetchRange.mockImplementation(async (from, to) => ({ ...vipPrepPayload, from, to, reservations, reservationCount: 2 }));
    const result = await autoSubmitChecklists(deps);
    expect(result).toMatchObject({ considered: 3, submitted: 0, skipped: 3 });
    expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "rescheduled", "moved"])("does not close a VIP after its source is %s", async (change) => {
    const deps = await setup(); await deps.plans.replaceWindow({ startDate: DATE, endDate: DATE }, []);
    const initial = { ...vipPrepPayload.reservations[0], operatingDate: DATE, startAt: "2026-10-27T22:00:00Z", endAt: "2026-10-28T01:00:00Z" };
    let reads = 0;
    deps.vipClient.fetchRange.mockImplementation(async (from, to) => ({ ...vipPrepPayload, from, to, reservationCount: 1,
      reservations: [reads++ === 0 ? initial : change === "cancelled" ? { ...initial, status: "cancelled" as const }
        : change === "moved" ? { ...initial, operatingDate: "2026-10-28", startAt: "2026-10-28T22:00:00Z", endAt: "2026-10-29T01:00:00Z" }
        : { ...initial, endAt: "2026-10-28T03:00:00Z" }] }));
    expect((await autoSubmitChecklists(deps)).submitted).toBe(0);
    expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it("reports a provider row cap rather than silently treating a partial source list as complete", async () => {
    const deps = await setup(); const row = (await deps.plans.findById("77"))!;
    vi.spyOn(deps.plans, "plansForWindow").mockResolvedValue(Array.from({ length: 1000 }, () => row));
    const result = await autoSubmitChecklists(deps);
    expect(result.sourceErrors.join(" ")).toContain("safe row limit");
    expect(result.submitted).toBe(0); expect(deps.saveRecord).not.toHaveBeenCalled();
  });

  it("keeps corporate closeout independent of a VIP feed outage without exposing source details", async () => {
    const deps = await setup(); deps.vipClient.fetchRange.mockRejectedValue(new Error("private upstream body"));
    const result = await autoSubmitChecklists(deps);
    expect(result.submitted).toBe(1); expect(result.sourceErrors).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private upstream body");
  });

  it("does no source or storage work in a read-only Preview, disabled configuration, or invalid activation", async () => {
    const deps = await setup(); const read = vi.spyOn(deps.plans, "plansForWindow");
    for (const env of [{ ...ENV, VERCEL_ENV: "preview", EVENT_HOST_REVIEW_ONLY: "true" }, {}, { CHECKLIST_AUTO_SUBMIT_ENABLED: "true" }]) {
      expect((await autoSubmitChecklists({ ...deps, env })).submitted).toBe(0);
    }
    expect(read).not.toHaveBeenCalled(); expect(deps.vipClient.fetchRange).not.toHaveBeenCalled(); expect(deps.saveRecord).not.toHaveBeenCalled();
  });
});
