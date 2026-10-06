import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getEntertainmentDay } from "@/lib/entertainment/sync";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { ENTERTAINMENT_TIME_ZONE } from "@/lib/entertainment/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RANGE_DAYS = 31;

function safeSecretEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function authorized(request: Request) {
  const configuredToken =
    process.env.ENTERTAINMENT_SCHEDULE_API_TOKEN?.trim() ?? "";
  const match = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i);
  const requestToken = match?.[1].trim() ?? "";
  return (
    configuredToken.length > 0 &&
    requestToken.length > 0 &&
    safeSecretEqual(requestToken, configuredToken)
  );
}

function unauthorized() {
  return NextResponse.json(
    { error: "A valid entertainment schedule service token is required." },
    {
      status: 401,
      headers: {
        "cache-control": "private, no-store",
        "www-authenticate": "Bearer",
      },
    },
  );
}

function addUtcDay(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function requestedDates(from: string, to: string) {
  if (!isValidEntertainmentDate(from) || !isValidEntertainmentDate(to)) {
    throw new Error("Query parameters from and to must use YYYY-MM-DD.");
  }
  if (from > to) {
    throw new Error("Query parameter from must be on or before to.");
  }
  const dates: string[] = [];
  for (let date = from; date <= to; date = addUtcDay(date)) {
    dates.push(date);
    if (dates.length > MAX_RANGE_DAYS) {
      throw new Error(
        `Entertainment schedule requests cannot exceed ${MAX_RANGE_DAYS} days.`,
      );
    }
  }
  return dates;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return unauthorized();
  }

  const searchParams = new URL(request.url).searchParams;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  let dates: string[];
  try {
    dates = requestedDates(from, to);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid entertainment schedule date range.",
      },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const days = await Promise.all(dates.map((date) => getEntertainmentDay(date)));
    const reservations = days
      .flatMap((day) => day.reservations)
      .map((reservation) => ({
        id: reservation.id,
        operatingDate: reservation.operatingDate,
        eventId:
          reservation.tripleseatEventId ?? reservation.localEventId ?? null,
        eventName: reservation.eventName,
        resourceId: reservation.resourceId,
        resourceName: reservation.resourceName,
        resourceCategory: reservation.resourceCategory,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        eventColor: reservation.eventColor,
        source: reservation.source,
        manualOverride: reservation.manualOverride,
        needsReview: reservation.needsReview,
        updatedAt: reservation.updatedAt,
      }))
      .sort((left, right) =>
        `${left.startAt}:${left.resourceId}`.localeCompare(
          `${right.startAt}:${right.resourceId}`,
        ),
      );

    return NextResponse.json(
      {
        from,
        to,
        timeZone: ENTERTAINMENT_TIME_ZONE,
        reservationCount: reservations.length,
        reservations,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to load the saved entertainment schedule." },
      { status: 502, headers: { "cache-control": "private, no-store" } },
    );
  }
}
