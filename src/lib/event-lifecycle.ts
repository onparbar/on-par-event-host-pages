const EVENT_TIME_ZONE = "America/New_York";

type TimedEvent = {
  id: number;
  date: string;
  time: string;
};

type NamedTimedEvent = TimedEvent & {
  name: string;
};

type DatedAsset = {
  date: string;
  image: string;
  events: string[];
};

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const easternPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function minuteKey(value: LocalDateTime) {
  return (
    value.year * 100_000_000 +
    value.month * 1_000_000 +
    value.day * 10_000 +
    value.hour * 100 +
    value.minute
  );
}

function easternMinuteKey(value: Date) {
  const parts = easternDateTimeParts(value);

  return minuteKey(parts);
}

function easternDateTimeParts(value: Date) {
  const parts = Object.fromEntries(
    easternPartsFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function easternDateValue(value = new Date()) {
  const parts = easternDateTimeParts(value);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseClockTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  return (hour % 12) * 60 + minute + (match[3].toUpperCase() === "PM" ? 12 * 60 : 0);
}

function parseEventDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function eventMinuteKeys(event: TimedEvent) {
  const date = parseEventDate(event.date);
  const range = event.time.split(/\s+[-–—]\s+/);
  const startMinutes = range.length === 2 ? parseClockTime(range[0]) : null;
  const endMinutes = range.length === 2 ? parseClockTime(range[1]) : null;

  if (!date || startMinutes === null || endMinutes === null) {
    return null;
  }

  const startKey = minuteKey({
    ...date,
    hour: Math.floor(startMinutes / 60),
    minute: startMinutes % 60,
  });

  let endDate = date;
  if (endMinutes <= startMinutes) {
    const nextDate = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    endDate = {
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
    };
  }

  return {
    start: startKey,
    end: minuteKey({
      ...endDate,
      hour: Math.floor(endMinutes / 60),
      minute: endMinutes % 60,
    }),
  };
}

export function isEventOver(event: TimedEvent, now = new Date()) {
  const keys = eventMinuteKeys(event);
  return keys ? easternMinuteKey(now) >= keys.end : false;
}

export function activeEvents<T extends TimedEvent>(
  items: T[],
  manuallyArchivedIds: number[] = [],
  now = new Date(),
) {
  const manuallyArchived = new Set(manuallyArchivedIds);
  const currentMinute = easternMinuteKey(now);

  return items
    .map((event, index) => ({
      event,
      index,
      keys: eventMinuteKeys(event),
    }))
    .filter(({ event, keys }) => {
      if (manuallyArchived.has(event.id)) {
        return false;
      }

      return !keys || currentMinute < keys.end;
    })
    .sort((left, right) => {
      if (!left.keys) return right.keys ? 1 : left.index - right.index;
      if (!right.keys) return -1;
      return left.keys.start - right.keys.start || left.index - right.index;
    })
    .map(({ event }) => event);
}

export function eventsForDatedAsset<T extends NamedTimedEvent>(
  asset: DatedAsset,
  items: T[],
) {
  const eventNames = new Set(asset.events);
  return items.filter(
    (event) =>
      event.date === asset.date &&
      (!eventNames.size || eventNames.has(event.name)),
  );
}

export function activeDatedAssets<
  TAsset extends DatedAsset,
  TEvent extends NamedTimedEvent,
>(
  assets: TAsset[],
  items: TEvent[],
  manuallyArchivedKeys: string[] = [],
  now = new Date(),
) {
  const manuallyArchived = new Set(manuallyArchivedKeys);
  const currentDate = easternDateValue(now);

  return assets
    .filter((asset) => {
      if (manuallyArchived.has(asset.image)) {
        return false;
      }

      const associatedEvents = eventsForDatedAsset(asset, items);
      if (associatedEvents.length) {
        return associatedEvents.some((event) => !isEventOver(event, now));
      }

      return asset.date >= currentDate;
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.image.localeCompare(right.image),
    );
}
