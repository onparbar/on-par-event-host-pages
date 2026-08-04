import {
  KITCHEN_FOOD_DESCRIPTIONS,
  KITCHEN_RULE_CONFIG,
  type KitchenRuleConfig,
  type PlatterRule,
} from "./config";
import { resolveKitchenLiveFoodAddOns } from "./addons";
import { normalizeKitchenText, normalizeKitchenSelections } from "./normalize";
import {
  KITCHEN_TIME_ZONE,
  type BarType,
  type KitchenCategory,
  type KitchenChecklist,
  type KitchenChecklistRow,
  type KitchenFoodKey,
  type KitchenLiveFoodAddOn,
  type KitchenReferenceConflict,
  type KitchenSourceEvent,
  type KitchenWarning,
  type NormalizedKitchenSelection,
  type PackageMarker,
  type PlatterPackingItem,
  type PlatterPackingResult,
  type PrepTiming,
} from "./types";

const CATEGORY_ORDER: readonly KitchenCategory[] = [
  "dessert",
  "taco",
  "wing",
  "appetizer",
  "platters",
  "sauces",
];

const CATEGORY_LABELS: Readonly<Record<KitchenCategory, string>> = {
  dessert: "Assorted Desserts",
  taco: "Taco Bar",
  wing: "Wing Bar",
  appetizer: "Appetizer Bar",
  platters: "Platters",
  sauces: "Sauces",
};

const BAR_ORDER: readonly BarType[] = ["taco", "wing", "appetizer"];
const PACKAGE_ORDER: readonly PackageMarker[] = [
  "the-full-course",
  "the-front-nine",
];

const LEGACY_REFERENCE_FOODS = new Set([
  "beer cheese",
  "cookies",
  "legacy pretzel bites",
  "loaded fries",
  "pork",
  "pretzel bites",
  "salad",
]);

const PLATTER_KIND_ORDER = [
  "platter:tater-kegs",
  "platter:chicken-tenders",
  "platter:mozzarella-sticks",
  "platter:wings",
  "platter:veggie-tray",
  "platter:fries",
] as const;

type PlatterSelectionKind = (typeof PLATTER_KIND_ORDER)[number];

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type TimeParts = {
  hour: number;
  minute: number;
};

function warningKey(warning: KitchenWarning): string {
  return [
    warning.code,
    warning.itemKey ?? "",
    warning.selectionName ?? "",
    warning.conflictCode ?? "",
    warning.message,
  ].join("|");
}

function addWarning(
  warnings: KitchenWarning[],
  warningKeys: Set<string>,
  warning: KitchenWarning,
): void {
  const key = warningKey(warning);
  if (!warningKeys.has(key)) {
    warningKeys.add(key);
    warnings.push(warning);
  }
}

function parseDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day
  ) {
    return null;
  }

  return parts;
}

function parseTime(value: string): TimeParts | null {
  const match =
    /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLocaleLowerCase("en-US");

  if (minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (hour === 12) {
      hour = 0;
    }
    if (meridiem === "pm") {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute };
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KITCHEN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAtEpoch(epochMilliseconds: number): DateParts & TimeParts {
  const parts = Object.fromEntries(
    dateTimeFormatter
      .formatToParts(new Date(epochMilliseconds))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function localDateTimeToEpoch(
  date: DateParts,
  time: TimeParts,
): number | null {
  const desiredAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
  );
  let epoch = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsAtEpoch(epoch);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
    );
    const adjustment = desiredAsUtc - observedAsUtc;
    epoch += adjustment;
    if (adjustment === 0) {
      break;
    }
  }

  const finalParts = partsAtEpoch(epoch);
  if (
    finalParts.year !== date.year ||
    finalParts.month !== date.month ||
    finalParts.day !== date.day ||
    finalParts.hour !== time.hour ||
    finalParts.minute !== time.minute
  ) {
    return null;
  }

  return epoch;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(epochMilliseconds: number): string {
  const parts = partsAtEpoch(epochMilliseconds);
  return `${parts.year}-${twoDigits(parts.month)}-${twoDigits(parts.day)}T${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`;
}

function sourceStartEpoch(
  value: string,
  eventDate: DateParts | null,
): number | null {
  const timeOnly = parseTime(value);
  if (timeOnly) {
    return eventDate
      ? localDateTimeToEpoch(eventDate, timeOnly)
      : null;
  }

  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    )
  ) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const localIso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(
    value,
  );
  if (localIso) {
    const localDate = parseDate(localIso[1]);
    const localTime = parseTime(localIso[2]);
    return localDate && localTime
      ? localDateTimeToEpoch(localDate, localTime)
      : null;
  }

  return null;
}

function validGuestCount(
  guestCount: number | null,
): guestCount is number {
  return (
    typeof guestCount === "number" &&
    Number.isInteger(guestCount) &&
    guestCount > 0
  );
}

function validSelectionQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

function resolveGuestCount(
  eventGuestCount: number | null,
  selections: readonly NormalizedKitchenSelection[],
): {
  guestCount: number | null;
  source: "event" | "bar-selection-quantity" | null;
} {
  if (eventGuestCount != null) {
    return {
      guestCount: eventGuestCount,
      source: "event",
    };
  }

  const candidates = selections.filter(
    (selection) =>
      selection.quantityProvided &&
      selection.kinds.some((kind) => kind.startsWith("bar:")) &&
      selection.kinds.some((kind) => kind.startsWith("package:")),
  );

  if (
    candidates.length === 0 ||
    candidates.some(
      (selection) => !validSelectionQuantity(selection.quantity),
    )
  ) {
    return { guestCount: null, source: null };
  }

  const quantities = new Set(
    candidates.map((selection) => selection.quantity),
  );
  if (quantities.size !== 1) {
    return { guestCount: null, source: null };
  }

  return {
    guestCount: candidates[0].quantity,
    source: "bar-selection-quantity",
  };
}

