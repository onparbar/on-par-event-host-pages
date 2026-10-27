import { describe, expect, it } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { checklistReadiness, checklistTaskRequirements } from "@/lib/checklist-readiness";
import { checklistEventsForPlans } from "@/lib/checklist-events";
import { completeChecklistTask, defaultChecklistState } from "@/lib/checklist-model";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { contractSetup, reconcileChecklistSetup, servingChafingSetup, setupTaskFingerprint } from "../setup";

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

  it("separates the approved Taco Bar and wing/tender serving layout from all prepared pans", () => {
    const setup = contractSetup({ ...event, guest_count: 17, food: ["17 × The Full Course", "Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"] });
    expect(setup.chafingDishes).toBe(3);
    expect(setup.servingSetup?.chafingDishes).toBe(2);
    expect(setup.servingSetup?.instructions).toEqual([
      "Wings and chicken tenders share one serving chafing dish: one 1/2 pan of each.",
      "Keep the extra 1/2 pan of wings and extra 1/2 pan of chicken tenders for refills; prepare the full purchased quantities.",
      "Taco Bar uses one serving chafing dish; keep its remaining prepared pans for refills.",
    ]);
    expect(setup.food).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Chicken Tenders", quantity: 64, pans: 2, panSize: "1/2" }),
      expect.objectContaining({ name: "Wings", quantity: 64, pans: 2, panSize: "1/2" }),
      expect.objectContaining({ name: "Beef", quantity: 5, pans: 1, panSize: "1/3" }),
      expect.objectContaining({ name: "Chicken", quantity: 5, pans: 2, panSize: "1/3" }),
      expect.objectContaining({ name: "Black Beans", quantity: 1, pans: 2, panSize: "1/3" }),
    ]));
    expect(setup.review.length).toBeGreaterThan(0); // Unresolved serving supplies remain visible.
  });

  it("uses the same serving plan on an existing kitchen checklist without changing any food or pan data", () => {
    const kitchen = generateKitchenChecklist({ eventId: 77, eventName: "Redacted serving fixture", localDate: event.date,
      startTime: "6:00 PM", endTime: "9:00 PM", guestCount: 17, status: "DEFINITE", sourceUpdatedAt: event.source_updated_at,
      selections: [{ name: "The Full Course", quantity: 17 }, { name: "Taco Bar" }, { name: "Chicken Tender Platter", quantity: 1 }, { name: "Wing Platter", quantity: 1 }] });
    const original = structuredClone(kitchen);
    const plan = servingChafingSetup(kitchen);
    expect(plan?.chafingDishes).toBe(2);
    expect(kitchen.chafingDishes.total).toBe(3);
    expect(kitchen).toEqual(original);
    expect(servingChafingSetup({ ...kitchen, event: { ...kitchen.event, sourceUpdatedAt: null } })).toBeNull();
    expect(servingChafingSetup({ ...kitchen, liveFoodAddOns: [{ itemKey: "wings", foodName: "Wings", description: "Refill", quantity: 1, unit: "pans", numberOfPans: 1, panSize: "1/2", sourceUpdatedAt: event.source_updated_at! }] })).toBeNull();
    expect(servingChafingSetup({ ...kitchen, warnings: [...kitchen.warnings, { code: "SPECIAL_NOTE_REQUIRES_REVIEW", message: "Serving override needs verification", requiresReview: true, scope: "event" }] })).toBeNull();
    const savedShape = { ...kitchen, event: { ...kitchen.event, sourceUpdatedAt: "10/6/2026 2:52 PM" }, warnings: [...kitchen.warnings, { code: "SPECIAL_NOTE_REQUIRES_REVIEW" as const, message: "Special contract note requires kitchen review: Needs Review: Tripleseat booking contract data could not be verified. Review the source event.", requiresReview: true, scope: "event" as const }] };
    const savedBefore = structuredClone(savedShape);
    expect(servingChafingSetup(savedShape)?.chafingDishes).toBe(2);
    expect(savedShape).toEqual(savedBefore);
  });

  it.each([
    { guest_count: 101, food: ["101 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] },
    { guest_count: 201, food: ["201 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] },
    { food: ["17 × The Full Course + Taco Bar", "2 × Chicken Tender Platter", "1 × Wing Platter"] },
    { food: ["17 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Fry Platter"] },
    { food: ["17 × The Full Course + Wing Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] },
    { food: ["17 × The Full Course + Taco Bar", "Chicken Tender Platter", "1 × Wing Platter"] },
    { needs_review: true, food: ["17 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] },
    { source_updated_at: null, food: ["17 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] },
  ])("does not extrapolate the serving layout to unapproved or unresolved combinations: %j", (changes) => {
    expect(contractSetup({ ...event, guest_count: 17, ...changes }).servingSetup).toBeNull();
  });

  it("rechecks only chafer placement and cleaning when the approved serving layout replaces an old all-pan count", () => {
    const plan = { ...event, guest_count: 17, food: ["17 × The Full Course + Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter"] };
    const setup = contractSetup(plan);
    let state = defaultChecklistState(plan.date);
    state.bwa = "BWA";
    for (const key of ["chaffing-dishes-placed", "chaffing-dishes-clean", "food-carts-prepped"]) {
      const legacyFingerprint = key === "chaffing-dishes-placed"
        ? JSON.stringify(["contract-setup-v1", KITCHEN_RULE_CONFIG.ruleVersion, [setup.chafingDishes, setup.food]])
        : key === "chaffing-dishes-clean" ? JSON.stringify(["contract-setup-v1", KITCHEN_RULE_CONFIG.ruleVersion, setup.chafingDishes]) : setupTaskFingerprint(plan, key, setup);
      state = completeChecklistTask(state, key, true, "Brooke", "2026-10-23T17:00:00Z", legacyFingerprint);
    }
    const original = structuredClone(state);
    const next = reconcileChecklistSetup(plan, state);
    expect(next.tasks["chaffing-dishes-placed"]).toBe(false);
    expect(next.tasks["chaffing-dishes-clean"]).toBe(false);
    expect(next.tasks["food-carts-prepped"]).toBe(true);
    expect(next.taskEvidence).toEqual(original.taskEvidence);
    expect(state).toEqual(original);
  });

  it("retains the exact prior fingerprints for unrelated serving arrangements", () => {
    const setup = contractSetup(event);
    expect(setup.servingSetup).toBeNull();
    expect(setupTaskFingerprint(event, "chaffing-dishes-placed", setup)).toBe(JSON.stringify(["contract-setup-v1", KITCHEN_RULE_CONFIG.ruleVersion, [setup.chafingDishes, setup.food]]));
    expect(setupTaskFingerprint(event, "chaffing-dishes-clean", setup)).toBe(JSON.stringify(["contract-setup-v1", KITCHEN_RULE_CONFIG.ruleVersion, setup.chafingDishes]));
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
