import type {
  KitchenSourceSelection,
  NormalizedKitchenSelection,
  NormalizedSelectionKind,
} from "./types";

export function normalizeKitchenText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

const EXACT_SELECTION_ALIASES: Readonly<
  Record<string, readonly NormalizedSelectionKind[]>
> = {
  "the full course": ["package:the-full-course"],
  "the front nine": ["package:the-front-nine"],
  "the full course with dessert": [
    "package:the-full-course",
    "dessert",
  ],
  "the front nine with dessert": [
    "package:the-front-nine",
    "dessert",
  ],
  "the full course w/dessert": [
    "package:the-full-course",
    "dessert",
  ],
  "the front nine w/dessert": [
    "package:the-front-nine",
    "dessert",
  ],
  "taco bar": ["bar:taco"],
  "wing bar": ["bar:wing"],
  "appetizer bar": ["bar:appetizer"],
  "lettuce wraps": ["option:taco-lettuce-wraps"],
  "dessert platter": ["dessert"],
  "dessert tray": ["dessert"],
  "tater keg platter": ["platter:tater-kegs"],
  "tater kegs platter": ["platter:tater-kegs"],
  "chicken tender platter": ["platter:chicken-tenders"],
  "chicken tenders platter": ["platter:chicken-tenders"],
  "mozzarella stick platter": ["platter:mozzarella-sticks"],
  "mozzarella sticks platter": ["platter:mozzarella-sticks"],
  "wing platter": ["platter:wings"],
  "wings platter": ["platter:wings"],
  "veggie tray": ["platter:veggie-tray"],
  "fry platter": ["platter:fries"],
  "fries platter": ["platter:fries"],
  "tater keg plattersuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives.": [
    "platter:tater-kegs",
  ],
  "tater keg plattersuper sized crispy on the outside mashed potato on the inside tots with cheese, bacon and chives": [
    "platter:tater-kegs",
  ],
  "wing platterdeep fried traditional wings served with celery and served with ranch.": [
    "platter:wings",
  ],
  "wing platterdeep fried traditional wings served with celery and served with ranch": [
    "platter:wings",
  ],
  "chicken tender platterfried chicken tenders with ranch dipping sauce.": [
    "platter:chicken-tenders",
  ],
  "chicken tender platterfried chicken tenders with ranch dipping sauce": [
    "platter:chicken-tenders",
  ],
  "veggie trayassorted fresh vegetables served with ranch dressing.": [
    "platter:veggie-tray",
  ],
  "veggie trayassorted fresh vegetables served with ranch dressing": [
    "platter:veggie-tray",
  ],
  ranch: ["sauce:ranch"],
  "ranch sauce": ["sauce:ranch"],
  marinara: ["sauce:marinara"],
  "marinara sauce": ["sauce:marinara"],
};

const MOZZARELLA_PLATTER_SELECTION_NAMES = new Set([
  "mozzarella sticks",
  "mozzarella sticksgolden fried mozzarella sticks with a crispy seasoned coating and warm melted cheese inside, served with marinara for dipping",
]);

const NON_FOOD_SOURCE_CATEGORIES = new Set([
  "beverage",
  "beverages",
  "bowling",
  "darts",
  "entertainment",
  "event",
  "event details",
  "fees",
  "mini golf",
  "room",
  "room rental",
  "shuffleboard",
]);

function uniqueKinds(
  kinds: readonly NormalizedSelectionKind[],
): NormalizedSelectionKind[] {
  return [...new Set(kinds)];
}