export function getTacoBatchCount(
  guestCount: number,
  config: KitchenRuleConfig = KITCHEN_RULE_CONFIG,
): number | null {
  return (
    config.taco.bands.find(
      (band) =>
        guestCount >= band.minGuests && guestCount <= band.maxGuests,
    )?.batches ?? null
  );
}

export function getStartedGroupCount(
  guestCount: number,
  groupSize: number,
  maxGuests: number,
): number | null {
  if (
    !Number.isInteger(guestCount) ||
    guestCount < 1 ||
    guestCount > maxGuests
  ) {
    return null;
  }
  return Math.ceil(guestCount / groupSize);
}

export function getRequiredPanCount(
  quantity: number,
  amountPerPan: number,
): number {
  if (
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    !Number.isFinite(amountPerPan) ||
    amountPerPan <= 0
  ) {
    throw new RangeError(
      "Pan quantities must be finite and nonnegative, with a positive capacity.",
    );
  }

  return Math.ceil(quantity / amountPerPan);
}

export function packHotPlatters(
  items: readonly PlatterPackingItem[],
): PlatterPackingResult {
  const totalHotPlatters = items.reduce(
    (sum, item) => sum + item.platterCount,
    0,
  );

  if (totalHotPlatters === 0) {
    return {
      status: "approved",
      totalHotPlatters: 0,
      panCount: 0,
      panSize: null,
      chafingDishes: 0,
    };
  }

  const approved = {
    2: { panSize: "1/2" as const, chafingDishes: 1 },
    3: { panSize: "1/3" as const, chafingDishes: 1 },
    4: { panSize: "1/2" as const, chafingDishes: 2 },
    6: { panSize: "1/3" as const, chafingDishes: 2 },
  }[totalHotPlatters];

  if (!approved) {
    return {
      status: "needs-review",
      reason: "unapproved-total",
      totalHotPlatters,
      panCount: null,
      panSize: null,
      chafingDishes: null,
    };
  }

  return {
    status: "approved",
    totalHotPlatters,
    panCount: totalHotPlatters,
    panSize: approved.panSize,
    chafingDishes: approved.chafingDishes,
  };
}

function selectionsWithKind(
  selections: readonly NormalizedKitchenSelection[],
  kind: NormalizedKitchenSelection["kinds"][number],
): NormalizedKitchenSelection[] {
  return selections.filter((selection) => selection.kinds.includes(kind));
}

function hasKind(
  selections: readonly NormalizedKitchenSelection[],
  kind: NormalizedKitchenSelection["kinds"][number],
): boolean {
  return selections.some((selection) => selection.kinds.includes(kind));
}

function prepForPlatter(
  rule: PlatterRule,
  config: KitchenRuleConfig,
): PrepTiming {
  switch (rule.rowKey) {
    case "platter-tater-kegs":
      return {
        kind: "minutes-before-food-ready",
        minutes: config.prepLeadMinutes.taterKegs,
      };
    case "platter-chicken-tenders":
      return {
        kind: "minutes-before-food-ready",
        minutes: config.prepLeadMinutes.chickenTenders,
      };
    case "platter-wings":
      return {
        kind: "minutes-before-food-ready",
        minutes: config.prepLeadMinutes.wings,
      };
    case "platter-mozzarella-sticks":
    case "platter-fries":
      return { kind: "unresolved" };
    case "platter-veggie-tray":
      return {
        kind: "kitchen-morning",
        localTime: config.kitchenMorningTime,
      };
  }
}

function isKnownFoodSelection(
  selection: NormalizedKitchenSelection,
): boolean {
  return selection.kinds.some(
    (kind) =>
      kind.startsWith("bar:") ||
      kind.startsWith("platter:") ||
      kind.startsWith("sauce:") ||
      kind === "dessert" ||
      kind === "option:taco-lettuce-wraps",
  );
}

function addReferenceWarning(
  conflict: KitchenReferenceConflict,
  warnings: KitchenWarning[],
  warningKeys: Set<string>,
  requiresReview: boolean,
): void {
  addWarning(warnings, warningKeys, {
    code: "REFERENCE_CONFLICT",
    message: `${conflict.title}: ${conflict.currentResolution}`,
    requiresReview,
    scope: "configuration",
    conflictCode: conflict.code,
  });
}

