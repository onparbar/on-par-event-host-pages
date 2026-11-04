import type { EventPlan } from "@/lib/event-plans/types";
import { KITCHEN_RULE_CONFIG } from "@/lib/kitchen/config";
import { normalizeKitchenSelections } from "@/lib/kitchen/normalize";
import type { NormalizedKitchenSelection } from "@/lib/kitchen/types";
import { contractSetup, type ContractSetup } from "./setup";

export type SetupStation = { id: string; title: string; instructions: string; equipment: string[] };
export type SetupTemplateId = "taco-bar" | "appetizer-wings-dessert";
type SetupTemplate = {
  id: SetupTemplateId;
  version: string;
  title: string;
  stations: SetupStation[];
  referenceChafingDishes: number;
  imagePath: string;
  imageAlt: string;
};
export type SetupLayout = {
  templateId: SetupTemplateId | null;
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

export const SERVING_CART_SETUP_STATION: SetupStation = {
  id: "service-cart", title: "Plates, napkins & forks",
  instructions: "Place 2 marble serving carts side by side at the start, with plates, napkins and forks accessible from each side.",
  equipment: ["2 marble serving carts, side by side", "Plate stack on each side", "Napkins on each side", "Forks accessible from each side"],
};

/** Reference positions supplied by staff, not a capacity or food-quantity rule. */
export const TACO_BAR_SETUP_TEMPLATE = {
  id: "taco-bar" as const,
  version: "taco-bar-reference-v1",
  title: "Taco Bar setup reference",
  referenceChafingDishes: 1,
  imagePath: "/setup/taco-bar-reference-v1.png",
  imageAlt: "Illustrative Taco Bar serving arrangement with two marble carts, tortilla warmers, clear risers, a centered chafing dish and a three-tier serving stack.",
  stations: [
    SERVING_CART_SETUP_STATION,
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
} satisfies SetupTemplate;

export const APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE = {
  id: "appetizer-wings-dessert" as const,
  version: "appetizer-wings-dessert-reference-v1",
  title: "Appetizer Bar, wings & dessert setup reference",
  referenceChafingDishes: 2,
  imagePath: "/setup/appetizer-wings-dessert-reference-v1.png",
  imageAlt: "Illustrative Appetizer Bar, wings and dessert serving arrangement with two marble carts, two chafing dishes, a sauce plate and a raised dessert platter at the far end.",
  stations: [
    SERVING_CART_SETUP_STATION,
    {
      id: "chafer-one", title: "First chafing dish",
      instructions: "After the two serving carts, place the first reference chafing dish. Put a long black plate on each side, with 3 tongs on each plate.",
      equipment: ["First reference chafing dish", "Left long black plate: 3 tongs", "Right long black plate: 3 tongs"],
    },
    {
      id: "chafer-two", title: "Second chafing dish",
      instructions: "Place the second reference chafing dish next. Put a long black plate on each side, with 2 tongs on each plate.",
      equipment: ["Second reference chafing dish", "Left long black plate: 2 tongs", "Right long black plate: 2 tongs"],
    },
    {
      id: "sauces", title: "Sauce serving plate",
      instructions: "After the second chafing dish, place the long black sauce plate with 3 spoons. The reference does not assign particular sauce contents.",
      equipment: ["Long black sauce plate", "3 spoons"],
    },
    {
      id: "dessert", title: "Raised dessert platter",
      instructions: "At the far end, replace the three-tier stack with the dessert platter on a small clear riser, with 2 tongs. Purchased dessert quantities remain unchanged.",
      equipment: ["Small clear riser", "Dessert platter", "2 tongs"],
    },
  ],
} satisfies SetupTemplate;

export const SETUP_TEMPLATES = {
  "taco-bar": TACO_BAR_SETUP_TEMPLATE,
  "appetizer-wings-dessert": APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE,
} satisfies Record<SetupTemplateId, SetupTemplate>;

/** Only the supplied purchased signature: 55 Front Nine/Appetizer Bar + 2 wings + 2 dessert. */
function matchesAppetizerWingsDessert(selections: NormalizedKitchenSelection[]) {
  const signature = selections.flatMap((selection) => selection.kinds.map((kind) => ({
    kind, quantity: selection.quantity, provided: selection.quantityProvided,
  })));
  if (selections.some((selection) => selection.kinds.length === 0) || signature.length !== 4) return false;
  const required = ["package:the-front-nine", "bar:appetizer", "platter:wings", "dessert"];
  if (required.some((kind) => signature.filter((item) => item.kind === kind).length !== 1)) return false;
  return signature.every((item) => item.kind === "bar:appetizer"
    ? !item.provided || item.quantity === 55
    : item.provided && item.quantity === (item.kind === "package:the-front-nine" ? 55 : 2));
}

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
  const templateId: SetupTemplateId | null = bars.length === 1 && bars[0] === "bar:taco" && !unknownFood ? "taco-bar"
    : setup.foodTables === 1 && foodLabels.length === event.food.length && matchesAppetizerWingsDessert(selections) ? "appetizer-wings-dessert" : null;
  const template = templateId ? SETUP_TEMPLATES[templateId] : null;
  const additionalFood = templateId === "appetizer-wings-dessert" ? [] : foodLabels.filter((_label, index) => !templateId || normalizedByLabel[index].some((selection) =>
    selection.kinds.some((kind) => kind.startsWith("platter:") || kind === "dessert" || kind.startsWith("sauce:"))));
  const review = [...setup.review, ...(event.review_reasons ?? []).filter((reason) => reason.trim())];
  if (!Number.isFinite(Date.parse(event.source_updated_at ?? ""))) review.push("A verified source update timestamp is required before confirming this setup.");
  if (!event.rooms.some((room) => room.trim())) review.push("The reserved area is missing; confirm the area before arranging the tables.");
  if (foodLabels.length) {
    review.push("Draft only — equipment placement is not to scale. Furniture dimensions are confirmed, but chafing-dish, tray, riser and stand footprints and their clearances are not verified; physical fit is not approved.");
    if (!templateId) review.push("No complete setup template is available for this food combination. Do not substitute a reference layout for an unknown item or unmatched food combination.");
    if (templateId && additionalFood.length) review.push("Additional purchased food is listed separately and has not been assigned an approved table position.");
    const servingCount = setup.servingSetup?.chafingDishes ?? setup.chafingDishes;
    if (template && servingCount !== null && setup.foodTables !== null && servingCount !== template.referenceChafingDishes * setup.foodTables) {
      const referenceCount = template.referenceChafingDishes;
      review.push(`The reference illustrates ${referenceCount === 1 ? "one chafing dish" : `${referenceCount} chafing dishes`} per table, but this event’s existing calculation calls for ${servingCount}. Equipment placement needs review; the illustration does not replace the calculated count.`);
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
      ruleVersion: `${template?.version ?? TACO_BAR_SETUP_TEMPLATE.version} / ${KITCHEN_RULE_CONFIG.ruleVersion}`,
    },
    stations: template ? template.stations.map((station) => ({ ...station, equipment: [...station.equipment] })) : [],
    additionalFood,
  };
}
