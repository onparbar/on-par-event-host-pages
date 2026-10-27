import { formatClock, parseTimeRange } from "@/lib/entertainment/time";
import { formatEntertainmentIntervalHours } from "@/lib/entertainment/duration";
import { canonicalCategoryForText } from "@/lib/entertainment/resources";
import { floorPlanEventSourceIds } from "@/lib/floor-plans/identity";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import type {
  EntertainmentDayPayload,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import type {
  EventPlan,
  EventPlanEntertainmentItem,
} from "@/lib/event-plans/types";

type EntertainmentDay = Pick<
  EntertainmentDayPayload,
  "date" | "events" | "reservations"
>;

type ItineraryIdentityScope = {
  sourceEventIds?: readonly string[];
  allowLegacyNameMatch?: boolean;
};

function normalizedEventName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function sourceWindowMatchesPlan(
  operatingDate: string,
  startAt: string | null,
  endAt: string | null,
  plan: EventPlan,
) {
  if (operatingDate !== plan.date || !startAt || !endAt) return false;
  const planWindow = parseTimeRange(plan.time, plan.date);
  if (!planWindow) return false;
  const sourceStart = Date.parse(startAt);
  const sourceEnd = Date.parse(endAt);
  const planStart = Date.parse(planWindow.startAt);
  const planEnd = Date.parse(planWindow.endAt);
  return (
    [sourceStart, sourceEnd, planStart, planEnd].every(Number.isFinite) &&
    sourceStart < sourceEnd &&
    sourceStart < planEnd &&
    sourceEnd > planStart
  );
}

export function itineraryIdentityScope(
  plan: EventPlan,
  floorPlan: FloorPlanDocument | null,
  floorPlanPersisted: boolean,
  candidates?: readonly EventPlan[],
): ItineraryIdentityScope {
  const linkedEvents = floorPlanPersisted && floorPlan?.eventDate === plan.date
    ? floorPlan.events.filter((event) => floorPlanEventSourceIds(event).has(String(plan.id)))
    : [];
  const planWindow = parseTimeRange(plan.time, plan.date);
  const sameNameCandidates = candidates?.filter((candidate) => {
    if (candidate.date !== plan.date || normalizedEventName(candidate.name) !== normalizedEventName(plan.name)) return false;
    const window = parseTimeRange(candidate.time, candidate.date);
    return !planWindow || !window || Date.parse(window.startAt) < Date.parse(planWindow.endAt) && Date.parse(window.endAt) > Date.parse(planWindow.startAt);
  });
  const candidateIds = new Set(sameNameCandidates?.map((candidate) => candidate.id));
  return {
    sourceEventIds: linkedEvents.length === 1 ? [...floorPlanEventSourceIds(linkedEvents[0])] : [],
    allowLegacyNameMatch: Boolean(planWindow && candidates && candidateIds.size === 1 && candidateIds.has(plan.id)),
  };
}

function sourceIdentityMatches(
  identities: readonly string[],
  eventName: string,
  operatingDate: string,
  startAt: string | null,
  endAt: string | null,
  plan: EventPlan,
  scope: ItineraryIdentityScope,
) {
  const allowedIds = new Set([String(plan.id), ...(scope.sourceEventIds ?? [])]);
  if (identities.some((id) => allowedIds.has(id))) return true;
  return identities.length === 0 && scope.allowLegacyNameMatch === true &&
    normalizedEventName(eventName) === normalizedEventName(plan.name) &&
    sourceWindowMatchesPlan(operatingDate, startAt, endAt, plan);
}

export function itinerarySnapshotMatchesPlan(
  event: EntertainmentEventSnapshot,
  plan: EventPlan,
  scope: ItineraryIdentityScope = {},
) {
  const identities = [event.tripleseatEventId, event.localEventId].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  return sourceIdentityMatches(identities, event.eventName, event.operatingDate, event.eventStartAt, event.eventEndAt, plan, scope);
}

export function itineraryReservationMatchesPlan(
  reservation: EntertainmentReservation,
  plan: EventPlan,
  scope: ItineraryIdentityScope = {},
) {
  const identities = [
    reservation.tripleseatEventId,
    reservation.localEventId,
  ].filter((value): value is string => Boolean(value?.trim()));
  return sourceIdentityMatches(identities, reservation.eventName, reservation.operatingDate, reservation.startAt, reservation.endAt, plan, scope);
}

export function hasAmbiguousLegacyItineraryIdentity(day: EntertainmentDay, plan: EventPlan, scope: ItineraryIdentityScope) {
  const unresolved = (eventName: string, date: string, startAt: string | null, endAt: string | null) => {
    if (date !== plan.date || normalizedEventName(eventName) !== normalizedEventName(plan.name)) return false;
    if (!startAt || !endAt || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(startAt) >= Date.parse(endAt)) return true;
    return !scope.allowLegacyNameMatch && sourceWindowMatchesPlan(date, startAt, endAt, plan);
  };
  return day.events.some((event) => event.active && !event.tripleseatEventId?.trim() && !event.localEventId?.trim() && unresolved(event.eventName, event.operatingDate, event.eventStartAt, event.eventEndAt)) ||
    day.reservations.some((reservation) => reservation.active && !reservation.tripleseatEventId?.trim() && !reservation.localEventId?.trim() && unresolved(reservation.eventName, reservation.operatingDate, reservation.startAt, reservation.endAt));
}

function groupName(reservation: EntertainmentReservation) {
  switch (reservation.resourceCategory) {
    case "bowling":
      return "Duckpin Bowling";
    case "darts":
      return "Darts";
    case "pool":
      return "Pool";
    case "shuffleboard":
      return "Shuffleboard";
    case "private-rooms":
      return reservation.resourceName;
    case "mini-golf":
      return "Mini Golf";
  }
}

function quantityLabel(
  reservation: EntertainmentReservation,
  quantity: number,
) {
  if (
    reservation.resourceCategory === "pool" ||
    reservation.resourceCategory === "shuffleboard"
  ) {
    return `${quantity} table${quantity === 1 ? "" : "s"}`;
  }
  if (reservation.resourceCategory === "private-rooms") {
    return `${quantity} room${quantity === 1 ? "" : "s"}`;
  }
  return `${quantity} lane${quantity === 1 ? "" : "s"}`;
}

function reservedResourcesLabel(
  reservations: readonly EntertainmentReservation[],
) {
  const first = reservations[0];
  const numberedPrefixes: Partial<
    Record<EntertainmentReservation["resourceCategory"], string>
  > = {
    bowling: "Bowling Lane",
    darts: "Dart Lane",
    pool: "Pool Table",
    shuffleboard: "Shuffleboard Table",
  };
  const prefix = numberedPrefixes[first.resourceCategory];
  const numbers = reservations.flatMap((reservation) => {
    const match = reservation.resourceId.match(/-(\d+)$/);
    return match ? [Number(match[1])] : [];
  });
  if (prefix && numbers.length === reservations.length) {
    const sorted = [...new Set(numbers)].sort((left, right) => left - right);
    const ranges: string[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const start = sorted[index];
      let end = start;
      while (sorted[index + 1] === end + 1) {
        end = sorted[index + 1];
        index += 1;
      }
      ranges.push(start === end ? String(start) : `${start}–${end}`);
    }
    return `${prefix}${sorted.length === 1 ? "" : "s"} ${ranges.join(", ")}`;
  }
  return reservations.map((reservation) => reservation.resourceName).join(", ");
}

function contractMiniGolfItems(
  items: readonly EventPlanEntertainmentItem[],
) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (canonicalCategoryForText(item.name) !== "mini-golf") return false;
    const key = `${item.name}|${item.quantity}`.toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function itineraryEntertainmentFromReservations(
  reservations: readonly EntertainmentReservation[],
): EventPlanEntertainmentItem[] {
  const groups = new Map<string, EntertainmentReservation[]>();
  for (const reservation of reservations
    .filter(
      (item) => item.active && item.resourceCategory !== "mini-golf",
    )
    .sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) ||
        left.endAt.localeCompare(right.endAt) ||
        left.resourceName.localeCompare(right.resourceName, undefined, {
          numeric: true,
        }),
    )) {
    const resourceKey = reservation.resourceCategory === "private-rooms"
      ? reservation.resourceId
      : reservation.resourceCategory;
    const key = `${resourceKey}:${reservation.startAt}:${reservation.endAt}`;
    groups.set(key, [...(groups.get(key) ?? []), reservation]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    return {
      name: groupName(first),
      quantity: `${quantityLabel(first, group.length)} · ${reservedResourcesLabel(group)}`,
      time: `${formatClock(first.startAt)} – ${formatClock(first.endAt)}`,
      duration: formatEntertainmentIntervalHours(first.startAt, first.endAt),
    };
  });
}

export function applyEntertainmentDayToItinerary(
  plan: EventPlan,
  day: EntertainmentDay,
  scope: ItineraryIdentityScope = {},
) {
  if (day.date !== plan.date) return plan;
  const reservations = day.reservations.filter((reservation) =>
    itineraryReservationMatchesPlan(reservation, plan, scope),
  );
  const eventExists = day.events.some((event) =>
    itinerarySnapshotMatchesPlan(event, plan, scope),
  );
  if (!eventExists && reservations.length === 0) return plan;
  return {
    ...plan,
    // Mini Golf is contract-only open play, so it has no saved timed
    // reservation. Keep its contracted quantity when replacing timed items
    // with the live schedule.
    entertainment: [
      ...itineraryEntertainmentFromReservations(reservations),
      ...contractMiniGolfItems(plan.entertainment),
    ],
  };
}
