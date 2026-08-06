export const KITCHEN_TIME_ZONE = "America/New_York" as const;

export type KitchenSourceSelection = {
  name: string;
  quantity?: number | null;
  sourceId?: string | number | null;
  sourceCategory?: string | null;
  isFood?: boolean | null;
};

export type KitchenFoodNoteSource =
  | "event-description"
  | "event-note"
  | "event-document"
  | "booking-note"
  | "booking-document";

export type KitchenFoodNote = {
  text: string;
  source: KitchenFoodNoteSource;
  sourceId: string | null;
  sourceUpdatedAt: string | null;
};

export type KitchenSourceEvent = {
  eventId: string | number;
  bookingId?: string | number | null;
  eventName: string;
  localDate: string;
  localDateVerified?: boolean;
  startTime: string | null;
  endTime?: string | null;
  guestCount: number | null;
  status: string | null;
  statusVerified?: boolean;
  room?: string | null;
  selections: readonly KitchenSourceSelection[];
  foodNotes?: readonly KitchenFoodNote[];
  specialNotes?: readonly string[];
  sourceUpdatedAt?: string | null;
  sourceState?: "fresh" | "stale" | "sync-failed";
};

export type PackageMarker = "the-full-course" | "the-front-nine";
export type BarType = "taco" | "wing" | "appetizer";
export type KitchenClassification = "bar-package" | "platter-only";

export type KitchenCategory =
  | "dessert"
  | "taco"
  | "wing"
  | "appetizer"
  | "platters"
  | "sauces";

export type KitchenFoodKey =
  | "dessert-platter"
  | "taco-beef"
  | "taco-chicken"
  | "taco-black-beans"
  | "taco-tortillas"
  | "taco-lettuce-wraps"
  | "taco-cold-sides"
  | "wing-wings"
  | "wing-celery"
  | "wing-fries"
  | "appetizer-tater-kegs"
  | "appetizer-mozzarella-sticks"
  | "appetizer-chicken-tenders"
  | "platter-tater-kegs"
  | "platter-chicken-tenders"
  | "platter-mozzarella-sticks"
  | "platter-wings"
  | "platter-veggie-tray"
  | "platter-fries"
  | "sauce-marinara"
  | "sauce-ranch";

export type PanSize = "1/3" | "1/2";

export type PrepTiming =
  | {
      kind: "minutes-before-food-ready";
      minutes: number;
    }
  | {
      kind: "kitchen-morning";
      localTime: string | null;
    }
  | {
      kind: "not-applicable";
    }
  | {
      kind: "unresolved";
    };

export type KitchenChecklistRow = {
  key: KitchenFoodKey;
  category: KitchenCategory;
  foodName: string;
  description: string;
  quantity: number | null;
  unit: string;
  numberOfPans: number | null;
  panSize: PanSize | null;
  prepTiming: PrepTiming;
};

export type KitchenLiveFoodAddOn = {
  itemKey: string;
  foodName: string;
  description: string;
  quantity: number;
  unit: string;
  numberOfPans: number | null;
  panSize: PanSize | null;
  sourceUpdatedAt: string | null;
};

export type KitchenAddOnActivity = {
  eventId: string;
  eventName: string;
  revision: number;
  updatedAt: string | null;
  itemNames: string[];
};

export type KitchenAddOnCompletion = {
  eventId: string;
  eventName: string;
  itemKey: string;
  foodName: string;
  readinessUpdatedAt: string;
};

export type KitchenChecklistSection = {
  category: KitchenCategory;
  label: string;
  rows: KitchenChecklistRow[];
};

export type NormalizedSelectionKind =
  | `package:${PackageMarker}`
  | `bar:${BarType}`
  | "option:taco-lettuce-wraps"
  | "dessert"
  | "platter:tater-kegs"
  | "platter:chicken-tenders"
  | "platter:mozzarella-sticks"
  | "platter:wings"
  | "platter:veggie-tray"
  | "platter:fries"
  | "sauce:marinara"
  | "sauce:ranch";

