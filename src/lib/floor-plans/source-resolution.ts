import type { EventPlan } from "@/lib/event-plans/types";
import { parseTimeRange } from "@/lib/entertainment/time";

type SourceRecord = Record<string, unknown>;

export type FloorPlanSourceRow = {
  plan: EventPlan;
  source: SourceRecord | null;
  sourceEventId: string;
};

const GENERIC_EVENT_PREFIXES = new Set([
  "birthday party",
  "corporate event",
  "event",
  "private event",
  "social event",
  "team building",
  "vip",
  "work outing",
]);

function normalizedNamePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+vip(?:\s+[12])?$/i, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function canonicalSourceName(value: string) {
  const delimiterMatch = value.match(/^(.+?)\s*(?:-|–|—|\||:)\s*(.+)$/);
  const withoutKnownPrefix = delimiterMatch &&
      GENERIC_EVENT_PREFIXES.has(normalizedNamePart(delimiterMatch[1]))
    ? delimiterMatch[2]
    : value;
  return normalizedNamePart(withoutKnownPrefix);
}

export function floorPlanSourceNamesMatch(left: string, right: string) {
  const leftName = canonicalSourceName(left);
  const rightName = canonicalSourceName(right);
  return leftName.length >= 6 &&
    !GENERIC_EVENT_PREFIXES.has(leftName) &&
    leftName === rightName;
}

