import type {
  KitchenFoodKey,
  KitchenReferenceConflict,
  PanSize,
} from "./types";

export type PanCapacityKey =
  | "taterKegs"
  | "chickenTenders"
  | "mozzarellaSticks"
  | "wings";

export type PanCapacityRule = {
  amountPerPan: number;
  panSize: PanSize;
};

export type TacoGuestBand = {
  minGuests: number;
  maxGuests: number;
  batches: number;
};

export type PlatterRule = {
  rowKey: Extract<
    KitchenFoodKey,
    | "platter-tater-kegs"
    | "platter-chicken-tenders"
    | "platter-mozzarella-sticks"
    | "platter-wings"
    | "platter-veggie-tray"
    | "platter-fries"
  >;
  foodName: string;
  amountPerPlatter: number;
  unit: string;
  hot: boolean;
  panCapacityKey?: PanCapacityKey;
  sauce?: {
    name: "marinara" | "ranch";
    bowlsPerPlatter: number | null;
  };
};

export type KitchenRuleConfig = {
  ruleVersion: string;
  foodReadyOffsetMinutes: number;
  definiteStatuses: readonly string[];
  taco: {
    maxGuests: number;
    bands: readonly TacoGuestBand[];
    beefPoundsPerBatch: number;
    chickenPoundsPerBatch: number;
    chickenPoundsPerPan: number;
    beanRecipesPerBatch: number;
    beefPansPerBatch: number;
    beanPansPerBatch: number;
    panSize: PanSize;
    tortillaGuestsPerPack: number;
  };
  wing: {
    maxGuests: number;
    guestsPerGroup: number;
    wingsPerGuest: number;
    friesPoundsPerGroup: number;
    celeryHalfSticksPerGuest: number;
    friesPansPerGroup: number;
    friesPanSize: PanSize;
  };
  appetizer: {
    maxGuests: number;
    guestsPerGroup: number;
    taterKegsPerGroup: number;
    chickenTendersPerGroup: number;
    mozzarellaPoundsPerGroup: number;
    marinaraBowlsPerBar: number;
    ranchBowlsPerBar: number;
  };
  panCapacities: Readonly<Record<PanCapacityKey, PanCapacityRule>>;
  dessertGuestsPerPlatter: number;
  barTables: {
    doubleAboveGuestCount: number;
    normalTablesPerBar: number;
    mirroredTablesPerBar: number;
  };
  prepLeadMinutes: {
    tacoBeef: number;
    tacoChicken: number;
    tacoBlackBeans: number;
    taterKegs: number;
    wings: number;
    chickenTenders: number;
    fries: null;
    mozzarellaSticks: null;
    dessert: number;
  };
  kitchenMorningTime: string | null;
  platter: {
    minQuantity: number;
    maxQuantity: number;
    rules: Readonly<Record<string, PlatterRule>>;
  };
  referenceConflicts: readonly KitchenReferenceConflict[];
};

export const TACO_GUEST_BANDS: readonly TacoGuestBand[] = [
  { minGuests: 1, maxGuests: 24, batches: 1 },
  { minGuests: 25, maxGuests: 48, batches: 2 },
  { minGuests: 49, maxGuests: 72, batches: 3 },
  { minGuests: 73, maxGuests: 96, batches: 4 },
  { minGuests: 97, maxGuests: 120, batches: 5 },
  { minGuests: 121, maxGuests: 145, batches: 6 },
  { minGuests: 146, maxGuests: 170, batches: 7 },
  { minGuests: 171, maxGuests: 194, batches: 8 },
  { minGuests: 195, maxGuests: 218, batches: 9 },
  { minGuests: 219, maxGuests: 242, batches: 10 },
] as const;

