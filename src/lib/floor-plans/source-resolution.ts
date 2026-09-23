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
  const orderedOnPar = [...onParRows].sort((left, right) => {
    const leftRoom = left.plan.rooms.join(" ");
    const rightRoom = right.plan.rooms.join(" ");
    return leftRoom.localeCompare(rightRoom) ||
      left.sourceEventId.localeCompare(right.sourceEventId);
  });
  const primary = orderedOnPar[0];
  const tripleseatRows = matchingRows.filter((row) => !isOnParBookingRow(row));
  const allRows = [...tripleseatRows, ...orderedOnPar];
  const tripleseatRooms = uniqueStrings(
    tripleseatRows.flatMap((row) => row.plan.rooms),
  );
  const onParRooms = uniqueStrings(
    orderedOnPar.flatMap((row) => row.plan.rooms),
  );
  const sourceEventIds = uniqueStrings(
    allRows.flatMap((row) => [
      row.sourceEventId,
      ...sourceStringList(row.source, "sourceEventIds"),
    ]),
  );

  return {
    plan: {
      ...primary.plan,
      guest_count: Math.max(...allRows.map((row) => row.plan.guest_count)),
      rooms: uniqueStrings([...tripleseatRooms, ...onParRooms]),
      food: uniqueStrings(allRows.flatMap((row) => row.plan.food)),
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
        allRows.some((row) => row.plan.needs_review),
      review_reasons: uniqueStrings(
        [
          ...allRows.flatMap((row) => row.plan.review_reasons ?? []),
          ...extraReviewReasons,
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
  return floorPlanSourceNamesMatch(left.plan.name, right.plan.name);
}

/**
 * Collapses one party's OnParBookings room reservations into a single floor-plan
 * event and absorbs one unambiguous same-name Tripleseat block into that event.
 * OnParBookings remains authoritative for the title, time, and VIP room list.
 */
export function resolveFloorPlanSourceRows(
  rows: readonly FloorPlanSourceRow[],
) {
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
    const matchingRows = rows.filter(
      (candidate) =>
        !isOnParBookingRow(candidate) &&
        candidate.plan.date === group[0].plan.date &&
        floorPlanSourceNamesMatch(group[0].plan.name, candidate.plan.name),
    );
    const matchingOnParGroups = onParGroups.filter(
      (candidate) =>
        candidate[0].plan.date === group[0].plan.date &&
        floorPlanSourceNamesMatch(
          candidate[0].plan.name,
          group[0].plan.name,
        ),
    );
    if (matchingRows.length === 1 && matchingOnParGroups.length === 1) {
      claimedRows.add(matchingRows[0]);
      return mergeOnParGroup(group, matchingRows);
    }
    const ambiguous =
      matchingRows.length > 1 ||
      (matchingRows.length === 1 && matchingOnParGroups.length > 1);
    return mergeOnParGroup(
      group,
      [],
      ambiguous
        ? [
            "Multiple same-name source records match this OnPar reservation; floor-plan source needs review.",
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
