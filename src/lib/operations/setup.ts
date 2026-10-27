import type { EventPlan } from "@/lib/event-plans/types";
import type { EventChecklistState } from "@/lib/checklist-model";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import type { KitchenChecklist, KitchenSourceSelection } from "@/lib/kitchen/types";

type ServingChafingSetup = { chafingDishes: number; instructions: string[] };

export type ContractSetup = {
  purchasedFood: string[];
  foodTables: number | null;
  mirrored: boolean;
  chafingDishes: number | null;
  servingSetup: ServingChafingSetup | null;
  tongs: number | null;
  sauceContainers: number | null;
  spoons: number | null;
  food: Array<{ name: string; quantity: number | null; unit: string; pans: number | null; panSize: string | null }>;
  review: string[];
};

/** Read only the canonical quantity prefix produced from structured contract selections. */
function selectionsFromPlan(value: string): KitchenSourceSelection[] {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+)$/i.exec(value);
  // Event-plan formatting joins approved normalized kind labels with this exact separator.
  return (match?.[2] ?? value).split(" + ").map((name) => ({ name, quantity: match ? Number(match[1]) : null, isFood: true }));
}

/** Approved serving layout; prep quantities and all-pan capacity remain unchanged. */
export function servingChafingSetup(checklist: KitchenChecklist): ServingChafingSetup | null {
  const guests = checklist.event.guestCount;
  if (!Number.isInteger(guests) || guests === null || guests < 1 || guests > KITCHEN_RULE_CONFIG.barTables.doubleAboveGuestCount
    || !Number.isFinite(Date.parse(checklist.event.sourceUpdatedAt ?? "")) || checklist.liveFoodAddOns.length > 0
    || checklist.selectedBars.length !== 1 || checklist.selectedBars[0] !== "taco"
    || checklist.chafingDishes.total === null
    || checklist.warnings.some((warning) => ["UNKNOWN_FOOD_ITEM", "INVALID_SELECTION_QUANTITY", "CONFLICTING_QUANTITY", "UNAPPROVED_PLATTER_QUANTITY", "UNAPPROVED_PLATTER_PACKING", "SOURCE_STALE", "SOURCE_SYNC_FAILED"].includes(warning.code)
      // Keep the generated missing-document warning visible without treating it as a serving-layout override.
      || warning.code === "SPECIAL_NOTE_REQUIRES_REVIEW" && warning.message !== "Special contract note requires kitchen review: Needs Review: Tripleseat booking contract data could not be verified. Review the source event.")) return null;
  const standalone = checklist.normalizedSelections.filter((selection) => !selection.kinds.some((kind) => kind.startsWith("package:")) && selection.kinds.some((kind) => kind.startsWith("platter:") || kind === "dessert"));
  if (standalone.some((selection) => !selection.quantityProvided || !Number.isInteger(selection.quantity) || selection.quantity < 1)) return null;
  const hotPlatters = checklist.normalizedSelections.flatMap((selection) => selection.kinds
    .filter((kind) => KITCHEN_RULE_CONFIG.platter.rules[kind]?.hot)
    .map((kind) => ({ kind, quantity: selection.quantity, provided: selection.quantityProvided })));
  const halfPanPair = ["platter-wings", "platter-chicken-tenders"].every((key) => checklist.sections
    .flatMap((section) => section.rows).some((row) => row.key === key && row.numberOfPans === 2 && row.panSize === "1/2"));
  // Do not extrapolate this layout to other foods, quantities, or mirrored setups.
  if (hotPlatters.length !== 2 || !["platter:wings", "platter:chicken-tenders"].every((kind) => hotPlatters.some((item) => item.kind === kind && item.quantity === 1 && item.provided)) || !halfPanPair) return null;
  return { chafingDishes: 2, instructions: [
    "Wings and chicken tenders share one serving chafing dish: one 1/2 pan of each.",
    "Keep the extra 1/2 pan of wings and extra 1/2 pan of chicken tenders for refills; prepare the full purchased quantities.",
    "Taco Bar uses one serving chafing dish; keep its remaining prepared pans for refills.",
  ] };
}

