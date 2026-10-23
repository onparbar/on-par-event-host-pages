import { KITCHEN_RULE_CONFIG } from "./config";
import { getPlatterPanAllocation } from "./platter-pans";
import type { KitchenLiveFoodAddOn } from "./types";

type AddOnUnit =
  | "each"
  | "pounds"
  | "pretzel plates"
  | "bags"
  | "bowls"
  | "platters"
  | "requested units";

export type KitchenEventAddOnSection =
  | "party-platters"
  | "sauces"
  | "dessert"
  | "taco-bar"
  | "appetizer-bar-refills"
  | "wing-bar-refills";

export type KitchenAddOnCalculation =
  | {
      kind: "platter";
      platterKind:
        | "platter:tater-kegs"
        | "platter:chicken-tenders"
        | "platter:mozzarella-sticks"
        | "platter:wings"
        | "platter:veggie-tray"
        | "platter:fries";
    }
  | {
      kind: "approved-sauce";
      sauce: "ranch";
    }
  | {
      kind: "dessert";
    }
  | {
      kind: "display-only";
    }
  | {
      kind: "unresolved-taco-addon";
    };

type AddOnRule = {
  sourceKey: string;
  foodName: string;
  section: KitchenEventAddOnSection;
  sourceUnitLabel: "platters" | "trays" | "bowls" | "requested units";
  description: string;
  amountPerSourceUnit: number;
  maxSourceQuantity: number;
  unit: AddOnUnit;
  calculation: KitchenAddOnCalculation;
};

const TACO_BAR_ADD_ON_ITEMS = [
  ["taco-beef", "Beef"],
  ["taco-chicken", "Chicken"],
  ["taco-black-beans", "Black Beans"],
  ["taco-tortillas", "Tortillas"],
  ["taco-lettuce-wraps", "Lettuce Wraps"],
  ["taco-tomatoes", "Tomatoes"],
  ["taco-lettuce", "Lettuce"],
  ["taco-sour-cream", "Sour Cream"],
  ["taco-diced-onion", "Diced Onion"],
  ["taco-shredded-cheese", "Shredded Cheese"],
  ["taco-salsa", "Salsa"],
] as const;

