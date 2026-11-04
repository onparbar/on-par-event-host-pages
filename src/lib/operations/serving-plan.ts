import type { EventPlan } from "@/lib/event-plans/types";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { normalizeKitchenSelections } from "@/lib/kitchen/normalize";
import type { NormalizedKitchenSelection } from "@/lib/kitchen/types";
import { contractSetup } from "./setup";

export type ServingObject = {
  id: string;
  label: string;
  kind: "carts" | "plates" | "napkins" | "forks" | "tortillas" | "taco-stands" | "lettuce-wraps" | "chafer" | "pan" | "utensils" | "sauces" | "tier" | "cold-platter";
  description: string;
  quantity: number | null;
  unit: string;
  contents: string[];
  panSize?: "1/2" | "1/3";
  children?: ServingObject[];
};

export type EventServingPlan = {
  status: "ready" | "needs-review" | "no-food";
  ruleVersion: string;
  servingLines: number | null;
  plates: number | null;
  tacoStands: number | null;
  chafingDishesPerLine: number | null;
  objects: ServingObject[];
  review: string[];
  unplacedFood: string[];
  source: { eventId: string; updatedAt: string | null; eventRuleVersion: string | null; rawSelections: string[] };
};

export const EVENT_SERVING_RULE_VERSION = "event-serving-2026-11-04.1";
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

function object(id: string, kind: ServingObject["kind"], label: string, description: string, quantity: number | null, unit: string, contents: string[] = [], children?: ServingObject[]): ServingObject {
  return { id, kind, label, description, quantity, unit, contents, ...(children ? { children } : {}) };
}

function utensils(id: string, side: "Left" | "Right", tongs: number, spoons = 0) {
  return object(id, "utensils", `${side} black utensil plate`, `${side} long black plate: ${tongs} tongs${spoons ? ` and ${spoons} spoon` : ""}. Keep these serving tools accessible on this side.`, tongs + spoons, "serving tools", [`${tongs} tongs`, ...(spoons ? [`${spoons} spoon`] : [])]);
}

function chafer(id: string, label: string, foods: string[], panSize: "1/2" | "1/3", tongs = foods.length, spoons = 0) {
  return object(id, "chafer", label, `Serving contents: ${foods.join(", ")}. This shows serving pans only; prepare the full purchased quantities and hold remaining prepared pans for refills.`, 1, "chafing dish per serving line", [...foods], [
    ...foods.map((food, index) => ({ ...object(`${id}-pan-${index + 1}`, "pan", `${food} · ${panSize} pan`, `${food} in one ${panSize} serving pan. This is not the full purchased platter or its total prepared-pan count.`, 1, "serving pan", [food]), panSize })),
    utensils(`${id}-utensils-left`, "Left", tongs, spoons),
    utensils(`${id}-utensils-right`, "Right", tongs, spoons),
  ]);
}

/** Canonical EventPlan labels are produced from the existing structured contract feed. */
function selectionsFromLabels(labels: readonly string[]) {
  return labels.map((label) => {
    const match = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+)$/i.exec(label);
    return { label, selections: normalizeKitchenSelections((match?.[2] ?? label).split(" + ").map((name) => ({ name, quantity: match ? Number(match[1]) : null, isFood: true }))) };
  });
}

function tacoGuestCount(grouped: ReturnType<typeof selectionsFromLabels>, review: string[]) {
  const selections = grouped.flatMap((entry) => entry.selections);
  const bars = selections.filter((selection) => selection.kinds.includes("bar:taco") && selection.quantityProvided);
  const packages = grouped.filter((entry) => entry.selections.some((selection) => selection.kinds.includes("bar:taco")) || !entry.selections.some((selection) => selection.kinds.some((kind) => kind.startsWith("bar:")))).flatMap((entry) => entry.selections).filter((selection) => selection.kinds.some((kind) => kind.startsWith("package:")) && selection.quantityProvided);
  const candidates = bars.length ? bars : packages;
  const quantities = [...new Set(candidates.map((selection) => selection.quantity))];
  const conflictingPackage = bars.length > 0 && packages.some((selection) => selection.quantity !== quantities[0]);
  if (quantities.length !== 1 || !positiveInteger(quantities[0]) || !Number.isSafeInteger(quantities[0] * 2) || conflictingPackage) {
    review.push("The contracted Taco Bar guest quantity is missing, invalid or conflicting; taco-stand quantity needs review.");
    return null;
  }
  return quantities[0];
}