export const KITCHEN_REFERENCE_CONFLICTS: readonly KitchenReferenceConflict[] = [
  {
    code: "DESSERT_30_VS_35",
    title: "Dessert platter threshold",
    writtenRule: "One dessert platter per 35 guests, rounded up, only when dessert is explicitly selected.",
    referenceRule: "The Taco sheets say one dessert tray per 30 guests and visually place it inside the Taco reference.",
    currentResolution: "Use 35 and require an explicit dessert selection.",
    appliesTo: ["dessert"],
  },
  {
    code: "TORTILLA_RANGE_TYPOS",
    title: "Tortilla ranges",
    writtenRule: "Provisionally use ceil(guest count / 8).",
    referenceRule: "The first sheet contains 23-40 instead of 33-40; the 121-242 sheet undercounts multiple upper boundaries.",
    currentResolution: "Use the formula, not the printed ranges.",
    appliesTo: ["taco", "taco-tortillas"],
  },
  {
    code: "WING_HIGH_COUNT_COPY_ERROR",
    title: "Wing quantities above 125 guests",
    writtenRule: "Use eight wings per guest.",
    referenceRule: "The 126-250 sheet repeats the 1-125 guest mappings instead of the corresponding high-count mappings.",
    currentResolution: "Use the formula through the approved maximum of 250.",
    appliesTo: ["wing", "wing-wings"],
  },
  {
    code: "WING_CELERY_HALF_VS_ONE",
    title: "Wing celery quantity",
    writtenRule: "Use one half-stick per guest.",
    referenceRule: "The 126-250 sheet says one stick per guest while the 1-125 sheet says one half-stick.",
    currentResolution: "Use one half-stick per guest.",
    appliesTo: ["wing", "wing-celery"],
  },
  {
    code: "WING_RANCH_VS_BLUE_CHEESE",
    title: "Wing sauce",
    writtenRule: "Use ranch unless a later approved exact mapping allows another sauce.",
    referenceRule: "The 126-250 sheet says ranch or blue cheese.",
    currentResolution: "Use ranch; an explicit blue-cheese source item remains unknown and needs review.",
    appliesTo: ["wing", "sauce-ranch"],
  },
  {
    code: "CHECKLIST_PAN_SIZE_OPTIONS",
    title: "Checklist pan-size columns",
    writtenRule:
      "Use the approved per-item prep-pan capacities and keep chafing-display packing separate.",
    referenceRule: "The checklist displays two unlabeled pan-size subcolumns and shows both 1/2 and 1/3 for several rows.",
    currentResolution:
      "Use confirmed 1/3-pan capacities for wings, tenders, tater kegs, and mozzarella; retain the separate approved chafing rule.",
    appliesTo: ["wing", "appetizer", "platters"],
  },
  {
    code: "LEGACY_MENU_ITEMS",
    title: "Legacy training menu items",
    writtenRule: "Only the currently listed Taco, Wing, Appetizer, platter, dessert, and sauce items are supported.",
    referenceRule: "The training sheet also shows pork, cookies, pretzel bites, loaded fries, beer cheese, and salad.",
    currentResolution: "Treat those exact source foods as unknown until rules are approved.",
    appliesTo: ["classification"],
  },
  {
    code: "MIRRORED_TABLE_TRIGGER",
    title: "Mirrored buffet-table trigger",
    writtenRule: "Use two mirrored tables for each selected bar type above 75 guests.",
    referenceRule: "Party Misc presents mirrored tables as a contract special-note example.",
    currentResolution: "Use the written threshold and send contradictory special notes to review.",
    appliesTo: ["chafing", "special-notes"],
  },
  {
    code: "MARINARA_EIGHT_OUNCES",
    title: "Appetizer Bar sauce amount",
    writtenRule: "Every Appetizer Bar receives one bowl of marinara and one bowl of ranch.",
    referenceRule: "The Appetizer sheet says mozzarella sticks receive eight ounces of marinara without saying per pan, group, or event.",
    currentResolution: "Use one bowl of each sauce per Appetizer Bar, independent of guest count.",
    appliesTo: ["appetizer", "sauce-marinara", "sauce-ranch"],
  },
  {
    code: "FRIED_ITEM_ZERO_HOUR",
    title: "Fries and mozzarella prep leads",
    writtenRule: "Keep both prep leads unresolved in named configuration.",
    referenceRule: "The prep sheet says zero hours earliest start but also says five minutes cook time.",
    currentResolution: "Do not infer a lead; surface a setup warning.",
    appliesTo: ["wing-fries", "appetizer-mozzarella-sticks", "platter-fries", "platter-mozzarella-sticks"],
  },
  {
    code: "VEGGIE_MORNING_45_MINUTES",
    title: "Veggie-tray morning rule",
    writtenRule: "Use a configurable first-thing-in-the-morning local time.",
    referenceRule: "The prep sheet additionally shows 45 minutes without defining how it combines with the morning time.",
    currentResolution: "Use only an approved configured morning time; retain the 45-minute detail as unresolved.",
    appliesTo: ["platter-veggie-tray"],
  },
  {
    code: "DUPLICATE_SAUCE_ROWS",
    title: "Sauce placement on the checklist",
    writtenRule: "Use the yellow sauce section for required Ranch and Marinara.",
    referenceRule: "The checklist also embeds sauces in food names and includes generic or duplicate Ranch rows.",
    currentResolution: "Generate each required sauce once in the sauce section.",
    appliesTo: ["sauces"],
  },
  {
    code: "LEGACY_CHECKLIST_COLUMNS",
    title: "Legacy checklist columns",
    writtenRule: "Use Food Name, Number of Pans, Pan Size, and Quantity.",
    referenceRule: "The training form additionally labels Item Number and Add Ons.",
    currentResolution: "Use the written four-field row model.",
    appliesTo: ["checklist-layout"],
  },
  {
    code: "UNMODELED_OPERATING_NOTES",
    title: "Unmodeled operating notes",
    writtenRule: "The first release calculates and prints kitchen requirements only.",
    referenceRule: "Party Misc also says not to cover fried foods, to label backup pans, and to move paper contracts to the heat-lamp area.",
    currentResolution: "Do not turn these notes into calculated requirements without approval.",
    appliesTo: ["operations"],
  },
] as const;

