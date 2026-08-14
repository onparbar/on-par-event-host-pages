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

const MANAGER_OUTING_ID = "2026082101";
const MANAGER_OUTING_CONFIRMED_AT = "2026-08-14T21:29:11.000Z";

const managerOuting: ConfirmedContractEvent = {
  confirmedAt: MANAGER_OUTING_CONFIRMED_AT,
  plan: {
    id: Number(MANAGER_OUTING_ID),
    name: "Manager Outing",
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
      "Confirmed from the August 21 contract image supplied to Event Host on August 14, 2026. The exact Tripleseat event ID is not visible in the supplied image.",
    needs_review: true,
    review_reasons: [
      "Temporary contract-evidence record: replace the synthetic Event Host ID with the exact Tripleseat event ID after the live connection is restored.",
      "Bowling and dart lane numbers were not listed; adjacent physical resources are assigned automatically and require staff verification.",
      "Only page 1 of the 2-page contract was supplied; review the contract Special Instructions on page 2.",
    ],
    tripleseat_booking_id: null,
    source_updated_at: MANAGER_OUTING_CONFIRMED_AT,
    synced_at: MANAGER_OUTING_CONFIRMED_AT,
    rule_version: "event-plan-v1.0.2",
  },
  eventPlanSource: {
    eventId: MANAGER_OUTING_ID,
    bookingId: null,
    eventName: "Manager Outing",
    localDate: "2026-08-21",
    eventStartAt: "2026-08-21T20:00:00.000Z",
    eventEndAt: "2026-08-21T23:00:00.000Z",
    guestCount: 50,
    status: "MANUAL CONFIRMED",
    rooms: ["VIP 1"],
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
    sourceUpdatedAt: MANAGER_OUTING_CONFIRMED_AT,
    sourceSystem: "contract-evidence",
  },
  kitchenSource: {
    eventId: MANAGER_OUTING_ID,
    bookingId: null,
    eventName: "Manager Outing",
    localDate: "2026-08-21",
    localDateVerified: true,
    startTime: "2026-08-21T16:00:00-04:00",
    endTime: "2026-08-21T19:00:00-04:00",
    guestCount: 50,
    status: "MANUAL CONFIRMED",
    statusVerified: false,
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
    sourceUpdatedAt: MANAGER_OUTING_CONFIRMED_AT,
    sourceState: "stale",
  },
  entertainmentSource: {
    tripleseatEventId: MANAGER_OUTING_ID,
    tripleseatBookingId: null,
    eventName: "Manager Outing",
    localDate: "2026-08-21",
    eventStartAt: "2026-08-21T20:00:00.000Z",
    eventEndAt: "2026-08-21T23:00:00.000Z",
    status: "MANUAL CONFIRMED",
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
    sourceUpdatedAt: MANAGER_OUTING_CONFIRMED_AT,
    noteCount: 0,
    sourceSystem: "contract-evidence",
  },
};

const CONFIRMED_CONTRACT_EVENTS = [managerOuting] as const;

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
  _lastSuccessfulSyncAt?: string | null,
  _coverage?: ConfirmedContractSyncCoverage | null,
) {
  return CONFIRMED_CONTRACT_EVENTS.filter(
    (event) =>
      event.plan.date >= startDate &&
      event.plan.date <= endDate,
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
    const matchingIndex = merged.findIndex((plan) =>
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
