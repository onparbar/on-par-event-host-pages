import { checklistSections, type EventChecklistState } from "./checklist-model";
import type { EventPlan } from "./event-plans/types";
import { kitchenEventInterval } from "./kitchen/lifecycle";
import { normalizeKitchenSelections } from "./kitchen/normalize";
import { contractSetup, setupTaskFingerprint } from "./operations/setup";
export { CHECKLIST_CLOSEOUT_CONFIRMATION_KEY } from "./checklist-model";

export type ChecklistTaskRequirement = {
  key: string;
  label: string;
  applicability: "required" | "optional" | "needs-review";
  reason: string;
  critical: boolean;
  dueAt: string | null;
};

type Requirement = Pick<ChecklistTaskRequirement, "applicability" | "reason">;
const required: Requirement = { applicability: "required", reason: "Required for this event." };
const optional: Requirement = { applicability: "optional", reason: "Complete this task if needed for this event." };
const FOOD_TASKS = new Set(["food-details-accurate", "table-line-placed", "food-carts-prepped", "chaffing-dishes-placed", "chaffing-dishes-clean", "floor-boxes-cleaned", "food-ready", "food-kitchen-window", "food-setup-confirmed", "food-quality-check", "event-specialist-restocking", "sternos-cooled", "carts-laundry"]);
const CARD_TASKS = new Set(["prepaid-drink-cards-labeled", "prepaid-drink-cards-shown", "prepaid-cards-collected"]);
const HOT_EQUIPMENT_TASKS = new Set(["chaffing-dishes-placed", "chaffing-dishes-clean", "sternos-cooled"]);
const CRITICAL_TASKS = new Set(["tablet-layout-accurate", "entertainment-tablet-accurate", "food-details-accurate", "prepaid-drink-cards-labeled", "contract-details-confirmed", "entertainment-reserved", "event-tables-cleaned", "table-line-placed", "food-carts-prepped", "chaffing-dishes-placed", "mini-golf-coins", "show-reserved-seating", "prepaid-drink-cards-shown", "food-ready", "food-kitchen-window", "food-setup-confirmed", "used-tables-bussed", "sternos-cooled", "prepaid-cards-collected", "shift-lead-checkout"]);
const UNCERTAIN = /\b(?:unknown|unmapped|unverified|unavailable|missing|needs? review|could not|not (?:listed|verified|available))\b/i;
const CARD_PACKAGE = /\bfood\s*(?:\+|and)\s*beverages?\s+package\b|^\s*(?:\d+(?:\.\d+)?\s*[×x]\s*)?(?:the\s+)?(?:full course|back nine)\b/i;
const FOOD_ONLY = /\bfood[\s-]+only\b/i;
const WITHOUT_CARDS = /\b(?:no\s+(?:prepaid\s+)?drink\s+cards?|without\s+(?:prepaid\s+)?drink\s+cards?|(?:prepaid\s+)?drink\s+cards?\s+(?:not\s+included|excluded))\b/i;
const ARRIVAL_TASKS = new Set(["introduce-bwa", "review-times-with-poc", "mini-golf-coins", "show-reserved-seating", "prepaid-drink-cards-shown", "food-ready", "plates-and-tables-cleared", "upsell-additional-items", "additional-items-noted"]);

function categoryRequirement(event: EventPlan, values: string[], matches: (value: string) => boolean, label: string): Requirement {
  const usable = values.filter((value) => value.trim());
  if (usable.some((value) => matches(value) && !UNCERTAIN.test(value))) return { applicability: "required", reason: `${label} is listed in the event source.` };
  if (usable.some((value) => UNCERTAIN.test(value)) || event.needs_review || !Number.isFinite(Date.parse(event.source_updated_at ?? ""))) {
    return { applicability: "needs-review", reason: `${label} has not been verified from the contract; review the source before closing this event.` };
  }
  return optional;
}

function drinkCardRequirement(event: EventPlan): Requirement {
  const values = [...event.drink_options, ...event.food.filter((value) => CARD_PACKAGE.test(value))];
  const includesCards = (value: string) => !FOOD_ONLY.test(value) && !WITHOUT_CARDS.test(value) && (/\b(?:prepaid\s+)?drink\s+cards?\b/i.test(value) || CARD_PACKAGE.test(value));
  if (values.some((value) => includesCards(value) && !UNCERTAIN.test(value)) && values.some((value) => WITHOUT_CARDS.test(value))) {
    return { applicability: "needs-review", reason: "Drink-card selections conflict with an explicit no-card selection; review the contract before closing this event." };
  }
  return categoryRequirement(event, values, includesCards, "Drink cards");
}

