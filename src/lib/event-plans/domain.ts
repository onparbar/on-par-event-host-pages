import {
  canonicalCategoryForText,
  deterministicEventColor,
  exactResourceIdsForText,
  getEntertainmentResource,
  isAmbiguousLaneText,
  quantityForText,
} from "@/lib/entertainment/resources";
import {
  formatClock,
  isValidEntertainmentDate,
  localDateForIso,
  parseTimeRange,
} from "@/lib/entertainment/time";
import type {
  EntertainmentCategory,
  EntertainmentSourceItem,
} from "@/lib/entertainment/types";
import { normalizeKitchenSelection } from "@/lib/kitchen/normalize";
import type { KitchenSourceSelection } from "@/lib/kitchen/types";

import {
  EVENT_PLAN_RULE_VERSION,
  EVENT_PLAN_TIME_ZONE,
  type EventPlan,
  type EventPlanEntertainmentItem,
  type EventPlanOperationalNote,
  type TripleseatEventPlanSource,
} from "./types";

export class EventPlanMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventPlanMappingError";
  }
}

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedText(value: string) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .toLocaleLowerCase("en-US");
}

function uniqueText(values: readonly string[]) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const cleaned = cleanText(value);
    const key = normalizedText(cleaned);
    if (!cleaned || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [cleaned];
  });
}

function exactNumericEventId(value: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new EventPlanMappingError(
      "Tripleseat event ID must be an exact positive numeric ID.",
    );
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || String(id) !== value) {
    throw new EventPlanMappingError(
      "Tripleseat event ID must be an exact safe numeric ID.",
    );
  }
  return id;
}

function categoryText(value: string | null | undefined) {
  return value ? normalizedText(value).replace(/[^a-z0-9]+/g, " ") : "";
}

function isFoodCategory(value: string | null | undefined) {
  const category = categoryText(value);
  return (
    category === "food" ||
    category === "menu" ||
    category.startsWith("food ") ||
    category.endsWith(" food") ||
    category === "dessert" ||
    category === "desserts" ||
    category === "taco bar" ||
    category === "wing bar" ||
    category === "appetizer bar"
  );
}

function isDrinkCategory(value: string | null | undefined) {
  return /\b(?:beverages?|drinks?)\b/.test(categoryText(value));
}

function isEntertainmentCategory(value: string | null | undefined) {
  return /\b(?:entertainment|activities|activity)\b/.test(
    categoryText(value),
  );
}

function packageDrinkLabel(value: string) {
  const normalized = normalizedText(value);
  if (
    normalized.includes("food + beverage") ||
    normalized.includes("food and beverage") ||
    (normalized.startsWith("the full course") &&
      !normalized.includes("food only"))
  ) {
    return "Food + Beverage package";
  }
  if (
    normalized.includes("drink card") ||
    normalized.startsWith("the back nine")
  ) {
    return cleanText(value);
  }
  if (
    normalized.includes("soft drinks included") ||
    normalized.includes("soft drinks free of charge")
  ) {
    return cleanText(value);
  }
  return null;
}

type ClassifiedDetails = {
  food: string[];
  drinks: string[];
  reviewReasons: string[];
};

function classifySelection(
  selection: KitchenSourceSelection,
  result: ClassifiedDetails,
) {
  const name = cleanText(selection.name);
  if (!name) {
    result.reviewReasons.push(
      "A structured Tripleseat selection has no item name.",
    );
    return;
  }

  const normalized = normalizeKitchenSelection(selection);
  const knownFood = normalized.kinds.length > 0;
  const foodCategory = isFoodCategory(selection.sourceCategory);
  const drinkCategory = isDrinkCategory(selection.sourceCategory);

  if (
    selection.isFood !== false &&
    (selection.isFood === true || foodCategory || knownFood)
  ) {
    result.food.push(name);
  }
  if (drinkCategory) {
    result.drinks.push(name);
  } else {
    const packageDrink = packageDrinkLabel(name);
    if (packageDrink) {
      result.drinks.push(packageDrink);
    }
  }

  if (
    selection.isFood !== false &&
    !foodCategory &&
    !drinkCategory &&
    !knownFood &&
    canonicalCategoryForText(
      [selection.sourceCategory, selection.name].filter(Boolean).join(" "),
    ) == null
  ) {
    result.reviewReasons.push(
      `Structured selection "${name}" is not mapped to food, drink, or entertainment.`,
    );
  }
}

