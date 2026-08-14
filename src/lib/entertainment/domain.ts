import {
  canonicalCategoryForText,
  deterministicEventColor,
  exactResourceIdsForText,
  getEntertainmentResource,
  isEntertainmentScheduleCategory,
  isAmbiguousLaneText,
  isHexColor,
  quantityForText,
  resourcesForCategory,
} from "./resources";
import {
  isInsideOperatingDay,
  parseTimeRange,
} from "./time";
import type {
  EntertainmentCategory,
  EntertainmentColorSource,
  EntertainmentConflict,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
  EntertainmentReviewIssue,
  EntertainmentSourceEvent,
  EntertainmentSourceItem,
} from "./types";

export type LocalEntertainmentItem = {
  name: string;
  quantity: string;
  time: string;
};

export type LocalEntertainmentEvent = {
  id: string;
  bookingId?: string | null;
  name: string;
  date: string;
  color: string | null;
  rooms: string[];
  eventTime?: string;
  entertainment: LocalEntertainmentItem[];
};

export type BuildScheduleInput = {
  sourceEvents: EntertainmentSourceEvent[];
  localEvents: LocalEntertainmentEvent[];
  existingReservations?: EntertainmentReservation[];
  now?: string;
};

export type BuiltSchedule = {
  events: EntertainmentEventSnapshot[];
  reservations: EntertainmentReservation[];
};

