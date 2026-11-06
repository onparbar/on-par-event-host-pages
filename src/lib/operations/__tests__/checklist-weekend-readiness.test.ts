import { describe, expect, it } from "vitest";
import { checklistSections, defaultChecklistState } from "@/lib/checklist-model";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { vipPrepEventPlan } from "@/lib/vip-prep/client";
import { novemberVipPayload } from "@/lib/vip-prep/__tests__/prearrival-fixtures";
import { automaticChecklistTiming } from "../checklist-auto-submit-policy";
import { workspaceEvent } from "./workspace-fixtures";

// Redacted reproductions of the observed weekend state, not raw operational exports.
const event = { ...workspaceEvent, id: 93001, name: "Redacted Saturday event", date: "2026-10-24", time: "4:00 PM - 7:00 PM",
  needs_review: true, review_reasons: ["Contract selections remain unverified."], source_updated_at: "2026-10-19T13:11:00Z" };

describe("weekend checklist submission blockers", () => {
  it("retains the contract-warning confirmation requirement even when every checkbox has completion evidence", () => {
    const state = defaultChecklistState(event.date);
    state.bwa = "Recorded BWA";
    for (const task of checklistSections.flatMap((section) => section.items)) {
      state.tasks[task.key] = true;
      state.taskEvidence![task.key] = { employeeName: "Recorded staff", completedAt: "2026-10-24T23:00:00Z" };
    }
    const readiness = checklistReadiness(event, state);
    expect(readiness.missing).toEqual([]);
    expect(readiness.warningMessages.length).toBeGreaterThan(0);
    expect(readiness.canSubmit).toBe(false);
    expect(readiness.canSubmitAfterWarningConfirmation).toBe(true);
    expect(checklistReadiness(event, state, readiness.warningFingerprint!).canSubmit).toBe(true);
  });

  it("does not treat entered BWA/add-on values as completion of required checklist tasks", () => {
    const state = defaultChecklistState(event.date);
    state.bwa = "Recorded BWA";
    state.food.wings = { quantity: "1", manualPrice: "" };
    const readiness = checklistReadiness({ ...event, id: 93002 }, state);
    expect(readiness.canSubmit).toBe(false);
    expect(readiness.canSubmitAfterWarningConfirmation).toBe(false);
    expect(readiness.missing.map((task) => task.key)).toContain("shift-lead-checkout");
  });

  it("computes one-hour closeout from the previously verified redacted VIP interval, not from food prep or arrival", () => {
    const reservation = novemberVipPayload().reservations[0];
    expect(automaticChecklistTiming({ sourceEventId: `vip-${reservation.id}`, event: vipPrepEventPlan(reservation),
      startAt: reservation.startAt, endAt: reservation.endAt, sourceUpdatedAt: reservation.updatedAt })).toEqual({
      eventEndedAt: "2026-11-15T00:00:00.000Z", scheduledFor: "2026-11-15T01:00:00.000Z",
    });
  });
});