export const KITCHEN_EVENT_ADD_ON_FIELDS = [
  {
    sourceKey: "wings",
    foodName: "Wings",
    section: "party-platters",
    sourceUnitLabel: "platters",
    description: "Traditional wings served with celery and ranch.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:wings"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "each",
    calculation: {
      kind: "platter",
      platterKind: "platter:wings",
    },
  },
  {
    sourceKey: "mozzarella-sticks",
    foodName: "Mozzarella Sticks",
    section: "party-platters",
    sourceUnitLabel: "platters",
    description:
      "Golden fried mozzarella sticks served with marinara for dipping.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:mozzarella-sticks"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "pounds",
    calculation: {
      kind: "platter",
      platterKind: "platter:mozzarella-sticks",
    },
  },
  {
    sourceKey: "tater-kegs",
    foodName: "Tater Kegs",
    section: "party-platters",
    sourceUnitLabel: "platters",
    description:
      "Crispy mashed-potato tots with cheese, bacon, and chives.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:tater-kegs"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "each",
    calculation: {
      kind: "platter",
      platterKind: "platter:tater-kegs",
    },
  },
  {
    sourceKey: "fry-platters",
    foodName: "Fries",
    section: "party-platters",
    sourceUnitLabel: "platters",
    description: "One 5-pound bag of golden crispy fries per platter.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:fries"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "bags",
    calculation: {
      kind: "platter",
      platterKind: "platter:fries",
    },
  },
  {
    sourceKey: "chicken-tenders",
    foodName: "Chicken Tenders",
    section: "party-platters",
    sourceUnitLabel: "platters",
    description: "Fried chicken tenders served with ranch dipping sauce.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:chicken-tenders"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "each",
    calculation: {
      kind: "platter",
      platterKind: "platter:chicken-tenders",
    },
  },
  {
    sourceKey: "veggie-tray",
    foodName: "Veggie Tray",
    section: "party-platters",
    sourceUnitLabel: "trays",
    description: "Assorted fresh vegetables served with ranch dressing.",
    amountPerSourceUnit:
      KITCHEN_RULE_CONFIG.platter.rules["platter:veggie-tray"].amountPerPlatter,
    maxSourceQuantity: 10,
    unit: "pretzel plates",
    calculation: {
      kind: "platter",
      platterKind: "platter:veggie-tray",
    },
  },
  {
    sourceKey: "bbq-sauce",
    foodName: "BBQ Sauce",
    section: "sauces",
    sourceUnitLabel: "bowls",
    description: "Bowl of BBQ sauce.",
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "bowls",
    calculation: { kind: "display-only" },
  },
  {
    sourceKey: "garlic-parm",
    foodName: "Garlic Parm",
    section: "sauces",
    sourceUnitLabel: "bowls",
    description: "Bowl of garlic Parmesan sauce.",
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "bowls",
    calculation: { kind: "display-only" },
  },
  {
    sourceKey: "buffalo-sauce",
    foodName: "Buffalo Sauce",
    section: "sauces",
    sourceUnitLabel: "bowls",
    description: "Bowl of Buffalo sauce.",
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "bowls",
    calculation: { kind: "display-only" },
  },
  {
    sourceKey: "ranch",
    foodName: "Ranch",
    section: "sauces",
    sourceUnitLabel: "bowls",
    description: "Bowl of ranch dressing.",
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "bowls",
    calculation: {
      kind: "approved-sauce",
      sauce: "ranch",
    },
  },
  {
    sourceKey: "dessert-platter",
    foodName: "Dessert Platter",
    section: "dessert",
    sourceUnitLabel: "platters",
    description: "Dessert platter added to the event.",
    amountPerSourceUnit: 1,
    maxSourceQuantity: 10,
    unit: "platters",
    calculation: { kind: "dessert" },
  },
  ...TACO_BAR_ADD_ON_ITEMS.map(([sourceKey, foodName]) => ({
    sourceKey,
    foodName,
    section: "taco-bar" as const,
    sourceUnitLabel: "requested units" as const,
    description: `${foodName} added separately to the Taco Bar.`,
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "requested units" as const,
    calculation: { kind: "unresolved-taco-addon" as const },
  })),
  ...[
    ["appetizer-refill-tater-kegs", "Tater Kegs"],
    ["appetizer-refill-mozzarella-sticks", "Mozzarella Sticks"],
    ["appetizer-refill-chicken-tenders", "Chicken Tenders"],
    ["appetizer-refill-marinara", "Marinara"],
    ["appetizer-refill-ranch", "Ranch"],
    ["appetizer-refill-bbq", "BBQ Sauce"],
  ].map(([sourceKey, foodName]) => ({
    sourceKey,
    foodName,
    section: "appetizer-bar-refills" as const,
    sourceUnitLabel: "requested units" as const,
    description: `${foodName} refill requested for the Appetizer Bar.`,
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "requested units" as const,
    calculation: { kind: "display-only" as const },
  })),
  ...[
    ["wing-refill-wings", "Wings"],
    ["wing-refill-fries", "Fries"],
    ["wing-refill-ranch", "Ranch"],
    ["wing-refill-bbq", "BBQ Sauce"],
    ["wing-refill-garlic-parm", "Garlic Parm"],
    ["wing-refill-buffalo", "Buffalo Sauce"],
  ].map(([sourceKey, foodName]) => ({
    sourceKey,
    foodName,
    section: "wing-bar-refills" as const,
    sourceUnitLabel: "requested units" as const,
    description: `${foodName} refill requested for the Wing Bar.`,
    amountPerSourceUnit: 1,
    maxSourceQuantity: 9999,
    unit: "requested units" as const,
    calculation: { kind: "display-only" as const },
  })),
] as const satisfies readonly AddOnRule[];

export const KITCHEN_EVENT_ADD_ON_SECTIONS = [
  { key: "party-platters", label: "Party Platters" },
  { key: "sauces", label: "Sauces" },
  { key: "dessert", label: "Dessert" },
  { key: "taco-bar", label: "Taco Bar" },
  { key: "appetizer-bar-refills", label: "Appetizer Bar Refills" },
  { key: "wing-bar-refills", label: "Wing Bar Refills" },
] as const satisfies readonly {
  key: KitchenEventAddOnSection;
  label: string;
}[];

