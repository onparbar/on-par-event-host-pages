import type { EntertainmentSourceEvent } from "@/lib/entertainment/types";
import type {
  EventPlan,
  TripleseatEventPlanSource,
} from "@/lib/event-plans/types";
import type { KitchenSourceEvent } from "@/lib/kitchen/types";

type ConfirmedContractEvent = {
  confirmedAt: string;
  plan: EventPlan;
  eventPlanSource: TripleseatEventPlanSource;
  kitchenSource: KitchenSourceEvent;
  entertainmentSource: EntertainmentSourceEvent;
};

export type ConfirmedContractSyncCoverage = {
  startDate: string;
  endDate: string;
};

const AMAZON_AUG_21_ID = "62238275";
const AMAZON_AUG_21_BOOKING_ID = "58621092";
const AMAZON_AUG_21_CONFIRMED_AT = "2026-08-14T21:29:11.000Z";

const amazonAug21: ConfirmedContractEvent = {
  confirmedAt: AMAZON_AUG_21_CONFIRMED_AT,
  plan: {
    id: Number(AMAZON_AUG_21_ID),
    name: "Amazon 08/21/2026",
    date: "2026-08-21",
    day: "Friday",
    time: "4:00 PM - 7:00 PM",
    guest_count: 50,
    rooms: ["VIP 1"],
    color: "#1D4ED8",
    food: [
      "The Full Course - Food + $20 Drink Cards",
      "Jumbo Wing Bar",
      "5 Dessert Platters",
    ],
    drink_options: ["$20 Drink Cards"],
    entertainment: [
      {
        name: "Duckpin Bowling",
        quantity: "5 lanes",
        time: "4:30 PM - 6:30 PM",
        duration: "2 hours",
      },
      {
        name: "Darts",
        quantity: "4 lanes",
        time: "4:30 PM - 6:30 PM",
        duration: "2 hours",
      },
    ],
    verification_status:
      "Confirmed from the August 21 contract image supplied on August 14, 2026 and matched to Tripleseat event 62238275 (Amazon 08/21/2026).",
    needs_review: true,
    review_reasons: [
      "Bowling and dart lane numbers were not listed; adjacent physical resources are assigned automatically and require staff verification.",
      "Only page 1 of the 2-page contract was supplied; review the contract Special Instructions on page 2.",
    ],
    tripleseat_booking_id: AMAZON_AUG_21_BOOKING_ID,
    source_updated_at: AMAZON_AUG_21_CONFIRMED_AT,
    synced_at: AMAZON_AUG_21_CONFIRMED_AT,
    rule_version: "event-plan-v1.0.2",
  },
  eventPlanSource: {
    eventId: AMAZON_AUG_21_ID,
    bookingId: AMAZON_AUG_21_BOOKING_ID,
    eventName: "Amazon 08/21/2026",
    localDate: "2026-08-21",
    eventStartAt: "2026-08-21T20:00:00.000Z",
    eventEndAt: "2026-08-21T23:00:00.000Z",
    guestCount: 50,
    status: "DEFINITE",
    rooms: ["VIP 1"],
    selections: [
      {
        name: "The Full Course - Food + $20 Drink Cards",
        quantity: 50,
        sourceCategory: "Food Packages",
        isFood: true,
      },
      {
        name: "Jumbo Wing Bar",
        quantity: 50,
        sourceCategory: "Food Packages",
        isFood: true,
      },
      {
        name: "5 Dessert Platters",
        quantity: 5,
        sourceCategory: "Food Platters",
        isFood: true,
      },
    ],
    documentItems: [
      {
        sourceId: "contract-evidence:bowling",
        name: "Duckpin Bowling",
        description:
          "5 Duckpin Bowling lanes for 2 hours, 4:30 PM - 6:30 PM",
        categoryName: "Bowling",
        quantity: 5,
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      },
      {
        sourceId: "contract-evidence:darts",
        name: "Darts",
        description: "4 dart lanes for 2 hours, 4:30 PM - 6:30 PM",
        categoryName: "Darts",
        quantity: 4,
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      },
    ],
    operationalNotes: [],
    operationalNotesAvailable: false,
    operationalNotesTruncated: true,
    sourceUpdatedAt: AMAZON_AUG_21_CONFIRMED_AT,
    sourceSystem: "contract-evidence",
  },
  kitchenSource: {
    eventId: AMAZON_AUG_21_ID,
    bookingId: AMAZON_AUG_21_BOOKING_ID,
    eventName: "Amazon 08/21/2026",
    localDate: "2026-08-21",
    localDateVerified: true,
    startTime: "2026-08-21T16:00:00-04:00",
    endTime: "2026-08-21T19:00:00-04:00",
    guestCount: 50,
    status: "DEFINITE",
    statusVerified: true,
    room: "VIP 1",
    selections: [
      {
        name: "The Full Course - Food + $20 Drink Cards",
        quantity: 50,
        sourceCategory: "Food Packages",
        isFood: true,
      },
      {
        name: "Wing Bar",
        quantity: 50,
        sourceCategory: "Food Packages",
        isFood: true,
      },
      {
        name: "Dessert Platter",
        quantity: 5,
        sourceCategory: "Food Platters",
        isFood: true,
      },
    ],
    foodNotes: [],
    specialNotes: [
      "Only page 1 of the 2-page contract was supplied; review the contract Special Instructions on page 2.",
    ],
    sourceUpdatedAt: AMAZON_AUG_21_CONFIRMED_AT,
    sourceState: "stale",
  },
  entertainmentSource: {
    tripleseatEventId: AMAZON_AUG_21_ID,
    tripleseatBookingId: AMAZON_AUG_21_BOOKING_ID,
    eventName: "Amazon 08/21/2026",
    localDate: "2026-08-21",
    eventStartAt: "2026-08-21T20:00:00.000Z",
    eventEndAt: "2026-08-21T23:00:00.000Z",
    status: "DEFINITE",
    rooms: [{ id: null, name: "VIP 1" }],
    items: [
      {
        sourceId: "contract-evidence:bowling",
        name: "Duckpin Bowling",
        description:
          "5 Duckpin Bowling lanes for 2 hours, 4:30 PM - 6:30 PM",
        categoryName: "Bowling",
        quantity: 5,
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      },
      {
        sourceId: "contract-evidence:darts",
        name: "Darts",
        description: "4 dart lanes for 2 hours, 4:30 PM - 6:30 PM",
        categoryName: "Darts",
        quantity: 4,
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      },
    ],
    categoryNames: ["Bowling", "Darts", "Private Rooms"],
    sourceUpdatedAt: AMAZON_AUG_21_CONFIRMED_AT,
    noteCount: 0,
    sourceSystem: "contract-evidence",
  },
};