export const KITCHEN_FOOD_DESCRIPTIONS: Readonly<
  Record<KitchenFoodKey, string>
> = {
  "dessert-platter":
    "Dessert platter; prepare one platter per 35 guests when dessert is selected.",
  "taco-beef":
    "Seasoned Taco Bar beef; prepare 5 pounds for each approved batch.",
  "taco-chicken":
    "Seasoned Taco Bar chicken; prepare 5 pounds for each approved batch and pack up to 2.5 pounds in each 1/3 pan.",
  "taco-black-beans":
    "Taco Bar black beans; prepare one recipe for each approved batch.",
  "taco-tortillas":
    "Taco Bar tortillas; prepare one pack per 8 guests, rounded up.",
  "taco-lettuce-wraps":
    "Fresh lettuce wraps for the Taco Bar; prepare one wrap per guest.",
  "taco-cold-sides":
    "Complete Taco Bar cold-side set with cheese, lettuce, tomato, onion, sour cream, and salsa.",
  "wing-wings":
    "Wing Bar wings; prepare 8 per guest and pack up to 25 in each 1/3 pan.",
  "wing-celery":
    "Wing Bar celery; prepare one half-stick per guest.",
  "wing-fries":
    "Wing Bar fries; prepare 5 pounds for each started group of 25 guests.",
  "appetizer-tater-kegs":
    "Appetizer Bar tater kegs; pack up to 25 in each 1/3 pan.",
  "appetizer-mozzarella-sticks":
    "Appetizer Bar mozzarella sticks; pack up to 3 pounds in each 1/3 pan.",
  "appetizer-chicken-tenders":
    "Appetizer Bar chicken tenders; pack up to 25 in each 1/3 pan.",
  "platter-tater-kegs":
    "Tater Keg Platters contain 64 each; pack up to 25 in each 1/3 pan.",
  "platter-chicken-tenders":
    "Chicken Tender Platters contain 50 each; pack up to 25 in each 1/3 pan.",
  "platter-mozzarella-sticks":
    "Mozzarella Stick Platters contain 4 pounds; pack up to 3 pounds in each 1/3 pan.",
  "platter-wings":
    "Wing Platters contain 64 each; pack up to 25 in each 1/3 pan.",
  "platter-veggie-tray":
    "Assorted fresh vegetables arranged on pretzel plates with ranch required.",
  "platter-fries":
    "Fry Platters contain one bag of fries per ordered platter.",
  "sauce-marinara":
    "Marinara dipping sauce required by the selected mozzarella items or Appetizer Bar.",
  "sauce-ranch":
    "Ranch dipping sauce required by the selected wings, tenders, veggie trays, or bar.",
};

