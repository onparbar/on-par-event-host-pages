import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultChecklistState, type ChecklistRecord, type EventChecklistState } from "@/lib/checklist-model";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY, checklistReadiness, checklistTaskRequirements } from "@/lib/checklist-readiness";
import { saveChecklist } from "@/lib/checklist-storage";
import type { EventPlan } from "@/lib/event-plans/types";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { synchronizeChecklistFoodAddOns } from "@/lib/gotab/sync-checklist-addons";
import { setupTaskFingerprint } from "@/lib/operations/setup";
import { StaleSaveError } from "@/lib/stale-save";
import { POST } from "../submit/route";

vi.mock("@/lib/checklist-storage", () => ({ saveChecklist: vi.fn(), getChecklistRecord: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/event-plans/sync", () => ({ findEventPlanById: vi.fn() }));
vi.mock("@/lib/gotab/sync-checklist-addons", () => ({ synchronizeChecklistFoodAddOns: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

const event: EventPlan = {
  id: 120, name: "Redacted closeout fixture", date: "2026-10-23", day: "Friday", time: "5:00 PM - 8:00 PM",
  guest_count: 25, rooms: ["VIP 1"], color: "#18332F", food: ["25 × The Front Nine"], drink_options: [], entertainment: [],
  needs_review: true, review_reasons: ["Redacted contract selection remains unresolved"],
  verification_status: "Needs Review", source_updated_at: "2026-10-23T14:00:00Z",
};

function fixture(plan = event) {
  vi.mocked(findEventPlanById).mockResolvedValue(plan);
  const state = defaultChecklistState(plan.date);
  state.bwa = "  Brooke  ";
  for (const task of checklistTaskRequirements(plan)) {
    state.tasks[task.key] = true;
    state.taskEvidence![task.key] = { employeeName: "Brooke", completedAt: "2026-10-23T16:00:00Z" };
  }
  vi.mocked(saveChecklist).mockImplementation(async (input) => ({
    ...input.checklist, eventId: plan.id, eventName: plan.name, eventDate: plan.date, poc: input.checklist.poc ?? "",
    status: "submitted", updatedAt: "2026-10-23T17:00:00Z", submittedAt: "2026-10-23T17:00:00Z",
  } as ChecklistRecord));
  vi.mocked(synchronizeChecklistFoodAddOns).mockRejectedValue(new Error("No orders sent in tests"));
  return { state, fingerprint: checklistReadiness(plan, state).warningFingerprint! };
}

function submit(state: EventChecklistState, extra: Record<string, unknown> = {}, id = event.id) {
  return POST(new Request("https://example.test/api/checklists/submit", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" },
    body: JSON.stringify({ eventId: id, checklist: state, expectedUpdatedAt: null, ...extra }),
  }));
}

describe("explicit contract-warning closeout confirmation", () => {
  it("requires new confirmation even if the request contains a saved receipt", async () => {
    const { state, fingerprint } = fixture();
    state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = true;
    state.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = { employeeName: "Old staff", completedAt: "2026-10-22T16:00:00Z", sourceFingerprint: fingerprint, contractWarnings: ["Old warning"] };
    const response = await submit(state);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ reviewTasks: expect.arrayContaining(["contract-details-confirmed"]) });
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("records the explicit requester, server timestamp and unchanged server warning snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T17:12:34Z"));
    const { state, fingerprint } = fixture();
    const originalWarnings = checklistReadiness(event, state).warningMessages;
    state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = true;
    state.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = { employeeName: "Forged actor", completedAt: "1999-01-01T00:00:00Z", sourceFingerprint: "forged", contractWarnings: ["Forged warning"] };
    const response = await submit(state, { requesterName: "  Carlos  ", warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(200);
    const saved = vi.mocked(saveChecklist).mock.calls[0][0];
    expect(saved).toMatchObject({ action: "submit", eventId: event.id, expectedUpdatedAt: null });
    expect(saved.checklist.tasks![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBe(true);
    expect(saved.checklist.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toEqual({
      employeeName: "Carlos", completedAt: "2026-10-23T17:12:34.000Z", sourceFingerprint: fingerprint, contractWarnings: originalWarnings,
    });
    expect(saved.checklist.taskEvidence!["shift-lead-checkout"]).toEqual(state.taskEvidence!["shift-lead-checkout"]);
    expect(event.needs_review).toBe(true);
    expect(event.review_reasons).toEqual(["Redacted contract selection remains unresolved"]);
    expect(synchronizeChecklistFoodAddOns).toHaveBeenCalledExactlyOnceWith(String(event.id), state.food, undefined, "EVENT_HOST_ADDON", { requesterName: "Carlos" });
  });

  it("uses the manually entered BWA when no separate requester is supplied", async () => {
    const { state, fingerprint } = fixture();
    const response = await submit(state, { requesterName: "  ", warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(200);
    const evidence = vi.mocked(saveChecklist).mock.calls[0][0].checklist.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY];
    expect(evidence.employeeName).toBe("Brooke");
    expect(Number.isFinite(Date.parse(evidence.completedAt))).toBe(true);
  });

  it.each([null, true, [], {}, { sourceFingerprint: 2 }, { sourceFingerprint: " " }, { sourceFingerprint: "a", contractWarnings: ["client warning"] }])("rejects malformed confirmation before saving or ordering: %j", async (warningConfirmation) => {
    const { state } = fixture();
    const response = await submit(state, { warningConfirmation });
    expect(response.status).toBe(400);
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it.each(["a".repeat(121), "Brooke\nCarlos", "Brooke\u0000"])("validates the fallback confirmation actor: %j", async (bwa) => {
    const { state, fingerprint } = fixture();
    state.bwa = bwa;
    const response = await submit(state, { warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(400);
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it.each(["shift-lead-checkout", "contract-details-confirmed", "sternos-cooled"])("keeps unfinished critical required/review work blocked despite consent: %s", async (key) => {
    const { state, fingerprint } = fixture();
    state.tasks[key] = false;
    const response = await submit(state, { warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ incompleteTasks: expect.arrayContaining([key]) });
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it.each([{ date: "2026-10-24" }, { id: event.id + 1 }, { guest_count: 30 }, { review_reasons: ["Changed warning"] }])("rejects confirmation for changed event scope/source: %j", async (changes) => {
    const { state, fingerprint } = fixture();
    vi.mocked(findEventPlanById).mockResolvedValue({ ...event, ...changes });
    const response = await submit(state, { warningConfirmation: { sourceFingerprint: fingerprint } }, changes.id ?? event.id);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: "Contract warnings changed; refresh and confirm the current warnings before submitting." });
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("requires changed setup tasks to be rechecked, not bypassed by fresh consent", async () => {
    const { state } = fixture();
    state.taskEvidence!["event-tables-cleaned"].sourceFingerprint = setupTaskFingerprint(event, "event-tables-cleaned");
    const changed = { ...event, rooms: ["VIP 2"] };
    vi.mocked(findEventPlanById).mockResolvedValue(changed);
    const fingerprint = checklistReadiness(changed, state).warningFingerprint!;
    const response = await submit(state, { warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ incompleteTasks: expect.arrayContaining(["event-tables-cleaned"]) });
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("preserves compare-and-swap failure protection and never dispatches after a stale save", async () => {
    const { state, fingerprint } = fixture();
    vi.mocked(saveChecklist).mockRejectedValueOnce(new StaleSaveError());
    const response = await submit(state, { expectedUpdatedAt: "2026-10-23T16:00:00Z", warningConfirmation: { sourceFingerprint: fingerprint } });
    expect(response.status).toBe(409);
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("does not manufacture a warning receipt for a normal verified closeout", async () => {
    const verified = { ...event, needs_review: false, review_reasons: [], food: ["1 × Chicken Tender Platter"], source_updated_at: "2026-10-23T14:00:00Z" };
    const { state } = fixture(verified);
    state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = true;
    state.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = { employeeName: "Forged actor", completedAt: "1999-01-01T00:00:00Z", sourceFingerprint: "forged", contractWarnings: ["Forged warning"] };
    const response = await submit(state);
    expect(response.status).toBe(200);
    const saved = vi.mocked(saveChecklist).mock.calls[0][0].checklist;
    expect(saved.tasks![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
    expect(saved.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY]).toBeUndefined();
  });
});
