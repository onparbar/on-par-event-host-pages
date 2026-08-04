import { kitchenEventInterval } from "./lifecycle";

export type KitchenFocusEvent = {
  event: {
    eventId: string | number;
    name: string;
    localDate: string;
    startTime: string | null;
    endTime: string | null;
  };
  timing: {
    startTime: string | null;
    foodReadyBy: string | null;
  };
};

export type KitchenFocusItem = {
  event: KitchenFocusEvent;
  startAt: number;
  endAt: number | null;
  foodReadyAt: number | null;
};

export type KitchenFocusSnapshot = {
  current: KitchenFocusItem | null;
  currentEventCount: number;
  next: KitchenFocusItem | null;
};

function eventInterval(value: KitchenFocusEvent) {
  return kitchenEventInterval({
    localDate: value.event.localDate,
    startTime: value.timing.startTime ?? value.event.startTime,
    endTime: value.event.endTime,
  });
}

function foodReadyAt(value: KitchenFocusEvent) {
  if (!value.timing.foodReadyBy) {
    return null;
  }
  return kitchenEventInterval({
    localDate: value.event.localDate,
    startTime: value.timing.foodReadyBy,
    endTime: null,
  }).startAt;
}

function compareCurrent(left: KitchenFocusItem, right: KitchenFocusItem) {
  if (left.endAt === null) return right.endAt === null ? left.startAt - right.startAt : 1;
  if (right.endAt === null) return -1;
  return left.endAt - right.endAt || left.startAt - right.startAt;
}

export function kitchenFocusSnapshot(
  events: readonly KitchenFocusEvent[],
  now: Date,
): KitchenFocusSnapshot {
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt)) {
    return { current: null, currentEventCount: 0, next: null };
  }

  const timed = events.flatMap((event) => {
    const interval = eventInterval(event);
    return interval.startAt === null
      ? []
      : [{
          event,
          startAt: interval.startAt,
          endAt: interval.endAt,
          foodReadyAt: foodReadyAt(event),
        } satisfies KitchenFocusItem];
  });
  const currentEvents = timed
    .filter(
      (item) =>
        item.startAt <= nowAt &&
        (item.endAt === null || nowAt < item.endAt),
    )
    .sort(compareCurrent);
  const next = timed
    .filter((item) => item.startAt > nowAt)
    .sort((left, right) => left.startAt - right.startAt)[0] ?? null;

  return {
    current: currentEvents[0] ?? null,
    currentEventCount: currentEvents.length,
    next,
  };
}

export function minutesUntil(targetAt: number | null, now: Date) {
  if (targetAt === null || !Number.isFinite(now.getTime())) {
    return null;
  }
  return Math.ceil((targetAt - now.getTime()) / 60_000);
}