export type EventHostFoodAddOnKey =
  (typeof KITCHEN_EVENT_ADD_ON_FIELDS)[number]["sourceKey"];

export type KitchenEventAddOnFood = Partial<
  Record<EventHostFoodAddOnKey, { quantity: number; panSize?: "1/3" | "1/2"; notes?: string }>
>;

export type KitchenAddOnItemKey = `addon:${EventHostFoodAddOnKey}`;

export type KitchenAddOnItem = {
  itemKey: KitchenAddOnItemKey;
  foodName: string;
  description: string;
  quantity: number;
  unit: AddOnUnit;
  numberOfPans: number | null;
  panSize: "1/3" | "1/2" | null;
  selectedPanSize?: "1/3" | "1/2" | null;
  sourceUpdatedAt: string | null;
  requestNotes?: string;
};

export type KitchenLiveAddOnEffect = {
  item: KitchenLiveFoodAddOn;
  sourceKey: EventHostFoodAddOnKey;
  sourceQuantity: number;
  calculation: KitchenAddOnCalculation;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveWholeQuantity(value: unknown) {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function sourceQuantity(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return positiveWholeQuantity(value.quantity);
}

function sourcePanSize(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return value.panSize === "1/3" || value.panSize === "1/2"
    ? value.panSize
    : null;
}

export function normalizeKitchenOrderNotes(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error("Food request notes must be text of up to 500 characters without control characters.");
  }
  return value.trim() || undefined;
}

export function resolveKitchenLiveFoodAddOns(
  items: readonly KitchenLiveFoodAddOn[],
): KitchenLiveAddOnEffect[] {
  return items.flatMap((item) => {
    const field = KITCHEN_EVENT_ADD_ON_FIELDS.find(
      (candidate) => `addon:${candidate.sourceKey}` === item.itemKey,
    );
    if (!field) {
      return [];
    }
    const quantity = item.quantity / field.amountPerSourceUnit;
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      return [];
    }
    return [
      {
        item,
        sourceKey: field.sourceKey,
        sourceQuantity: quantity,
        calculation: field.calculation,
      },
    ];
  });
}

export function translateEventHostFoodAddOns(
  food: unknown,
  sourceUpdatedAt: string | null,
): KitchenAddOnItem[] {
  if (!isRecord(food)) {
    return [];
  }

  return KITCHEN_EVENT_ADD_ON_FIELDS.flatMap((rule) => {
    const platterOrBowlCount = sourceQuantity(food[rule.sourceKey]);
    if (
      platterOrBowlCount === null ||
      platterOrBowlCount > rule.maxSourceQuantity
    ) {
      return [];
    }

    const quantity = platterOrBowlCount * rule.amountPerSourceUnit;
    if (!Number.isSafeInteger(quantity)) {
      return [];
    }
    const selectedPanSize = sourcePanSize(food[rule.sourceKey]);
    const rawValue = food[rule.sourceKey];
    const requestNotes = normalizeKitchenOrderNotes(isRecord(rawValue) ? rawValue.notes : undefined);
    const platterRule = rule.calculation.kind === "platter"
      ? KITCHEN_RULE_CONFIG.platter.rules[rule.calculation.platterKind]
      : null;
    const panAllocation: Pick<KitchenAddOnItem, "numberOfPans" | "panSize"> = platterRule?.pansPerPlatter
      ? selectedPanSize === "1/3" && platterRule.pansPerPlatter["1/3"] === null
        ? { numberOfPans: null, panSize: selectedPanSize }
        : getPlatterPanAllocation(platterRule, platterOrBowlCount, selectedPanSize ?? "1/3")
      : {
          numberOfPans: selectedPanSize ? platterOrBowlCount : null,
          panSize: selectedPanSize,
        };

    return [
      {
        itemKey: `addon:${rule.sourceKey}`,
        foodName: rule.foodName,
        description: rule.description,
        quantity,
        unit: rule.unit,
        ...panAllocation,
        ...(selectedPanSize ? { selectedPanSize } : {}),
        sourceUpdatedAt,
        ...(requestNotes ? { requestNotes } : {}),
      },
    ];
  });
}