export const KITCHEN_RULE_CONFIG: KitchenRuleConfig = {
  ruleVersion: "ope-kitchen-2026-07-29.5",
  foodReadyOffsetMinutes: 15,
  definiteStatuses: ["definite"],
  taco: {
    maxGuests: 242,
    bands: TACO_GUEST_BANDS,
    beefPoundsPerBatch: 5,
    chickenPoundsPerBatch: 5,
    chickenPoundsPerPan: 2.5,
    beanRecipesPerBatch: 1,
    beefPansPerBatch: 1,
    beanPansPerBatch: 1,
    panSize: "1/3",
    tortillaGuestsPerPack: 8,
  },
  wing: {
    maxGuests: 250,
    guestsPerGroup: 25,
    wingsPerGuest: 8,
    friesPoundsPerGroup: 5,
    celeryHalfSticksPerGuest: 1,
    friesPansPerGroup: 1,
    friesPanSize: "1/2",
  },
  appetizer: {
    maxGuests: 250,
    guestsPerGroup: 25,
    taterKegsPerGroup: 42,
    chickenTendersPerGroup: 60,
    mozzarellaPoundsPerGroup: 6,
    marinaraBowlsPerBar: 1,
    ranchBowlsPerBar: 1,
  },
  panCapacities: {
    taterKegs: {
      amountPerPan: 25,
      panSize: "1/3",
    },
    chickenTenders: {
      amountPerPan: 25,
      panSize: "1/3",
    },
    mozzarellaSticks: {
      amountPerPan: 3,
      panSize: "1/3",
    },
    wings: {
      amountPerPan: 25,
      panSize: "1/3",
    },
  },
  dessertGuestsPerPlatter: 35,
  barTables: {
    doubleAboveGuestCount: 75,
    normalTablesPerBar: 1,
    mirroredTablesPerBar: 2,
  },
  prepLeadMinutes: {
    tacoBeef: 180,
    tacoChicken: 180,
    tacoBlackBeans: 180,
    taterKegs: 25,
    wings: 30,
    chickenTenders: 30,
    fries: null,
    mozzarellaSticks: null,
    dessert: 60,
  },
  kitchenMorningTime: null,
  platter: {
    minQuantity: 1,
    maxQuantity: 10,
    rules: {
      "platter:tater-kegs": {
        rowKey: "platter-tater-kegs",
        foodName: "Tater Kegs",
        amountPerPlatter: 64,
        unit: "each",
        hot: true,
        panCapacityKey: "taterKegs",
      },
      "platter:chicken-tenders": {
        rowKey: "platter-chicken-tenders",
        foodName: "Chicken Tenders",
        amountPerPlatter: 50,
        unit: "each",
        hot: true,
        panCapacityKey: "chickenTenders",
        sauce: {
          name: "ranch",
          bowlsPerPlatter: 1,
        },
      },
      "platter:mozzarella-sticks": {
        rowKey: "platter-mozzarella-sticks",
        foodName: "Mozzarella Sticks",
        amountPerPlatter: 4,
        unit: "pounds",
        hot: true,
        panCapacityKey: "mozzarellaSticks",
        sauce: {
          name: "marinara",
          bowlsPerPlatter: null,
        },
      },
      "platter:wings": {
        rowKey: "platter-wings",
        foodName: "Wings",
        amountPerPlatter: 64,
        unit: "each",
        hot: true,
        panCapacityKey: "wings",
        sauce: {
          name: "ranch",
          bowlsPerPlatter: 1,
        },
      },
      "platter:veggie-tray": {
        rowKey: "platter-veggie-tray",
        foodName: "Veggie Tray",
        amountPerPlatter: 1,
        unit: "pretzel plates",
        hot: false,
        sauce: {
          name: "ranch",
          bowlsPerPlatter: null,
        },
      },
      "platter:fries": {
        rowKey: "platter-fries",
        foodName: "Fries",
        amountPerPlatter: 1,
        unit: "bags",
        hot: true,
      },
    },
  },
  referenceConflicts: KITCHEN_REFERENCE_CONFLICTS,
};