export function checklistTaskRequirements(event: EventPlan): ChecklistTaskRequirement[] {
  const food = categoryRequirement(event, event.food, (value) => !/^no food\b|^none$/i.test(value.trim()), "Food");
  // Event-plan display values use the deterministic “quantity × item” format.
  // Remove that presentation prefix and split the exact canonical kind-label separator before applying the existing food aliases.
  const normalizedFood = normalizeKitchenSelections(event.food.flatMap((name) => name.replace(/^\s*\d+(?:\.\d+)?\s*[×x]\s*/i, "").split(" + ").map((name) => ({ name, isFood: true }))));
  const hotFood = food.applicability !== "required" ? food
    : normalizedFood.some((selection) => selection.kinds.some((kind) => kind.startsWith("bar:") || (kind.startsWith("platter:") && kind !== "platter:veggie-tray"))) ? required
    : normalizedFood.some((selection) => !selection.kinds.length || selection.kinds.some((kind) => kind.startsWith("package:"))) ? { applicability: "needs-review" as const, reason: "Hot-food equipment requirements are not verified from the food selections." }
    : optional;
  const cards = drinkCardRequirement(event);
  const entertainment = event.entertainment.map((item) => /^\s*\d+\b/.test(item.quantity) ? `${item.quantity} ${item.name}` : `Unverified quantity: ${item.name}`);
  const anyEntertainment = categoryRequirement(event, entertainment, (value) => /^\s*[1-9]\d*\b/.test(value), "Entertainment");
  const miniGolf = categoryRequirement(event, entertainment, (value) => /^\s*[1-9]\d*\b/.test(value) && /\bmini(?:ature)?\s*golf\b/i.test(value), "Mini golf");
  const bowling = categoryRequirement(event, entertainment, (value) => /^\s*[1-9]\d*\b/.test(value) && /\b(?:duckpin|bowling)\b/i.test(value), "Bowling");
  const clocks = [...event.time.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi)].map((match) => match[0]);
  const interval = kitchenEventInterval({ localDate: event.date, startTime: clocks[0] ?? null, endTime: clocks[1] ?? null });
  return checklistSections.flatMap((section) => section.items.map((item) => {
    const requirement = item.key === "contract-details-confirmed" && (event.needs_review || interval.startAt === null || interval.endAt === null) ? { applicability: "needs-review" as const, reason: event.needs_review ? "The event source still requires contract review before closeout." : "Event timing is not verified in America/New_York. Review the contract." }
      : HOT_EQUIPMENT_TASKS.has(item.key) ? hotFood
      : FOOD_TASKS.has(item.key) ? food
      : CARD_TASKS.has(item.key) ? cards
      : item.key === "mini-golf-coins" ? miniGolf
      : item.key === "bowling-pin-setup" ? bowling
      : ["entertainment-reserved", "entertainment-tablet-accurate"].includes(item.key) ? anyEntertainment
      : required;
    const due = item.key === "food-kitchen-window" ? (interval.startAt === null ? null : interval.startAt - 15 * 60_000)
      : section.key === "one-hour-before" ? (interval.startAt === null ? null : interval.startAt - 60 * 60_000)
      : ARRIVAL_TASKS.has(item.key) || item.key === "food-setup-confirmed" ? interval.startAt
      : section.key === "end-of-event" ? interval.endAt : null;
    return { ...item, ...requirement, critical: CRITICAL_TASKS.has(item.key), dueAt: due === null ? null : new Date(due).toISOString() };
  }));
}

export function checklistReadiness(event: EventPlan, state: Pick<EventChecklistState, "tasks" | "bwa" | "taskEvidence">, confirmedWarningFingerprint?: string) {
  const setup = contractSetup(event);
  const changedTasks = new Set<string>();
  const tasks = checklistTaskRequirements(event).map((task) => {
    const recorded = state.taskEvidence?.[task.key]?.sourceFingerprint;
    const current = recorded ? setupTaskFingerprint(event, task.key, setup) : undefined;
    if (recorded && current && recorded !== current) {
      changedTasks.add(task.key);
      return { ...task, applicability: "needs-review" as const, reason: "Contract setup changed. Review the updated setup, then complete this task again." };
    }
    return task;
  });
  const review = tasks.filter((task) => task.critical && task.applicability === "needs-review");
  const applicable = tasks.filter((task) => task.applicability === "required");
  const complete = (task: ChecklistTaskRequirement) => state.tasks[task.key] === true && typeof state.taskEvidence?.[task.key]?.employeeName === "string" && Boolean(state.taskEvidence[task.key].employeeName.trim()) && Number.isFinite(Date.parse(state.taskEvidence[task.key].completedAt));
  const missing = tasks.filter((task) => task.critical && task.applicability !== "optional" && (!complete(task) || changedTasks.has(task.key)));
  const warningMessages = review.length ? [...new Set([
    ...review.map((task) => `${task.label}: ${task.reason}`),
    ...(event.review_reasons ?? []),
  ].map((message) => message.trim()).filter(Boolean))] : [];
  // Like setupTaskFingerprint, bind consent to the exact current source inputs, not the saved receipt.
  const warningFingerprint = review.length ? JSON.stringify([
    "contract-closeout-v1", event.id, event.date, event.name, event.time, event.guest_count,
    event.rooms, event.food, event.drink_options, event.entertainment, event.special_instructions ?? [],
    event.operational_notes ?? [], event.verification_status, Boolean(event.needs_review),
    [...new Set(event.review_reasons ?? [])].sort(), event.tripleseat_booking_id ?? null,
    event.source_updated_at ?? null, event.rule_version ?? null,
    tasks.filter((task) => task.critical).map((task) => [task.key, task.applicability, task.reason, setupTaskFingerprint(event, task.key, setup) ?? null]),
  ]) : null;
  const canSubmitAfterWarningConfirmation = Boolean(state.bwa.trim()) && review.length > 0 && missing.length === 0;
  const canSubmit = Boolean(state.bwa.trim()) && missing.length === 0 && (review.length === 0 || (canSubmitAfterWarningConfirmation && confirmedWarningFingerprint === warningFingerprint));
  return { tasks, review, missing, completed: applicable.filter(complete).length, total: applicable.length, canSubmit, warningFingerprint, warningMessages, canSubmitAfterWarningConfirmation };
}