export type NormalizedKitchenSelection = {
  originalName: string;
  normalizedName: string;
  quantity: number;
  quantityProvided: boolean;
  kinds: NormalizedSelectionKind[];
  sourceId: string | number | null;
  sourceCategory: string | null;
  isFood: boolean | null;
};

export type KitchenWarningCode =
  | "INVALID_EVENT_DATE"
  | "MISSING_START_TIME"
  | "INVALID_START_TIME"
  | "MISSING_GUEST_COUNT"
  | "INVALID_GUEST_COUNT"
  | "GUEST_COUNT_OUT_OF_RANGE"
  | "DEFINITE_STATUS_UNVERIFIED"
  | "UNKNOWN_FOOD_ITEM"
  | "NO_FOOD_SELECTIONS"
  | "PACKAGE_BAR_MISSING"
  | "BAR_WITHOUT_PACKAGE_MARKER"
  | "INVALID_SELECTION_QUANTITY"
  | "CONFLICTING_QUANTITY"
  | "UNAPPROVED_PLATTER_QUANTITY"
  | "UNAPPROVED_PLATTER_PACKING"
  | "UNRESOLVED_SAUCE_QUANTITY"
  | "UNRESOLVED_TACO_ADD_ON"
  | "UNRESOLVED_PREP_LEAD"
  | "UNCONFIGURED_KITCHEN_MORNING"
  | "SPECIAL_NOTE_REQUIRES_REVIEW"
  | "SOURCE_STALE"
  | "SOURCE_SYNC_FAILED"
  | "REFERENCE_CONFLICT";

export type KitchenWarning = {
  code: KitchenWarningCode;
  message: string;
  requiresReview: boolean;
  scope: "event" | "selection" | "item" | "configuration";
  itemKey?: string;
  selectionName?: string;
  conflictCode?: string;
};

export type KitchenReferenceConflict = {
  code: string;
  title: string;
  writtenRule: string;
  referenceRule: string;
  currentResolution: string;
  appliesTo: readonly string[];
};

export type PlatterPackingItem = {
  key: Extract<
    KitchenFoodKey,
    | "platter-tater-kegs"
    | "platter-chicken-tenders"
    | "platter-mozzarella-sticks"
    | "platter-wings"
    | "platter-fries"
  >;
  platterCount: number;
};

export type PlatterPackingResult =
  | {
      status: "approved";
      totalHotPlatters: number;
      panCount: number;
      panSize: PanSize | null;
      chafingDishes: number;
    }
  | {
      status: "needs-review";
      reason: "unapproved-total";
      totalHotPlatters: number;
      panCount: null;
      panSize: null;
      chafingDishes: number;
    };

export type KitchenChecklist = {
  ruleVersion: string;
  timezone: typeof KITCHEN_TIME_ZONE;
  event: {
    eventId: string | number;
    bookingId: string | number | null;
    name: string;
    localDate: string;
    startTime: string | null;
    endTime: string | null;
    guestCount: number | null;
    guestCountSource:
      | "event"
      | "bar-selection-quantity"
      | null;
    status: string | null;
    room: string | null;
    sourceUpdatedAt: string | null;
    foodNotes?: KitchenFoodNote[];
    specialNotes: string[];
  };
  /** Legacy single-value assignment retained while older snapshots migrate. */
  foodRunnerOrBwa: string;
  foodRunners?: string[];
  pocs?: string[];
  classification: KitchenClassification;
  packageMarkers: PackageMarker[];
  selectedBars: BarType[];
  selectedCategories: KitchenCategory[];
  normalizedSelections: NormalizedKitchenSelection[];
  timing: {
    startTime: string | null;
    foodReadyBy: string | null;
    earliestPrepTime: string | null;
  };
  sections: KitchenChecklistSection[];
  liveFoodAddOns: KitchenLiveFoodAddOn[];
  completedItemKeys: string[];
  finalCompletedItemKeys: string[];
  chafingDishes: {
    bars: number | null;
    hotPlatters: number | null;
    total: number | null;
  };
  warnings: KitchenWarning[];
  referenceConflicts: KitchenReferenceConflict[];
  needsReview: boolean;
};
