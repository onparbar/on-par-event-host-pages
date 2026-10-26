import {
  foodTablesNearArea,
  getFloorPlanArea,
  getPhysicalFloorPlanAreaId,
  requiredFoodTableCount,
  seatingInventoryForArea,
} from "./configuration/areas";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { detectFloorPlanConflicts, floorPlanAreaTimeOverlap } from "./conflicts";
import { searchSeatingCombination } from "./seating-search";
import { distinctPhysicalSeatingCapacity, summarizeEventSeating } from "./seating-summary";
import { reservationTimingSource } from "./reservation-state";
import type {
  FloorPlanArea,
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanGenerationMode,
  FloorPlanReservation,
} from "./types";

export type FloorPlanGenerationIssue = {
  eventId: string;
  code: "missing-source" | "no-valid-combination" | "search-incomplete" | "assignments-preserved" | "joint-reallocation" | "seating-selection" | "placement-unavailable";
  message: string;
  blocking: boolean;
};

export type FloorPlanGenerationProposal = {
  reservations: FloorPlanReservation[];
  issues: FloorPlanGenerationIssue[];
  addedReservationIds: string[];
  movedReservationIds: string[];
  complete: boolean;
};

export function seatingCapacity(tables: readonly FloorPlanArea[]) {
  return tables.reduce((total, table) => total + table.capacity, 0);
}

export function reservedSeatingCapacity(reservations: readonly FloorPlanReservation[]) {
  return distinctPhysicalSeatingCapacity(reservations);
}

