import { formatClock, parseTimeRange } from "@/lib/entertainment/time";
import { canonicalCategoryForText } from "@/lib/entertainment/resources";
import { floorPlanSourceNamesMatch } from "@/lib/floor-plans/source-resolution";
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
    sourceStart < planEnd &&
    sourceEnd > planStart
  );
}

function eventSnapshotMatchesPlan(
  event: EntertainmentEventSnapshot,
  plan: EventPlan,
) {
  const planId = String(plan.id);
  const identities = [event.tripleseatEventId, event.localEventId].filter(
    (value): value is string => Boolean(value),
  );
  if (identities.includes(planId)) return true;
  if (
    identities.length === 0 &&
    normalizedEventName(event.eventName) === normalizedEventName(plan.name)
  ) {
    return true;
  }
  return (
    floorPlanSourceNamesMatch(event.eventName, plan.name) &&
    sourceWindowMatchesPlan(
      event.operatingDate,
      event.eventStartAt,
      event.eventEndAt,
      plan,
    )
  );
}

function reservationMatchesPlan(
  reservation: EntertainmentReservation,
  plan: EventPlan,
) {
  const planId = String(plan.id);
  const identities = [
    reservation.tripleseatEventId,
    reservation.localEventId,
  ].filter((value): value is string => Boolean(value));
  if (identities.includes(planId)) return true;
  if (
    identities.length === 0 &&
    normalizedEventName(reservation.eventName) ===
      normalizedEventName(plan.name)
  ) {
    return true;
  }
  return (
    floorPlanSourceNamesMatch(reservation.eventName, plan.name) &&
    sourceWindowMatchesPlan(
      reservation.operatingDate,
      reservation.startAt,
      reservation.endAt,
      plan,
    )
  );
}

function durationLabel(startAt: string, endAt: string) {
  const minutes = Math.round(
    (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
  );
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "",
    remainingMinutes
      ? `${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`
      : "",
  ].filter(Boolean).join(" ");
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
      duration: durationLabel(first.startAt, first.endAt),
    };
  });
}

export function applyEntertainmentDayToItinerary(
  plan: EventPlan,
  day: EntertainmentDay,
) {
  if (day.date !== plan.date) return plan;
  const reservations = day.reservations.filter((reservation) =>
    reservationMatchesPlan(reservation, plan),
  );
  const eventExists = day.events.some((event) =>
    eventSnapshotMatchesPlan(event, plan),
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
