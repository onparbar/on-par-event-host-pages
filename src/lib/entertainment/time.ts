import { ENTERTAINMENT_TIME_ZONE } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_IN_OPERATING_DAY = 15 * 60;

function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}
function localParts(value: Date, timeZone = ENTERTAINMENT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetAt(timestamp: number, timeZone = ENTERTAINMENT_TIME_ZONE) {
  const parts = localParts(new Date(timestamp), timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - timestamp;
}

export function isValidEntertainmentDate(value: string) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const { year, month, day } = dateParts(value);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function addCalendarDays(value: string, amount: number) {
  if (!isValidEntertainmentDate(value)) {
    throw new Error("Date must use YYYY-MM-DD.");
  }
  const { year, month, day } = dateParts(value);
  const result = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function zonedDateTimeToIso(
  date: string,
  hour: number,
  minute: number,
  timeZone = ENTERTAINMENT_TIME_ZONE,
) {
  if (
    !isValidEntertainmentDate(date) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("Invalid local date or time.");
  }
  const { year, month, day } = dateParts(date);
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = wallClockUtc - offsetAt(wallClockUtc, timeZone);
  timestamp = wallClockUtc - offsetAt(timestamp, timeZone);
  const roundTrip = localParts(new Date(timestamp), timeZone);
  if (
    roundTrip.year !== year ||
    roundTrip.month !== month ||
    roundTrip.day !== day ||
    roundTrip.hour !== hour ||
    roundTrip.minute !== minute
  ) {
    throw new Error("The selected local time does not exist in America/New_York.");
  }
  return new Date(timestamp).toISOString();
}

export function operatingWindow(date: string) {
  return {
    startAt: zonedDateTimeToIso(date, 10, 0),
    endAt: zonedDateTimeToIso(addCalendarDays(date, 1), 1, 0),
  };
}

export function operatingMinutesForIso(iso: string, date: string) {
  const timestamp = Date.parse(iso);
  const start = Date.parse(operatingWindow(date).startAt);
  return Number.isFinite(timestamp) ? Math.round((timestamp - start) / 60_000) : null;
}

export function isoForOperatingMinutes(date: string, minutes: number) {
  if (!Number.isFinite(minutes)) {
    throw new Error("Invalid operating-day minutes.");
  }
  const start = Date.parse(operatingWindow(date).startAt);
  return new Date(start + Math.round(minutes) * 60_000).toISOString();
}

export function isInsideOperatingDay(
  startAt: string,
  endAt: string,
  date: string,
) {
  const window = operatingWindow(date);
  return (
    Date.parse(startAt) >= Date.parse(window.startAt) &&
    Date.parse(endAt) <= Date.parse(window.endAt)
  );
}

export function snapOperatingMinutes(value: number) {
  return Math.round(value / 15) * 15;
}

export function clampOperatingMinutes(value: number) {
  return Math.max(0, Math.min(MINUTES_IN_OPERATING_DAY, value));
}

export function parseClockTime(value: string) {
  const match = value
    .trim()
    .match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) {
    return null;
  }
  const rawHour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (rawHour < 1 || rawHour > 12 || minute > 59) {
    return null;
  }
  const period = match[3].replace(/\./g, "").toLowerCase();
  return {
    hour: (rawHour % 12) + (period === "pm" ? 12 : 0),
    minute,
  };
}

export function parseTimeRange(value: string, operatingDate: string) {
  const matches = [...value.matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi)];
  if (matches.length < 2) {
    return null;
  }
  const first = parseClockTime(matches[0][0]);
  const second = parseClockTime(matches[1][0]);
  if (!first || !second) {
    return null;
  }
  const startAt = zonedDateTimeToIso(
    first.hour < 10 ? addCalendarDays(operatingDate, 1) : operatingDate,
    first.hour,
    first.minute,
  );
  let endDate = second.hour < 10 ? addCalendarDays(operatingDate, 1) : operatingDate;
  let endAt = zonedDateTimeToIso(endDate, second.hour, second.minute);
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    endDate = addCalendarDays(endDate, 1);
    endAt = zonedDateTimeToIso(endDate, second.hour, second.minute);
  }
  return { startAt, endAt };
}

export function localDateForIso(
  iso: string,
  timeZone = ENTERTAINMENT_TIME_ZONE,
) {
  const parts = localParts(new Date(iso), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function todayInEntertainmentTimeZone(now = new Date()) {
  return localDateForIso(now.toISOString());
}

export function formatClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ENTERTAINMENT_TIME_ZONE,
  }).format(new Date(iso));
}

export function formatFullDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function startOfWeek(date: string) {
  const { year, month, day } = dateParts(date);
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  return addCalendarDays(date, -value.getUTCDay());
}