function documentItemText(item: EntertainmentSourceItem) {
  return [item.categoryName, item.name, item.description]
    .filter(Boolean)
    .join(" ");
}

function classifyDocumentItem(
  item: EntertainmentSourceItem,
  result: ClassifiedDetails,
) {
  const name = cleanText(item.name);
  if (!name) {
    return;
  }

  if (isFoodCategory(item.categoryName)) {
    result.food.push(name);
  }
  if (isDrinkCategory(item.categoryName)) {
    result.drinks.push(name);
  } else {
    const packageDrink = packageDrinkLabel(name);
    if (packageDrink && isFoodCategory(item.categoryName)) {
      result.drinks.push(packageDrink);
    }
  }
}

function classifyFoodAndDrinks(source: TripleseatEventPlanSource) {
  const result: ClassifiedDetails = {
    food: [],
    drinks: [],
    reviewReasons: [],
  };

  source.selections.forEach((selection) =>
    classifySelection(selection, result),
  );
  source.documentItems.forEach((item) =>
    classifyDocumentItem(item, result),
  );

  return {
    food: uniqueText(result.food),
    drinks: uniqueText(result.drinks),
    reviewReasons: uniqueText(result.reviewReasons),
  };
}

function validTimeRange(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) {
    return null;
  }
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { startAt, endAt }
    : null;
}

function formattedTimeRange(startAt: string, endAt: string) {
  return `${formatClock(startAt)} - ${formatClock(endAt)}`;
}