const CONFIRMED_CONTRACT_EVENTS = [amazonAug21] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizedName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function matchingIdentity(
  left: { date: string; name: string },
  right: { date: string; name: string },
) {
  return (
    left.date === right.date &&
    normalizedName(left.name) === normalizedName(right.name)
  );
}

function activeConfirmedEvents(
  startDate: string,
  endDate: string,
  lastSuccessfulSyncAt?: string | null,
  coverage?: ConfirmedContractSyncCoverage | null,
) {
  const effectiveCoverage =
    coverage ??
    (startDate === endDate ? { startDate, endDate } : null);
  return CONFIRMED_CONTRACT_EVENTS.filter(
    (event) =>
      event.plan.date >= startDate &&
      event.plan.date <= endDate &&
      !successfulSyncReplacedEvidence(
        lastSuccessfulSyncAt,
        event.confirmedAt,
        event.plan.date,
        effectiveCoverage,
      ),
  );
}

function successfulSyncReplacedEvidence(
  lastSuccessfulSyncAt: string | null | undefined,
  confirmedAt: string,
  eventDate: string,
  coverage?: ConfirmedContractSyncCoverage | null,
) {
  const syncedAt = Date.parse(lastSuccessfulSyncAt ?? "");
  const evidenceAt = Date.parse(confirmedAt);
  return (
    Number.isFinite(syncedAt) &&
    Number.isFinite(evidenceAt) &&
    Boolean(
      coverage &&
        coverage.startDate <= eventDate &&
        coverage.endDate >= eventDate,
    ) &&
    syncedAt >= evidenceAt
  );
}

