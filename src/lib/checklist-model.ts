export type RateOption = {
  key: string;
  label: string;
  price: number;
};

export type EntertainmentAddOnConfig = {
  key: string;
  label: string;
  kind: "manual-price" | "fixed-price" | "rate-select";
  fixedPrice?: number;
  options?: RateOption[];
  unitLabel: string;
};

export type FoodAddOnConfig = {
  key: string;
  label: string;
  kind: "manual-price" | "fixed-price" | "quantity-only";
  fixedPrice?: number;
};

export type ChecklistSection = {
  key: string;
  title: string;
  items: Array<{
    key: string;
    label: string;
  }>;
};

export type EntertainmentState = {
  quantity: string;
  selectedRateKey: string;
  manualPrice: string;
};

export type FoodState = {
  quantity: string;
  manualPrice: string;
};

export type EventChecklistState = {
  bwa: string;
  extrasAdded: string;
  remainingDrinkCardBalance: string;
  tasks: Record<string, boolean>;
  entertainment: Record<string, EntertainmentState>;
  food: Record<string, FoodState>;
};

export type ChecklistRecordStatus = "draft" | "submitted";

export type ChecklistRecord = EventChecklistState & {
  eventId: number;
  status: ChecklistRecordStatus;
  updatedAt: string | null;
  submittedAt: string | null;
};

export const entertainmentAddOns: EntertainmentAddOnConfig[] = [
  {
    key: "prepaid-drink-cards",
    label: "Prepaid Drink Cards",
    kind: "manual-price",
    unitLabel: "cards",
  },
  {
    key: "bowling",
    label: "Bowling",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $30 per hour", price: 30 },
      { key: "fri-sat", label: "Friday-Saturday · $40 per hour", price: 40 },
    ],
  },
  {
    key: "darts",
    label: "Darts",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $30 per hour", price: 30 },
      { key: "fri-sat", label: "Friday-Saturday · $40 per hour", price: 40 },
    ],
  },
  {
    key: "mini-golf",
    label: "Mini Golf",
    kind: "fixed-price",
    fixedPrice: 9,
    unitLabel: "courses",
  },
  {
    key: "shuffleboard",
    label: "Shuffleboard",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $30 per hour", price: 30 },
      { key: "fri-sat", label: "Friday-Saturday · $40 per hour", price: 40 },
    ],
  },
  {
    key: "gem-room",
    label: "The Gem Room",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $39 per hour", price: 39 },
      { key: "fri-sat", label: "Friday-Saturday · $79 per hour", price: 79 },
    ],
  },
  {
    key: "ocean-room",
    label: "The Ocean Room",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $35 per hour", price: 35 },
      { key: "fri-sat", label: "Friday-Saturday · $69 per hour", price: 69 },
    ],
  },
  {
    key: "prime-room",
    label: "The Prime Room",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $35 per hour", price: 35 },
      { key: "fri-sat", label: "Friday-Saturday · $69 per hour", price: 69 },
    ],
  },
  {
    key: "disco-room",
    label: "The Disco Room",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $39 per hour", price: 39 },
      { key: "fri-sat", label: "Friday-Saturday · $79 per hour", price: 79 },
    ],
  },
  {
    key: "royal-room",
    label: "The Royal Room",
    kind: "rate-select",
    unitLabel: "hours",
    options: [
      { key: "sun-thu", label: "Sun-Thursday · $35 per hour", price: 35 },
      { key: "fri-sat", label: "Friday-Saturday · $69 per hour", price: 69 },
    ],
  },
];