/** Serving arrangement only: never changes purchased food, kitchen prep pans, reservations or orders. */
export function buildEventServingPlan(event: EventPlan): EventServingPlan {
  const labels = event.food.filter((label) => !/^\s*(?:no food\b|none$)/i.test(label));
  const grouped = selectionsFromLabels(labels);
  const selections = grouped.flatMap((entry) => entry.selections);
  let bars = [...new Set(selections.flatMap((selection) => selection.kinds.filter((kind) => kind.startsWith("bar:"))))];
  const setup = contractSetup(event);
  const review = setup.review.filter((reason) => !reason.startsWith("Bar serving-tong quantities need review") && !(bars.length === 1 && bars[0] === "bar:taco" && reason.startsWith("Bar sauce containers need review")));
  review.push(...(event.review_reasons ?? []).filter((reason) => reason.trim()));
  if (setup.food.some((row) => row.quantity === null)) review.push("Some kitchen prep quantities are unresolved. This serving arrangement does not supply missing food quantities; confirm the kitchen sheet before setup.");
  if (bars.some((kind) => event.guest_count > (kind === "bar:taco" ? KITCHEN_RULE_CONFIG.taco.maxGuests : KITCHEN_RULE_CONFIG.wing.maxGuests))) review.push("The event guest count exceeds an existing approved bar-prep range; confirm kitchen quantities before setup.");
  const guestsKnown = positiveInteger(event.guest_count) && Number.isSafeInteger(event.guest_count * 2);
  const servingLines = labels.length ? guestsKnown ? event.guest_count > KITCHEN_RULE_CONFIG.barTables.doubleAboveGuestCount ? 2 : 1 : null : 0;
  const plates = guestsKnown && labels.length ? event.guest_count * 2 : labels.length ? null : 0;
  if (labels.length && !guestsKnown) review.push("A positive whole event guest count is required for plates and serving lines.");
  if (labels.length && !Number.isFinite(Date.parse(event.source_updated_at ?? ""))) review.push("A verified source update timestamp is required before confirming this setup.");
  if (labels.length && !event.rooms.some((room) => room.trim())) review.push("The reserved area is missing; confirm it before setting the table.");
  if (labels.length && (event.special_instructions ?? []).some((note) => note.trim())) review.push("Contract special instructions are present; confirm any changes to serving contents or placement before setup.");
  if (labels.length && event.guest_count > KITCHEN_RULE_CONFIG.chafingSetup.doubleAboveGuestCount) review.push("More than 200 guests: the existing kitchen rule doubles chafing equipment. Confirm the additional/reserve dishes separately; this serving-line diagram does not replace the kitchen equipment requirement.");
  const unplaced = new Set<string>();
  const invalidBars = new Set(selections.filter((selection) => selection.quantityProvided && !positiveInteger(selection.quantity)).flatMap((selection) => selection.kinds.filter((kind) => kind.startsWith("bar:"))));
  for (const { label, selections: entries } of grouped) {
    if (entries.some((selection) => selection.kinds.length === 0)) {
      unplaced.add(label);
      review.push(`Food is not mapped to an approved serving position: ${label}`);
    }
    if (entries.some((selection) => selection.kinds.some((kind) => invalidBars.has(kind)))) {
      unplaced.add(label);
      review.push(`A bar selection has an invalid quantity; no buffet contents were assigned: ${label}`);
    }
    if (entries.some((selection) => selection.kinds.some((kind) => kind.startsWith("sauce:")))) {
      unplaced.add(label);
      review.push(`A separately listed sauce selection needs its own verified container quantity and placement: ${label}`);
    }
  }
  bars = bars.filter((kind) => !invalidBars.has(kind));
  if (selections.some((selection) => selection.kinds.some((kind) => kind.startsWith("package:"))) && bars.length === 0) {
    for (const entry of grouped.filter((entry) => entry.selections.some((selection) => selection.kinds.some((kind) => kind.startsWith("package:"))))) unplaced.add(entry.label);
    review.push("The food package has no verified bar selection; do not substitute a buffet menu.");
  }
  const objects: ServingObject[] = labels.length ? [object("service-cart", "carts", "Two marble serving carts", "Place two marble carts side by side at the beginning of each serving line. Plates, napkins and forks must be accessible from both sides. Plate totals below are for the entire event, not per line.", 2, "marble carts per serving line", [], [
    object("plates", "plates", "Guest plates", plates === null ? "Guest count needs review before calculating plates." : `${plates} plates for the entire event: ${event.guest_count} guests × 2. Split these plates across the serving carts; do not multiply again for mirrored lines.`, plates, "plates for entire event"),
    object("napkins", "napkins", "Napkins", "Place napkins on each side of the serving carts.", null, "napkins"),
    object("forks", "forks", "Fork caddy", "Keep guest forks accessible from each side of the carts.", null, "forks"),
  ])] : [];
  let tacoStands: number | null = 0;
  const sauceCounts = new Map<string, number>();
  const addSauce = (name: string, count: number) => sauceCounts.set(name, (sauceCounts.get(name) ?? 0) + count);
  if (bars.includes("bar:taco")) {
    const tacoGuests = tacoGuestCount(grouped, review);
    tacoStands = tacoGuests === null ? null : tacoGuests * 2;
    objects.push(
      object("taco-tortillas", "tortillas", "Tortilla warmers", "Contents: tortillas. Place a tortilla warmer and small tongs on each side of the clear risers.", 2, "tortilla warmers per serving line", ["Tortillas"]),
      object("taco-stands", "taco-stands", "Taco stands", tacoStands === null ? "Two taco stands per contracted Taco Bar guest; contracted quantity needs review." : `${tacoStands} taco stands for the entire event: ${tacoGuests} contracted Taco Bar guests × 2. Split across serving lines; do not double again for mirrored service.`, tacoStands, "taco stands for entire event"),
      object("taco-lettuce-wraps", "lettuce-wraps", "Lettuce-wrap riser", "Contents: lettuce wraps. Place on the small clear riser with two tongs.", 1, "riser per serving line", ["Lettuce Wraps"], [object("lettuce-wrap-tongs", "utensils", "Lettuce-wrap tongs", "Two tongs for the lettuce wraps.", 2, "tongs")]),
      chafer("taco-chafer", "Taco Bar chafing dish", ["Black Beans", "Chicken", "Beef"], "1/3", 2, 1),
      object("taco-tier", "tier", "Three-tier serving stand", "Top: lettuce and cheese. Middle: onion and tomato. Bottom: salsa and sour cream.", 1, "stand per serving line", ["Lettuce", "Cheese", "Onion", "Tomato", "Salsa", "Sour Cream"], [
        object("tier-top", "tier", "Top tier", "Lettuce and cheese, with two small tongs.", 1, "tier", ["Lettuce", "Cheese"], [object("tier-top-tools", "utensils", "Top-tier tongs", "Two small tongs for lettuce and cheese.", 2, "small tongs")]),
        object("tier-middle", "tier", "Middle tier", "Onion and tomato, with two spoons.", 1, "tier", ["Onion", "Tomato"], [object("tier-middle-tools", "utensils", "Middle-tier spoons", "Two spoons for onion and tomato.", 2, "spoons")]),
        object("tier-bottom", "tier", "Bottom tier", "Salsa and sour cream, with two spoons.", 1, "tier", ["Salsa", "Sour Cream"], [object("tier-bottom-tools", "utensils", "Bottom-tier spoons", "Two spoons for salsa and sour cream.", 2, "spoons")]),
      ]),
    );
  }
  if (bars.includes("bar:appetizer")) {
    objects.push(chafer("appetizer-chafer", "Appetizer Bar chafing dish", ["Tater Kegs", "Mozzarella Sticks", "Chicken Tenders"], "1/3"));
    addSauce("Marinara", 1); addSauce("Ranch", 1); addSauce("BBQ", 1);
  }
  if (bars.includes("bar:wing")) {
    // The approved reference has three tongs on each side; celery is cold and never assigned a hot pan.
    objects.push(chafer("wing-chafer", "Wing Bar chafing dish", ["Wings", "French Fries"], "1/2", 3), object("wing-celery", "cold-platter", "Wing Bar celery plate", "Contents: celery. Keep this cold side on a plate, not inside the chafing dish.", 1, "cold plate per serving line", ["Celery"]));
    addSauce("BBQ", 1);
    objects.push(object("wing-ranch", "sauces", "Wing Bar ranch", "Ranch is required for the Wing Bar, but its existing bowl quantity remains unresolved. Confirm containers and matching spoons before setup.", null, "containers and spoons", ["Ranch"]));
    review.push("Wing Bar ranch container quantity needs review; no quantity has been guessed.");
  }
  const hotFoods: string[] = [];
  const cold: ServingObject[] = [];
  const platterKinds = [...Object.keys(KITCHEN_RULE_CONFIG.platter.rules), "dessert"];
  for (const kind of platterKinds) {
    let matching = selections.filter((selection) => selection.kinds.includes(kind as NormalizedKitchenSelection["kinds"][number]));
    if (!matching.length) continue;
    let includedDessertCount: number | null = null;
    if (kind === "dessert") {
      const partOfPackage = (selection: NormalizedKitchenSelection) => grouped.some((entry) => entry.selections.includes(selection) && entry.selections.some((item) => item.kinds.some((value) => value.startsWith("package:"))));
      const explicit = matching.filter((selection) => !partOfPackage(selection));
      if (explicit.length) matching = explicit;
      else if (matching.some(partOfPackage)) {
        includedDessertCount = setup.food.find((row) => row.name === "Assorted Desserts")?.quantity ?? null;
        if (includedDessertCount === null || !positiveInteger(includedDessertCount)) {
          review.push("Package-included dessert serving-plate quantity is unresolved in the existing kitchen calculation.");
          for (const entry of grouped.filter((entry) => entry.selections.some((selection) => selection.kinds.includes("dessert")))) unplaced.add(entry.label);
          continue;
        }
      }
    }
    const total = includedDessertCount ?? matching.reduce((sum, selection) => sum + selection.quantity, 0);
    if (includedDessertCount === null && (matching.some((selection) => !selection.quantityProvided || !positiveInteger(selection.quantity)) || !positiveInteger(total) || kind !== "dessert" && total > KITCHEN_RULE_CONFIG.platter.maxQuantity)) {
      review.push(`A purchased ${kind.replace("platter:", "").replaceAll("-", " ")} quantity is missing, invalid${kind === "dessert" ? "" : " or outside the approved 1–10 range"}; no serving pans or utensils were assigned to it.`);
      for (const entry of grouped.filter((entry) => entry.selections.some((selection) => selection.kinds.includes(kind as NormalizedKitchenSelection["kinds"][number])))) unplaced.add(entry.label);
      continue;
    }
    if (kind === "dessert" || kind === "platter:veggie-tray") {
      const dessert = kind === "dessert";
      const name = dessert ? "Dessert Platter" : "Veggie Tray";
      cold.push(object(dessert ? "cold-platter-dessert" : "cold-platter-veggie", "cold-platter", name, `${total} ${includedDessertCount === null ? "purchased" : "kitchen-calculated"} ${name.toLowerCase()}${total === 1 ? "" : "s"} on plates${dessert ? " on clear risers" : ""}, never in chafing pans. Use two tongs per platter on each serving line. Purchased quantities remain unchanged; split food across mirrored lines.`, total, "platters for entire event", [name], [object(`${dessert ? "dessert" : "veggie"}-tongs`, "utensils", `${name} tongs`, "Two tongs per platter on each serving line, one accessible from each side. Mirror the serving equipment without doubling purchased food.", total * 2, "tongs per serving line")]));
      if (!dessert) addSauce("Ranch", total);
    } else {
      const rule = KITCHEN_RULE_CONFIG.platter.rules[kind];
      hotFoods.push(...Array.from({ length: total }, () => rule.foodName));
      if (kind === "platter:chicken-tenders" || kind === "platter:wings") { addSauce("BBQ", total); addSauce("Ranch", total); }
      if (kind === "platter:mozzarella-sticks") addSauce("Marinara", total);
    }
  }
  let offset = 0;
  let number = 1;
  while (offset < hotFoods.length) {
    const thirds = offset === 0 && hotFoods.length % 2 === 1;
    const capacity = thirds ? 3 : 2;
    objects.push(chafer(`platter-chafer-${number}`, `Platter chafing dish ${number}`, hotFoods.slice(offset, offset + capacity), thirds ? "1/3" : "1/2"));
    offset += capacity; number += 1;
  }
  if (sauceCounts.size) {
    const sauces = [...sauceCounts].map(([name, quantity]) => object(`sauce-${name.toLowerCase()}`, "sauces", `${name} sauce`, `${quantity} ${name} containers with ${quantity} spoons for the entire event: one spoon per container. Platter sauce quantities are based on purchased platters, not on prepared pans. Split containers across mirrored lines without multiplying the purchased sauces.`, quantity, "containers and matching spoons for entire event", [name]));
    objects.push(object("sauce-station", "sauces", "Sauce serving plates", "Place sauce containers on long black plates with one spoon per container. Totals are event-wide, not per serving line.", sauces.reduce((sum, item) => sum + (item.quantity ?? 0), 0), "containers and matching spoons for entire event", sauces.map((item) => item.label), sauces));
  }
  objects.push(...cold);
  if (servingLines === 2) review.push("Mirror serving equipment on two food tables. Split the purchased food, plates, taco stands and sauce totals across the lines; do not double purchased quantities.");
  return {
    status: !labels.length ? "no-food" : review.length || unplaced.size ? "needs-review" : "ready",
    ruleVersion: EVENT_SERVING_RULE_VERSION,
    servingLines, plates, tacoStands,
    chafingDishesPerLine: unplaced.size ? null : objects.filter((item) => item.kind === "chafer").length,
    objects, review: [...new Set(review)], unplacedFood: [...unplaced],
    source: { eventId: event.source_event_id ?? String(event.id), updatedAt: event.source_updated_at ?? null, eventRuleVersion: event.rule_version ?? null, rawSelections: [...event.food] },
  };
}
