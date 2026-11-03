import type { EventPlan } from "@/lib/event-plans/types";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { normalizeKitchenSelections } from "@/lib/kitchen/normalize";
import { contractSetup, type ContractSetup } from "./setup";

export type SetupStation = { id: string; title: string; instructions: string; equipment: string[] };
export type SetupLayout = {
  templateId: "taco-bar" | null;
  status: "draft" | "needs-review" | "no-food";
  tableCount: number | null;
  mirrored: boolean;
  chafingDishes: number | null;
  servingChafingDishes: number | null;
  purchasedFood: string[];
  food: ContractSetup["food"];
  review: string[];
  source: { eventId: string; updatedAt: string | null; ruleVersion: string };
  stations: SetupStation[];
  additionalFood: string[];
};

/** Staff-measured furniture only; equipment footprints and clearances are unverified. */
export const SETUP_FURNITURE_DIMENSIONS = Object.freeze({
  table: Object.freeze({ lengthInches: 96, widthInches: 36 }),
  cart: Object.freeze({ lengthInches: 21.5, widthInches: 15.5, count: 2, combinedLengthInches: 21.5, combinedWidthInches: 31 }),
});

/** Reference positions supplied by staff, not a capacity or food-quantity rule. */
export const TACO_BAR_SETUP_TEMPLATE = {
  id: "taco-bar" as const,
  version: "taco-bar-reference-v1",
  title: "Taco Bar setup reference",
  stations: [
    {
      id: "service-cart", title: "Plates, napkins & forks",
      instructions: "Place 2 marble serving carts side by side at the start, with plates, napkins and forks accessible from each side.",
      equipment: ["2 marble serving carts, side by side", "Plate stack on each side", "Napkins on each side", "Forks accessible from each side"],
    },
    {
      id: "tortillas", title: "Tortilla warmers & taco stands",
      instructions: "Left to right: tortilla warmer with small tongs, taco stands in the center, tortilla warmer with small tongs. Use the clear risers shown in the reference.",
      equipment: ["Left tortilla warmer and small tongs", "Center taco stands", "Right tortilla warmer and small tongs", "Clear risers"],
    },
    {
      id: "lettuce-wraps", title: "Lettuce wraps",
      instructions: "Use a small clear riser box for lettuce wraps, with 2 tongs.",
      equipment: ["Small clear riser box", "2 tongs"],
    },
    {
      id: "hot-food", title: "Centered chafing dish",
      instructions: "Center the reference chafing dish. Place a long black plate on each side; each plate holds 1 spoon and 2 large tongs. Check this event’s calculated equipment separately.",
      equipment: ["Reference chafing dish", "Left long black plate: 1 spoon and 2 large tongs", "Right long black plate: 1 spoon and 2 large tongs"],
    },
    {
      id: "cold-sides", title: "Three-tier serving stack",
      instructions: "Arrange the three-tier stack with 2 small tongs on top, 2 spoons in the middle and 2 spoons on the bottom.",
      equipment: ["Three-tier serving stack", "Top: 2 small tongs", "Middle: 2 spoons", "Bottom: 2 spoons"],
    },
  ],
} satisfies { id: "taco-bar"; version: string; title: string; stations: SetupStation[] };

/** Read-only draft. Never packs equipment to an assumed table size or changes prep. */
export function buildSetupLayout(event: EventPlan): SetupLayout {
  const setup = contractSetup(event);
  const foodLabels = event.food.filter((label) => !/^\s*(?:no food\b|none$)/i.test(label));
  const normalizedByLabel = foodLabels.map((label) => {
    // Match the existing contractSetup canonical prefix and exact composite separator.
    const match = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+)$/i.exec(label);
    return normalizeKitchenSelections((match?.[2] ?? label).split(" + ").map((name) => ({
      name, quantity: match ? Number(match[1]) : null, isFood: true,
    })));
  });
  const selections = normalizedByLabel.flat();
  const kinds = selections.flatMap((selection) => selection.kinds);
  const bars = [...new Set(kinds.filter((kind) => kind.startsWith("bar:")))];
  const unknownFood = selections.some((selection) => selection.kinds.length === 0);
  const templateId = bars.length === 1 && bars[0] === "bar:taco" && !unknownFood ? "taco-bar" : null;
  const additionalFood = foodLabels.filter((_label, index) => !templateId || normalizedByLabel[index].some((selection) =>
    selection.kinds.some((kind) => kind.startsWith("platter:") || kind === "dessert" || kind.startsWith("sauce:"))));
  const review = [...setup.review, ...(event.review_reasons ?? []).filter((reason) => reason.trim())];
  if (!Number.isFinite(Date.parse(event.source_updated_at ?? ""))) review.push("A verified source update timestamp is required before confirming this setup.");
  if (!event.rooms.some((room) => room.trim())) review.push("The reserved area is missing; confirm the area before arranging the tables.");
  if (foodLabels.length) {
    review.push("Draft only — equipment placement is not to scale. Furniture dimensions are confirmed, but chafing-dish, tray, riser and stand footprints and their clearances are not verified; physical fit is not approved.");
    if (!templateId) review.push("No complete setup template is available for this food combination. Do not substitute the Taco Bar layout for an unknown item or another bar.");
    if (templateId && additionalFood.length) review.push("Additional purchased food is listed separately and has not been assigned an approved table position.");
    const servingCount = setup.servingSetup?.chafingDishes ?? setup.chafingDishes;
    if (templateId && servingCount !== null && setup.foodTables !== null && servingCount > setup.foodTables) {
      review.push(`The reference illustrates one chafing dish per table, but this event’s existing calculation calls for ${servingCount}. Additional equipment placement needs review; the illustration does not replace the calculated count.`);
    }
  }
  return {
    templateId: foodLabels.length ? templateId : null,
    status: !foodLabels.length ? "no-food" : review.length ? "needs-review" : "draft",
    tableCount: setup.foodTables,
    mirrored: setup.mirrored,
    chafingDishes: setup.chafingDishes,
    servingChafingDishes: setup.servingSetup?.chafingDishes ?? null,
    purchasedFood: [...setup.purchasedFood],
    food: setup.food.map((row) => ({ ...row })),
    review: [...new Set(review)],
    source: {
      eventId: event.source_event_id ?? String(event.id),
      updatedAt: event.source_updated_at ?? null,
      ruleVersion: `${TACO_BAR_SETUP_TEMPLATE.version} / ${KITCHEN_RULE_CONFIG.ruleVersion}`,
    },
    stations: templateId ? TACO_BAR_SETUP_TEMPLATE.stations.map((station) => ({ ...station, equipment: [...station.equipment] })) : [],
    additionalFood,
  };
}