export const foodAddOns: FoodAddOnConfig[] = [
  { key: "wings", label: "Wings", kind: "fixed-price", fixedPrice: 120 },
  { key: "mozzarella-sticks", label: "Mozzarella Sticks", kind: "fixed-price", fixedPrice: 120 },
  { key: "tater-kegs", label: "Tater Kegs", kind: "fixed-price", fixedPrice: 120 },
  { key: "fry-platters", label: "Fry Platters", kind: "fixed-price", fixedPrice: 75 },
  { key: "chicken-tenders", label: "Chicken Tenders", kind: "fixed-price", fixedPrice: 120 },
  { key: "veggie-tray", label: "Veggie Tray", kind: "fixed-price", fixedPrice: 75 },
  { key: "bbq-sauce", label: "BBQ Sauce", kind: "fixed-price", fixedPrice: 5 },
  { key: "garlic-parm", label: "Garlic Parm", kind: "fixed-price", fixedPrice: 5 },
  { key: "buffalo-sauce", label: "Buffalo Sauce", kind: "fixed-price", fixedPrice: 5 },
  { key: "ranch", label: "Ranch", kind: "fixed-price", fixedPrice: 5 },
  { key: "dessert-platter", label: "Dessert Platter", kind: "manual-price" },
  { key: "taco-beef", label: "Beef", kind: "quantity-only" },
  { key: "taco-chicken", label: "Chicken", kind: "quantity-only" },
  { key: "taco-black-beans", label: "Black Beans", kind: "quantity-only" },
  { key: "taco-tortillas", label: "Tortillas", kind: "quantity-only" },
  { key: "taco-lettuce-wraps", label: "Lettuce Wraps", kind: "quantity-only" },
  { key: "taco-tomatoes", label: "Tomatoes", kind: "quantity-only" },
  { key: "taco-lettuce", label: "Lettuce", kind: "quantity-only" },
  { key: "taco-sour-cream", label: "Sour Cream", kind: "quantity-only" },
  { key: "taco-diced-onion", label: "Diced Onion", kind: "quantity-only" },
  { key: "taco-shredded-cheese", label: "Shredded Cheese", kind: "quantity-only" },
  { key: "taco-salsa", label: "Salsa", kind: "quantity-only" },
];

export const checklistSections: ChecklistSection[] = [
  {
    key: "morning-of-event",
    title: "Morning of Event-Shift Lead",
    items: [
      { key: "tripleseat-contract-printed", label: "Confirm 2 copies of the contract is printed from Tripleseat" },
      {
        key: "contract-placed-front-desk",
        label: "Place one copy of the contract in the sign holder and place on the front desk with both sides showing the events details",
      },
      { key: "tablet-layout-accurate", label: "Confirm table layout tablet has accurate time and has no overlaps" },
      { key: "entertainment-tablet-accurate", label: "Confirm entertainment is accurate on the entertainment tablet and has no overlaps" },
      {
        key: "food-details-accurate",
        label: "Confirm food details, time and ensure Event Kitchen Checklist sheets are file in and accurate",
      },
      { key: "prepaid-drink-cards-labeled", label: "Ensure any prepaid drink cards have been created and labeled" },
      { key: "table-signs-printed", label: "Ensure all necessary table signs are printed and in sign holders" },
    ],
  },
  {
    key: "one-hour-before",
    title: "1 hour before the event-BWA POC",
    items: [
      { key: "contract-details-confirmed", label: "Confirm food, drink card, and entertainment details with the contract" },
      {
        key: "entertainment-reserved",
        label: "Ensure entertainment is reserved (move shuffleboard pucks, pool balls and darts to your contract)",
      },
      { key: "event-tables-cleaned", label: "Ensure all tables being used for the events are cleaned" },
      {
        key: "table-line-placed",
        label: "Place black table linen and table runner (color of company) on the food table",
      },
      { key: "signs-placed", label: "Place table signs on tables and entertainment" },
      { key: "food-carts-prepped", label: "Prepare food carts w/ plates, utensils, tongs, napkins" },
      {
        key: "chaffing-dishes-placed",
        label: "Get necessary chaffing dishes placed on reserved tables, fill bottom w/ water & light sterno warmers",
      },
      { key: "chaffing-dishes-clean", label: "Ensure chafing dish covers are clean" },
      { key: "floor-boxes-cleaned", label: "Set up clear boxes that food goes on. Clean with glass cleaner if needed" },
      {
        key: "stanchions-placed",
        label: "Place stanchions out to separate the parties food table from general public and ropes for bowling if applicable",
      },
    ],
  },
  {
    key: "guest-arrival",
    title: "Guest Arrival-BWA POC",
    items: [
      { key: "introduce-bwa", label: "Introduce yourself and the BWA(s) working the event to the groups POC" },
      {
        key: "review-times-with-poc",
        label: "Give group POC itinerary-Review food, drink and entertainment start times with them",
      },
      { key: "mini-golf-coins", label: "Give guests mini golf coins (if applicable)" },
      { key: "show-reserved-seating", label: "Show POC where their reserved seating for their party will be" },
      {
        key: "prepaid-drink-cards-shown",
        label: "Give guests prepaid drink cards and show them how the tapwall works",
      },
      { key: "food-ready", label: "Tell POC when the food is ready" },
      {
        key: "plates-and-tables-cleared",
        label: "Tell guests to leave their food plates and empty glasses on the tables. We will bus tables for them",
      },
      {
        key: "upsell-additional-items",
        label: "Upsell guests on additional items such as mini golf, prepaid drink cards, food or entertainment",
      },
      {
        key: "additional-items-noted",
        label: "If guests add any additional items, write those items down on the Events Add-Ons sheet",
      },
    ],
  },
  {
    key: "during-event",
    title: "During the Event check-ins-BWA POC",
    items: [
      { key: "food-kitchen-window", label: "Food shall be in the kitchen window 15 minutes prior to start of the event" },
      { key: "food-setup-confirmed", label: "Ensure all the food the party ordered is set up at event start time" },
      { key: "food-quality-check", label: "Ensure food is filled quickly" },
      {
        key: "event-specialist-restocking",
        label: "Event specialist (BWA or person running the event) shall bus, restock food during the event",
      },
      { key: "bowling-pin-setup", label: "Give POC bowling pin and sharpie to keep" },
    ],
  },
  {
    key: "end-of-event",
    title: "End of the Event",
    items: [
      { key: "ask-experience", label: "Ask the guests how their experience and favorite part of the event was" },
      {
        key: "review-add-ons",
        label: "Review any add ons with the guests and tell them we will get final payment after the event.",
      },
      {
        key: "guest-feedback-booklet",
        label: "Ask guests to leave a google review and feedback in black itinerary booklet.",
      },
      { key: "used-tables-bussed", label: "Ensure all used tables are bussed and area is clean (signs, food tables, dishes, stanchions)" },
      { key: "sternos-cooled", label: "Put a cap on the sternos. Wait until they have cooled before throwing it away" },
      { key: "prepaid-cards-collected", label: "Collect prepaid cards" },
      { key: "carts-laundry", label: "Clean carts and start a load of laundry" },
      { key: "add-on-sheet-stapled", label: "Staple the Add-On sheets in the door holder of the Sales office" },
      { key: "shift-lead-checkout", label: "Check in with shift lead to confirm you can leave" },
    ],
  },
];

