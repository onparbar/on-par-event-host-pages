"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checklistEvents } from "@/lib/checklist-events";

type RateOption = {
  key: string;
  label: string;
  price: number;
};

type EntertainmentAddOnConfig = {
  key: string;
  label: string;
  kind: "manual-price" | "fixed-price" | "rate-select";
  fixedPrice?: number;
  options?: RateOption[];
  unitLabel: string;
};

type FoodAddOnConfig = {
  key: string;
  label: string;
  kind: "manual-price" | "fixed-price";
  fixedPrice?: number;
};

type ChecklistSection = {
  key: string;
  title: string;
  items: Array<{
    key: string;
    label: string;
  }>;
};

type EntertainmentState = {
  quantity: string;
  selectedRateKey: string;
  manualPrice: string;
};

type FoodState = {
  quantity: string;
  manualPrice: string;
};

type EventChecklistState = {
  bwa: string;
  extrasAdded: string;
  remainingDrinkCardBalance: string;
  tasks: Record<string, boolean>;
  entertainment: Record<string, EntertainmentState>;
  food: Record<string, FoodState>;
};

const STORAGE_KEY = "on-par-event-checklists-v1";

const entertainmentAddOns: EntertainmentAddOnConfig[] = [
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

const foodAddOns: FoodAddOnConfig[] = [
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
];

const checklistSections: ChecklistSection[] = [
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

function isWeekendRateEvent(dateValue: string) {
  const day = new Date(`${dateValue}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

function defaultChecklistState(dateValue: string): EventChecklistState {
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

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function entertainmentUnitPrice(config: EntertainmentAddOnConfig, state: EntertainmentState) {
  if (config.kind === "manual-price") {
    return numeric(state.manualPrice);
  }
  if (config.kind === "fixed-price") {
    return config.fixedPrice ?? 0;
  }
  const selected = config.options?.find((option) => option.key === state.selectedRateKey);
  return selected?.price ?? 0;
}

function foodUnitPrice(config: FoodAddOnConfig, state: FoodState) {
  if (config.kind === "manual-price") {
    return numeric(state.manualPrice);
  }
  return config.fixedPrice ?? 0;
}

function eventCompletion(state: EventChecklistState) {
  const total = checklistSections.reduce((sum, section) => sum + section.items.length, 0);
  const completed = Object.values(state.tasks).filter(Boolean).length;
  return { completed, total };
}

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Event Checklists</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/itineraries">Itineraries</Link>
        <Link href="/checklists">Checklists</Link>
      </nav>
    </header>
  );
}

export default function ChecklistsPage() {
  const [activeEventId, setActiveEventId] = useState<number>(checklistEvents[0]?.id ?? 0);
  const [activeEventTab, setActiveEventTab] = useState<"checklist" | "addons">("checklist");
  const [checklistsByEvent, setChecklistsByEvent] = useState<Record<number, EventChecklistState>>(() =>
    Object.fromEntries(checklistEvents.map((event) => [event.id, defaultChecklistState(event.date)])),
  );
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<number, Partial<EventChecklistState>>;
        const nextState = Object.fromEntries(
          checklistEvents.map((event) => {
            const base = defaultChecklistState(event.date);
            const savedState = parsed[event.id];
            return [
              event.id,
              {
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
              },
            ];
          }),
        );
        setChecklistsByEvent(nextState);
      } catch {
        // Ignore invalid local checklist cache and use defaults.
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checklistsByEvent));
  }, [checklistsByEvent, isHydrated]);

  const activeEvent = checklistEvents.find((event) => event.id === activeEventId) ?? checklistEvents[0];
  const activeChecklist = activeEvent ? checklistsByEvent[activeEvent.id] : undefined;

  function updateEventChecklist(eventId: number, updater: (current: EventChecklistState) => EventChecklistState) {
    setChecklistsByEvent((current) => {
      const existing = current[eventId];
      const event = checklistEvents.find((item) => item.id === eventId);
      if (!existing || !event) {
        return current;
      }
      return {
        ...current,
        [eventId]: updater(existing),
      };
    });
  }

  if (!activeEvent || !activeChecklist) {
    return null;
  }

  const progress = eventCompletion(activeChecklist);
  const entertainmentSubtotal = entertainmentAddOns.reduce((sum, item) => {
    const state = activeChecklist.entertainment[item.key];
    return sum + entertainmentUnitPrice(item, state) * numeric(state.quantity);
  }, 0);
  const foodSubtotal = foodAddOns.reduce((sum, item) => {
    const state = activeChecklist.food[item.key];
    return sum + foodUnitPrice(item, state) * numeric(state.quantity);
  }, 0);

  return (
    <>
      <Header />
      <main className="page checklist-page">
        <section className="intro">
          <div>
            <h2>Digital Event Checklists</h2>
            <p>Each event has its own checklist page and add-on page. Updates save locally on this device.</p>
          </div>
          <div className="checklist-meta-card">
            <span className="eyebrow">Current Event</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {progress.completed} of {progress.total} checklist items complete
            </span>
          </div>
        </section>

        <section className="event-tab-strip" aria-label="Event checklist tabs">
          {checklistEvents.map((event) => {
            const eventState = checklistsByEvent[event.id];
            const eventProgress = eventCompletion(eventState);
            return (
              <button
                key={event.id}
                type="button"
                className={`event-switcher${event.id === activeEvent.id ? " active" : ""}`}
                onClick={() => setActiveEventId(event.id)}
              >
                <span>{event.name}</span>
                <small>
                  {event.dateLabel} · {eventProgress.completed}/{eventProgress.total}
                </small>
              </button>
            );
          })}
        </section>

        <section className="event-header-card">
          <div className="event-field-grid">
            <Field label="Date" value={activeEvent.dateLabel} />
            <Field label="Event Name" value={activeEvent.name} />
            <Field label="POC" value={activeEvent.poc} />
            <EditableField
              label="BWA"
              value={activeChecklist.bwa}
              placeholder="Type employee name"
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  bwa: value,
                }))
              }
            />
          </div>
          <div className="notes-grid">
            <EditableTextArea
              label="Extras Added"
              value={activeChecklist.extrasAdded}
              placeholder="Track extra items added during the event."
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  extrasAdded: value,
                }))
              }
            />
            <EditableTextArea
              label="Remaining Drink Card Balance"
              value={activeChecklist.remainingDrinkCardBalance}
              placeholder="Add any remaining drink card balance notes."
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  remainingDrinkCardBalance: value,
                }))
              }
            />
          </div>
        </section>

        <section className="sheet-tab-strip" aria-label="Event detail tabs">
          <button
            type="button"
            className={`sheet-tab${activeEventTab === "checklist" ? " active" : ""}`}
            onClick={() => setActiveEventTab("checklist")}
          >
            Checklist Page
          </button>
          <button
            type="button"
            className={`sheet-tab${activeEventTab === "addons" ? " active" : ""}`}
            onClick={() => setActiveEventTab("addons")}
          >
            Add-On Page
          </button>
        </section>

        {activeEventTab === "checklist" ? (
          <section className="paper-checklist">
            {checklistSections.map((section) => (
              <article className="task-section-card" key={section.key}>
                <header className="task-section-header">{section.title}</header>
                <div className="task-list">
                  {section.items.map((item) => (
                    <label className="task-row" key={item.key}>
                      <input
                        type="checkbox"
                        checked={activeChecklist.tasks[item.key]}
                        onChange={(event) =>
                          updateEventChecklist(activeEvent.id, (current) => ({
                            ...current,
                            tasks: {
                              ...current.tasks,
                              [item.key]: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="addon-layout">
            <article className="addon-card">
              <div className="addon-card-header">
                <div>
                  <h3>Entertainment &amp; Drink Add-Ons</h3>
                  <p>Use the required pricing rules for each event add-on.</p>
                </div>
                <strong>{currency(entertainmentSubtotal)}</strong>
              </div>
              <div className="addon-grid">
                {entertainmentAddOns.map((item) => {
                  const state = activeChecklist.entertainment[item.key];
                  const unitPrice = entertainmentUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);
                  return (
                    <article className="addon-row-card" key={item.key}>
                      <div className="addon-row-top">
                        <div>
                          <h4>{item.label}</h4>
                          <p>{item.unitLabel}</p>
                        </div>
                        <strong>{currency(subtotal)}</strong>
                      </div>
                      <div className="addon-controls">
                        {item.kind === "rate-select" ? (
                          <label className="control-block">
                            <span>Rate</span>
                            <select
                              value={state.selectedRateKey}
                              onChange={(event) =>
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  entertainment: {
                                    ...current.entertainment,
                                    [item.key]: {
                                      ...current.entertainment[item.key],
                                      selectedRateKey: event.target.value,
                                    },
                                  },
                                }))
                              }
                            >
                              {item.options?.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : item.kind === "manual-price" ? (
                          <label className="control-block">
                            <span>Price</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={state.manualPrice}
                              onChange={(event) =>
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  entertainment: {
                                    ...current.entertainment,
                                    [item.key]: {
                                      ...current.entertainment[item.key],
                                      manualPrice: event.target.value,
                                    },
                                  },
                                }))
                              }
                              placeholder="0.00"
                            />
                          </label>
                        ) : (
                          <div className="control-block locked-price">
                            <span>Price</span>
                            <strong>{currency(item.fixedPrice ?? 0)}</strong>
                          </div>
                        )}

                        <label className="control-block quantity-block">
                          <span>Quantity</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={state.quantity}
                            onChange={(event) =>
                              updateEventChecklist(activeEvent.id, (current) => ({
                                ...current,
                                entertainment: {
                                  ...current.entertainment,
                                  [item.key]: {
                                    ...current.entertainment[item.key],
                                    quantity: event.target.value,
                                  },
                                },
                              }))
                            }
                            placeholder="0"
                          />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>

            <article className="addon-card">
              <div className="addon-card-header">
                <div>
                  <h3>Food Add-Ons</h3>
                  <p>Locked prices stay fixed. Dessert Platter can be edited manually.</p>
                </div>
                <strong>{currency(foodSubtotal)}</strong>
              </div>
              <div className="addon-grid">
                {foodAddOns.map((item) => {
                  const state = activeChecklist.food[item.key];
                  const unitPrice = foodUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);
                  return (
                    <article className="addon-row-card" key={item.key}>
                      <div className="addon-row-top">
                        <div>
                          <h4>{item.label}</h4>
                          <p>{item.kind === "manual-price" ? "Manual price" : "Locked price"}</p>
                        </div>
                        <strong>{currency(subtotal)}</strong>
                      </div>
                      <div className="addon-controls">
                        {item.kind === "manual-price" ? (
                          <label className="control-block">
                            <span>Price</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              value={state.manualPrice}
                              onChange={(event) =>
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  food: {
                                    ...current.food,
                                    [item.key]: {
                                      ...current.food[item.key],
                                      manualPrice: event.target.value,
                                    },
                                  },
                                }))
                              }
                              placeholder="0.00"
                            />
                          </label>
                        ) : (
                          <div className="control-block locked-price">
                            <span>Price</span>
                            <strong>{currency(item.fixedPrice ?? 0)}</strong>
                          </div>
                        )}

                        <label className="control-block quantity-block">
                          <span>Quantity</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={state.quantity}
                            onChange={(event) =>
                              updateEventChecklist(activeEvent.id, (current) => ({
                                ...current,
                                food: {
                                  ...current.food,
                                  [item.key]: {
                                    ...current.food[item.key],
                                    quantity: event.target.value,
                                  },
                                },
                              }))
                            }
                            placeholder="0"
                          />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>

            <aside className="totals-card">
              <span className="eyebrow">Add-On Summary</span>
              <div className="summary-line">
                <span>Entertainment &amp; Drink</span>
                <strong>{currency(entertainmentSubtotal)}</strong>
              </div>
              <div className="summary-line">
                <span>Food</span>
                <strong>{currency(foodSubtotal)}</strong>
              </div>
              <div className="summary-line grand-total">
                <span>Total</span>
                <strong>{currency(entertainmentSubtotal + foodSubtotal)}</strong>
              </div>
            </aside>
          </section>
        )}
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="field-card">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function EditableField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-card">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function EditableTextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-card textarea-card">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={3} />
    </label>
  );
}
