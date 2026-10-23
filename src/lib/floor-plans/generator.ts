import {
  foodTablesNearArea,
  getFloorPlanArea,
  getPhysicalFloorPlanAreaId,
  requiredFoodTableCount,
  seatingInventoryForArea,
} from "./configuration/areas";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { floorPlanAreaTimeOverlap } from "./conflicts";
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

export function reservedSeatingCapacity(reservations: readonly FloorPlanReservation[]) {
  const foodIds = new Set(reservations.filter((item) => item.reservationType === "food-table")
    .map((item) => getPhysicalFloorPlanAreaId(item.areaId)));
  const ids = new Set(reservations.flatMap((item) =>
    item.reservationType === "seating" || item.reservationType === "room"
      ? [getPhysicalFloorPlanAreaId(item.areaId)] : [],
  ));
  return seatingCapacity([...ids].flatMap((id) => {
    const area = getFloorPlanArea(id);
    return area && !foodIds.has(id) ? [area] : [];
  }));
}

export function selectSmallestTableCombination(
  tables: readonly FloorPlanArea[],
  guestCount: number,
  reservedSeating: readonly FloorPlanArea[] = [],
  foodTables: readonly FloorPlanArea[] = [],
) {
  if (!Number.isInteger(guestCount) || guestCount <= 0) return [];
  const candidates = tables.filter(
    (table) =>
      table.isReservable &&
      (table.type === "rectangle-table" || table.type === "square-table" ||
        table.type === "seating-section") &&
      table.capacity > 0,
  );
  if (seatingCapacity(candidates) < guestCount) return [];
  let best: FloorPlanArea[] | null = null;
  let bestScore: [number, number, number, number, number] | null = null;
  const foodDistances = new Map(candidates.map((table) => {
    const center = tableCenter(table);
    return [table.id, foodTables.length ? Math.min(...foodTables.map((food) => {
      const foodCenter = tableCenter(food);
      return Math.hypot(center.x - foodCenter.x, center.y - foodCenter.y);
    })) : 0];
  }));
  const combinations = 1 << candidates.length;
  for (let mask = 1; mask < combinations; mask += 1) {
    const selected = candidates.filter((_, index) => mask & (1 << index));
    const capacity = seatingCapacity(selected);
    if (capacity < guestCount) continue;
    const proximity = selected.reduce((total, table, index) => {
      const center = tableCenter(table);
      const anchors = reservedSeating.length ? reservedSeating : selected.slice(0, index);
      return total + anchors.reduce((distance, anchor) => {
        const anchorCenter = tableCenter(anchor);
        return distance + Math.hypot(center.x - anchorCenter.x, center.y - anchorCenter.y);
      }, 0);
    }, 0);
    const score: [number, number, number, number, number] = [
      // Keep even the farthest selected table close to an event food table.
      Math.max(...selected.map((table) => foodDistances.get(table.id)!)),
      capacity - guestCount,
      connectedComponents([...reservedSeating, ...selected]),
      selected.length,
      proximity,
    ];
    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] === bestScore[2] && score[3] < bestScore[3]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] === bestScore[2] && score[3] === bestScore[3] && score[4] < bestScore[4])
    ) {
      best = selected;
      bestScore = score;
    }
  }
  return best ?? [];
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
      return !reservationOccupancy(candidate.startAt, candidate.endAt) || floorPlanAreaTimeOverlap(
        candidate.areaId,
        event.startAt,
        event.endAt,
        candidate.startAt,
        candidate.endAt,
      )
        ? [getPhysicalFloorPlanAreaId(candidate.areaId)]
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
  const onParBookingAreaIds = new Set(
    event.source.onParBookingAreaIds ?? [],
  );
  const vipOnly = isVipOnlyFloorPlanEvent(event);
  const seatingContractedAreas = vipOnly
    ? []
    : onParBookingAreaIds.size
      ? contractedAreas.filter((areaId) => !onParBookingAreaIds.has(areaId))
      : contractedAreas;
  const primaryContractedArea = seatingContractedAreas.find(
    (areaId) => seatingInventoryForArea(areaId).length > 0,
  ) ?? seatingContractedAreas[0] ?? null;
  const generated: FloorPlanReservation[] = [];

  if (event.fullBuyout) {
    generated.push(reservation(event, "facility", "room", "FULL BUYOUT"));
  }
  for (const contractedArea of contractedAreas) {
    const contracted = getFloorPlanArea(contractedArea);
    if (contracted?.type === "room") {
      generated.push(reservation(event, contracted.id, "room", contracted.shortLabel));
    }
  }
  if (vipOnly) {
    return generated;
  }
  const foodTableCount = requiredFoodTableCount(event.guestCount);
  const existingFoodAreaIds = new Set(
    existing.flatMap((item) =>
      item.floorPlanEventId === event.id &&
      item.reservationType === "food-table"
        ? [item.areaId]
        : [],
    ),
  );
  const foodPhysicalIds = new Set([...existingFoodAreaIds].map(getPhysicalFloorPlanAreaId));
  const savedSeatingPhysicalIds = new Set(existing.filter((item) =>
    item.floorPlanEventId === event.id && item.reservationType === "seating",
  ).map((item) => getPhysicalFloorPlanAreaId(item.areaId)));
  const foodCandidates = primaryContractedArea
    ? foodTablesNearArea(primaryContractedArea)
    : foodTablesNearArea("main-dining");
  for (const foodCandidate of foodCandidates) {
    if (foodPhysicalIds.size >= foodTableCount) break;
    const physicalId = getPhysicalFloorPlanAreaId(foodCandidate.id);
    if (
      unavailable.has(physicalId) ||
      savedSeatingPhysicalIds.has(physicalId) ||
      foodPhysicalIds.has(physicalId)
    ) {
      continue;
    }
    generated.push(reservation(event, foodCandidate.id, "food-table", "F"));
    existingFoodAreaIds.add(foodCandidate.id);
    foodPhysicalIds.add(physicalId);
  }
  const foodTables = [...existingFoodAreaIds].flatMap((id) => {
    const area = getFloorPlanArea(id);
    return area?.canBeFoodTable ? [area] : [];
  });
  const existingSeatingAreaIds = new Set(
    existing.flatMap((item) =>
      item.floorPlanEventId === event.id && item.reservationType === "seating"
        ? [getPhysicalFloorPlanAreaId(item.areaId)]
        : [],
    ),
  );
  const existingEventReservations = [
    ...existing.filter((item) => item.floorPlanEventId === event.id),
    ...generated,
  ];
  const existingSeatingCapacity = reservedSeatingCapacity(existingEventReservations);
  const reservedSeating = [...new Set(existingEventReservations.flatMap((item) =>
    item.reservationType === "room" || item.reservationType === "seating" ? [item.areaId] : [],
  ))].flatMap((id) => {
    const area = getFloorPlanArea(id);
    return area && area.capacity > 0 ? [area] : [];
  });
  const availableTables = [...new Set(seatingContractedAreas)].flatMap((areaId) =>
    seatingInventoryForArea(areaId).filter(
      (table) =>
        !unavailable.has(getPhysicalFloorPlanAreaId(table.id)) &&
        !existingSeatingAreaIds.has(getPhysicalFloorPlanAreaId(table.id)) &&
        !foodPhysicalIds.has(getPhysicalFloorPlanAreaId(table.id)),
    ),
  );
  const remainingGuests = Math.max(0, event.guestCount - existingSeatingCapacity);
  const selectedTables = selectSmallestTableCombination(
    availableTables,
    remainingGuests,
    reservedSeating,
    foodTables,
  );
  for (const table of selectedTables) {
    generated.push(reservation(event, table.id, "seating", table.shortLabel));
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
    const generated = eventBaseReservations(plan, event, next);
    for (const item of generated) {
      if (
        next.some(
          (existing) =>
            existing.id === item.id ||
            (existing.floorPlanEventId === item.floorPlanEventId &&
              existing.areaId === item.areaId &&
              existing.reservationType === item.reservationType),
        )
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
  if (!isVipOnlyFloorPlanEvent(event)) return true;
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
  if (reservation.source === "manual" || reservation.lockedByUser) {
    return reservation;
  }
  return {
    ...reservation,
    startAt: event.startAt,
    endAt: event.endAt,
  };
}

export function isVipOnlyFloorPlanEvent(event: FloorPlanEvent) {
  const onParBookingAreaIds = event.source.onParBookingAreaIds ?? [];
  return event.tripleseatEventId.startsWith("vip-") &&
    (onParBookingAreaIds.length === 0 ||
      event.contractedAreaIds.every((areaId) =>
        onParBookingAreaIds.includes(areaId),
      ));
}
