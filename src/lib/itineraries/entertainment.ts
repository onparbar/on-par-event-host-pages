import { formatClock } from "@/lib/entertainment/time";
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

function eventSnapshotMatchesPlan(
  event: EntertainmentEventSnapshot,
  plan: EventPlan,
) {
  const planId = String(plan.id);
  const identities = [event.tripleseatEventId, event.localEventId].filter(
    (value): value is string => Boolean(value),
  );
  return identities.includes(planId) ||
    (identities.length === 0 &&
      normalizedEventName(event.eventName) === normalizedEventName(plan.name));
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
  return identities.includes(planId) ||
    (identities.length === 0 &&
      normalizedEventName(reservation.eventName) ===
        normalizedEventName(plan.name));
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
    entertainment: itineraryEntertainmentFromReservations(reservations),
  };
}