export function contractSetup(event: EventPlan): ContractSetup {
  const selections = event.food.filter((name) => !/^\s*(?:no food\b|none$)/i.test(name)).flatMap(selectionsFromPlan);
  const clocks = [...event.time.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi)].map((match) => match[0].replace(/^(\d{1,2})\s/, "$1:00 "));
  const kitchen = generateKitchenChecklist({
    eventId: event.id, eventName: event.name, localDate: event.date,
    startTime: clocks[0] ?? null, endTime: clocks[1] ?? null,
    guestCount: event.guest_count, status: "DEFINITE", room: event.rooms.join(", "),
    selections, sourceUpdatedAt: event.source_updated_at,
  });
  const guestsVerified = Number.isInteger(event.guest_count) && event.guest_count > 0;
  const mirrored = guestsVerified && event.guest_count > KITCHEN_RULE_CONFIG.barTables.doubleAboveGuestCount;
  const multiplier = mirrored ? 2 : 1;
  const review: string[] = [];
  if (event.needs_review) review.push("Contract information needs review before setup is confirmed.");
  if (selections.length && !guestsVerified) review.push("Guest count is required to determine food-table setup.");
  const standalone = kitchen.normalizedSelections.filter((selection) => !selection.kinds.some((kind) => kind.startsWith("package:")) && selection.kinds.some((kind) => kind.startsWith("platter:") || kind === "dessert"));
  const quantitiesKnown = standalone.every((selection) => selection.quantityProvided && Number.isInteger(selection.quantity) && selection.quantity > 0);
  const unknownMapping = kitchen.warnings.some((warning) => ["UNKNOWN_FOOD_ITEM", "INVALID_SELECTION_QUANTITY", "CONFLICTING_QUANTITY", "UNAPPROVED_PLATTER_QUANTITY", "UNAPPROVED_PLATTER_PACKING"].includes(warning.code));
  if (!quantitiesKnown) review.push("A purchased platter quantity is missing or invalid; tongs need review.");
  const hasBars = kitchen.selectedBars.length > 0;
  if (hasBars) review.push("Bar serving-tong quantities need review; the approved two-tongs rule is per purchased platter, not per guest.");
  const tongs = quantitiesKnown && !unknownMapping && !hasBars ? standalone.reduce((sum, selection) => sum + selection.quantity * 2, 0) * multiplier : null;
  const sauceRows = kitchen.sections.flatMap((section) => section.rows).filter((row) => row.category === "sauces");
  const unmappedBarSauces = kitchen.selectedBars.includes("taco") || (kitchen.selectedBars.includes("wing") && !sauceRows.some((row) => row.key === "sauce-ranch" && row.quantity !== null));
  if (unmappedBarSauces) review.push("Bar sauce containers need review; no approved per-container quantity mapping is available.");
  const saucesKnown = quantitiesKnown && !unknownMapping && !unmappedBarSauces && sauceRows.every((row) => row.quantity !== null) && !kitchen.warnings.some((warning) => warning.code === "UNRESOLVED_SAUCE_QUANTITY");
  const sauceContainers = saucesKnown ? sauceRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0) * multiplier : null;
  for (const warning of kitchen.warnings) {
    if (["UNKNOWN_FOOD_ITEM", "INVALID_SELECTION_QUANTITY", "CONFLICTING_QUANTITY", "UNAPPROVED_PLATTER_QUANTITY", "UNAPPROVED_PLATTER_PACKING", "UNRESOLVED_SAUCE_QUANTITY", "PACKAGE_BAR_MISSING", "BAR_WITHOUT_PACKAGE_MARKER"].includes(warning.code)) review.push(warning.message);
  }
  // The kitchen already mirrors bars above 100 and doubles all chafers above 200.
  // Mirror standalone equipment once here without multiplying an existing doubling.
  const existingLargeMultiplier = guestsVerified && event.guest_count > KITCHEN_RULE_CONFIG.chafingSetup.doubleAboveGuestCount ? KITCHEN_RULE_CONFIG.chafingSetup.largeEventMultiplier : 1;
  const chafingDishes = !quantitiesKnown || unknownMapping || kitchen.chafingDishes.bars === null || kitchen.chafingDishes.hotPlatters === null ? null
    : kitchen.chafingDishes.bars + kitchen.chafingDishes.hotPlatters * (mirrored && existingLargeMultiplier === 1 ? 2 : 1);
  const servingSetup = chafingDishes === null || event.needs_review ? null : servingChafingSetup(kitchen);
  return {
    purchasedFood: [...event.food], foodTables: selections.length ? guestsVerified ? multiplier : null : 0,
    mirrored, chafingDishes, servingSetup, tongs, sauceContainers, spoons: sauceContainers,
    food: kitchen.sections.flatMap((section) => section.rows.map((row) => ({ name: row.foodName, quantity: quantitiesKnown && !unknownMapping ? row.quantity : null, unit: row.unit, pans: quantitiesKnown && !unknownMapping ? row.numberOfPans : null, panSize: row.panSize }))),
    review: [...new Set(review)],
  };
}