function sourceString(source: SourceRecord | null, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sourceStringList(source: SourceRecord | null, key: string) {
  const value = source?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sourceWindow(row: FloorPlanSourceRow) {
  const startAt = sourceString(row.source, "eventStartAt");
  const endAt = sourceString(row.source, "eventEndAt");
  if (
    startAt &&
    endAt &&
    Number.isFinite(Date.parse(startAt)) &&
    Number.isFinite(Date.parse(endAt))
  ) {
    return { startAt, endAt };
  }
  return parseTimeRange(row.plan.time, row.plan.date);
}

function sameSourceWindow(left: FloorPlanSourceRow, right: FloorPlanSourceRow) {
  if (left.plan.date !== right.plan.date) return false;
  const leftWindow = sourceWindow(left);
  const rightWindow = sourceWindow(right);
  return Boolean(
    leftWindow &&
      rightWindow &&
      Date.parse(leftWindow.startAt) === Date.parse(rightWindow.startAt) &&
      Date.parse(leftWindow.endAt) === Date.parse(rightWindow.endAt),
  );
}

function isOnParBookingRow(row: FloorPlanSourceRow) {
  return (
    sourceString(row.source, "sourceSystem") === "vip-prep" ||
    row.sourceEventId.startsWith("vip-")
  );
}

function uniqueStrings(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function uniqueObjects<T>(values: readonly T[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function newestTimestamp(values: readonly (string | null | undefined)[]) {
  return uniqueStrings(values).sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  )[0] ?? null;
}

function mergeOnParGroup(
  onParRows: readonly FloorPlanSourceRow[],
  matchingRows: readonly FloorPlanSourceRow[],
  extraReviewReasons: readonly string[] = [],
): FloorPlanSourceRow {
  const orderedOnPar = [...onParRows].sort((left, right) => left.sourceEventId.localeCompare(right.sourceEventId));
  const primary = orderedOnPar[0];
  const tripleseatRows = matchingRows.filter((row) => !isOnParBookingRow(row));
  const allRows = [...tripleseatRows, ...orderedOnPar];
  // A matching VIP block identifies the reserved room, not a replacement for
  // the corporate BEO's attendance. Never inflate seating from its party size.
  const guestCount = tripleseatRows[0]?.plan.guest_count ??
    Math.max(...orderedOnPar.map((row) => row.plan.guest_count));
  const guestCountReview = tripleseatRows.length && orderedOnPar.some(
    (row) => row.plan.guest_count !== guestCount,
  )
    ? ["VIP booking guest count differs from the BEO; floor-plan seating uses the BEO guest count."]
    : [];
  const tripleseatRooms = uniqueStrings(
    tripleseatRows.flatMap((row) => row.plan.rooms),
  );
  const onParRooms = uniqueStrings(
    orderedOnPar.flatMap((row) => row.plan.rooms),
  );
  const sourceEventIds = uniqueStrings(
    allRows.map((row) => row.sourceEventId),
  );

  return {
    plan: {
      ...primary.plan,
      guest_count: guestCount,
      rooms: uniqueStrings([...tripleseatRooms, ...onParRooms]),
      food: allRows.flatMap((row) => row.plan.food),
      drink_options: uniqueStrings(
        allRows.flatMap((row) => row.plan.drink_options),
      ),
      entertainment: uniqueObjects(
        allRows.flatMap((row) => row.plan.entertainment),
      ),
      special_instructions: uniqueStrings(
        allRows.flatMap((row) => row.plan.special_instructions ?? []),
      ),
      operational_notes: uniqueObjects(
        allRows.flatMap((row) => row.plan.operational_notes ?? []),
      ),
      verification_status: uniqueStrings(
        allRows.map((row) => row.plan.verification_status),
      ).join(" "),
      needs_review:
        extraReviewReasons.length > 0 ||
        guestCountReview.length > 0 ||
        allRows.some((row) => row.plan.needs_review),
      review_reasons: uniqueStrings(
        [
          ...allRows.flatMap((row) => row.plan.review_reasons ?? []),
          ...extraReviewReasons,
          ...guestCountReview,
        ],
      ),
      source_updated_at: newestTimestamp(
        allRows.map((row) => row.plan.source_updated_at),
      ),
      synced_at: newestTimestamp(allRows.map((row) => row.plan.synced_at)),
    },
    source: {
      ...(primary.source ?? {}),
      rooms: uniqueStrings([...tripleseatRooms, ...onParRooms]),
      sourceSystem: "vip-prep",
      sourceEventIds,
      verifiedSourceEventIds: sourceEventIds,
      linkedTripleseatEventIds: uniqueStrings(orderedOnPar.flatMap((row) => sourceStringList(row.source, "linkedTripleseatEventIds"))),
      onParBookingRooms: onParRooms,
      sourceUpdatedAt: newestTimestamp(
        allRows.map((row) => sourceString(row.source, "sourceUpdatedAt")),
      ),
    },
    sourceEventId: primary.sourceEventId,
  };
}

function sameOnParParty(left: FloorPlanSourceRow, right: FloorPlanSourceRow) {
  if (!sameSourceWindow(left, right)) return false;
  const linked = new Set(sourceStringList(left.source, "linkedTripleseatEventIds"));
  return sourceStringList(right.source, "linkedTripleseatEventIds").some((id) => linked.has(id));
}

/**
 * Reconcile only canonical source identities or explicit feed-provided links.
 * A matching display name is not evidence that two reservations are one party.
 */
export function resolveFloorPlanSourceRows(
  rows: readonly FloorPlanSourceRow[],
) {
  const canonicalRows = new Map<string, FloorPlanSourceRow>();
  for (const row of rows) {
    const key = `${isOnParBookingRow(row) ? "on-par-bookings" : "tripleseat"}:${row.sourceEventId}`;
    const previous = canonicalRows.get(key);
    const nextTime = Date.parse(row.plan.source_updated_at ?? "");
    const previousTime = Date.parse(previous?.plan.source_updated_at ?? "");
    if (!previous || Number.isFinite(nextTime) && (!Number.isFinite(previousTime) || nextTime >= previousTime)) canonicalRows.set(key, row);
  }
  rows = [...canonicalRows.values()];
  const onParGroups: FloorPlanSourceRow[][] = [];
  for (const row of rows.filter(isOnParBookingRow)) {
    const group = onParGroups.find((candidate) =>
      sameOnParParty(candidate[0], row),
    );
    if (group) group.push(row);
    else onParGroups.push([row]);
  }

  const claimedRows = new Set<FloorPlanSourceRow>();
  const mergedOnParRows = onParGroups.map((group) => {
    group.forEach((row) => claimedRows.add(row));
    const linkedIds = new Set(group.flatMap((row) => sourceStringList(row.source, "linkedTripleseatEventIds")));
    const linkedRows = rows.filter(
      (candidate) =>
        !isOnParBookingRow(candidate) &&
        candidate.plan.date === group[0].plan.date &&
        linkedIds.has(candidate.sourceEventId),
    );
    const matchingRows = linkedRows.filter((candidate) => sameSourceWindow(candidate, group[0]));
    matchingRows.forEach((row) => claimedRows.add(row));
    return mergeOnParGroup(
      group,
      matchingRows,
      linkedRows.length !== matchingRows.length
        ? [
            "A verified linked source has a different interval; its physical reservations remain separate for review.",
          ]
        : [],
    );
  });

  return [
    ...rows.filter((row) => !claimedRows.has(row)),
    ...mergedOnParRows,
  ].sort((left, right) => {
    const leftStart = sourceWindow(left)?.startAt ?? "";
    const rightStart = sourceWindow(right)?.startAt ?? "";
    return leftStart.localeCompare(rightStart) ||
      left.plan.name.localeCompare(right.plan.name);
  });
}