export function isWeekendRateEvent(dateValue: string) {
  const day = new Date(`${dateValue}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

export function defaultChecklistState(dateValue: string): EventChecklistState {
  const defaultRateKey = isWeekendRateEvent(dateValue) ? "fri-sat" : "sun-thu";
  const entertainment = Object.fromEntries(
    entertainmentAddOns.map((item) => [
      item.key,
      {
        quantity: "",
        selectedRateKey: item.kind === "rate-select" ? defaultRateKey : "",
        manualPrice: "",
      },
    ]),
  );
  const food = Object.fromEntries(
    foodAddOns.map((item) => [
      item.key,
      {
        quantity: "",
        manualPrice: "",
      },
    ]),
  );
  const tasks = Object.fromEntries(
    checklistSections.flatMap((section) => section.items.map((item) => [item.key, false])),
  );

  return {
    bwa: "",
    extrasAdded: "",
    remainingDrinkCardBalance: "",
    tasks,
    entertainment,
    food,
  };
}

export function hydrateChecklistState(dateValue: string, savedState?: Partial<EventChecklistState> | null): EventChecklistState {
  const base = defaultChecklistState(dateValue);

  return {
    ...base,
    ...savedState,
    tasks: {
      ...base.tasks,
      ...(savedState?.tasks ?? {}),
    },
    entertainment: Object.fromEntries(
      entertainmentAddOns.map((item) => [
        item.key,
        {
          ...base.entertainment[item.key],
          ...(savedState?.entertainment?.[item.key] ?? {}),
        },
      ]),
    ),
    food: Object.fromEntries(
      foodAddOns.map((item) => [
        item.key,
        {
          ...base.food[item.key],
          ...(savedState?.food?.[item.key] ?? {}),
        },
      ]),
    ),
  };
}

export function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function entertainmentUnitPrice(config: EntertainmentAddOnConfig, state: EntertainmentState) {
  if (config.kind === "manual-price") {
    return numeric(state.manualPrice);
  }
  if (config.kind === "fixed-price") {
    return config.fixedPrice ?? 0;
  }
  const selected = config.options?.find((option) => option.key === state.selectedRateKey);
  return selected?.price ?? 0;
}

export function foodUnitPrice(config: FoodAddOnConfig, state: FoodState) {
  if (config.kind === "quantity-only") {
    return 0;
  }
  if (config.kind === "manual-price") {
    return numeric(state.manualPrice);
  }
  return config.fixedPrice ?? 0;
}

export function eventCompletion(state: EventChecklistState) {
  const total = checklistSections.reduce((sum, section) => sum + section.items.length, 0);
  const completed = Object.values(state.tasks).filter(Boolean).length;
  return { completed, total };
}

export function recordToChecklistState(dateValue: string, record: Partial<EventChecklistState>) {
  return hydrateChecklistState(dateValue, record);
}