const SETUP_INPUTS: Record<string, (event: EventPlan, setup: ContractSetup) => unknown> = {
  "contract-details-confirmed": (event) => [event.food, event.guest_count, event.rooms, event.time, event.entertainment, event.drink_options, event.special_instructions],
  "food-details-accurate": (event, setup) => [event.food, event.guest_count, setup.food, setup.review],
  "event-tables-cleaned": (event) => [event.rooms, event.guest_count],
  "table-line-placed": (event, setup) => [event.rooms, setup.foodTables],
  "food-carts-prepped": (_event, setup) => [setup.tongs, setup.sauceContainers, setup.spoons, setup.food],
  "chaffing-dishes-placed": (_event, setup) => [setup.chafingDishes, setup.food, ...(setup.servingSetup ? [setup.servingSetup] : [])],
  "chaffing-dishes-clean": (_event, setup) => setup.servingSetup ? [setup.chafingDishes, setup.servingSetup] : setup.chafingDishes,
  "floor-boxes-cleaned": (_event, setup) => setup.foodTables,
  "stanchions-placed": (event, setup) => [event.rooms, setup.foodTables, event.entertainment],
  "signs-placed": (event) => [event.name, event.rooms, event.time, event.entertainment],
  "entertainment-reserved": (event) => event.entertainment,
  "food-setup-confirmed": (event, setup) => [event.food, event.time, setup.food],
  "food-kitchen-window": (event) => [event.date, event.time, event.food],
};

export function setupTaskFingerprint(event: EventPlan, key: string, setup = contractSetup(event)): string | undefined {
  const inputs = SETUP_INPUTS[key];
  return inputs ? JSON.stringify(["contract-setup-v1", KITCHEN_RULE_CONFIG.ruleVersion, inputs(event, setup)]) : undefined;
}

/** Invalidate only completions whose recorded setup inputs have actually changed. */
export function reconcileChecklistSetup(event: EventPlan, state: EventChecklistState): EventChecklistState {
  const setup = contractSetup(event);
  let next = state;
  for (const [key, evidence] of Object.entries(state.taskEvidence ?? {})) {
    if (!state.tasks[key] || !evidence.sourceFingerprint) continue;
    const fingerprint = setupTaskFingerprint(event, key, setup);
    if (fingerprint && fingerprint !== evidence.sourceFingerprint) {
      if (next === state) next = { ...state, tasks: { ...state.tasks }, taskEvidence: { ...state.taskEvidence } };
      next.tasks[key] = false;
      // Keep the prior evidence visible to review/audit until staff verifies again.
    }
  }
  return next;
}