export function generateKitchenChecklist(
  sourceEvent: KitchenSourceEvent,
  config: KitchenRuleConfig = KITCHEN_RULE_CONFIG,
  liveFoodAddOns: readonly KitchenLiveFoodAddOn[] = [],
): KitchenChecklist {
  const selections = normalizeKitchenSelections(sourceEvent.selections);
  const liveAddOnEffects =
    resolveKitchenLiveFoodAddOns(liveFoodAddOns);
  const warnings: KitchenWarning[] = [];
  const warningKeys = new Set<string>();
  const rowsByCategory = new Map<KitchenCategory, KitchenChecklistRow[]>(
    CATEGORY_ORDER.map((category) => [category, []]),
  );
  const requiredSauces = new Set<"marinara" | "ranch">();
  const approvedSauceBowlCounts = new Map<
    "marinara" | "ranch",
    number
  >();
  const unresolvedSauceBowlSources = new Map<
    "marinara" | "ranch",
    Set<string>
  >();
  const addApprovedSauceBowls = (
    sauce: "marinara" | "ranch",
    bowlCount: number,
  ): void => {
    approvedSauceBowlCounts.set(
      sauce,
      (approvedSauceBowlCounts.get(sauce) ?? 0) + bowlCount,
    );
  };
  const addUnresolvedSauceSource = (
    sauce: "marinara" | "ranch",
    source: string,
  ): void => {
    const sources =
      unresolvedSauceBowlSources.get(sauce) ?? new Set<string>();
    sources.add(source);
    unresolvedSauceBowlSources.set(sauce, sources);
  };
  const activeConflictCodes = new Map<string, boolean>();
  const activateConflict = (
    code: string,
    requiresReview: boolean,
  ): void => {
    activeConflictCodes.set(
      code,
      (activeConflictCodes.get(code) ?? false) || requiresReview,
    );
  };
  const prepItems: {
    itemKey: string;
    foodName: string;
    prepTiming: PrepTiming;
  }[] = [];
  const registerPrepItem = ({
    itemKey,
    foodName,
    prepTiming,
  }: (typeof prepItems)[number]) => {
    prepItems.push({ itemKey, foodName, prepTiming });
    if (prepTiming.kind === "unresolved") {
      addWarning(warnings, warningKeys, {
        code: "UNRESOLVED_PREP_LEAD",
        message: `${foodName} has a five-minute cook reference but no approved prep-lead value.`,
        requiresReview: true,
        scope: "item",
        itemKey,
      });
      activateConflict("FRIED_ITEM_ZERO_HOUR", false);
    }
    if (
      prepTiming.kind === "kitchen-morning" &&
      prepTiming.localTime == null
    ) {
      addWarning(warnings, warningKeys, {
        code: "UNCONFIGURED_KITCHEN_MORNING",
        message:
          "Veggie Tray requires a first-thing-in-the-morning start, but the kitchen morning time is not configured.",
        requiresReview: true,
        scope: "configuration",
        itemKey,
      });
      activateConflict("VEGGIE_MORNING_45_MINUTES", false);
    }
  };

  const addRow = (
    row: Omit<KitchenChecklistRow, "description">,
  ): KitchenChecklistRow => {
    const completeRow = {
      ...row,
      description: KITCHEN_FOOD_DESCRIPTIONS[row.key],
    };
    rowsByCategory.get(completeRow.category)?.push(completeRow);
    registerPrepItem({
      itemKey: completeRow.key,
      foodName: completeRow.foodName,
      prepTiming: completeRow.prepTiming,
    });
    return completeRow;
  };

  const packageMarkers = PACKAGE_ORDER.filter((marker) =>
    hasKind(selections, `package:${marker}`),
  );
  const selectedBars = BAR_ORDER.filter((bar) =>
    hasKind(selections, `bar:${bar}`),
  );
  const classification =
    packageMarkers.length > 0 ? "bar-package" : "platter-only";
  const activeBars = classification === "bar-package" ? selectedBars : [];
  const guestCountResolution = resolveGuestCount(
    sourceEvent.guestCount,
    selections,
  );
  const effectiveGuestCount = guestCountResolution.guestCount;

  if (packageMarkers.length > 0 && selectedBars.length === 0) {
    addWarning(warnings, warningKeys, {
      code: "PACKAGE_BAR_MISSING",
      message:
        "A Full Course or Front Nine package marker is present, but no structured bar selection identifies Taco, Wing, or Appetizer Bar.",
      requiresReview: true,
      scope: "event",
    });
  }

  if (packageMarkers.length === 0 && selectedBars.length > 0) {
    addWarning(warnings, warningKeys, {
      code: "BAR_WITHOUT_PACKAGE_MARKER",
      message:
        "A bar selection is present without The Full Course or The Front Nine; the written rule classifies this event as platter-only.",
      requiresReview: true,
      scope: "event",
    });
  }

  for (const selection of selections) {
    if (
      selection.kinds.length === 0 &&
      selection.isFood === true
    ) {
      addWarning(warnings, warningKeys, {
        code: "UNKNOWN_FOOD_ITEM",
        message: `Unknown structured food item: ${selection.originalName}.`,
        requiresReview: true,
        scope: "selection",
        selectionName: selection.originalName,
      });
      if (LEGACY_REFERENCE_FOODS.has(selection.normalizedName)) {
        activateConflict("LEGACY_MENU_ITEMS", false);
      }
    }

    const requiresExplicitQuantity = selection.kinds.some((kind) =>
      kind.startsWith("platter:"),
    );
    if (requiresExplicitQuantity && !selection.quantityProvided) {
      addWarning(warnings, warningKeys, {
        code: "INVALID_SELECTION_QUANTITY",
        message: `${selection.originalName} is missing its required platter quantity.`,
        requiresReview: true,
        scope: "selection",
        selectionName: selection.originalName,
      });
    } else if (
      selection.kinds.length > 0 &&
      !validSelectionQuantity(selection.quantity)
    ) {
      addWarning(warnings, warningKeys, {
        code: "INVALID_SELECTION_QUANTITY",
        message: `${selection.originalName} has an invalid quantity; a positive whole number is required.`,
        requiresReview: true,
        scope: "selection",
        selectionName: selection.originalName,
      });
    }
  }

  if (
    !selections.some(isKnownFoodSelection) &&
    liveAddOnEffects.length === 0
  ) {
    addWarning(warnings, warningKeys, {
      code: "NO_FOOD_SELECTIONS",
      message:
        "No structured food/menu selections were provided for this definite event.",
      requiresReview: true,
      scope: "event",
    });
  }

  const normalizedStatus = sourceEvent.status
    ? normalizeKitchenText(sourceEvent.status)
    : "";
  const definiteVerified =
    sourceEvent.statusVerified === true ||
    (sourceEvent.statusVerified !== false &&
      config.definiteStatuses.includes(normalizedStatus));
  if (!definiteVerified) {
    addWarning(warnings, warningKeys, {
      code: "DEFINITE_STATUS_UNVERIFIED",
      message: "The event's approved definite status could not be verified.",
      requiresReview: true,
      scope: "event",
    });
  }

  if (effectiveGuestCount == null) {
    addWarning(warnings, warningKeys, {
      code: "MISSING_GUEST_COUNT",
      message: "Guest count is missing.",
      requiresReview: true,
      scope: "event",
    });
  } else if (!validGuestCount(effectiveGuestCount)) {
    addWarning(warnings, warningKeys, {
      code: "INVALID_GUEST_COUNT",
      message: "Guest count must be a positive whole number.",
      requiresReview: true,
      scope: "event",
    });
  }

  if (sourceEvent.sourceState === "stale") {
    addWarning(warnings, warningKeys, {
      code: "SOURCE_STALE",
      message: "The Tripleseat source snapshot is stale.",
      requiresReview: true,
      scope: "event",
    });
  } else if (sourceEvent.sourceState === "sync-failed") {
    addWarning(warnings, warningKeys, {
      code: "SOURCE_SYNC_FAILED",
      message: "The latest Tripleseat sync failed.",
      requiresReview: true,
      scope: "event",
    });
  }

  const specialNotes = (sourceEvent.specialNotes ?? [])
    .map((note) => note.trim())
    .filter(Boolean);
  const foodNotes = (sourceEvent.foodNotes ?? []).flatMap((note) => {
    const text = note.text.trim();
    return text ? [{ ...note, text }] : [];
  });
  for (const note of foodNotes) {
    addWarning(warnings, warningKeys, {
      code: "SPECIAL_NOTE_REQUIRES_REVIEW",
      message: `Food contract note requires kitchen review: ${note.text}`,
      requiresReview: true,
      scope: "event",
    });
  }
  for (const note of specialNotes) {
    addWarning(warnings, warningKeys, {
      code: "SPECIAL_NOTE_REQUIRES_REVIEW",
      message: `Special contract note requires kitchen review: ${note}`,
      requiresReview: true,
      scope: "event",
    });
  }

  let barQuantitiesApproved = true;

  if (activeBars.includes("taco")) {
    const guestCount = effectiveGuestCount;
    const batchCount = validGuestCount(guestCount)
      ? getTacoBatchCount(guestCount, config)
      : null;

    if (validGuestCount(guestCount) && batchCount == null) {
      barQuantitiesApproved = false;
      addWarning(warnings, warningKeys, {
        code: "GUEST_COUNT_OUT_OF_RANGE",
        message: `Taco Bar is approved only through ${config.taco.maxGuests} guests.`,
        requiresReview: true,
        scope: "event",
      });
    } else if (batchCount != null && validGuestCount(guestCount)) {
      addRow({
        key: "taco-beef",
        category: "taco",
        foodName: "Beef",
        quantity: batchCount * config.taco.beefPoundsPerBatch,
        unit: "pounds",
        numberOfPans: batchCount * config.taco.beefPansPerBatch,
        panSize: config.taco.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.tacoBeef,
        },
      });
      addRow({
        key: "taco-chicken",
        category: "taco",
        foodName: "Chicken",
        quantity: batchCount * config.taco.chickenPoundsPerBatch,
        unit: "pounds",
        numberOfPans: getRequiredPanCount(
          batchCount * config.taco.chickenPoundsPerBatch,
          config.taco.chickenPoundsPerPan,
        ),
        panSize: config.taco.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.tacoChicken,
        },
      });
      addRow({
        key: "taco-black-beans",
        category: "taco",
        foodName: "Black Beans",
        quantity: batchCount * config.taco.beanRecipesPerBatch,
        unit: "recipes",
        numberOfPans: batchCount * config.taco.beanPansPerBatch,
        panSize: config.taco.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.tacoBlackBeans,
        },
      });
      addRow({
        key: "taco-tortillas",
        category: "taco",
        foodName: "Tortillas",
        quantity: Math.ceil(
          guestCount / config.taco.tortillaGuestsPerPack,
        ),
        unit: "packs",
        numberOfPans: null,
        panSize: null,
        prepTiming: { kind: "not-applicable" },
      });
      addRow({
        key: "taco-lettuce-wraps",
        category: "taco",
        foodName: "Lettuce Wraps",
        quantity: guestCount,
        unit: "wraps",
        numberOfPans: null,
        panSize: null,
        prepTiming: { kind: "not-applicable" },
      });
      addRow({
        key: "taco-cold-sides",
        category: "taco",
        foodName: "Cold Side Sets",
        quantity: batchCount,
        unit: "complete sets",
        numberOfPans: null,
        panSize: null,
        prepTiming: { kind: "not-applicable" },
      });
      activateConflict("TORTILLA_RANGE_TYPOS", true);
    } else {
      barQuantitiesApproved = false;
    }
  }

  if (
    hasKind(selections, "option:taco-lettuce-wraps") &&
    !activeBars.includes("taco")
  ) {
    addWarning(warnings, warningKeys, {
      code: "UNKNOWN_FOOD_ITEM",
      message:
        "Lettuce Wraps were selected without an approved Taco Bar package.",
      requiresReview: true,
      scope: "selection",
      selectionName: "Lettuce Wraps",
    });
  }

  if (activeBars.includes("wing")) {
    const guestCount = effectiveGuestCount;
    const groupCount = validGuestCount(guestCount)
      ? getStartedGroupCount(
          guestCount,
          config.wing.guestsPerGroup,
          config.wing.maxGuests,
        )
      : null;

    if (validGuestCount(guestCount) && groupCount == null) {
      barQuantitiesApproved = false;
      addWarning(warnings, warningKeys, {
        code: "GUEST_COUNT_OUT_OF_RANGE",
        message: `Wing Bar is approved only through ${config.wing.maxGuests} guests.`,
        requiresReview: true,
        scope: "event",
      });
    } else if (groupCount != null && validGuestCount(guestCount)) {
      const wingQuantity = guestCount * config.wing.wingsPerGuest;
      const wingCapacity = config.panCapacities.wings;
      addRow({
        key: "wing-wings",
        category: "wing",
        foodName: "Wings",
        quantity: wingQuantity,
        unit: "each",
        numberOfPans: getRequiredPanCount(
          wingQuantity,
          wingCapacity.amountPerPan,
        ),
        panSize: wingCapacity.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.wings,
        },
      });
      addRow({
        key: "wing-celery",
        category: "wing",
        foodName: "Celery",
        quantity: guestCount * config.wing.celeryHalfSticksPerGuest,
        unit: "half-sticks",
        numberOfPans: null,
        panSize: null,
        prepTiming: { kind: "not-applicable" },
      });
      addRow({
        key: "wing-fries",
        category: "wing",
        foodName: "Fries",
        quantity: groupCount * config.wing.friesPoundsPerGroup,
        unit: "pounds",
        numberOfPans: groupCount * config.wing.friesPansPerGroup,
        panSize: config.wing.friesPanSize,
        prepTiming: { kind: "unresolved" },
      });
      requiredSauces.add("ranch");
      addUnresolvedSauceSource("ranch", "Wing Bar");
      activateConflict("WING_HIGH_COUNT_COPY_ERROR", false);
      activateConflict("WING_CELERY_HALF_VS_ONE", false);
      activateConflict("WING_RANCH_VS_BLUE_CHEESE", false);
      activateConflict("CHECKLIST_PAN_SIZE_OPTIONS", true);
    } else {
      barQuantitiesApproved = false;
    }
  }

  if (activeBars.includes("appetizer")) {
    requiredSauces.add("marinara");
    requiredSauces.add("ranch");
    addApprovedSauceBowls(
      "marinara",
      config.appetizer.marinaraBowlsPerBar,
    );
    addApprovedSauceBowls(
      "ranch",
      config.appetizer.ranchBowlsPerBar,
    );
    activateConflict("MARINARA_EIGHT_OUNCES", false);

    const guestCount = effectiveGuestCount;
    const groupCount = validGuestCount(guestCount)
      ? getStartedGroupCount(
          guestCount,
          config.appetizer.guestsPerGroup,
          config.appetizer.maxGuests,
        )
      : null;

    if (validGuestCount(guestCount) && groupCount == null) {
      barQuantitiesApproved = false;
      addWarning(warnings, warningKeys, {
        code: "GUEST_COUNT_OUT_OF_RANGE",
        message: `Appetizer Bar is approved only through ${config.appetizer.maxGuests} guests.`,
        requiresReview: true,
        scope: "event",
      });
    } else if (groupCount != null) {
      const taterKegQuantity =
        groupCount * config.appetizer.taterKegsPerGroup;
      const mozzarellaQuantity =
        groupCount * config.appetizer.mozzarellaPoundsPerGroup;
      const chickenTenderQuantity =
        groupCount * config.appetizer.chickenTendersPerGroup;
      const taterKegCapacity = config.panCapacities.taterKegs;
      const mozzarellaCapacity =
        config.panCapacities.mozzarellaSticks;
      const chickenTenderCapacity =
        config.panCapacities.chickenTenders;
      addRow({
        key: "appetizer-tater-kegs",
        category: "appetizer",
        foodName: "Tater Kegs",
        quantity: taterKegQuantity,
        unit: "each",
        numberOfPans: getRequiredPanCount(
          taterKegQuantity,
          taterKegCapacity.amountPerPan,
        ),
        panSize: taterKegCapacity.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.taterKegs,
        },
      });
      addRow({
        key: "appetizer-mozzarella-sticks",
        category: "appetizer",
        foodName: "Mozzarella Sticks",
        quantity: mozzarellaQuantity,
        unit: "pounds",
        numberOfPans: getRequiredPanCount(
          mozzarellaQuantity,
          mozzarellaCapacity.amountPerPan,
        ),
        panSize: mozzarellaCapacity.panSize,
        prepTiming: { kind: "unresolved" },
      });
      addRow({
        key: "appetizer-chicken-tenders",
        category: "appetizer",
        foodName: "Chicken Tenders",
        quantity: chickenTenderQuantity,
        unit: "each",
        numberOfPans: getRequiredPanCount(
          chickenTenderQuantity,
          chickenTenderCapacity.amountPerPan,
        ),
        panSize: chickenTenderCapacity.panSize,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.chickenTenders,
        },
      });
      activateConflict("CHECKLIST_PAN_SIZE_OPTIONS", false);
    } else {
      barQuantitiesApproved = false;
    }
  }

  const dessertSelections = selectionsWithKind(selections, "dessert").filter(
    (selection) => validSelectionQuantity(selection.quantity),
  );
  const explicitDessertCount = dessertSelections
    .filter(
      (selection) =>
        selection.quantityProvided &&
        !selection.kinds.some((kind) => kind.startsWith("package:")),
    )
    .reduce((sum, selection) => sum + selection.quantity, 0);
  const calculatedDessertCount = validGuestCount(effectiveGuestCount)
    ? Math.ceil(
        effectiveGuestCount / config.dessertGuestsPerPlatter,
      )
    : null;
  const dessertCount =
    explicitDessertCount > 0
      ? explicitDessertCount
      : calculatedDessertCount;
  if (
    dessertSelections.length > 0 &&
    dessertCount != null
  ) {
    addRow({
      key: "dessert-platter",
      category: "dessert",
      foodName: "Assorted Desserts",
      quantity: dessertCount,
      unit: "pretzel plates",
      numberOfPans: null,
      panSize: null,
      prepTiming: {
        kind: "minutes-before-food-ready",
        minutes: config.prepLeadMinutes.dessert,
      },
    });
    if (explicitDessertCount === 0) {
      activateConflict("DESSERT_30_VS_35", true);
    }
  }

  const platterCounts = new Map<PlatterSelectionKind, number>();
  for (const kind of PLATTER_KIND_ORDER) {
    const kindSelections = selectionsWithKind(selections, kind);
    let total = 0;
    for (const selection of kindSelections) {
      if (
        selection.quantityProvided &&
        validSelectionQuantity(selection.quantity)
      ) {
        total += selection.quantity;
      }
    }
    if (total > 0) {
      platterCounts.set(kind, total);
    }
  }

  const packingItems: PlatterPackingItem[] = [];
  for (const kind of PLATTER_KIND_ORDER) {
    const platterCount = platterCounts.get(kind);
    if (platterCount == null) {
      continue;
    }

    if (
      platterCount < config.platter.minQuantity ||
      platterCount > config.platter.maxQuantity
    ) {
      addWarning(warnings, warningKeys, {
        code: "UNAPPROVED_PLATTER_QUANTITY",
        message: `${platterCount} ${kind.replace("platter:", "").replaceAll("-", " ")} platters exceed the approved 1-10 multiplier table.`,
        requiresReview: true,
        scope: "selection",
        selectionName: kind,
      });
      continue;
    }

    const rule = config.platter.rules[kind];
    const quantity = rule.amountPerPlatter * platterCount;
    const panCapacity =
      rule.panCapacityKey == null
        ? null
        : config.panCapacities[rule.panCapacityKey];
    addRow({
      key: rule.rowKey,
      category: "platters",
      foodName: rule.foodName,
      quantity,
      unit: rule.unit,
      numberOfPans:
        panCapacity == null
          ? null
          : getRequiredPanCount(quantity, panCapacity.amountPerPan),
      panSize: panCapacity?.panSize ?? null,
      prepTiming: prepForPlatter(rule, config),
    });

    if (rule.hot) {
      packingItems.push({
        key: rule.rowKey as PlatterPackingItem["key"],
        platterCount,
      });
    }

    if (rule.sauce) {
      requiredSauces.add(rule.sauce.name);
      if (rule.sauce.bowlsPerPlatter == null) {
        addUnresolvedSauceSource(rule.sauce.name, rule.foodName);
      } else {
        addApprovedSauceBowls(
          rule.sauce.name,
          rule.sauce.bowlsPerPlatter * platterCount,
        );
      }
    }
    if (rule.rowKey === "platter-mozzarella-sticks") {
      activateConflict("MARINARA_EIGHT_OUNCES", false);
    }
  }

  for (const effect of liveAddOnEffects) {
    if (effect.calculation.kind === "display-only") {
      continue;
    }
    if (effect.calculation.kind === "unresolved-taco-addon") {
      addWarning(warnings, warningKeys, {
        code: "UNRESOLVED_TACO_ADD_ON",
        message: `${effect.item.foodName} has ${effect.item.quantity} requested unit${effect.item.quantity === 1 ? "" : "s"} entered on the Taco Bar add-on sheet, but its kitchen prep, batch, and pan conversion is not approved.`,
        requiresReview: true,
        scope: "item",
        itemKey: effect.item.itemKey,
      });
      continue;
    }
    if (effect.calculation.kind === "approved-sauce") {
      requiredSauces.add(effect.calculation.sauce);
      addApprovedSauceBowls(
        effect.calculation.sauce,
        effect.item.quantity,
      );
      continue;
    }
    if (effect.calculation.kind === "dessert") {
      registerPrepItem({
        itemKey: effect.item.itemKey,
        foodName: effect.item.foodName,
        prepTiming: {
          kind: "minutes-before-food-ready",
          minutes: config.prepLeadMinutes.dessert,
        },
      });
      continue;
    }

    const rule =
      config.platter.rules[effect.calculation.platterKind];
    if (
      effect.sourceQuantity < config.platter.minQuantity ||
      effect.sourceQuantity > config.platter.maxQuantity
    ) {
      addWarning(warnings, warningKeys, {
        code: "UNAPPROVED_PLATTER_QUANTITY",
        message: `${effect.sourceQuantity} live ${effect.item.foodName} add-on platter(s) exceed the approved 1-10 multiplier table.`,
        requiresReview: true,
        scope: "selection",
        itemKey: effect.item.itemKey,
        selectionName: effect.item.foodName,
      });
    }
    registerPrepItem({
      itemKey: effect.item.itemKey,
      foodName: effect.item.foodName,
      prepTiming: prepForPlatter(rule, config),
    });
    if (rule.hot) {
      packingItems.push({
        key: rule.rowKey as PlatterPackingItem["key"],
        platterCount: effect.sourceQuantity,
      });
    }
    if (rule.sauce) {
      requiredSauces.add(rule.sauce.name);
      if (rule.sauce.bowlsPerPlatter == null) {
        addUnresolvedSauceSource(
          rule.sauce.name,
          `live ${rule.foodName} add-on`,
        );
      } else {
        addApprovedSauceBowls(
          rule.sauce.name,
          rule.sauce.bowlsPerPlatter * effect.sourceQuantity,
        );
      }
    }
    if (rule.rowKey === "platter-mozzarella-sticks") {
      activateConflict("MARINARA_EIGHT_OUNCES", false);
    }
  }

  const platterPacking = packHotPlatters(packingItems);
  if (platterPacking.status !== "approved") {
    addWarning(warnings, warningKeys, {
      code: "UNAPPROVED_PLATTER_PACKING",
      message: `Hot-platter packing is approved only for totals 2, 3, 4, and 6; this event has ${platterPacking.totalHotPlatters}.`,
      requiresReview: true,
      scope: "event",
    });
  }

  if (hasKind(selections, "sauce:marinara")) {
    requiredSauces.add("marinara");
    addUnresolvedSauceSource("marinara", "explicit Marinara selection");
  }
  if (hasKind(selections, "sauce:ranch")) {
    requiredSauces.add("ranch");
    addUnresolvedSauceSource("ranch", "explicit Ranch selection");
  }

  const addSauce = (
    sauce: "marinara" | "ranch",
    key: "sauce-marinara" | "sauce-ranch",
    foodName: string,
  ) => {
    if (!requiredSauces.has(sauce)) {
      return;
    }
    const approvedBowlCount = approvedSauceBowlCounts.get(sauce);
    const unresolvedSources = [
      ...(unresolvedSauceBowlSources.get(sauce) ?? []),
    ];
    addRow({
      key,
      category: "sauces",
      foodName,
      quantity: approvedBowlCount ?? null,
      unit:
        approvedBowlCount == null
          ? "quantity needs review"
          : approvedBowlCount === 1
            ? "bowl"
            : "bowls",
      numberOfPans: null,
      panSize: null,
      prepTiming: { kind: "not-applicable" },
    });
    if (approvedBowlCount != null && unresolvedSources.length === 0) {
      return;
    }
    addWarning(warnings, warningKeys, {
      code: "UNRESOLVED_SAUCE_QUANTITY",
      message:
        approvedBowlCount == null
          ? `${foodName} is required, but the number of sauce bowls is not approved.`
          : `${foodName} includes ${approvedBowlCount} approved ${approvedBowlCount === 1 ? "bowl" : "bowls"}, but the additional quantity required for ${unresolvedSources.join(" and ")} is not approved.`,
      requiresReview: true,
      scope: "item",
      itemKey: key,
    });
  };
  addSauce("marinara", "sauce-marinara", "Marinara Sauce");
  addSauce("ranch", "sauce-ranch", "Ranch");
  if (requiredSauces.size > 0) {
    activateConflict("DUPLICATE_SAUCE_ROWS", false);
  }

  let barChafingDishes: number | null = 0;
  if (activeBars.length > 0) {
    if (
      !validGuestCount(effectiveGuestCount) ||
      !barQuantitiesApproved
    ) {
      barChafingDishes = null;
    } else {
      const tablesPerBar =
        effectiveGuestCount > config.barTables.doubleAboveGuestCount
          ? config.barTables.mirroredTablesPerBar
          : config.barTables.normalTablesPerBar;
      barChafingDishes = tablesPerBar * activeBars.length;
      activateConflict("MIRRORED_TABLE_TRIGGER", false);
    }
  }

  const hotPlatterChafingDishes =
    platterPacking.status === "approved"
      ? platterPacking.chafingDishes
      : null;
  const totalChafingDishes =
    barChafingDishes == null || hotPlatterChafingDishes == null
      ? null
      : barChafingDishes + hotPlatterChafingDishes;

  const dateParts = parseDate(sourceEvent.localDate);
  let startEpoch: number | null = null;
  if (!dateParts || sourceEvent.localDateVerified === false) {
    addWarning(warnings, warningKeys, {
      code: "INVALID_EVENT_DATE",
      message: !dateParts
        ? "Event local date must be a valid YYYY-MM-DD value."
        : "The event local date could not be verified from the Tripleseat source; the requested search date is being shown.",
      requiresReview: true,
      scope: "event",
    });
  }

  if (
    !sourceEvent.sourceUpdatedAt ||
    !Number.isFinite(Date.parse(sourceEvent.sourceUpdatedAt))
  ) {
    addWarning(warnings, warningKeys, {
      code: "SOURCE_STALE",
      message:
        "The Tripleseat source-updated timestamp is missing or invalid, so freshness cannot be verified.",
      requiresReview: true,
      scope: "event",
    });
  }

  if (sourceEvent.startTime == null || sourceEvent.startTime.trim() === "") {
    addWarning(warnings, warningKeys, {
      code: "MISSING_START_TIME",
      message: "Event start time is missing.",
      requiresReview: true,
      scope: "event",
    });
  } else {
    startEpoch = sourceStartEpoch(sourceEvent.startTime, dateParts);
    if (
      startEpoch == null &&
      (dateParts != null || parseTime(sourceEvent.startTime) == null)
    ) {
      addWarning(warnings, warningKeys, {
        code: "INVALID_START_TIME",
        message:
          "Event start time must be a valid America/New_York clock time or ISO 8601 timestamp.",
        requiresReview: true,
        scope: "event",
      });
    }
  }

  const foodReadyEpoch =
    startEpoch == null
      ? null
      : startEpoch - config.foodReadyOffsetMinutes * 60_000;
  const prepCandidates: number[] = [];
  if (foodReadyEpoch != null && dateParts != null) {
    for (const item of prepItems) {
      if (item.prepTiming.kind === "minutes-before-food-ready") {
        prepCandidates.push(
          foodReadyEpoch - item.prepTiming.minutes * 60_000,
        );
      } else if (
        item.prepTiming.kind === "kitchen-morning" &&
        item.prepTiming.localTime != null
      ) {
        const morningParts = parseTime(item.prepTiming.localTime);
        const morningEpoch = morningParts
          ? localDateTimeToEpoch(dateParts, morningParts)
          : null;
        if (morningEpoch != null) {
          prepCandidates.push(morningEpoch);
        } else {
          addWarning(warnings, warningKeys, {
            code: "UNCONFIGURED_KITCHEN_MORNING",
            message:
              "The configured kitchen morning time is not a valid local time.",
            requiresReview: true,
            scope: "configuration",
            itemKey: item.itemKey,
          });
        }
      }
    }
  }
  const earliestPrepEpoch =
    prepCandidates.length > 0 ? Math.min(...prepCandidates) : null;

  const sectionCategories = CATEGORY_ORDER.filter(
    (category) => (rowsByCategory.get(category)?.length ?? 0) > 0,
  );
  const semanticCategories = new Set(sectionCategories);
  for (const effect of liveAddOnEffects) {
    if (effect.calculation.kind === "platter") {
      semanticCategories.add("platters");
    } else if (effect.calculation.kind === "dessert") {
      semanticCategories.add("dessert");
    } else if (effect.calculation.kind === "unresolved-taco-addon") {
      semanticCategories.add("taco");
    } else {
      semanticCategories.add("sauces");
    }
  }
  const selectedCategories = CATEGORY_ORDER.filter((category) =>
    semanticCategories.has(category),
  );
  const sections = sectionCategories.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rows: rowsByCategory.get(category) ?? [],
  }));

  for (const [code, requiresReview] of activeConflictCodes) {
    const conflict = config.referenceConflicts.find(
      (candidate) => candidate.code === code,
    );
    if (conflict) {
      addReferenceWarning(
        conflict,
        warnings,
        warningKeys,
        requiresReview,
      );
    }
  }

  return {
    ruleVersion: config.ruleVersion,
    timezone: KITCHEN_TIME_ZONE,
    event: {
      eventId: sourceEvent.eventId,
      bookingId: sourceEvent.bookingId ?? null,
      name: sourceEvent.eventName,
      localDate: sourceEvent.localDate,
      startTime: sourceEvent.startTime,
      endTime: sourceEvent.endTime ?? null,
      guestCount: effectiveGuestCount,
      guestCountSource: guestCountResolution.source,
      status: sourceEvent.status,
      room: sourceEvent.room ?? null,
      sourceUpdatedAt: sourceEvent.sourceUpdatedAt ?? null,
      foodNotes,
      specialNotes,
    },
    foodRunnerOrBwa: "",
    classification,
    packageMarkers,
    selectedBars,
    selectedCategories,
    normalizedSelections: selections,
    timing: {
      startTime:
        startEpoch == null ? null : formatLocalDateTime(startEpoch),
      foodReadyBy:
        foodReadyEpoch == null
          ? null
          : formatLocalDateTime(foodReadyEpoch),
      earliestPrepTime:
        earliestPrepEpoch == null
          ? null
          : formatLocalDateTime(earliestPrepEpoch),
    },
    sections,
    liveFoodAddOns: liveFoodAddOns.map((item) => ({ ...item })),
    completedItemKeys: [],
    finalCompletedItemKeys: [],
    chafingDishes: {
      bars: barChafingDishes,
      hotPlatters: hotPlatterChafingDishes,
      total: totalChafingDishes,
    },
    warnings,
    referenceConflicts: config.referenceConflicts.filter((conflict) =>
      activeConflictCodes.has(conflict.code),
    ),
    needsReview: warnings.some((warning) => warning.requiresReview),
  };
}