export function selectSmallestTableCombination(
  tables: readonly FloorPlanArea[],
  guestCount: number,
  reservedSeating: readonly FloorPlanArea[] = [],
  foodTables: readonly FloorPlanArea[] = [],
) {
  return searchSeatingCombination(tables, guestCount, reservedSeating, foodTables).tables;
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
    timingSource: "event-default",
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
  issues: FloorPlanGenerationIssue[] = [],
  excludedChoices: ReadonlySet<string> = new Set(),
) {
  const unavailable = unavailableAreaIds(plan, event, existing);
  const areaUnavailable = (areaId: string, purpose: FloorPlanReservation["reservationType"]) => {
    const physicalId = getPhysicalFloorPlanAreaId(areaId);
    return unavailable.has("facility") || unavailable.has(physicalId) || excludedChoices.has(`${purpose}:${physicalId}`);
  };
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
      if (contracted.capacity > 0 && areaUnavailable(contracted.id, "room")) {
        issues.push({ eventId: event.id, code: "placement-unavailable", blocking: false,
          message: `${event.name}: ${contracted.name} is held by another party during the required seating occupancy. Its seats were not used; eligible additional tables are considered without moving the other party.` });
        continue;
      }
      generated.push(reservation(event, contracted.id, "room", contracted.shortLabel));
    }
  }
  if (!reservationOccupancy(event.startAt, event.endAt) || !Number.isInteger(event.guestCount) || event.guestCount <= 0 ||
    contractedAreas.length === 0 || (!vipOnly && seatingContractedAreas.length === 0) || event.unresolvedAreaNames.length > 0) {
    issues.push({ eventId: event.id, code: "missing-source", message: `${event.name}: verified guest count, contracted area and event interval are required before filling seating.`, blocking: true });
    return generated;
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
  let foodAssigned = summarizeEventSeating(event, existing, { allReservations: existing }).foodAssigned;
  const savedSeatingPhysicalIds = new Set(existing.filter((item) =>
    item.floorPlanEventId === event.id && item.reservationType === "seating",
  ).map((item) => getPhysicalFloorPlanAreaId(item.areaId)));
  const foodCandidates = primaryContractedArea
    ? foodTablesNearArea(primaryContractedArea)
    : foodTablesNearArea("main-dining");
  for (const foodCandidate of foodCandidates) {
    if (foodAssigned >= foodTableCount) break;
    const physicalId = getPhysicalFloorPlanAreaId(foodCandidate.id);
    if (
      areaUnavailable(physicalId, "food-table") ||
      savedSeatingPhysicalIds.has(physicalId) ||
      foodPhysicalIds.has(physicalId)
    ) {
      continue;
    }
    generated.push(reservation(event, foodCandidate.id, "food-table", "F"));
    existingFoodAreaIds.add(foodCandidate.id);
    foodPhysicalIds.add(physicalId);
    foodAssigned += 1;
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
  const existingSeatingCapacity = summarizeEventSeating(event, existingEventReservations).coveredCapacity;
  const reservedSeating = [...new Set(existingEventReservations.flatMap((item) =>
    item.reservationType === "room" || item.reservationType === "seating" ? [item.areaId] : [],
  ))].flatMap((id) => {
    const area = getFloorPlanArea(id);
    return area && area.capacity > 0 ? [area] : [];
  });
  const availableTables = [...new Set(seatingContractedAreas)].flatMap((areaId) =>
    seatingInventoryForArea(areaId).filter(
      (table) =>
        !areaUnavailable(table.id, "seating") &&
        !existingSeatingAreaIds.has(getPhysicalFloorPlanAreaId(table.id)) &&
        !foodPhysicalIds.has(getPhysicalFloorPlanAreaId(table.id)),
    ),
  );
  const remainingGuests = Math.max(0, event.guestCount - existingSeatingCapacity);
  const selection = searchSeatingCombination(
    availableTables,
    remainingGuests,
    reservedSeating,
    foodTables,
  );
  if (selection.status === "search-incomplete") {
    issues.push({ eventId: event.id, code: "search-incomplete", message: `${event.name}: a sufficient table group was found, but the bounded search could not finish comparing every grouping. Review the proposed placement.`, blocking: false });
  } else if (selection.status === "no-valid-combination") {
    issues.push({ eventId: event.id, code: "no-valid-combination", message: `${event.name}: no sufficient combination is available in the contracted area for the full seating interval, including setup and cleanup occupancy.`, blocking: true });
  }
  for (const table of selection.tables) {
    generated.push(reservation(event, table.id, "seating", table.shortLabel));
  }
  if (selection.tables.length) {
    issues.push({ eventId: event.id, code: "seating-selection", blocking: false,
      message: `${event.name}: add ${selection.tables.map((table) => table.name).join(", ")} (${seatingCapacity(selection.tables)} seats) for ${remainingGuests} remaining guests. Eligible tables are prioritized by food access, then spare capacity, grouping and table count; setup and cleanup availability is included.` });
  }
  return generated;
}

function generateInOrder(
  plan: FloorPlanDocument,
  mode: FloorPlanGenerationMode,
  selectedEventId: string | undefined,
  eventOrder: readonly FloorPlanEvent[],
  fixedReservations?: readonly FloorPlanReservation[],
) {
  const approved = ["Approved", "Updated After Approval", "Completed", "Archived"].includes(plan.status);
  const preserved = fixedReservations ? [...fixedReservations] : plan.reservations.flatMap((item) => {
    if (selectedEventId && item.floorPlanEventId !== selectedEventId) return [item];
    const event = plan.events.find(
      (candidate) => candidate.id === item.floorPlanEventId,
    );
    if (event) {
      const current = reservationForCurrentFloorPlanEvent(event, item);
      if (!current) return [];
      if (mode === "fill-missing" || approved) return [current];
      if (mode === "replace-generated") {
        return item.source === "manual" || item.lockedByUser || item.placementOverride || item.timingSource === "staff-override" ? [current] : [];
      }
      return [];
    }
    if (mode === "fill-missing") return [item];
    if (mode === "replace-generated") {
      return item.source === "manual" || item.lockedByUser || item.timingSource === "staff-override" ? [item] : [];
    }
    return [];
  });
  const next = [...preserved];
  const issues: FloorPlanGenerationIssue[] = [];
  for (const event of eventOrder) {
    if (selectedEventId && event.id !== selectedEventId) continue;
    const generated = eventBaseReservations(plan, event, next, issues);
    for (const item of generated) {
      if (
        next.some(
          (existing) =>
            existing.id === item.id ||
            (existing.floorPlanEventId === item.floorPlanEventId &&
              getPhysicalFloorPlanAreaId(existing.areaId) === getPhysicalFloorPlanAreaId(item.areaId) &&
              existing.reservationType === item.reservationType),
        )
      ) {
        continue;
      }
      next.push(item);
    }
  }
  return { reservations: next, issues };
}

function eventSatisfied(event: FloorPlanEvent, reservations: readonly FloorPlanReservation[]) {
  const summary = summarizeEventSeating(event, reservations, { allReservations: reservations });
  return summary.fullEventCoverage && summary.foodAssigned >= summary.foodRequired;
}

/** Suggestions only: callers retain checked-save/version/publication protections. */
export function generateFloorPlanReservationProposal(
  plan: FloorPlanDocument,
  mode: FloorPlanGenerationMode,
  selectedEventId?: string,
): FloorPlanGenerationProposal {
  const selectedEvents = plan.events.filter((event) => !selectedEventId || event.id === selectedEventId);
  if (selectedEventId && selectedEvents.length === 0) throw new Error("Choose an event on this floor plan before repairing seating.");
  let result = generateInOrder(plan, mode, selectedEventId, selectedEvents);
  const satisfied = (reservations: readonly FloorPlanReservation[]) =>
    selectedEvents.every((event) => eventSatisfied(event, reservations)) &&
    !detectFloorPlanConflicts({ ...plan, reservations: [...reservations] }).some((conflict) =>
      !selectedEventId || conflict.eventIds.includes(selectedEventId));
  const mayReallocate = !selectedEventId && !["Approved", "Updated After Approval", "Completed", "Archived"].includes(plan.status);
  if (!satisfied(result.reservations) && mayReallocate && selectedEvents.length > 1 &&
    !result.issues.some((issue) => issue.code === "missing-source")) {
    // Reconsider only unlocked generated choices. Staff/approved choices are constraints.
    const fixed = plan.reservations.filter((item) => item.source === "manual" || item.lockedByUser || item.placementOverride || item.timingSource === "staff-override");
    const order = [...selectedEvents].sort((left, right) => {
      const options = (event: FloorPlanEvent) => event.contractedAreaIds.reduce((total, id) => total + seatingInventoryForArea(id).length, 0);
      return options(left) - options(right) || right.guestCount - left.guestCount || left.id.localeCompare(right.id);
    });
    let explored = 0;
    let searchIncomplete = false;
    function allocate(index: number, reservations: FloorPlanReservation[], issues: FloorPlanGenerationIssue[]): typeof result | null {
      if (index === order.length) return satisfied(reservations) ? { reservations, issues } : null;
      if (explored >= 256) { searchIncomplete = true; return null; }
      const event = order[index];
      const exclusions: Set<string>[] = [new Set()];
      const seen = new Set([""]);
      for (let variant = 0; variant < exclusions.length && variant < 24; variant += 1) {
        if (explored >= 256) { searchIncomplete = true; break; }
        explored += 1;
        const variantIssues: FloorPlanGenerationIssue[] = [];
        const additions = eventBaseReservations(plan, event, reservations, variantIssues, exclusions[variant]);
        const next = [...reservations];
        for (const addition of additions) {
          if (!next.some((existing) => existing.floorPlanEventId === event.id &&
            existing.reservationType === addition.reservationType &&
            getPhysicalFloorPlanAreaId(existing.areaId) === getPhysicalFloorPlanAreaId(addition.areaId))) next.push(addition);
        }
        if (eventSatisfied(event, next)) {
          const complete = allocate(index + 1, next, [...issues, ...variantIssues]);
          if (complete) return complete;
        }
        // Alternate only new choices, never the fixed records supplied by staff.
        for (const addition of additions.filter((item) => item.reservationType === "seating" || item.reservationType === "food-table")) {
          const alternate = new Set([...exclusions[variant], `${addition.reservationType}:${getPhysicalFloorPlanAreaId(addition.areaId)}`]);
          const key = [...alternate].sort().join("|");
          if (!seen.has(key)) { seen.add(key); exclusions.push(alternate); }
        }
      }
      if (exclusions.length > 24) searchIncomplete = true;
      return null;
    }
    const alternative = allocate(0, [...fixed], []);
    if (alternative) {
      result = alternative;
      result.issues.push({ eventId: "", code: "joint-reallocation", blocking: false,
        message: "An alternate combination of unlocked generated tables meets the overlapping parties’ requirements. Contracted areas, food proximity and seating buffers were retained; staff-selected and locked tables were not moved." });
    } else if (searchIncomplete) {
      result.issues = result.issues.filter((issue) => issue.code !== "no-valid-combination");
      result.issues.push({ eventId: "", code: "search-incomplete", blocking: true,
        message: "The bounded joint allocation search could not finish. Existing assignments were retained; this is not proof that no valid table combination exists." });
    }
  }
  // Never discard an existing event assignment in favor of an unsuccessful rework.
  if (mode !== "fill-missing") {
    for (const event of selectedEvents) {
      const eventConflicts = detectFloorPlanConflicts({ ...plan, reservations: result.reservations }).some((conflict) => conflict.eventIds.includes(event.id));
      if ((!eventSatisfied(event, result.reservations) || eventConflicts) && plan.reservations.some((item) => item.floorPlanEventId === event.id)) {
        result.reservations = [...result.reservations.filter((item) => item.floorPlanEventId !== event.id),
          ...plan.reservations.filter((item) => item.floorPlanEventId === event.id)];
        result.issues.push({ eventId: event.id, code: "assignments-preserved", blocking: true,
          message: `${event.name}: the replacement does not meet the full seating and food-table requirements, so existing assignments were retained.` });
      }
    }
  }
  const oldIds = new Set(plan.reservations.map((item) => item.id));
  const newIds = new Set(result.reservations.map((item) => item.id));
  return {
    ...result,
    addedReservationIds: result.reservations.filter((item) => !oldIds.has(item.id)).map((item) => item.id),
    movedReservationIds: plan.reservations.filter((item) => !newIds.has(item.id)).map((item) => item.id),
    complete: satisfied(result.reservations),
  };
}

export function generateFloorPlanReservations(
  plan: FloorPlanDocument,
  mode: FloorPlanGenerationMode,
  selectedEventId?: string,
) {
  return generateFloorPlanReservationProposal(plan, mode, selectedEventId).reservations;
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
  if (reservationTimingSource(reservation, event) === "staff-override") {
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
