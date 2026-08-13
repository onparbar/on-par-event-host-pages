import {
  fixedSeatingHighlightsForArea,
  foodTablesNearArea,
  getFloorPlanArea,
  seatingTablesForArea,
} from "./configuration/areas";
import { timeRangesOverlap } from "./conflicts";
import type {
  FloorPlanArea,
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanGenerationMode,
  FloorPlanReservation,
} from "./types";

function tableCenter(table: FloorPlanArea) {
  return { x: table.x + table.width / 2, y: table.y + table.height / 2 };
}

function connectedComponents(tables: readonly FloorPlanArea[]) {
  if (tables.length < 2) return tables.length;
  const unseen = new Set(tables.map((table) => table.id));
  let components = 0;
  while (unseen.size) {
    components += 1;
    const first = unseen.values().next().value as string;
    unseen.delete(first);
    const queue = [first];
    while (queue.length) {
      const currentId = queue.pop()!;
      const current = tables.find((table) => table.id === currentId)!;
      const currentCenter = tableCenter(current);
      for (const candidateId of [...unseen]) {
        const candidate = tables.find((table) => table.id === candidateId)!;
        const candidateCenter = tableCenter(candidate);
        if (Math.hypot(currentCenter.x - candidateCenter.x, currentCenter.y - candidateCenter.y) <= 90) {
          unseen.delete(candidateId);
          queue.push(candidateId);
        }
      }
    }
  }
  return components;
}

export function seatingCapacity(tables: readonly FloorPlanArea[]) {
  return tables.reduce((total, table) => total + table.capacity, 0);
}

export function selectSmallestTableCombination(
  tables: readonly FloorPlanArea[],
  guestCount: number,
) {
  if (!Number.isInteger(guestCount) || guestCount <= 0) return [];
  const candidates = tables.filter(
    (table) =>
      table.isReservable &&
      !table.canBeFoodTable &&
      (table.type === "rectangle-table" || table.type === "square-table") &&
      table.capacity > 0,
  );
  let best: FloorPlanArea[] | null = null;
  let bestScore: [number, number, number] | null = null;
  const combinations = 1 << candidates.length;
  for (let mask = 1; mask < combinations; mask += 1) {
    const selected = candidates.filter((_, index) => mask & (1 << index));
    const capacity = seatingCapacity(selected);
    if (capacity < guestCount) continue;
    const score: [number, number, number] = [
      connectedComponents(selected),
      capacity - guestCount,
      selected.length,
    ];
    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
    ) {
      best = selected;
      bestScore = score;
    }
  }
  return best ?? candidates;
}

function reservationId(event: FloorPlanEvent, areaId: string, type: string) {
  return `${event.id}:${type}:${areaId}`;
}

function reservation(
  event: FloorPlanEvent,
  areaId: string,
  reservationType: FloorPlanReservation["reservationType"],
  label: string,
): FloorPlanReservation {
  return {
    id: reservationId(event, areaId, reservationType),
    floorPlanEventId: event.id,
    areaId,
    reservationType,
    startAt: event.startAt,
    endAt: event.endAt,
    label,
    source: "generated",
    lockedByUser: false,
  };
}

function unavailableAreaIds(
  plan: FloorPlanDocument,
  event: FloorPlanEvent,
  reservations: readonly FloorPlanReservation[],
) {
  return new Set(
    reservations.flatMap((candidate) => {
      if (candidate.floorPlanEventId === event.id) return [];
      return timeRangesOverlap(
        event.startAt,
        event.endAt,
        candidate.startAt,
        candidate.endAt,
      )
        ? [candidate.areaId]
        : [];
    }),
  );
}

