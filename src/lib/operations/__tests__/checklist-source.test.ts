import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChecklistSource, ChecklistSourceError } from "../checklist-source";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import { VipPrepApiError } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { defaultChecklistState, type ChecklistRecord } from "@/lib/checklist-model";
import type { EventPlan } from "@/lib/event-plans/types";
import { AUTO_SUBMISSION_KEY } from "../checklist-auto-submission";

const date = "2026-10-24";
const reservation = { ...vipPrepPayload.reservations[0], operatingDate: date, startAt: `${date}T21:00:00Z`, endAt: `${date}T23:00:00Z` };
const sourceId = vipPrepExternalId(reservation);
const id = numericVipEventId(sourceId);
const plan: EventPlan = { id: 77, name: "Sanitized corporate party", date, day: "Saturday", time: "5:00 PM - 8:00 PM", guest_count: 20,
  rooms: ["VIP 1"], color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };

function options() {
  return { findPlan: vi.fn().mockResolvedValue(null), findVip: vi.fn().mockResolvedValue(reservation), getRecord: vi.fn().mockResolvedValue(null) };
}
function storedRecord(overrides: Partial<ChecklistRecord> = {}): ChecklistRecord {
  return { ...defaultChecklistState(date), eventId: id, eventName: "Sanitized saved record", eventDate: date, poc: "", status: "draft", updatedAt: null, submittedAt: null, ...overrides };
}

describe("manual checklist write identity", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("uses the full VIP source ID and exact past date, not today's rolling horizon", async () => {
    const deps = options();
    const result = await resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps);
    expect(result.kitchenEventId).toBe(sourceId); expect(result.plan.source_event_id).toBe(sourceId);
    expect(deps.findVip).toHaveBeenNthCalledWith(1, sourceId, date, date);
    expect(deps.findVip).toHaveBeenNthCalledWith(2, id, date, date);
  });
  it("keeps legacy numeric VIP writes working only when the saved exact-date owner is unique", async () => {
    const deps = options();
    deps.getRecord.mockResolvedValue(storedRecord());
    const result = await resolveChecklistSource({ eventId: id }, deps);
    expect(result.kitchenEventId).toBe(sourceId);
    expect(deps.findVip).toHaveBeenCalledExactlyOnceWith(id, date, date);
  });
  it("rejects mismatched source IDs before any source or saved record access", async () => {
    const deps = options();
    await expect(resolveChecklistSource({ eventId: 77, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
    expect(deps.findVip).not.toHaveBeenCalled(); expect(deps.findPlan).not.toHaveBeenCalled(); expect(deps.getRecord).not.toHaveBeenCalled();
  });
  it("does not select a corporate event or another VIP when numeric hashes collide", async () => {
    const deps = options();
    deps.findPlan.mockResolvedValue({ ...plan, id });
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
    await expect(resolveChecklistSource({ eventId: id, eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
    deps.findPlan.mockResolvedValue(null);
    deps.findVip.mockImplementation(async (key) => { if (typeof key === "number") throw new VipPrepApiError("VIP booking identity is ambiguous. Use the source reservation ID."); return reservation; });
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
  });
  it("keeps a qualified corporate source during an unrelated VIP outage, but fails closed on ambiguous legacy requests", async () => {
    const deps = options(); deps.findPlan.mockResolvedValue(plan); deps.findVip.mockRejectedValue(new Error("Private upstream diagnostic"));
    expect((await resolveChecklistSource({ eventId: plan.id, sourceEventId: String(plan.id), eventDate: date }, deps)).kitchenEventId).toBe(String(plan.id));
    await expect(resolveChecklistSource({ eventId: plan.id, eventDate: date }, deps)).rejects.toMatchObject({ status: 503 });
    deps.findPlan.mockResolvedValue(null);
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toThrow("No different party was substituted");
  });
  it("bounds the default booking probe to three seconds without delaying qualified corporate saves indefinitely", async () => {
    vi.stubEnv("VIP_PREP_API_TOKEN", "sanitized-test-token");
    const signal = AbortSignal.abort(new DOMException("Sanitized source timeout", "TimeoutError"));
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      init?.signal?.throwIfAborted();
      throw new Error("Unexpected unbounded booking probe");
    });
    vi.stubGlobal("fetch", fetchMock);
    const deps = { findPlan: vi.fn().mockResolvedValue(plan), getRecord: vi.fn().mockResolvedValue(null) };
    expect((await resolveChecklistSource({ eventId: plan.id, sourceEventId: String(plan.id), eventDate: date }, deps)).plan.id).toBe(plan.id);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deps.findPlan.mockResolvedValue(null);
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toMatchObject({ status: 503 });
    expect(timeout).toHaveBeenNthCalledWith(2, 3000);
  });
  it("rejects changed booking dates and records owned by another date", async () => {
    const deps = options();
    deps.getRecord.mockResolvedValue(storedRecord({ eventDate: "2026-10-23" }));
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
    deps.getRecord.mockResolvedValue(null);
    await expect(resolveChecklistSource({ eventId: id, sourceEventId: sourceId, eventDate: "2026-10-25" }, deps)).rejects.toMatchObject({ status: 409 });
  });
  it("honors a trusted saved source receipt even when a same-date corporate/VIP hash collision cannot be refreshed", async () => {
    const deps = options();
    const vipSource = "vip-test-h4l720-hfbtsa";
    const sharedId = 527983760;
    deps.findPlan.mockResolvedValue({ ...plan, id: sharedId });
    deps.findVip.mockRejectedValue(new Error("VIP source unavailable"));
    const record = storedRecord({ eventId: sharedId, taskEvidence: {
      [AUTO_SUBMISSION_KEY]: { employeeName: "SYSTEM", completedAt: "2026-10-25T01:00:00Z", automaticSubmission: {
        version: 1, actor: "SYSTEM", sourceEventId: vipSource, sourceFingerprint: "f".repeat(64),
        eventEndedAt: "2026-10-25T00:00:00Z", scheduledFor: "2026-10-25T01:00:00Z", submittedAt: "2026-10-25T01:00:00Z",
        missingTaskKeys: [], missingBwa: false, missingPoc: false, contractWarnings: [],
      } },
    } });
    deps.getRecord.mockResolvedValue(record);
    await expect(resolveChecklistSource({ eventId: sharedId, sourceEventId: String(sharedId), eventDate: date }, deps)).rejects.toMatchObject({ status: 409 });
    record.taskEvidence![AUTO_SUBMISSION_KEY].automaticSubmission!.sourceEventId = String(sharedId);
    expect((await resolveChecklistSource({ eventId: sharedId, sourceEventId: String(sharedId), eventDate: date }, deps)).plan.id).toBe(sharedId);
  });
  it.each([{ eventId: 0 }, { eventId: 1, sourceEventId: [] }, { eventId: 1, eventDate: "2026-02-30" }])("rejects malformed source selection: %j", async (input) => {
    await expect(resolveChecklistSource(input, options())).rejects.toBeInstanceOf(ChecklistSourceError);
  });
});