function compositeKinds(
  normalizedName: string,
): NormalizedSelectionKind[] {
  const kinds: NormalizedSelectionKind[] = [];
  let isApprovedPackageComposite = false;

  if (
    normalizedName.startsWith("the full course |") ||
    normalizedName.startsWith("the full course - ") ||
    normalizedName.startsWith("the full course w/") ||
    normalizedName.startsWith("the full course with ")
  ) {
    kinds.push("package:the-full-course");
    isApprovedPackageComposite = true;
  }

  if (
    normalizedName.startsWith("the front nine |") ||
    normalizedName.startsWith("the front nine - ") ||
    normalizedName.startsWith("the front nine w/") ||
    normalizedName.startsWith("the front nine with ")
  ) {
    kinds.push("package:the-front-nine");
    isApprovedPackageComposite = true;
  }

  if (
    isApprovedPackageComposite &&
    normalizedName.includes("taco bar")
  ) {
    kinds.push("bar:taco");
  }
  if (
    isApprovedPackageComposite &&
    normalizedName.includes("wing bar")
  ) {
    kinds.push("bar:wing");
  }
  if (
    isApprovedPackageComposite &&
    normalizedName.includes("appetizer bar")
  ) {
    kinds.push("bar:appetizer");
  }

  if (
    isApprovedPackageComposite &&
    [
      "assorted desserts",
      "with dessert",
      "w/dessert",
      "+cookies",
      "+ cookies",
    ].some((token) => normalizedName.includes(token))
  ) {
    kinds.push("dessert");
  }

  const descriptiveBarPrefixes = [
    ["taco bar - ", "bar:taco"],
    ["premium taco bar - ", "bar:taco"],
    ["wing bar - ", "bar:wing"],
    ["premium wing bar - ", "bar:wing"],
    ["appetizer bar - ", "bar:appetizer"],
    ["premium appetizer bar - ", "bar:appetizer"],
  ] as const;
  for (const [prefix, kind] of descriptiveBarPrefixes) {
    if (normalizedName.startsWith(prefix)) {
      kinds.push(kind);
    }
  }

  return uniqueKinds(kinds);
}

function isAssortedDessertPlatter(normalizedName: string) {
  return (
    normalizedName.startsWith("assorted desserts") ||
    normalizedName.startsWith("assorted deserts")
  );
}

function isCookieDessert(normalizedName: string) {
  return (
    normalizedName === "cookies" ||
    normalizedName.startsWith("cookies ")
  );
}

function inferFoodFlag(
  selection: KitchenSourceSelection,
): boolean | null {
  if (typeof selection.isFood === "boolean") {
    return selection.isFood;
  }

  const category = selection.sourceCategory
    ? normalizeKitchenText(selection.sourceCategory)
    : "";
  if (
    category === "food" ||
    category === "menu" ||
    category.startsWith("food ") ||
    category === "dessert" ||
    category === "desserts" ||
    category === "taco bar" ||
    category === "wing bar" ||
    category === "appetizer bar"
  ) {
    return true;
  }
  if (category && NON_FOOD_SOURCE_CATEGORIES.has(category)) {
    return false;
  }
  return null;
}

export function normalizeKitchenSelection(
  selection: KitchenSourceSelection,
): NormalizedKitchenSelection {
  const normalizedName = normalizeKitchenText(selection.name);
  const normalizedCategory = selection.sourceCategory
    ? normalizeKitchenText(selection.sourceCategory)
    : "";
  const exact = EXACT_SELECTION_ALIASES[normalizedName] ?? [];
  const categoryAware: NormalizedSelectionKind[] = [];
  if (
    MOZZARELLA_PLATTER_SELECTION_NAMES.has(normalizedName) &&
    normalizedCategory === "food platters"
  ) {
    categoryAware.push("platter:mozzarella-sticks");
  }
  if (
    normalizedCategory === "food platters" &&
    isAssortedDessertPlatter(normalizedName)
  ) {
    categoryAware.push("dessert");
  }
  if (isCookieDessert(normalizedName)) {
    categoryAware.push("dessert");
  }
  const kinds = uniqueKinds([
    ...exact,
    ...categoryAware,
    ...compositeKinds(normalizedName),
  ]);

  return {
    originalName: selection.name,
    normalizedName,
    quantity: selection.quantity ?? 1,
    quantityProvided: selection.quantity != null,
    kinds,
    sourceId: selection.sourceId ?? null,
    sourceCategory: selection.sourceCategory ?? null,
    isFood: inferFoodFlag(selection),
  };
}

export function normalizeKitchenSelections(
  selections: readonly KitchenSourceSelection[],
): NormalizedKitchenSelection[] {
  return selections.map(normalizeKitchenSelection);
}
