import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { checklistReadiness, checklistTaskRequirements } from "@/lib/checklist-readiness";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { completeChecklistTask, defaultChecklistState } from "@/lib/checklist-model";
import { contractSetup, reconcileChecklistSetup, setupTaskFingerprint } from "../setup";

const event: EventPlan = {
  id: 42, name: "Redacted contract setup fixture", date: "2026-10-23", day: "Friday",
  time: "6:00 PM - 9:00 PM", guest_count: 100, rooms: ["VIP 1"], color: "#18332F",
  food: ["2 × Chicken Tender Platter", "1 × Mozzarella Sticks Platter", "1 × Wing Platter"],
  drink_options: [], entertainment: [], verification_status: "Verified redacted source",
  source_updated_at: "2026-10-23T14:00:00Z",
};

describe("contract-driven event setup", () => {
  it("keeps staff POC blank without copying customer source data", () => {
    const [plan] = checklistEventsForPlans([{ ...event, ...{ contact: { first_name: "Customer" }, poc: "Customer contact" } }]);
    expect(plan.poc).toBe("");
  });

  it("does not mirror exactly 100 guests, but mirrors 101 with unchanged purchased food", () => {
    const single = contractSetup(event);
    const mirrored = contractSetup({ ...event, guest_count: 101 });
    expect(single).toMatchObject({ foodTables: 1, mirrored: false, tongs: 8, sauceContainers: 7, spoons: 7 });
    expect(mirrored).toMatchObject({ foodTables: 2, mirrored: true, tongs: 16, sauceContainers: 14, spoons: 14 });
    expect(mirrored.purchasedFood).toEqual(single.purchasedFood);
    expect(mirrored.food).toEqual(single.food);
    expect(mirrored.chafingDishes).toBe(single.chafingDishes! * 2);
  });

  it("reuses pan packing, includes ranch/marinara/BBQ, and does not double already doubled standalone chafers", () => {
    const setup = contractSetup(event);
    expect(setup.food).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Chicken Tenders", quantity: 128, pans: 8, panSize: "1/3" }),
      expect.objectContaining({ name: "Ranch", quantity: 3 }),
      expect.objectContaining({ name: "Marinara Sauce", quantity: 1 }),
      expect.objectContaining({ name: "BBQ Sauce", quantity: 3 }),
      expect.objectContaining({ name: "Mozzarella Sticks", quantity: 4, unit: "pounds" }),
    ]));
    expect(contractSetup({ ...event, guest_count: 201 }).chafingDishes).toBe(contractSetup({ ...event, guest_count: 101 }).chafingDishes);
  });

  it("flags missing quantities and mappings instead of guessing equipment", () => {
    const setup = contractSetup({ ...event, food: ["Chicken Tender Platter", "1 × Unmapped meal"] });
    expect(setup.tongs).toBeNull();
    expect(setup.sauceContainers).toBeNull();
    expect(setup.chafingDishes).toBeNull();
    expect(setup.food.every((row) => row.quantity === null && row.pans === null)).toBe(true);
    expect(setup.review.length).toBeGreaterThan(0);
  });

  it("reads canonical package-plus-bar labels without inventing bar serving supplies", () => {
    const setup = contractSetup({ ...event, guest_count: 50, food: ["50 × The Full Course + Appetizer Bar"] });
    expect(setup.foodTables).toBe(1);
    expect(setup.food.some((row) => row.name === "Chicken Tenders")).toBe(true);
    expect(setup.tongs).toBeNull();
    expect(setup.review.join(" ")).toContain("Bar serving-tong quantities need review");
    expect(setup.review.join(" ")).not.toContain("not recognized");
  });

  it("matches the previously validated redacted August 21 BEO: 50 Wing Bar guests and five dessert platters", () => {
    // Same redacted real-contract selections validated by kitchen/rules.test.ts.
    const setup = contractSetup({ ...event, guest_count: 50, food: ["50 × The Full Course", "1 × Jumbo Wing Bar — Premium wings, expertly prepared and designed for effortless group dining.", "5 × Desert Platter"] });
    expect(setup.foodTables).toBe(1);
    expect(setup.chafingDishes).toBe(1);
    expect(setup.food).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Wings", quantity: 400 }),
      expect.objectContaining({ name: "Assorted Desserts", quantity: 5 }),
    ]));
    expect(setup.purchasedFood[2]).toBe("5 × Desert Platter");
    expect(setup.sauceContainers).toBeNull();
    expect(setup.review.join(" ")).toContain("Bar sauce containers need review");
  });

  it("rechecks only setup tasks whose recorded contract inputs changed", () => {
    let state = defaultChecklistState(event.date);
    state.bwa = "BWA";
    for (const key of ["chaffing-dishes-placed", "event-tables-cleaned", "ask-experience"]) {
      state = completeChecklistTask(state, key, true, "Brooke", "2026-10-23T17:00:00Z", setupTaskFingerprint(event, key));
    }
    const previous = structuredClone(state);
    const changedEvent = { ...event, food: ["3 × Chicken Tender Platter", "1 × Mozzarella Sticks Platter", "1 × Wing Platter"] };
    const next = reconcileChecklistSetup(changedEvent, state);
    expect(next.tasks["chaffing-dishes-placed"]).toBe(false);
    expect(next.tasks["event-tables-cleaned"]).toBe(true);
    expect(next.tasks["ask-experience"]).toBe(true);
    expect(next.taskEvidence?.["ask-experience"]).toEqual(previous.taskEvidence?.["ask-experience"]);
    expect(checklistReadiness(changedEvent, next).review.map((task) => task.key)).toContain("chaffing-dishes-placed");
    const verified = completeChecklistTask(next, "chaffing-dishes-placed", true, "Carlos", "2026-10-23T18:00:00Z", setupTaskFingerprint(changedEvent, "chaffing-dishes-placed"));
    expect(checklistReadiness(changedEvent, verified).review.map((task) => task.key)).not.toContain("chaffing-dishes-placed");
    expect(state).toEqual(previous);
  });

  it("labels Get Food Out and schedules it 15 minutes before event start", () => {
    expect(checklistTaskRequirements(event).find((task) => task.key === "food-kitchen-window")).toMatchObject({ label: "Get Food Out", dueAt: "2026-10-23T21:45:00.000Z" });
  });
});
