import type { KitchenChecklist } from "./types";

const KITCHEN_TIME_ZONE = "America/New_York";
const EXPLICIT_INSTANT_PATTERN =
  /(?:Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const LOCAL_CLOCK_PATTERN =
  /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type TimeParts = {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

type LocalDateTime = DateParts & TimeParts;

export type KitchenLifecycleEvent = Pick<
  KitchenChecklist["event"],
  "localDate" | "startTime" | "endTime"
>;

const easternPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: KITCHEN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parseDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const result = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const calendarDate = new Date(
    Date.UTC(result.year, result.month - 1, result.day),
  );
  return calendarDate.getUTCFullYear() === result.year &&
    calendarDate.getUTCMonth() + 1 === result.month &&
    calendarDate.getUTCDate() === result.day
    ? result
    : null;
}

function parseMilliseconds(value: string | undefined) {
  return Number((value ?? "").padEnd(3, "0") || 0);
}

function parseClock(value: string): TimeParts | null {
  const match = LOCAL_CLOCK_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  const millisecond = parseMilliseconds(match[4]);
  const meridiem = match[5]?.toUpperCase();

  if (minute > 59 || second > 59) {
    return null;
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }

  return { hour, minute, second, millisecond };
}

function parseLocalDateTime(value: string): LocalDateTime | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`);
  const time = parseClock(
    `${match[4]}:${match[5]}:${match[6] ?? "00"}.${match[7] ?? "000"}`,
  );
  return date && time ? { ...date, ...time } : null;
}

function easternPartsAt(epochMilliseconds: number): LocalDateTime {
  const parts = Object.fromEntries(
    easternPartsFormatter
      .formatToParts(new Date(epochMilliseconds))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: new Date(epochMilliseconds).getUTCMilliseconds(),
  };
}

function sameLocalDateTime(
  left: LocalDateTime,
  right: LocalDateTime,
) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second &&
    left.millisecond === right.millisecond
  );
}

function offsetAt(epochMilliseconds: number) {
  const wholeSecondEpoch =
    Math.floor(epochMilliseconds / 1_000) * 1_000;
  const parts = easternPartsAt(wholeSecondEpoch);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - wholeSecondEpoch
  );
}

function unambiguousEasternEpoch(value: LocalDateTime) {
  const desiredAsUtc = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(offsetAt(desiredAsUtc + hours * 60 * 60 * 1_000));
  }

  const candidates = new Set<number>();
  for (const offset of offsets) {
    const candidate = desiredAsUtc - offset;
    if (sameLocalDateTime(easternPartsAt(candidate), value)) {
      candidates.add(candidate);
    }
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

function explicitInstant(value: string) {
  if (!EXPLICIT_INSTANT_PATTERN.test(value.trim())) {
    return null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function addLocalDay(date: DateParts): DateParts {
  const next = new Date(
    Date.UTC(date.year, date.month - 1, date.day + 1, 12),
  );
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function sameDate(left: DateParts, right: DateParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day
  );
}

function endDateMatchesEventDate(
  eventDate: DateParts,
  endDate: DateParts,
) {
  return (
    sameDate(eventDate, endDate) ||
    sameDate(addLocalDay(eventDate), endDate)
  );
}

function timeValue(value: TimeParts) {
  return (
    value.hour * 60 * 60 * 1_000 +
    value.minute * 60 * 1_000 +
    value.second * 1_000 +
    value.millisecond
  );
}

function localStart(
  value: string,
  eventDate: DateParts,
): LocalDateTime | null {
  const instant = explicitInstant(value);
  if (instant !== null) {
    const local = easternPartsAt(instant);
    return local.year === eventDate.year &&
      local.month === eventDate.month &&
      local.day === eventDate.day
      ? local
      : null;
  }

  const dateTime = parseLocalDateTime(value);
  if (dateTime) {
    return dateTime.year === eventDate.year &&
      dateTime.month === eventDate.month &&
      dateTime.day === eventDate.day &&
      unambiguousEasternEpoch(dateTime) !== null
      ? dateTime
      : null;
  }

  const clock = parseClock(value);
  if (!clock) {
    return null;
  }
  const local = { ...eventDate, ...clock };
  return unambiguousEasternEpoch(local) !== null ? local : null;
}

function eventEndEpoch(event: KitchenLifecycleEvent) {
  const endTime = event.endTime?.trim();
  const eventDate = parseDate(event.localDate);
  if (!endTime || !eventDate) {
    return null;
  }

  if (EXPLICIT_INSTANT_PATTERN.test(endTime)) {
    const instant = explicitInstant(endTime);
    if (instant === null) {
      return null;
    }
    return endDateMatchesEventDate(
      eventDate,
      easternPartsAt(instant),
    )
      ? instant
      : null;
  }

  const localEnd = parseLocalDateTime(endTime);
  if (localEnd) {
    return endDateMatchesEventDate(eventDate, localEnd)
      ? unambiguousEasternEpoch(localEnd)
      : null;
  }

  const endClock = parseClock(endTime);
  const startTime = event.startTime?.trim();
  if (!endClock || !startTime) {
    return null;
  }
  const start = localStart(startTime, eventDate);
  if (!start) {
    return null;
  }

  const endDate =
    timeValue(endClock) <= timeValue(start)
      ? addLocalDay(eventDate)
      : eventDate;
  return unambiguousEasternEpoch({ ...endDate, ...endClock });
}

function eventStartEpoch(event: KitchenLifecycleEvent) {
  const startTime = event.startTime?.trim();
  const eventDate = parseDate(event.localDate);
  if (!startTime || !eventDate) {
    return null;
  }

  if (EXPLICIT_INSTANT_PATTERN.test(startTime)) {
    const instant = explicitInstant(startTime);
    if (instant === null) {
      return null;
    }
    return sameDate(eventDate, easternPartsAt(instant)) ? instant : null;
  }

  const localDateTime = parseLocalDateTime(startTime);
  if (localDateTime) {
    return sameDate(eventDate, localDateTime)
      ? unambiguousEasternEpoch(localDateTime)
      : null;
  }

  const clock = parseClock(startTime);
  return clock
    ? unambiguousEasternEpoch({ ...eventDate, ...clock })
    : null;
}

export function kitchenEventInterval(event: KitchenLifecycleEvent) {
  return {
    startAt: eventStartEpoch(event),
    endAt: eventEndEpoch(event),
  };
}

export function isKitchenEventOver(
  event: KitchenLifecycleEvent,
  now = new Date(),
) {
  const endEpoch = eventEndEpoch(event);
  const currentEpoch = now.getTime();
  return (
    endEpoch !== null &&
    Number.isFinite(currentEpoch) &&
    currentEpoch >= endEpoch
  );
}

export function activeKitchenChecklists<
  T extends { event: KitchenLifecycleEvent },
>(
  events: readonly T[],
  now = new Date(),
) {
  return events.filter(
    (checklist) => !isKitchenEventOver(checklist.event, now),
  );
}