function eventBaseReservations(
  plan: FloorPlanDocument,
  event: FloorPlanEvent,
  existing: readonly FloorPlanReservation[],
) {
  const unavailable = unavailableAreaIds(plan, event, existing);
  const contractedAreas = event.contractedAreaIds.filter(
    (areaId) => areaId !== "facility" && getFloorPlanArea(areaId),
  );
  const primaryContractedArea = contractedAreas.find(
    (areaId) => seatingTablesForArea(areaId).length > 0,
  ) ?? contractedAreas[0] ?? null;
  const generated: FloorPlanReservation[] = [];

  if (event.fullBuyout) {
    generated.push(reservation(event, "facility", "room", "FULL BUYOUT"));
  }
  for (const contractedArea of contractedAreas) {
    const contracted = getFloorPlanArea(contractedArea);
    if (contracted?.type === "room") {
      generated.push(reservation(event, contracted.id, "room", contracted.shortLabel));
    }
    if (event.tripleseatEventId.startsWith("vip-")) {
      continue;
    }
    for (const fixture of fixedSeatingHighlightsForArea(contractedArea)) {
      if (!unavailable.has(fixture.id)) {
        generated.push(
          reservation(event, fixture.id, "seating", fixture.shortLabel),
        );
      }
    }
  }
  if (event.tripleseatEventId.startsWith("vip-")) {
    return generated;
  }
  const existingSeatingAreaIds = new Set(
    existing.flatMap((item) =>
      item.floorPlanEventId === event.id && item.reservationType === "seating"
        ? [item.areaId]
        : [],
    ),
  );
  const existingSeatingCapacity = seatingCapacity(
    [...existingSeatingAreaIds].flatMap((areaId) => {
      const item = getFloorPlanArea(areaId);
      return item ? [item] : [];
    }),
  );
  const availableTables = contractedAreas.flatMap((areaId) =>
    seatingTablesForArea(areaId).filter(
      (table) =>
        !unavailable.has(table.id) && !existingSeatingAreaIds.has(table.id),
    ),
  );
  const remainingGuests = Math.max(0, event.guestCount - existingSeatingCapacity);
  for (const table of selectSmallestTableCombination(availableTables, remainingGuests)) {
    generated.push(reservation(event, table.id, "seating", table.shortLabel));
  }

  const foodCandidate = (primaryContractedArea ? foodTablesNearArea(primaryContractedArea) : foodTablesNearArea("main-dining"))
    .find((table) => !unavailable.has(table.id));
  if (foodCandidate) {
    generated.push(reservation(event, foodCandidate.id, "food-table", "F"));
  }
  return generated;
}

export function generateFloorPlanReservations(
  plan: FloorPlanDocument,
  mode: FloorPlanGenerationMode,
) {
  const preserved = plan.reservations.flatMap((item) => {
    const event = plan.events.find(
      (candidate) => candidate.id === item.floorPlanEventId,
    );
    if (event) {
      const current = reservationForCurrentFloorPlanEvent(event, item);
      if (!current) return [];
      if (mode === "fill-missing") return [current];
      if (mode === "replace-generated") {
        return item.source === "manual" || item.lockedByUser ? [current] : [];
      }
      return [];
    }
    if (mode === "fill-missing") return [item];
    if (mode === "replace-generated") {
      return item.source === "manual" || item.lockedByUser ? [item] : [];
    }
    return [];
  });
  const next = [...preserved];
  for (const event of plan.events) {
    const existingForEvent = next.filter((item) => item.floorPlanEventId === event.id);
    const hasFood = existingForEvent.some((item) => item.reservationType === "food-table");
    const generated = eventBaseReservations(plan, event, next);
    for (const item of generated) {
      if (
        next.some(
          (existing) =>
            existing.id === item.id ||
            (existing.floorPlanEventId === item.floorPlanEventId &&
              existing.areaId === item.areaId &&
              existing.reservationType === item.reservationType),
        ) ||
        (mode === "fill-missing" && item.reservationType === "food-table" && hasFood)
      ) {
        continue;
      }
      next.push(item);
    }
  }
  return next;
}

export function reservationAllowedForFloorPlanEvent(
  event: FloorPlanEvent,
  reservation: FloorPlanReservation,
) {
  if (!event.tripleseatEventId.startsWith("vip-")) return true;
  return (
    reservation.reservationType === "room" &&
    event.contractedAreaIds.includes(reservation.areaId)
  );
}

export function reservationForCurrentFloorPlanEvent(
  event: FloorPlanEvent,
  reservation: FloorPlanReservation,
) {
  if (!reservationAllowedForFloorPlanEvent(event, reservation)) return null;
  if (!event.tripleseatEventId.startsWith("vip-")) return reservation;
  return {
    ...reservation,
    startAt: event.startAt,
    endAt: event.endAt,
  };
}
