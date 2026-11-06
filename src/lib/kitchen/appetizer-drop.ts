import { kitchenEventInterval } from "./lifecycle";
import { KITCHEN_TIME_ZONE, type KitchenChecklist, type KitchenFoodKey } from "./types";

const HOT_APPETIZER_KEYS = new Set<KitchenFoodKey>([
  "appetizer-tater-kegs",
  "appetizer-mozzarella-sticks",
  "appetizer-chicken-tenders",
  "wing-wings",
  "wing-fries",
  "platter-tater-kegs",
  "platter-mozzarella-sticks",
  "platter-chicken-tenders",
  "platter-wings",
  "platter-fries",
]);
const FOOD_CONTEXT = /\b(?:appetizers?|food|buffet|platters?|wings?|fries|tater|tenders?|mozzarella)\b/i;
const TIMING_CONTEXT = /\b(?:drop(?:ped)?|ready|serv(?:e|ed|ice|ing)|before|prior|after|until|later|early|arrival|tim(?:e|ing))\b/i;
const CLOCK_CONTEXT = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b/i;
const GLOBAL_FOOD = "(?:appetizers?|(?:all |hot |fried )?food|all (?:hot )?platters)";
const DROP_ACTION = "(?:drop|cook|fry)";
const DROP_SUBJECT = `(?:${DROP_ACTION} ${GLOBAL_FOOD}|${GLOBAL_FOOD}(?: (?:should|must))?(?: (?:be|to be))? (?:dropped|cooked|fried)|${GLOBAL_FOOD} drop(?: time)?)`;
const CLOCK_OVERRIDE = new RegExp(
  `^(?:please )?${DROP_SUBJECT}\\s*(?:at|:)\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{2}:\\d{2})[.!]?$`,
  "i",
);
const RELATIVE_OVERRIDE = new RegExp(
  `^(?:please )?${DROP_SUBJECT}\\s*(?:at|:)?\\s*(\\d{1,3})\\s*(?:minutes?|mins?)\\s*(before|prior to|after)\\s*(?:the )?event(?: start)?[.!]?$`,
  "i",
);

export type KitchenAppetizerDropReminder = {
  scheduledAt: string | null;
  source: "default" | "contract" | "needs-review";
  itemKeys: KitchenFoodKey[];
  itemNames: string[];
  sourceNotes: string[];
};

export function kitchenLocalMinute(epoch: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: KITCHEN_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(epoch)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function unambiguousDropMinute(epoch: number) {
  const minute = kitchenLocalMinute(epoch);
  return kitchenEventInterval({
    localDate: minute.slice(0, 10),
    startTime: minute,
    endTime: null,
  }).startAt === Math.floor(epoch / 60_000) * 60_000 ? minute : null;
}

function explicitDropTime(note: string, checklist: KitchenChecklist, startAt: number) {
  const relative = RELATIVE_OVERRIDE.exec(note);
  if (relative) {
    return startAt + Number(relative[1]) * 60_000 * (relative[2].toLowerCase() === "after" ? 1 : -1);
  }
  const clock = CLOCK_OVERRIDE.exec(note)?.[1];
  if (!clock) {
    return null;
  }
  const normalizedClock = clock.replace(/^(\d{1,2})\s*(am|pm)$/i, "$1:00 $2");
  return kitchenEventInterval({
    localDate: checklist.event.localDate,
    startTime: normalizedClock,
    endTime: null,
  }).startAt;
}

/** A cooking reminder only: never changes food-ready time or GoTab dispatch. */
export function appetizerDropReminder(
  checklist: KitchenChecklist,
): KitchenAppetizerDropReminder | null {
  const items = checklist.sections.flatMap((section) => section.rows).filter(
    (row) => HOT_APPETIZER_KEYS.has(row.key) && row.quantity !== null && row.quantity > 0,
  );
  if (!items.length) {
    return null;
  }
  const sourceNotes = [...new Set([
    ...(checklist.event.foodNotes ?? []).map((note) => note.text),
    ...checklist.event.specialNotes,
  ])].map((note) => note.replace(/\s+/g, " ").trim()).filter(
    (note) => FOOD_CONTEXT.test(note) && (CLOCK_CONTEXT.test(note) ||
      (TIMING_CONTEXT.test(note) &&
        (/\d/.test(note) || /\b(?:before|prior|after|until|later|early|arrival|time|timing)\b/i.test(note)))),
  );
  const base = {
    itemKeys: items.map((item) => item.key),
    itemNames: [...new Set(items.map((item) => item.foodName))],
    sourceNotes,
  };
  const { startAt, endAt } = kitchenEventInterval(checklist.event);
  if (startAt === null) {
    return { ...base, scheduledAt: null, source: "needs-review" };
  }
  if (!sourceNotes.length) {
    const scheduledAt = unambiguousDropMinute(startAt - 30 * 60_000);
    return {
      ...base,
      scheduledAt,
      source: scheduledAt ? "default" : "needs-review",
    };
  }
  const overrides = sourceNotes.map((note) => explicitDropTime(note, checklist, startAt));
  const uniqueTimes = new Set(overrides);
  // Service time is not a cooking instruction. Ambiguous, item-specific, or
  // conflicting notes require review instead of silently using the default.
  if (uniqueTimes.size !== 1 || overrides[0] === null ||
      overrides[0] >= (endAt ?? startAt) ||
      overrides[0] < startAt - 24 * 60 * 60_000) {
    return { ...base, scheduledAt: null, source: "needs-review" };
  }
  const scheduledAt = unambiguousDropMinute(overrides[0]);
  return {
    ...base,
    scheduledAt,
    source: scheduledAt ? "contract" : "needs-review",
  };
}