export const confirmedContractEventPlans = CONFIRMED_CONTRACT_EVENTS.map(
  (event) => clone(event.plan),
);

export function confirmedContractEventPlanById(eventId: number) {
  const event = CONFIRMED_CONTRACT_EVENTS.find(
    (candidate) => candidate.plan.id === eventId,
  );
  return event ? clone(event.plan) : null;
}

export function isConfirmedContractEventPlanId(eventId: number) {
  return CONFIRMED_CONTRACT_EVENTS.some(
    (event) => event.plan.id === eventId,
  );
}

export function confirmedContractDatesInWindow(
  startDate: string,
  endDate: string,
) {
  return CONFIRMED_CONTRACT_EVENTS.flatMap((event) =>
    event.plan.date >= startDate && event.plan.date <= endDate
      ? [event.plan.date]
      : [],
  );
}

export function mergeConfirmedContractEventPlans(
  plans: readonly EventPlan[],
  startDate: string,
  endDate: string,
  lastSuccessfulSyncAt?: string | null,
  coverage?: ConfirmedContractSyncCoverage | null,
) {
  const merged = plans.map(clone);
  for (const event of activeConfirmedEvents(
    startDate,
    endDate,
    lastSuccessfulSyncAt,
    coverage,
  )) {
    const matchingIndex = merged.findIndex(
      (plan) =>
        plan.id === event.plan.id ||
        matchingIdentity(
          { date: plan.date, name: plan.name },
          { date: event.plan.date, name: event.plan.name },
        ),
    );
    if (
      matchingIndex >= 0 &&
      sourceIsAtLeastAsNew(
        merged[matchingIndex].source_updated_at,
        event.confirmedAt,
      )
    ) {
      continue;
    }
    if (matchingIndex >= 0) {
      merged[matchingIndex] = clone(event.plan);
    } else {
      merged.push(clone(event.plan));
    }
  }
  return merged.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.time.localeCompare(right.time) ||
      left.name.localeCompare(right.name),
  );
}

export function confirmedContractEventPlanSourcesForDate(
  date: string,
  lastSuccessfulSyncAt?: string | null,
  coverage?: ConfirmedContractSyncCoverage | null,
) {
  return activeConfirmedEvents(
    date,
    date,
    lastSuccessfulSyncAt,
    coverage,
  ).map(
    (event) => ({
      plan: clone(event.plan),
      source: clone(event.eventPlanSource),
      sourceEventId: event.eventPlanSource.eventId,
    }),
  );
}

export function confirmedContractKitchenSourcesForDate(
  date: string,
  lastSuccessfulSyncAt?: string | null,
) {
  return activeConfirmedEvents(date, date, lastSuccessfulSyncAt).map(
    (event) => clone(event.kitchenSource),
  );
}

export function confirmedContractEntertainmentSourcesForDate(
  date: string,
  lastSuccessfulSyncAt?: string | null,
) {
  return activeConfirmedEvents(date, date, lastSuccessfulSyncAt).map(
    (event) => clone(event.entertainmentSource),
  );
}

export function eventMatchesConfirmedContract(
  date: string,
  name: string,
  candidateDate: string,
  candidateName: string,
) {
  return matchingIdentity(
    { date, name },
    { date: candidateDate, name: candidateName },
  );
}

export function sourceIsAtLeastAsNew(
  sourceUpdatedAt: string | null | undefined,
  evidenceConfirmedAt: string | null | undefined,
) {
  const sourceTime = Date.parse(sourceUpdatedAt ?? "");
  const evidenceTime = Date.parse(evidenceConfirmedAt ?? "");
  return (
    Number.isFinite(sourceTime) &&
    Number.isFinite(evidenceTime) &&
    sourceTime >= evidenceTime
  );
}