function uniqueIssues(issues: EntertainmentReviewIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function normalizeEventName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function matchLocalEvent(
  source: EntertainmentSourceEvent,
  localEvents: readonly LocalEntertainmentEvent[],
) {
  const byEventId = localEvents.find(
    (event) => event.id === source.tripleseatEventId,
  );
  if (byEventId) {
    return { event: byEventId, matchedBy: "tripleseat-event-id" as const };
  }
  if (source.tripleseatBookingId) {
    const byBookingId = localEvents.find(
      (event) => event.bookingId === source.tripleseatBookingId,
    );
    if (byBookingId) {
      return { event: byBookingId, matchedBy: "tripleseat-booking-id" as const };
    }
  }
  const normalizedName = normalizeEventName(source.eventName);
  const byNameAndDate = localEvents.find(
    (event) =>
      event.date === source.localDate &&
      normalizeEventName(event.name) === normalizedName,
  );
  return byNameAndDate
    ? { event: byNameAndDate, matchedBy: "name-and-date" as const }
    : null;
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sourceReservationId(syncKey: string) {
  return `ent-sync-${simpleHash(syncKey)}`;
}

function overlaps(
  startAt: string,
  endAt: string,
  otherStartAt: string,
  otherEndAt: string,
) {
  return (
    Date.parse(startAt) < Date.parse(otherEndAt) &&
    Date.parse(endAt) > Date.parse(otherStartAt)
  );
}

function resourceIsAvailable(
  resourceId: string,
  startAt: string,
  endAt: string,
  reservations: readonly Pick<
    EntertainmentReservation,
    "resourceId" | "startAt" | "endAt" | "active"
  >[],
) {
  return !reservations.some(
    (reservation) =>
      reservation.active &&
      reservation.resourceId === resourceId &&
      overlaps(startAt, endAt, reservation.startAt, reservation.endAt),
  );
}

export function findAdjacentAvailableResources(
  category: EntertainmentCategory,
  quantity: number,
  startAt: string,
  endAt: string,
  reservations: readonly Pick<
    EntertainmentReservation,
    "resourceId" | "startAt" | "endAt" | "active"
  >[],
  excludedResourceIds: readonly string[] = [],
) {
  const excluded = new Set(excludedResourceIds);
  const available = resourcesForCategory(category).filter(
    (resource) =>
      !excluded.has(resource.id) &&
      resourceIsAvailable(
        resource.id,
        startAt,
        endAt,
        reservations,
      ),
  );
  if (quantity <= 0) {
    return [];
  }
  for (let index = 0; index <= available.length - quantity; index += 1) {
    const candidate = available.slice(index, index + quantity);
    const contiguous = candidate.every(
      (resource, candidateIndex) =>
        candidateIndex === 0 ||
        resource.displayOrder ===
          candidate[candidateIndex - 1].displayOrder + 1,
    );
    if (contiguous) {
      return candidate;
    }
  }
  return available.slice(0, quantity);
}

function localFallbackItems(
  localEvent: LocalEntertainmentEvent,
): EntertainmentSourceItem[] {
  return localEvent.entertainment.map((item, index) => ({
    sourceId: `event-host:${index}:${normalizeEventName(item.name)}`,
    name: item.name,
    description: `${item.quantity} ${item.name} ${item.time}`,
    categoryName: null,
    quantity: null,
    startAt: null,
    endAt: null,
  }));
}

function privateRoomItems(source: EntertainmentSourceEvent) {
  return source.rooms.flatMap((room, index) => {
    const category = canonicalCategoryForText(room.name);
    return category === "private-rooms"
      ? [
          {
            sourceId: `room:${room.id ?? index}`,
            name: room.name,
            description: room.name,
            categoryName: "Private Rooms",
            quantity: 1,
            startAt: source.eventStartAt,
            endAt: source.eventEndAt,
          } satisfies EntertainmentSourceItem,
        ]
      : [];
  });
}

function itemText(item: EntertainmentSourceItem) {
  return [item.categoryName, item.name, item.description]
    .filter(Boolean)
    .join(" ");
}

function itemTiming(
  item: EntertainmentSourceItem,
  source: EntertainmentSourceEvent,
) {
  if (
    item.startAt &&
    item.endAt &&
    Number.isFinite(Date.parse(item.startAt)) &&
    Number.isFinite(Date.parse(item.endAt)) &&
    Date.parse(item.endAt) > Date.parse(item.startAt)
  ) {
    return {
      startAt: item.startAt,
      endAt: item.endAt,
      usedFallback: false,
    };
  }
  const parsed = parseTimeRange(itemText(item), source.localDate);
  if (parsed) {
    return { ...parsed, usedFallback: false };
  }
  const durationMatch = itemText(item).match(
    /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i,
  );
  const eventStartEpoch = Date.parse(source.eventStartAt ?? "");
  if (durationMatch && Number.isFinite(eventStartEpoch)) {
    const durationHours = Number(durationMatch[1]);
    if (durationHours > 0 && durationHours <= 15) {
      return {
        startAt: source.eventStartAt!,
        endAt: new Date(
          eventStartEpoch + durationHours * 60 * 60 * 1000,
        ).toISOString(),
        usedFallback: false,
      };
    }
  }
  if (
    source.eventStartAt &&
    source.eventEndAt &&
    Number.isFinite(Date.parse(source.eventStartAt)) &&
    Number.isFinite(Date.parse(source.eventEndAt)) &&
    Date.parse(source.eventEndAt) > Date.parse(source.eventStartAt)
  ) {
    return {
      startAt: source.eventStartAt,
      endAt: source.eventEndAt,
      usedFallback: true,
    };
  }
  return null;
}

function colorForEvent(
  source: EntertainmentSourceEvent,
  localEvent: LocalEntertainmentEvent | null,
) {
  if (isHexColor(localEvent?.color)) {
    return {
      color: localEvent!.color!.toUpperCase(),
      source: "event-plan" as const,
    };
  }
  return {
    color: deterministicEventColor(source.tripleseatEventId),
    source: "deterministic-fallback" as const,
  };
}

function sameInstant(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime === rightTime
  );
}

function manualReservationMatchesSourceEvent(
  reservation: EntertainmentReservation,
  source: EntertainmentSourceEvent,
  localEvent: LocalEntertainmentEvent | null,
) {
  const sourceIds = new Set(
    [source.tripleseatEventId, localEvent?.id]
      .filter((value): value is string => Boolean(value)),
  );
  if (
    [reservation.tripleseatEventId, reservation.localEventId]
      .filter((value): value is string => Boolean(value))
      .some((value) => sourceIds.has(value))
  ) {
    return true;
  }
  return (
    reservation.operatingDate === source.localDate &&
    normalizeEventName(reservation.eventName) ===
      normalizeEventName(source.eventName)
  );
}

export function buildEntertainmentSchedule({
  sourceEvents,
  localEvents,
  existingReservations = [],
  now = new Date().toISOString(),
}: BuildScheduleInput): BuiltSchedule {
  const reservations: EntertainmentReservation[] = [];
  const snapshots: EntertainmentEventSnapshot[] = [];
  const manuallyOccupied = existingReservations.filter(
    (reservation) => reservation.active && reservation.manualOverride,
  );

  for (const source of [...sourceEvents].sort((left, right) => {
    const leftTime = Date.parse(left.eventStartAt ?? "");
    const rightTime = Date.parse(right.eventStartAt ?? "");
    return (
      (Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER) ||
      left.eventName.localeCompare(right.eventName)
    );
  })) {
    const isContractEvidence = source.sourceSystem === "contract-evidence";
    const match = matchLocalEvent(source, localEvents);
    const localEvent = match?.event ?? null;
    const eventIssues: EntertainmentReviewIssue[] = [];
    if (isContractEvidence) {
      eventIssues.push({
        code: "SOURCE_DETAILS_UNAVAILABLE",
        message:
          "Only page 1 of the 2-page contract was supplied; review the contract Special Instructions on page 2.",
      });
    }
    if (
      !localEvent &&
      source.sourceSystem !== "vip-prep" &&
      !isContractEvidence
    ) {
      eventIssues.push({
        code: "UNMATCHED_EVENT",
        message: "Tripleseat event could not be matched to an Event Host event.",
      });
    }
    const color = colorForEvent(source, localEvent);
    if (
      color.source === "deterministic-fallback" &&
      source.sourceSystem !== "vip-prep" &&
      !isContractEvidence
    ) {
      eventIssues.push({
        code: "FLOOR_PLAN_COLOR_MISSING",
        message:
          "Floor-plan color missing; a deterministic accessible color is in use.",
      });
    }

    const relevantSourceItems = source.items.filter((item) => {
      const text = itemText(item);
      const category = canonicalCategoryForText(text);
      return (
        (category != null && isEntertainmentScheduleCategory(category)) ||
        isAmbiguousLaneText(text)
      );
    });
    const localScheduleItems = localEvent
      ? localFallbackItems(localEvent).filter((item) => {
          const category = canonicalCategoryForText(itemText(item));
          return category != null && isEntertainmentScheduleCategory(category);
        })
      : [];
    const usingLocalFallback =
      relevantSourceItems.length === 0 &&
      localScheduleItems.length > 0;
    let items = usingLocalFallback
      ? localScheduleItems
      : relevantSourceItems;
    items = [...items, ...privateRoomItems(source)];
    if (
      relevantSourceItems.length === 0 &&
      !usingLocalFallback &&
      source.categoryNames.some(
        (name) => {
          const category = canonicalCategoryForText(name);
          return category != null && isEntertainmentScheduleCategory(category);
        },
      )
    ) {
      eventIssues.push({
        code: "SOURCE_DETAILS_UNAVAILABLE",
        message:
          "Tripleseat identifies an entertainment category but did not expose its quantity or reservation detail.",
      });
    }
    if (usingLocalFallback) {
      eventIssues.push({
        code: "SOURCE_DETAILS_UNAVAILABLE",
        message:
          "Tripleseat did not expose entertainment line details; the last structured Event Host values are shown for review.",
      });
    }

    const duplicateKeys = new Set<string>();
    const consumedManualReservationIds = new Set<string>();
    const occupied = [...manuallyOccupied, ...reservations];
    const eventReservations: EntertainmentReservation[] = [];

    items.forEach((item) => {
      const text = itemText(item);
      const category = canonicalCategoryForText(text);
      if (category === "mini-golf") {
        return;
      }
      if (!category) {
        if (isAmbiguousLaneText(text)) {
          eventIssues.push({
            code: "AMBIGUOUS_RESOURCE",
            message: `Ambiguous entertainment wording requires review: ${item.name}`,
          });
        }
        return;
      }

      const duplicateKey = `${category}:${normalizeEventName(text)}`;
      if (duplicateKeys.has(duplicateKey)) {
        eventIssues.push({
          code: "DUPLICATE_ENTERTAINMENT",
          message: `Duplicate entertainment entry detected: ${item.name}`,
        });
      }
      duplicateKeys.add(duplicateKey);

      const timing = itemTiming(item, source);
      if (!timing) {
        eventIssues.push({
          code: "TIME_NEEDS_REVIEW",
          message: `No usable reservation time was found for ${item.name}.`,
        });
        return;
      }
      const itemIssues: EntertainmentReviewIssue[] = [];
      if (timing.usedFallback) {
        itemIssues.push({
          code: "TIME_NEEDS_REVIEW",
          message: `${item.name} uses the event start and end time as a temporary fallback.`,
        });
      }
      if (!isInsideOperatingDay(timing.startAt, timing.endAt, source.localDate)) {
        itemIssues.push({
          code: "OUTSIDE_OPERATING_DAY",
          message: `${item.name} extends outside the 10:00 AM–1:00 AM operating day.`,
        });
      }

      const exactFromSource = exactResourceIdsForText(text, category);
      const quantity =
        quantityForText(text, category, item.quantity) ??
        exactFromSource.length;

      if (quantity < 1) {
        itemIssues.push({
          code: "SOURCE_DETAILS_UNAVAILABLE",
          message: `${item.name} does not state a reserved lane or table count in the contract wording; the Qty column was intentionally ignored.`,
        });
      }

      const desiredCount = Math.max(
        quantity,
        new Set(exactFromSource).size,
      );
      const matchingManualReservations = manuallyOccupied
        .filter(
          (reservation) =>
            !consumedManualReservationIds.has(reservation.id) &&
            reservation.resourceCategory === category &&
            sameInstant(reservation.startAt, timing.startAt) &&
            sameInstant(reservation.endAt, timing.endAt) &&
            manualReservationMatchesSourceEvent(
              reservation,
              source,
              localEvent,
            ),
        )
        .slice(0, desiredCount);
      matchingManualReservations.forEach((reservation) =>
        consumedManualReservationIds.add(reservation.id),
      );
      const manuallyAssignedResourceIds = new Set(
        matchingManualReservations.map((reservation) => reservation.resourceId),
      );
      const chosenIds = [...new Set(exactFromSource)].filter(
        (resourceId) => !manuallyAssignedResourceIds.has(resourceId),
      );
      const needed = Math.max(
        0,
        desiredCount - matchingManualReservations.length - chosenIds.length,
      );
      if (needed > 0) {
        const autoAssigned = findAdjacentAvailableResources(
          category,
          needed,
          timing.startAt,
          timing.endAt,
          occupied,
          chosenIds,
        );
        chosenIds.push(...autoAssigned.map((resource) => resource.id));
        if (autoAssigned.length > 0) {
          itemIssues.push({
            code: "AUTO_ASSIGNED",
            message: `${autoAssigned.length} ${category} resource${autoAssigned.length === 1 ? " was" : "s were"} auto-assigned and must be verified.`,
          });
        }
        if (autoAssigned.length < needed) {
          itemIssues.push({
            code: "INSUFFICIENT_RESOURCES",
            message: `${item.name} is short ${needed - autoAssigned.length} available resource${needed - autoAssigned.length === 1 ? "" : "s"}.`,
          });
        }
      }
      if (chosenIds.length === 0) {
        itemIssues.push({
          code: "UNVERIFIED_ASSIGNMENT",
          message: `${item.name} could not be assigned to an exact physical resource.`,
        });
      }

      chosenIds.forEach((resourceId, slot) => {
        const resource = getEntertainmentResource(resourceId);
        if (!resource) {
          return;
        }
        if (
          eventReservations.some(
            (reservation) =>
              reservation.resourceId === resource.id &&
              reservation.startAt === timing.startAt &&
              reservation.endAt === timing.endAt,
          )
        ) {
          itemIssues.push({
            code: "DUPLICATE_ENTERTAINMENT",
            message: `${resource.canonicalName} is already reserved for this event at the same time; the duplicate entry was not added.`,
          });
          return;
        }
        const syncKey = `${source.tripleseatEventId}:${item.sourceId}:${slot}`;
        const issues = uniqueIssues([
          ...itemIssues,
          ...(exactFromSource.includes(resourceId)
            ? []
            : [
                {
                  code: "UNVERIFIED_ASSIGNMENT" as const,
                  message: `${resource.canonicalName} was assigned automatically and must be verified.`,
                },
              ]),
          ...(usingLocalFallback
            ? [
                {
                  code: "SOURCE_DETAILS_UNAVAILABLE" as const,
                  message:
                    "This reservation uses the last structured Event Host value because Tripleseat detail was unavailable.",
                },
              ]
            : []),
        ]);
        const reservation: EntertainmentReservation = {
          id: sourceReservationId(syncKey),
          syncKey,
          localEventId: localEvent?.id ?? null,
          tripleseatEventId: source.tripleseatEventId,
          tripleseatBookingId: source.tripleseatBookingId,
          eventName: source.eventName,
          operatingDate: source.localDate,
          resourceId: resource.id,
          resourceCategory: resource.category,
          resourceName: resource.canonicalName,
          startAt: timing.startAt,
          endAt: timing.endAt,
          sourceStartAt: timing.startAt,
          sourceEndAt: timing.endAt,
          sourceResourceId: resource.id,
          eventColor: color.color,
          colorSource: color.source,
          source: source.sourceSystem === "vip-prep"
            ? "vip-prep"
            : usingLocalFallback || isContractEvidence
              ? "event-host-fallback"
              : "tripleseat",
          sourceReference: item.sourceId,
          manualOverride: false,
          hasSourceUpdate: false,
          needsReview: issues.length > 0,
          reviewIssues: issues,
          autoAssigned:
            !exactFromSource.includes(resourceId),
          notes: "",
          sourceUpdatedAt: source.sourceUpdatedAt,
          lastTripleseatSyncAt:
            source.sourceSystem === "vip-prep" || isContractEvidence
              ? null
              : now,
          active: true,
          createdAt: now,
          updatedAt: now,
          updatedBy:
            source.sourceSystem === "vip-prep"
              ? "vip-prep-sync"
              : isContractEvidence
                ? "event-host-contract"
                : "tripleseat-sync",
        };
        eventReservations.push(reservation);
        occupied.push(reservation);
      });
      eventIssues.push(...itemIssues);
    });

    reservations.push(...eventReservations);
    const reviewIssues = uniqueIssues([
      ...eventIssues,
      ...eventReservations.flatMap((reservation) => reservation.reviewIssues),
    ]);
    snapshots.push({
      eventId: source.tripleseatEventId,
      localEventId: localEvent?.id ?? null,
      tripleseatEventId: source.tripleseatEventId,
      tripleseatBookingId: source.tripleseatBookingId,
      eventName: source.eventName,
      operatingDate: source.localDate,
      eventStartAt: source.eventStartAt,
      eventEndAt: source.eventEndAt,
      eventColor: color.color,
      colorSource: color.source,
      floorPlanAssetKey: null,
      sourceUpdatedAt: source.sourceUpdatedAt,
      needsReview: reviewIssues.length > 0,
      reviewIssues,
      sourceSnapshot: source,
      active: true,
      syncedAt: now,
    });
  }

  return { events: snapshots, reservations };
}

function reservationSourceChanged(
  existing: EntertainmentReservation,
  incoming: EntertainmentReservation,
) {
  return (
    existing.sourceStartAt !== incoming.sourceStartAt ||
    existing.sourceEndAt !== incoming.sourceEndAt ||
    existing.sourceResourceId !== incoming.sourceResourceId
  );
}

export function mergeReservationsForSync(
  existingReservations: readonly EntertainmentReservation[],
  incomingReservations: readonly EntertainmentReservation[],
  now = new Date().toISOString(),
) {
  const existingBySyncKey = new Map(
    existingReservations.flatMap((reservation) =>
      reservation.syncKey ? [[reservation.syncKey, reservation] as const] : [],
    ),
  );
  const incomingKeys = new Set(
    incomingReservations.flatMap((reservation) =>
      reservation.syncKey ? [reservation.syncKey] : [],
    ),
  );
  const merged = incomingReservations.map((incoming) => {
    const existing = incoming.syncKey
      ? existingBySyncKey.get(incoming.syncKey)
      : null;
    if (!existing) {
      return incoming;
    }
    if (!existing.manualOverride) {
      return {
        ...incoming,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
    }
    const sourceChanged =
      reservationSourceChanged(existing, incoming) &&
      existing.sourceUpdatedAt !== incoming.sourceUpdatedAt;
    const hasSourceUpdate = existing.hasSourceUpdate || sourceChanged;
    const reviewIssues = uniqueIssues([
      ...existing.reviewIssues.filter(
        (issue) => issue.code !== "SOURCE_HAS_NEWER_INFORMATION",
      ),
      ...(hasSourceUpdate
        ? [
            {
              code: "SOURCE_HAS_NEWER_INFORMATION" as const,
              message:
                "The source has newer resource or time information. The manual value remains in use.",
            },
          ]
        : []),
    ]);
    return {
      ...incoming,
      id: existing.id,
      resourceId: existing.resourceId,
      resourceCategory: existing.resourceCategory,
      resourceName: existing.resourceName,
      startAt: existing.startAt,
      endAt: existing.endAt,
      eventColor: existing.eventColor,
      colorSource: existing.colorSource,
      manualOverride: true,
      hasSourceUpdate,
      needsReview: existing.needsReview || hasSourceUpdate,
      reviewIssues,
      autoAssigned: existing.autoAssigned,
      notes: existing.notes,
      active: existing.active,
      createdAt: existing.createdAt,
      updatedAt: now,
      updatedBy: existing.updatedBy,
    } satisfies EntertainmentReservation;
  });

  for (const existing of existingReservations) {
    if (existing.source === "manual" || existing.syncKey == null) {
      merged.push(existing);
      continue;
    }
    if (!incomingKeys.has(existing.syncKey)) {
      merged.push({
        ...existing,
        active: false,
        updatedAt: now,
        updatedBy: "tripleseat-sync",
      });
    }
  }
  return merged;
}

export function detectEntertainmentConflicts(
  reservations: readonly EntertainmentReservation[],
) {
  const conflicts: EntertainmentConflict[] = [];
  const active = reservations
    .filter((reservation) => reservation.active)
    .sort(
      (left, right) =>
        left.resourceId.localeCompare(right.resourceId) ||
        Date.parse(left.startAt) - Date.parse(right.startAt) ||
        left.id.localeCompare(right.id),
    );
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    const left = active[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < active.length;
      rightIndex += 1
    ) {
      const right = active[rightIndex];
      if (right.resourceId !== left.resourceId) {
        break;
      }
      if (Date.parse(right.startAt) >= Date.parse(left.endAt)) {
        break;
      }
      if (!overlaps(left.startAt, left.endAt, right.startAt, right.endAt)) {
        continue;
      }
      const startAt =
        Date.parse(left.startAt) >= Date.parse(right.startAt)
          ? left.startAt
          : right.startAt;
      const endAt =
        Date.parse(left.endAt) <= Date.parse(right.endAt)
          ? left.endAt
          : right.endAt;
      conflicts.push({
        id: `conflict-${simpleHash([left.id, right.id].sort().join(":"))}`,
        resourceId: left.resourceId,
        resourceName: left.resourceName,
        startAt,
        endAt,
        reservationIds: [left.id, right.id],
        eventNames: [left.eventName, right.eventName],
      });
    }
  }
  return conflicts;
}

export function conflictForCandidate(
  candidate: Pick<
    EntertainmentReservation,
    "id" | "resourceId" | "startAt" | "endAt"
  >,
  reservations: readonly EntertainmentReservation[],
) {
  return reservations.filter(
    (reservation) =>
      reservation.active &&
      reservation.id !== candidate.id &&
      reservation.resourceId === candidate.resourceId &&
      overlaps(
        candidate.startAt,
        candidate.endAt,
        reservation.startAt,
        reservation.endAt,
      ),
  );
}

export function validateReservationTimes(startAt: string, endAt: string) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Reservation end time must be after its start time.");
  }
  if (start % (15 * 60_000) !== 0 || end % (15 * 60_000) !== 0) {
    throw new Error("Reservation times must use 15-minute increments.");
  }
}

export function eventColorAndSource(
  color: string,
  source: EntertainmentColorSource,
) {
  return isHexColor(color)
    ? { eventColor: color.toUpperCase(), colorSource: source }
    : {
        eventColor: deterministicEventColor(color),
        colorSource: "deterministic-fallback" as const,
      };
}
