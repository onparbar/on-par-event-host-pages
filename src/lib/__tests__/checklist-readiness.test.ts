import { describe, expect, it } from "vitest";
import { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY, checklistReadiness, checklistTaskRequirements } from "../checklist-readiness";
import { defaultChecklistState } from "../checklist-model";
import type { EventPlan } from "../event-plans/types";
import { setupTaskFingerprint } from "../operations/setup";

const event: EventPlan = { id: 10, name: "Redacted setup fixture", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 9:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#18332F", food: ["Chicken Tender Platter"], drink_options: ["20 prepaid drink cards"], entertainment: [{ name: "Mini Golf", quantity: "20 guests", time: "Untimed", duration: "9 holes" }, { name: "Duckpin Bowling", quantity: "2 lanes", time: "7 PM - 9 PM", duration: "2 hours" }], verification_status: "Redacted contract validated", source_updated_at: "2026-10-21T14:00:00Z" };

function completedState(plan: EventPlan) {
  const state = defaultChecklistState(plan.date);
  state.bwa = "Staff-entered BWA";
  for (const task of checklistTaskRequirements(plan)) {
    state.tasks[task.key] = true;
    state.taskEvidence![task.key] = { employeeName: state.bwa, completedAt: "2026-10-23T17:00:00Z" };
  }
  return state;
}

describe("conditional setup and closeout readiness", () => {
  it("requires contracted food, cards, mini golf and bowling without giving mini golf a time", () => {
    const tasks = checklistTaskRequirements(event);
    for (const key of ["food-ready", "prepaid-drink-cards-shown", "mini-golf-coins", "bowling-pin-setup"]) expect(tasks.find((task) => task.key === key)?.applicability).toBe("required");
    expect(tasks.find((task) => task.key === "mini-golf-coins")?.dueAt).toBe("2026-10-21T22:00:00.000Z"); // Arrival task, not a timed golf reservation.
  });

  it("only marks categories N/A when their absence is verified", () => {
    const noSelections = { ...event, food: [], entertainment: [], drink_options: [] };
    const tasks = checklistTaskRequirements(noSelections);
    for (const key of ["food-ready", "mini-golf-coins", "prepaid-drink-cards-shown", "bowling-pin-setup"]) expect(tasks.find((task) => task.key === key)?.applicability).toBe("not-applicable");
    const unknown = checklistTaskRequirements({ ...noSelections, source_updated_at: null });
    expect(unknown.find((task) => task.key === "mini-golf-coins")?.applicability).toBe("needs-review");
    expect(checklistReadiness({ ...noSelections, needs_review: true }, defaultChecklistState(event.date)).review.length).toBeGreaterThan(0);
  });

  it("does not silently treat an unknown entertainment quantity as no entertainment", () => {
    const tasks = checklistTaskRequirements({ ...event, entertainment: [{ name: "Mini Golf", quantity: "", time: "Untimed", duration: "" }] });
    expect(tasks.find((task) => task.key === "mini-golf-coins")?.applicability).toBe("needs-review");
  });

  it("does not demand chafing equipment for a verified dessert-only event", () => {
    const tasks = checklistTaskRequirements({ ...event, food: ["Dessert Platter"] });
    expect(tasks.find((task) => task.key === "food-carts-prepped")?.applicability).toBe("required");
    expect(tasks.find((task) => task.key === "chaffing-dishes-placed")?.applicability).toBe("not-applicable");
    expect(tasks.find((task) => task.key === "sternos-cooled")?.applicability).toBe("not-applicable");
  });

  it("does not require hot equipment when no food is verified", () => {
    for (const food of [[], ["No food"], ["None"]]) {
      const tasks = checklistTaskRequirements({ ...event, food });
      for (const key of ["chaffing-dishes-placed", "chaffing-dishes-clean", "sternos-cooled"]) expect(tasks.find((task) => task.key === key)?.applicability).toBe("not-applicable");
    }
  });

  it.each(["1 × Wing Platter", "2× Chicken Tender Platter", "3 x Tater Keg Platter"])("recognizes quantity-prefixed event-plan food: %s", (food) => {
    const tasks = checklistTaskRequirements({ ...event, food: [food] });
    expect(tasks.find((task) => task.key === "chaffing-dishes-placed")?.applicability).toBe("required");
  });

  it.each(["25 × The Front Nine + Appetizer Bar", "15× The Full Course + Wing Bar", "30 x Food Only Package + Taco Bar"])("recognizes hot equipment for a canonical package and bar label: %s", (food) => {
    const tasks = checklistTaskRequirements({ ...event, food: [food] });
    for (const key of ["chaffing-dishes-placed", "chaffing-dishes-clean", "sternos-cooled"]) expect(tasks.find((task) => task.key === key)?.applicability).toBe("required");
    const state = defaultChecklistState(event.date);
    state.bwa = "Manually entered BWA";
    for (const task of tasks) {
      state.tasks[task.key] = true;
      state.taskEvidence![task.key] = { employeeName: state.bwa, completedAt: "2026-10-21T21:00:00Z" };
    }
    expect(checklistReadiness({ ...event, food: [food] }, state).canSubmit).toBe(true);
  });

  it.each(["25 × The Front Nine", "25 × The Front Nine + Dessert Platter", "25 × Unknown Package", "25 × The Front Nine + Unmapped Bar", "25 × The Front Nine+Appetizer Bar"])("retains hot-equipment review for missing or unmapped bar selections: %s", (food) => {
    const tasks = checklistTaskRequirements({ ...event, food: [food] });
    for (const key of ["chaffing-dishes-placed", "chaffing-dishes-clean", "sternos-cooled"]) expect(tasks.find((task) => task.key === key)?.applicability).toBe("needs-review");
  });

  it("recognizes a quantity-prefixed dessert without demanding hot equipment", () => {
    const tasks = checklistTaskRequirements({ ...event, food: ["2 × Dessert Platter"] });
    expect(tasks.find((task) => task.key === "chaffing-dishes-placed")?.applicability).toBe("not-applicable");
  });

  it("computes due times in Eastern across midnight and DST without guessing invalid local clocks", () => {
    expect(checklistTaskRequirements(event).find((task) => task.key === "event-tables-cleaned")?.dueAt).toBe("2026-10-21T21:00:00.000Z");
    const morning = { ...event, date: "2026-11-02", time: "12:30 AM - 2:00 AM" };
    expect(checklistTaskRequirements(morning).find((task) => task.key === "event-tables-cleaned")?.dueAt).toBe("2026-11-02T04:30:00.000Z");
    const ambiguous = checklistTaskRequirements({ ...event, date: "2026-11-01", time: "1:30 AM - 3:00 AM" });
    expect(ambiguous.find((task) => task.key === "contract-details-confirmed")?.applicability).toBe("needs-review");
    expect(ambiguous.find((task) => task.key === "event-tables-cleaned")?.dueAt).toBeNull();
  });

  it("blocks final submission until all required critical tasks have named evidence", () => {
    const state = defaultChecklistState(event.date);
    state.bwa = "Manually entered BWA";
    const tasks = checklistTaskRequirements(event);
    for (const task of tasks) state.tasks[task.key] = true;
    expect(checklistReadiness(event, state).canSubmit).toBe(false);
    for (const task of tasks) state.taskEvidence![task.key] = { employeeName: "Staff-entered actor", completedAt: "2026-10-21T21:00:00Z" };
    expect(checklistReadiness(event, state).canSubmit).toBe(true);
    state.tasks["shift-lead-checkout"] = false;
    expect(checklistReadiness(event, state).missing.map((task) => task.key)).toEqual(["shift-lead-checkout"]);
  });

  it("accepts the existing BWA name as task evidence without a separate employee entry", () => {
    const state = defaultChecklistState(event.date);
    state.bwa = "  Brooke  ";
    for (const task of checklistTaskRequirements(event)) {
      state.tasks[task.key] = true;
      state.taskEvidence![task.key] = { employeeName: state.bwa.trim(), completedAt: "2026-10-23T16:00:00Z" };
    }
    expect(checklistReadiness(event, state).canSubmit).toBe(true);
    expect(state.taskEvidence!["shift-lead-checkout"].employeeName).toBe("Brooke");
    state.bwa = "";
    expect(checklistReadiness(event, state).canSubmit).toBe(false);
  });

  it("keeps earlier completion names and timestamps when the BWA changes", () => {
    const state = defaultChecklistState(event.date);
    state.bwa = "Brooke";
    state.tasks["shift-lead-checkout"] = true;
    state.taskEvidence!["shift-lead-checkout"] = { employeeName: state.bwa, completedAt: "2026-10-23T16:00:00Z" };
    state.bwa = "Carlos";
    checklistReadiness(event, state);
    expect(state.taskEvidence!["shift-lead-checkout"]).toEqual({ employeeName: "Brooke", completedAt: "2026-10-23T16:00:00Z" });
  });

  it("requires explicit fresh confirmation while retaining every unresolved review task and reason", () => {
    const plan = { ...event, needs_review: true, review_reasons: ["Redacted missing contract detail"] };
    const state = completedState(plan);
    const pending = checklistReadiness(plan, state);
    expect(pending.canSubmit).toBe(false);
    expect(pending.canSubmitAfterWarningConfirmation).toBe(true);
    expect(pending.warningMessages).toContain("Redacted missing contract detail");
    expect(pending.warningFingerprint).not.toBeNull();
    const confirmed = checklistReadiness(plan, state, pending.warningFingerprint!);
    expect(confirmed.canSubmit).toBe(true);
    expect(confirmed.review).toEqual(pending.review);
    expect(confirmed.warningMessages).toEqual(pending.warningMessages);
    expect(confirmed.tasks.find((task) => task.key === "contract-details-confirmed")?.applicability).toBe("needs-review");
    expect(plan.needs_review).toBe(true);
    expect(plan.review_reasons).toEqual(["Redacted missing contract detail"]);
  });

  it("does not reuse a saved warning confirmation as fresh closeout consent", () => {
    const plan = { ...event, needs_review: true };
    const state = completedState(plan);
    const pending = checklistReadiness(plan, state);
    state.tasks[CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = true;
    state.taskEvidence![CHECKLIST_CLOSEOUT_CONFIRMATION_KEY] = { employeeName: state.bwa, completedAt: "2026-10-23T17:00:00Z", sourceFingerprint: pending.warningFingerprint!, contractWarnings: pending.warningMessages };
    expect(checklistReadiness(plan, state).canSubmit).toBe(false);
  });

  it.each(["shift-lead-checkout", "contract-details-confirmed", "sternos-cooled"])("never waives unfinished critical required or review work: %s", (key) => {
    const plan = { ...event, needs_review: true, food: ["25 × The Front Nine"] };
    const state = completedState(plan);
    const fingerprint = checklistReadiness(plan, state).warningFingerprint!;
    state.tasks[key] = false;
    const readiness = checklistReadiness(plan, state, fingerprint);
    expect(readiness.canSubmit).toBe(false);
    expect(readiness.canSubmitAfterWarningConfirmation).toBe(false);
    expect(readiness.missing.map((task) => task.key)).toContain(key);
  });

  it.each(["employeeName", "completedAt"])("requires valid named evidence for review work: %s", (field) => {
    const plan = { ...event, needs_review: true };
    const state = completedState(plan);
    const fingerprint = checklistReadiness(plan, state).warningFingerprint!;
    state.taskEvidence!["contract-details-confirmed"][field as "employeeName" | "completedAt"] = field === "employeeName" ? " " : "not-a-time";
    expect(checklistReadiness(plan, state, fingerprint).canSubmit).toBe(false);
  });

  it("cannot use warning consent to bypass a changed task source fingerprint", () => {
    const previous = { ...event, needs_review: true };
    const plan = { ...previous, rooms: ["VIP 2"] };
    const state = completedState(previous);
    state.taskEvidence!["event-tables-cleaned"].sourceFingerprint = setupTaskFingerprint(previous, "event-tables-cleaned");
    const current = checklistReadiness(plan, state);
    expect(current.review.map((task) => task.key)).toContain("event-tables-cleaned");
    expect(current.missing.map((task) => task.key)).toContain("event-tables-cleaned");
    expect(checklistReadiness(plan, state, current.warningFingerprint!).canSubmit).toBe(false);
    state.taskEvidence!["event-tables-cleaned"].sourceFingerprint = setupTaskFingerprint(plan, "event-tables-cleaned");
    expect(checklistReadiness(plan, state, checklistReadiness(plan, state).warningFingerprint!).canSubmit).toBe(true);
  });

  it.each([
    { id: event.id + 1 }, { date: "2026-10-22" }, { time: "7 PM - 10 PM" }, { guest_count: 50 },
    { rooms: ["VIP 2"] }, { food: ["2 × Chicken Tender Platter"] }, { drink_options: [] },
    { entertainment: [{ name: "Mini Golf", quantity: "30 guests", time: "Untimed", duration: "9 holes" }] },
    { special_instructions: ["Redacted updated food direction"] }, { review_reasons: ["Different unresolved detail"] },
    { source_updated_at: "2026-10-23T17:01:00Z" }, { rule_version: "next-rule-version" },
  ])("invalidates closeout consent for changed source or event scope: %j", (changes) => {
    const plan = { ...event, needs_review: true };
    const state = completedState(plan);
    const previous = checklistReadiness(plan, state).warningFingerprint!;
    const changed = checklistReadiness({ ...plan, ...changes }, state, previous);
    expect(changed.warningFingerprint).not.toBe(previous);
    expect(changed.canSubmit).toBe(false);
  });

  it("does not add review gates from setup arithmetic where closeout was already permitted", () => {
    const state = completedState(event); // The unprefixed platter has no verified purchased quantity for setup equipment.
    const readiness = checklistReadiness(event, state);
    expect(readiness.canSubmit).toBe(true);
    expect(readiness.warningFingerprint).toBeNull();
    expect(readiness.warningMessages).toEqual([]);
    expect(readiness.canSubmitAfterWarningConfirmation).toBe(false);
    const pending = { ...event, needs_review: true };
    const fingerprint = checklistReadiness(pending, completedState(pending)).warningFingerprint;
    expect(checklistReadiness({ ...pending, synced_at: "2026-10-23T23:59:00Z" }, completedState(pending)).warningFingerprint).toBe(fingerprint);
  });
});