function formattedDuration(startAt: string, endAt: string) {
  const totalMinutes = Math.round(
    (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if (minutes) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  return parts.join(" ") || "Duration not listed on BEO";
}

function textualDuration(value: string) {
  const match = value.match(
    /\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|holes?)\b/i,
  );
  if (!match) {
    return null;
  }
  const unit = match[2].toLocaleLowerCase("en-US");
  const normalizedUnit = unit.startsWith("h")
    ? Number(match[1]) === 1
      ? "hour"
      : "hours"
    : unit.startsWith("m")
      ? Number(match[1]) === 1
        ? "minute"
        : "minutes"
      : Number(match[1]) === 1
        ? "hole"
        : "holes";
  return `${match[1]} ${normalizedUnit}`;
}

function isLaneRentalDurationDetail(
  value: string,
  category: EntertainmentCategory,
) {
  if (category !== "bowling" && category !== "darts") {
    return false;
  }
  const activity = category === "bowling" ? "bowling" : "dart";
  return new RegExp(
    `\\b\\d+(?:\\.\\d+)?\\s*hours?\\s+${activity}\\s+lane\\s+rental\\b`,
  ).test(normalizedText(value));
}

function extraLaneHours(
  value: string,
  category: EntertainmentCategory,
) {
  if (category !== "bowling" && category !== "darts") {
    return null;
  }
  const activity =
    category === "bowling" ? "(?:duckpin\\s+)?bowling" : "darts?";
  const match = normalizedText(value).match(
    new RegExp(`\\b(?:(\\d+)\\s+)?extra\\s+hours?\\s+of\\s+${activity}\\b`),
  );
  return match ? Number(match[1] ?? 1) : null;
}

function addHoursToDuration(value: string, additionalHours: number) {
  const match = value.match(/^(\d+(?:\.\d+)?)\s+hours?$/);
  if (!match || !Number.isInteger(additionalHours) || additionalHours <= 0) {
    return null;
  }
  const totalHours = Number(match[1]) + additionalHours;
  return `${totalHours} hour${totalHours === 1 ? "" : "s"}`;
}

function entertainmentName(
  category: EntertainmentCategory,
  exactResourceIds: readonly string[],
) {
  if (category === "private-rooms" && exactResourceIds.length === 1) {
    return (
      getEntertainmentResource(exactResourceIds[0])?.canonicalName ??
      "Private Room"
    );
  }
  return {
    bowling: "Duckpin Bowling",
    darts: "Darts",
    pool: "Pool Tables",
    shuffleboard: "Neo Shuffleboard",
    "mini-golf": "Mini Golf",
    "private-rooms": "Private Rooms",
  }[category];
}

function quantityLabel(
  category: EntertainmentCategory,
  quantity: number | null,
  exactResourceIds: readonly string[],
) {
  if (exactResourceIds.length) {
    return exactResourceIds
      .map(
        (resourceId) =>
          getEntertainmentResource(resourceId)?.canonicalName ?? resourceId,
      )
      .join(", ");
  }
  if (quantity == null) {
    return "Quantity not listed on BEO";
  }
  const noun = {
    bowling: "lane",
    darts: "lane",
    pool: "table",
    shuffleboard: "table",
    "mini-golf": "course",
    "private-rooms": "room",
  }[category];
  return `${quantity} ${noun}${quantity === 1 ? "" : "s"}`;
}

type EntertainmentMapping = {
  items: EventPlanEntertainmentItem[];
  evidence: EventPlanEntertainmentEvidence[];
  reviewReasons: string[];
};

export type EventPlanEntertainmentEvidence = {
  item: EventPlanEntertainmentItem;
  sourceId: string;
  sourceText: string;
  sourceType: "selection" | "document-line";
};

function mapEntertainment(source: TripleseatEventPlanSource) {
  const reviewReasons: string[] = [];
  const mappedItems: Array<
    EventPlanEntertainmentEvidence & {
      category: EntertainmentCategory;
      numericQuantity: number | null;
      sourceName: string;
    }
  > = [];

  const selectionItems = source.selections.flatMap((selection, index) => {
    const normalized = normalizeKitchenSelection(selection);
    if (
      selection.isFood === true ||
      isFoodCategory(selection.sourceCategory) ||
      isDrinkCategory(selection.sourceCategory) ||
      normalized.kinds.length > 0
    ) {
      return [];
    }
    const text = [selection.sourceCategory, selection.name]
      .filter(Boolean)
      .join(" ");
    return canonicalCategoryForText(text)
      ? [
          {
            item: {
              sourceId: String(selection.sourceId ?? `selection-${index}`),
              name: selection.name,
              description: null,
              categoryName: selection.sourceCategory ?? null,
              quantity: selection.quantity ?? null,
              startAt: null,
              endAt: null,
            } satisfies EntertainmentSourceItem,
            sourceType: "selection" as const,
          },
        ]
      : [];
  });
  const documentItems = source.documentItems.filter(
    (item) =>
      !isFoodCategory(item.categoryName) &&
      !isDrinkCategory(item.categoryName),
  ).map((item) => ({ item, sourceType: "document-line" as const }));

  for (const candidate of [...documentItems, ...selectionItems]) {
    const { item } = candidate;
    const text = documentItemText(item);
    const category = canonicalCategoryForText(text);
    if (!category) {
      if (
        isEntertainmentCategory(item.categoryName) ||
        isAmbiguousLaneText(text)
      ) {
        reviewReasons.push(
          `Entertainment item "${cleanText(item.name)}" is ambiguous or unmapped.`,
        );
      }
      continue;
    }

    const exactResourceIds = exactResourceIdsForText(text, category);
    const quantity = quantityForText(text, category, item.quantity);
    const explicitRange = validTimeRange(item.startAt, item.endAt);
    const parsedRange =
      !explicitRange && isValidEntertainmentDate(source.localDate)
        ? parseTimeRange(text, source.localDate)
        : null;
    const range = explicitRange ?? parsedRange;
    const duration = range
      ? formattedDuration(range.startAt, range.endAt)
      : textualDuration(text) ?? "Duration not listed on BEO";
    const structuredRange = item.startAt && item.endAt
      ? `Start ${item.startAt}; end ${item.endAt}`
      : null;
    const candidateSourceText = [item.description || item.name, structuredRange]
      .filter(Boolean)
      .join(" · ");
    const previous = mappedItems.at(-1);
    const quantitiesMatch =
      previous != null &&
      (previous.numericQuantity == null ||
        quantity == null ||
        previous.numericQuantity === quantity);
    const canMergeWithPrevious =
      previous != null &&
      previous.category === category &&
      previous.sourceType === candidate.sourceType &&
      quantitiesMatch &&
      range == null;
    const appendEvidence = () => {
      if (!previous) return;
      previous.sourceText = uniqueText([
        previous.sourceText,
        `${item.sourceId}: ${candidateSourceText}`,
      ]).join(" · ");
    };

    if (
      canMergeWithPrevious &&
      previous.item.duration === "Duration not listed on BEO" &&
      duration !== "Duration not listed on BEO" &&
      isLaneRentalDurationDetail(text, category)
    ) {
      previous.item.duration = duration;
      if (previous.numericQuantity == null && quantity != null) {
        previous.numericQuantity = quantity;
        previous.item.quantity = quantityLabel(category, quantity, exactResourceIds);
      }
      appendEvidence();
      continue;
    }

    const additionalHours = extraLaneHours(text, category);
    const extendedDuration =
      canMergeWithPrevious && additionalHours != null
        ? addHoursToDuration(previous.item.duration, additionalHours)
        : null;
    if (previous && extendedDuration) {
      previous.item.duration = extendedDuration;
      appendEvidence();
      continue;
    }

    const mappedItem = {
      name: entertainmentName(category, exactResourceIds),
      quantity: quantityLabel(category, quantity, exactResourceIds),
      time: range
        ? formattedTimeRange(range.startAt, range.endAt)
        : "Time not listed on BEO",
      duration,
    } satisfies EventPlanEntertainmentItem;
    mappedItems.push({
      item: mappedItem,
      sourceId: item.sourceId,
      sourceText: candidateSourceText,
      sourceType: candidate.sourceType,
      category,
      numericQuantity: quantity,
      sourceName: cleanText(item.name),
    });
  }

  const seen = new Set<string>();
  const uniqueMappedItems = mappedItems.filter(({ item }) => {
    const key = [item.name, item.quantity, item.time, item.duration]
      .map(normalizedText)
      .join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  for (const mapped of uniqueMappedItems) {
    if (mapped.item.quantity === "Quantity not listed on BEO") {
      reviewReasons.push(
        `Entertainment quantity is missing for "${mapped.sourceName}".`,
      );
    }
    if (mapped.item.time === "Time not listed on BEO") {
      reviewReasons.push(
        `Entertainment time is missing for "${mapped.sourceName}".`,
      );
    }
    if (mapped.item.duration === "Duration not listed on BEO") {
      reviewReasons.push(
        `Entertainment duration is missing for "${mapped.sourceName}".`,
      );
    }
  }
  return {
    items: uniqueMappedItems.map(({ item }) => item),
    evidence: uniqueMappedItems.map(
      ({ item, sourceId, sourceText, sourceType }) => ({
        item,
        sourceId,
        sourceText,
        sourceType,
      }),
    ),
    reviewReasons: uniqueText(reviewReasons),
  };
}

export function entertainmentEvidenceForSource(
  source: TripleseatEventPlanSource,
) {
  return mapEntertainment(source).evidence;
}

function cleanOperationalNotes(
  notes: readonly EventPlanOperationalNote[],
) {
  const seen = new Set<string>();
  return notes.flatMap((note) => {
    const text = cleanText(note.text);
    const key = normalizedText(text);
    if (!text || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{ ...note, text }];
  });
}

function dayForDate(date: string) {
  if (!isValidEntertainmentDate(date)) {
    return "Needs Review";
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: EVENT_PLAN_TIME_ZONE,
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function eventTime(
  source: TripleseatEventPlanSource,
  reviewReasons: string[],
) {
  const range = validTimeRange(source.eventStartAt, source.eventEndAt);
  if (!range) {
    reviewReasons.push("Event start or end time is missing or invalid.");
    return "Time not listed on BEO";
  }
  if (
    isValidEntertainmentDate(source.localDate) &&
    localDateForIso(range.startAt, EVENT_PLAN_TIME_ZONE) !== source.localDate
  ) {
    reviewReasons.push(
      "Event start time does not match the Tripleseat local event date.",
    );
  }
  return formattedTimeRange(range.startAt, range.endAt);
}

function legacyPlanForId(
  id: number,
  legacyPlans: readonly EventPlan[],
) {
  return legacyPlans.find((plan) => plan.id === id) ?? null;
}

function structuredPackageGuestCount(
  source: TripleseatEventPlanSource,
): number | null {
  if (source.guestCount != null) return null;

  const candidates = source.selections
    .map(normalizeKitchenSelection)
    .filter(
      (selection) =>
        selection.quantityProvided &&
        selection.kinds.some((kind) => kind.startsWith("bar:")) &&
        selection.kinds.some((kind) => kind.startsWith("package:")),
    );
  if (
    candidates.length === 0 ||
    candidates.some(
      (selection) =>
        !Number.isInteger(selection.quantity) || selection.quantity <= 0,
    )
  ) {
    return null;
  }

  const quantities = new Set(candidates.map((selection) => selection.quantity));
  return quantities.size === 1 ? candidates[0].quantity : null;
}

export function buildEventPlan(
  source: TripleseatEventPlanSource,
  legacyPlans: readonly EventPlan[] = [],
): EventPlan {
  const id = exactNumericEventId(source.eventId);
  const reviewReasons: string[] = [];
  const name = cleanText(source.eventName) || "Unnamed event";
  const date = source.localDate;
  const rooms = uniqueText(source.rooms);
  const operationalNotes = cleanOperationalNotes(source.operationalNotes);
  const classified = classifyFoodAndDrinks(source);
  const mappedEntertainment = mapEntertainment(source);
  const legacy = legacyPlanForId(id, legacyPlans);
  const packageGuestCount = structuredPackageGuestCount(source);

  let food = classified.food;
  let drinkOptions = classified.drinks;
  let entertainment = mappedEntertainment.items;
  let specialInstructions = operationalNotes.map((note) => note.text);

  reviewReasons.push(
    ...classified.reviewReasons,
    ...mappedEntertainment.reviewReasons,
  );

  if (name === "Unnamed event") {
    reviewReasons.push("Event name is missing.");
  }
  if (!isValidEntertainmentDate(date)) {
    reviewReasons.push("Event date is missing or invalid.");
  }
  if (
    source.guestCount == null ||
    !Number.isInteger(source.guestCount) ||
    source.guestCount <= 0
  ) {
    reviewReasons.push("Guest count is missing or invalid.");
    if (packageGuestCount != null) {
      reviewReasons.push(
        "Guest count was filled from the exact structured Tripleseat package selection quantity because the event-level guest count is missing.",
      );
    }
  }
  if (!rooms.length) {
    reviewReasons.push("Room or area is missing.");
  }
  if (!source.status) {
    reviewReasons.push("Tripleseat event status is missing.");
  } else if (
    source.status.toLocaleUpperCase("en-US") !== "DEFINITE"
  ) {
    reviewReasons.push(
      `Tripleseat event status "${cleanText(source.status)}" is not DEFINITE.`,
    );
  }
  if (!source.sourceUpdatedAt) {
    reviewReasons.push("Tripleseat source update timestamp is missing.");
  }
  if (source.operationalNotesAvailable === false) {
    reviewReasons.push(
      "Tripleseat event notes were unavailable; review the source event for details not present on the contract.",
    );
  }
  if (source.operationalNotesTruncated) {
    reviewReasons.push(
      "Tripleseat operational notes were truncated; review the source event for complete details.",
    );
  }
  if (
    source.omittedOperationalNoteFragmentCount != null &&
    source.omittedOperationalNoteFragmentCount > 0
  ) {
    reviewReasons.push(
      `${source.omittedOperationalNoteFragmentCount} operational note fragment${source.omittedOperationalNoteFragmentCount === 1 ? " was" : "s were"} omitted; review the source event for complete details.`,
    );
  }
  if (
    source.shortenedOperationalNoteFragmentCount != null &&
    source.shortenedOperationalNoteFragmentCount > 0
  ) {
    reviewReasons.push(
      `${source.shortenedOperationalNoteFragmentCount} operational note fragment${source.shortenedOperationalNoteFragmentCount === 1 ? " was" : "s were"} shortened; review the source event for complete details.`,
    );
  }

  const time = eventTime(source, reviewReasons);

  if (!food.length && legacy?.food.length) {
    food = [...legacy.food];
    reviewReasons.push(
      "Food details were filled from exact-ID legacy Event Host data because current structured Tripleseat food details are missing.",
    );
  }
  if (!drinkOptions.length && legacy?.drink_options.length) {
    drinkOptions = [...legacy.drink_options];
    reviewReasons.push(
      "Drink details were filled from exact-ID legacy Event Host data because current structured Tripleseat drink details are missing.",
    );
  }
  if (!entertainment.length && legacy?.entertainment.length) {
    entertainment = legacy.entertainment.map((item) => ({ ...item }));
    reviewReasons.push(
      "Entertainment details were filled from exact-ID legacy Event Host data because current canonical Tripleseat entertainment details are missing.",
    );
  }
  if (
    !specialInstructions.length &&
    legacy?.special_instructions?.length
  ) {
    specialInstructions = [...legacy.special_instructions];
    reviewReasons.push(
      "Special instructions were filled from exact-ID legacy Event Host data because current Tripleseat operational notes are missing.",
    );
  }

  if (!food.length) {
    reviewReasons.push("Structured food details are missing.");
  }
  if (!drinkOptions.length) {
    reviewReasons.push("Structured drink details are missing.");
  }
  if (!entertainment.length) {
    reviewReasons.push("Canonical entertainment details are missing.");
  }

  const uniqueReviewReasons = uniqueText(reviewReasons);
  const needsReview = uniqueReviewReasons.length > 0;

  return {
    id,
    name,
    date,
    day: dayForDate(date),
    time,
    guest_count:
      source.guestCount != null &&
      Number.isInteger(source.guestCount) &&
      source.guestCount > 0
        ? source.guestCount
        : packageGuestCount ?? 0,
    rooms,
    color: deterministicEventColor(source.eventId),
    food,
    drink_options: drinkOptions,
    entertainment,
    ...(specialInstructions.length
      ? { special_instructions: uniqueText(specialInstructions) }
      : {}),
    ...(operationalNotes.length
      ? { operational_notes: operationalNotes }
      : {}),
    verification_status: needsReview
      ? `Needs Review: ${uniqueReviewReasons.join(" ")}`
      : operationalNotes.length
        ? "Verified from current structured Tripleseat event data and operational notes."
        : "Verified from current structured Tripleseat event data.",
    needs_review: needsReview,
    review_reasons: uniqueReviewReasons,
    tripleseat_booking_id: source.bookingId,
    source_updated_at: source.sourceUpdatedAt,
    rule_version: EVENT_PLAN_RULE_VERSION,
  };
}
