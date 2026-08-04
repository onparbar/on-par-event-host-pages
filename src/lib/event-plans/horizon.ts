import { EVENT_PLAN_TIME_ZONE } from "./types";

export { EVENT_PLAN_TIME_ZONE };

export type EventPlanHorizon = {
  startDate: string;
  endDate: string;
  dates: string[];
};

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function formatDate(parts: CalendarDateParts) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function parseDate(value: string): CalendarDateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function requiredDate(value: string) {
  const parts = parseDate(value);
  if (!parts) {
    throw new Error("Date must use a valid YYYY-MM-DD value.");
  }
  return parts;
}

export function isValidEventPlanDate(value: string) {
  return parseDate(value) !== null;
}

export function eventPlanToday(now = new Date()) {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Current time must be a valid Date.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_PLAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addOneCalendarMonthClamped(value: string) {
  const { year, month, day } = requiredDate(value);
  const nextMonth = new Date(Date.UTC(year, month, 1, 12));
  const nextYear = nextMonth.getUTCFullYear();
  const nextMonthNumber = nextMonth.getUTCMonth() + 1;
  const lastDay = new Date(
    Date.UTC(nextYear, nextMonthNumber, 0, 12),
  ).getUTCDate();

  return formatDate({
    year: nextYear,
    month: nextMonthNumber,
    day: Math.min(day, lastDay),
  });
}

export function enumerateEventPlanDates(
  startDate: string,
  endDate: string,
) {
  const start = requiredDate(startDate);
  const end = requiredDate(endDate);
  const startTimestamp = Date.UTC(start.year, start.month - 1, start.day, 12);
  const endTimestamp = Date.UTC(end.year, end.month - 1, end.day, 12);
  if (startTimestamp > endTimestamp) {
    throw new Error("Start date must be on or before end date.");
  }

  const dates: string[] = [];
  const cursor = new Date(startTimestamp);
  while (cursor.getTime() <= endTimestamp) {
    dates.push(
      formatDate({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
        day: cursor.getUTCDate(),
      }),
    );
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function rollingEventPlanHorizon(
  now = new Date(),
): EventPlanHorizon {
  const startDate = eventPlanToday(now);
  const endDate = addOneCalendarMonthClamped(startDate);
  return {
    startDate,
    endDate,
    dates: enumerateEventPlanDates(startDate, endDate),
  };
}
