import { describe, expect, it } from "vitest";
import { checklistReadiness, checklistTaskRequirements } from "../checklist-readiness";
import { defaultChecklistState } from "../checklist-model";
import type { EventPlan } from "../event-plans/types";

const event: EventPlan = { id: 10, name: "Redacted setup fixture", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 9:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#18332F", food: ["Chicken Tender Platter"], drink_options: ["20 prepaid drink cards"], entertainment: [{ name: "Mini Golf", quantity: "20 guests", time: "Untimed", duration: "9 holes" }, { name: "Duckpin Bowling", quantity: "2 lanes", time: "7 PM - 9 PM", duration: "2 hours" }], verification_status: "Redacted contract validated", source_updated_at: "2026-10-21T14:00:00Z" };

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

  it.each(["1 × Wing Platter", "2× Chicken Tender Platter", "3 x Tater Keg Platter"])("recognizes quantity-prefixed event-plan food: %s", (food) => {
    const tasks = checklistTaskRequirements({ ...event, food: [food] });
    expect(tasks.find((task) => task.key === "chaffing-dishes-placed")?.applicability).toBe("required");
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
});
