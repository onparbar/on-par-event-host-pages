import { checklistSections, type EventChecklistState } from "./checklist-model";
import type { EventPlan } from "./event-plans/types";
import { kitchenEventInterval } from "./kitchen/lifecycle";
import { normalizeKitchenSelections } from "./kitchen/normalize";

export type ChecklistTaskRequirement = {
  key: string;
  label: string;
  applicability: "required" | "not-applicable" | "needs-review";
  reason: string;
  critical: boolean;
  dueAt: string | null;
};

type Requirement = Pick<ChecklistTaskRequirement, "applicability" | "reason">;
const required: Requirement = { applicability: "required", reason: "Required for this event." };
const FOOD_TASKS = new Set(["food-details-accurate", "table-line-placed", "food-carts-prepped", "chaffing-dishes-placed", "chaffing-dishes-clean", "floor-boxes-cleaned", "food-ready", "food-kitchen-window", "food-setup-confirmed", "food-quality-check", "event-specialist-restocking", "sternos-cooled", "carts-laundry"]);
const CARD_TASKS = new Set(["prepaid-drink-cards-labeled", "prepaid-drink-cards-shown", "prepaid-cards-collected"]);
const HOT_EQUIPMENT_TASKS = new Set(["chaffing-dishes-placed", "chaffing-dishes-clean", "sternos-cooled"]);
const CRITICAL_TASKS = new Set(["tablet-layout-accurate", "entertainment-tablet-accurate", "food-details-accurate", "prepaid-drink-cards-labeled", "contract-details-confirmed", "entertainment-reserved", "event-tables-cleaned", "table-line-placed", "food-carts-prepped", "chaffing-dishes-placed", "mini-golf-coins", "show-reserved-seating", "prepaid-drink-cards-shown", "food-ready", "food-kitchen-window", "food-setup-confirmed", "used-tables-bussed", "sternos-cooled", "prepaid-cards-collected", "shift-lead-checkout"]);
const UNCERTAIN = /\b(?:unknown|unmapped|unverified|unavailable|missing|needs? review|could not|not (?:listed|verified|available))\b/i;

function categoryRequirement(event: EventPlan, values: string[], matches: (value: string) => boolean, label: string): Requirement {
  const usable = values.filter((value) => value.trim());
  if (usable.some((value) => matches(value) && !UNCERTAIN.test(value))) return { applicability: "required", reason: `${label} is listed in the event source.` };
  if (usable.some((value) => UNCERTAIN.test(value)) || event.needs_review || !Number.isFinite(Date.parse(event.source_updated_at ?? ""))) {
    return { applicability: "needs-review", reason: `${label} has not been verified from the contract; review the source before closing this event.` };
  }
  return { applicability: "not-applicable", reason: `No ${label.toLowerCase()} is listed in the verified event source.` };
}

export function checklistTaskRequirements(event: EventPlan): ChecklistTaskRequirement[] {
  const food = categoryRequirement(event, event.food, (value) => !/^no food\b|^none$/i.test(value.trim()), "Food");
  // Event-plan display values use the deterministic “quantity × item” format.
  // Remove that presentation prefix before applying the existing food aliases.
  const normalizedFood = normalizeKitchenSelections(event.food.map((name) => ({ name: name.replace(/^\s*\d+(?:\.\d+)?\s*[×x]\s*/i, ""), isFood: true })));
  const hotFood = food.applicability !== "required" ? food
    : normalizedFood.some((selection) => selection.kinds.some((kind) => kind.startsWith("bar:") || (kind.startsWith("platter:") && kind !== "platter:veggie-tray"))) ? required
    : normalizedFood.some((selection) => !selection.kinds.length || selection.kinds.some((kind) => kind.startsWith("package:"))) ? { applicability: "needs-review" as const, reason: "Hot-food equipment requirements are not verified from the food selections." }
    : { applicability: "not-applicable" as const, reason: "The verified food selections do not require hot-food equipment." };
  const cards = categoryRequirement(event, event.drink_options, (value) => /\b(?:prepaid\s+)?drink\s+cards?\b/i.test(value), "Drink cards");
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
      : section.key === "guest-arrival" || item.key === "food-setup-confirmed" ? interval.startAt
      : section.key === "end-of-event" ? interval.endAt : null;
    return { ...item, ...requirement, critical: CRITICAL_TASKS.has(item.key), dueAt: due === null ? null : new Date(due).toISOString() };
  }));
}

export function checklistReadiness(event: EventPlan, state: Pick<EventChecklistState, "tasks" | "bwa" | "taskEvidence">) {
  const tasks = checklistTaskRequirements(event);
  const review = tasks.filter((task) => task.critical && task.applicability === "needs-review");
  const applicable = tasks.filter((task) => task.applicability === "required");
  const complete = (task: ChecklistTaskRequirement) => state.tasks[task.key] === true && typeof state.taskEvidence?.[task.key]?.employeeName === "string" && Boolean(state.taskEvidence[task.key].employeeName.trim()) && Number.isFinite(Date.parse(state.taskEvidence[task.key].completedAt));
  const missing = applicable.filter((task) => task.critical && !complete(task));
  return { tasks, review, missing, completed: applicable.filter(complete).length, total: applicable.length, canSubmit: Boolean(state.bwa.trim()) && review.length === 0 && missing.length === 0 };
}
