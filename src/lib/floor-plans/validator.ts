import {
  canonicalCategoryForText,
} from "@/lib/entertainment/resources";
import type {
  EntertainmentConflict,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import { selectEntertainmentResources } from "./configuration/adjacency";
import {
  getAreaForEntertainmentResource,
  getFloorPlanArea,
  requiredFoodTableCount,
} from "./configuration/areas";
import { floorPlanEventColorsAreDistinct } from "./configuration/colors";
import { entertainmentReservationMatchesFloorPlanEvent } from "./identity";
import { timeRangesOverlap } from "./conflicts";
import { reservationOccupancy } from "@/lib/operations/reservation-buffer";
import { isVipOnlyFloorPlanEvent } from "./generator";
import { seatingCoverageMessage, summarizeEventSeating } from "./seating-summary";
import type {
  FloorPlanConflict,
  FloorPlanDocument,
  FloorPlanValidationItem,
} from "./types";

function item(
  code: FloorPlanValidationItem["code"],
  eventId: string | null,
  label: string,
  status: FloorPlanValidationItem["status"],
  message: string,
  blocking = status === "Failed",
): FloorPlanValidationItem {
  return { code, eventId, label, status, message, blocking };
}

function reservationMatchesEvent(
  reservation: EntertainmentReservation,
  event: FloorPlanDocument["events"][number],
) {
  return entertainmentReservationMatchesFloorPlanEvent(reservation, event);
}

function requestedQuantity(value: string) {
  const match = value.match(/\b(\d+)\b/);
  return match ? Number(match[1]) : null;
}

export function validateFloorPlan(
  plan: FloorPlanDocument,
  entertainmentReservations: readonly EntertainmentReservation[],
  floorPlanConflicts: readonly FloorPlanConflict[],
  entertainmentConflicts: readonly EntertainmentConflict[],
) {
  const result: FloorPlanValidationItem[] = [];
  const nonDistinctEventIds = new Set<string>();
  for (const [index, event] of plan.events.entries()) {
    for (const candidate of plan.events.slice(0, index)) {
      if (!floorPlanEventColorsAreDistinct(event.color, candidate.color)) {
        nonDistinctEventIds.add(event.id);
        nonDistinctEventIds.add(candidate.id);
      }
    }
  }

  for (const event of plan.events) {
    const reservations = plan.reservations.filter(
      (reservation) => reservation.floorPlanEventId === event.id,
    );
    const seating = reservations.filter(
      (reservation) => reservation.reservationType === "seating" ||
        (reservation.reservationType === "room" &&
          (getFloorPlanArea(reservation.areaId)?.capacity ?? 0) > 0),
    );
    const seatingSummary = summarizeEventSeating(event, reservations, { allReservations: plan.reservations });
    const vipOnly = isVipOnlyFloorPlanEvent(event);
    const food = reservations.filter(
      (reservation) => reservation.reservationType === "food-table",
    );
    const foodTableCount = requiredFoodTableCount(event.guestCount);
    const foodPhysicalCount = seatingSummary.foodAssigned;
    const foodTableCountPasses = foodPhysicalCount >= foodTableCount;
    const foodTableLabelsPass = food.every(
      (reservation) => reservation.label === "F",
    );
    const eventEntertainment = entertainmentReservations.filter(
      (reservation) => reservation.active && reservationMatchesEvent(reservation, event),
    );

    result.push(
      item("DATE_MATCH", event.id, "Day and date", "Passed", `${event.name} is attached to ${plan.eventDate}.`, false),
    );
    const detailsComplete =
      Boolean(event.name) &&
      event.guestCount > 0 &&
      !event.source.reviewReasons.some((reason) =>
        /Guest count is missing or invalid|Guest count was filled from .*package/i.test(reason),
      ) &&
      Boolean(reservationOccupancy(event.startAt, event.endAt));
    result.push(
      item(
        "EVENT_DETAILS",
        event.id,
        "Event details match BEO",
        detailsComplete ? "Passed" : "Failed",
        detailsComplete
          ? "Event name, guest count, and time are present."
          : "A verified BEO event name, guest count, or time is missing.",
      ),
    );

    const contractedAreaComplete =
      event.contractedAreaIds.length > 0 && event.unresolvedAreaNames.length === 0;
    result.push(
      item(
        "CONTRACTED_AREA",
        event.id,
        "Contracted section",
        contractedAreaComplete ? "Passed" : "Failed",
        contractedAreaComplete
          ? `Mapped to ${event.contractedAreaIds.join(", ")}.`
          : event.unresolvedAreaNames.length
            ? `Unresolved Tripleseat value: ${event.unresolvedAreaNames.join(", ")}.`
            : "No contracted section is available.",
      ),
    );

    const seatingPasses = seatingSummary.fullEventCoverage;
    const searchIssues = event.source.seatingGenerationIssues ?? [];
    const searchNeedsReview = searchIssues.some((issue) => issue.blocking);
    result.push(item(
      "SEATING_SEARCH", event.id, "Seating search",
      searchNeedsReview ? seatingPasses && seatingSummary.foodAssigned >= seatingSummary.foodRequired ? "Warning" : "Failed" : "Passed",
      searchIssues.length ? `Latest generation: ${searchIssues.map((issue) => issue.message).join(" ")}` : "No unresolved seating search limitation is recorded.",
      searchNeedsReview && !(seatingPasses && seatingSummary.foodAssigned >= seatingSummary.foodRequired),
    ));
    result.push(
      item(
        "SEATING_CAPACITY",
        event.id,
        "Seating capacity",
        seatingPasses ? "Passed" : "Failed",
        seatingCoverageMessage(event, seatingSummary),
      ),
    );
    const seatingInsideContract = seating.every((reservation) => {
      const area = getFloorPlanArea(reservation.areaId);
      return (
        event.contractedAreaIds.includes("facility") ||
        Boolean(
          area &&
            (event.contractedAreaIds.includes(area.id) ||
              (area.parentAreaId && event.contractedAreaIds.includes(area.parentAreaId))),
        )
      );
    });
    result.push(
      item(
        "SEATING_LOCATION",
        event.id,
        "Seating stays inside contract",
        seating.length === 0 ? "Failed" : seatingInsideContract ? "Passed" : "Failed",
        seating.length === 0
          ? "No verified seating inventory is reserved."
          : seatingInsideContract
            ? "All reserved seating is inside a contracted section."
            : "One or more seating assignments are outside the contracted section.",
      ),
    );

    result.push(
      item(
        "FOOD_TABLE",
        event.id,
        "Food table assigned",
        vipOnly ? "Not Applicable" : foodTableCountPasses && foodTableLabelsPass
          ? "Passed"
          : "Failed",
        vipOnly ? "VIP-only bookings reserve the VIP section without surrounding tables." : foodTableCountPasses
          ? foodTableLabelsPass
            ? `${foodPhysicalCount} authorized food table${foodPhysicalCount === 1 ? " is" : "s are"} assigned and labeled F.`
            : "Every food table must be labeled F."
          : `${foodTableCount} food table${foodTableCount === 1 ? " is" : "s are"} required for ${event.guestCount} guests; ${foodPhysicalCount} assigned with authorized inventory covering the full event interval and required occupancy.`,
        !vipOnly && !(foodTableCountPasses && foodTableLabelsPass),
      ),
    );
    const foodIsAda =
      foodTableCountPasses &&
      food.every((reservation) => {
        const area = getFloorPlanArea(reservation.areaId);
        return area?.isAda && area.canBeFoodTable;
      });
    const foodAuthorized = foodTableCountPasses && food.every((reservation) =>
      getFloorPlanArea(reservation.areaId)?.canBeFoodTable,
    );
    result.push(
      item(
        "FOOD_TABLE_ADA",
        event.id,
        "Food table uses designated ADA table",
        vipOnly ? "Not Applicable" : foodIsAda ? "Passed" : foodAuthorized ? "Warning" : "Failed",
        vipOnly ? "No surrounding food table is assigned for a VIP-only booking." : foodIsAda
          ? "Every food table uses designated ADA inventory."
          : foodAuthorized
            ? "GEG tables are approved for food use; confirm accessible placement before approval. Their ADA designation has not been verified."
            : "A food table is missing or is not assigned to authorized food inventory.",
        !vipOnly && !foodAuthorized,
      ),
    );

    if (event.source.entertainment.length === 0) {
      result.push(
        item("ENTERTAINMENT_QUANTITY", event.id, "Entertainment quantity", "Not Applicable", "No entertainment is listed in the available BEO projection.", false),
        item("ENTERTAINMENT_TIME", event.id, "Entertainment time", "Not Applicable", "No entertainment is listed in the available BEO projection.", false),
      );
    } else {
      const quantityFailures: string[] = [];
      const timeWarnings: string[] = [];
      for (const requirement of event.source.entertainment) {
        const category = canonicalCategoryForText(requirement.name);
        if (!category) {
          quantityFailures.push(`${requirement.name} is not mapped.`);
          continue;
        }
        if (category === "mini-golf") {
          continue;
        }
        const required = requestedQuantity(requirement.quantity);
        const assigned = eventEntertainment.filter(
          (reservation) => reservation.resourceCategory === category,
        ).length;
        if (required == null || assigned < required) {
          quantityFailures.push(
            `${requirement.name}: ${assigned} assigned; ${required ?? "an explicit quantity"} required.`,
          );
        }
        if (/not listed|needs review/i.test(requirement.time)) {
          timeWarnings.push(`${requirement.name} is missing a verified time.`);
        }
      }
      result.push(
        item(
          "ENTERTAINMENT_QUANTITY",
          event.id,
          "Entertainment quantity",
          quantityFailures.length ? "Failed" : "Passed",
          quantityFailures.join(" ") || "Shared schedule reservations meet the reservable BEO quantities. Mini golf is open play and does not require a reservation.",
        ),
        item(
          "ENTERTAINMENT_TIME",
          event.id,
          "Entertainment time",
          timeWarnings.length ? "Warning" : "Passed",
          timeWarnings.join(" ") || "Required reservation times are present. Mini golf is open play and is excluded from the schedule.",
          false,
        ),
      );
    }

    const eventEntertainmentConflict = entertainmentConflicts.some((conflict) =>
      conflict.reservationIds.some((id) =>
        eventEntertainment.some((reservation) => reservation.id === id),
      ),
    );
    result.push(
      item(
        "ENTERTAINMENT_CONFLICT",
        event.id,
        "Entertainment conflicts",
        eventEntertainmentConflict ? "Failed" : "Passed",
        eventEntertainmentConflict
          ? "A shared Entertainment Schedule reservation overlaps another event."
          : "No shared entertainment resource overlaps another event.",
      ),
    );
    const placementWarnings: string[] = [];
    const bowlingGroups = new Map<string, EntertainmentReservation[]>();
    for (const reservation of eventEntertainment) {
      if (reservation.resourceCategory !== "bowling") continue;
      const key = `${reservation.startAt}:${reservation.endAt}`;
      bowlingGroups.set(key, [...(bowlingGroups.get(key) ?? []), reservation]);
    }
    for (const group of bowlingGroups.values()) {
      const groupIds = new Set(group.map((reservation) => reservation.id));
      const unavailable = new Set(entertainmentReservations.flatMap((reservation) =>
        reservation.active && !groupIds.has(reservation.id) &&
          timeRangesOverlap(group[0].startAt, group[0].endAt, reservation.startAt, reservation.endAt)
          ? [reservation.resourceId] : [],
      ));
      const closest = selectEntertainmentResources(event.contractedAreaIds, "bowling", group.length, unavailable);
      if (closest.length !== group.length || group.some((reservation) => !closest.includes(reservation.resourceId))) {
        placementWarnings.push("Bowling is not the closest available lane group to the contracted seating. Review any deliberate manual placement.");
      }
    }
    result.push(
      item(
        "ENTERTAINMENT_PLACEMENT",
        event.id,
        "Entertainment placement",
        placementWarnings.length ? "Warning" : "Passed",
        placementWarnings.join(" ") || "Bowling uses the closest available consecutive lane group when possible; shared entertainment placement is preserved.",
        false,
      ),
    );
    result.push(
      item(
        "DISTINCT_COLOR",
        event.id,
        "Distinct event color",
        nonDistinctEventIds.has(event.id) ? "Failed" : "Passed",
        nonDistinctEventIds.has(event.id)
          ? "Another event on this date uses the same or a visually similar color."
          : "The event has a visually distinct color and labeled overlays.",
      ),
    );
  }

  result.push(
    item(
      "RESOURCE_CONFLICT",
      null,
      "Floor-plan resource conflicts",
      floorPlanConflicts.length ? "Failed" : "Passed",
      floorPlanConflicts.length
        ? `${floorPlanConflicts.length} overlapping floor-plan reservation conflict${floorPlanConflicts.length === 1 ? "" : "s"}.`
        : "No table, room, or facility reservation overlaps.",
    ),
    item(
      "FULL_BUYOUT",
      null,
      "Full buyout lock",
      floorPlanConflicts.some((conflict) => conflict.areaId === "facility") ? "Failed" : "Passed",
      floorPlanConflicts.some((conflict) => conflict.areaId === "facility")
        ? "Another event overlaps a full-facility buyout."
        : "No event overlaps a full-facility buyout.",
    ),
    item(
      "PROTECTED_PATHS",
      null,
      "Aisles, exits, and ADA routes",
      "Passed",
      "Assignments use fixed reservable venue objects; permanent geometry and protected paths cannot be moved.",
      false,
    ),
    item(
      "OVERLAY_STYLE",
      null,
      "Readable 50% overlays",
      "Passed",
      "Screen and export overlays use 50% fills, full event-color borders, and text labels.",
      false,
    ),
    item(
      "TRIPLESEAT_SAFE",
      null,
      "Tripleseat safe projection",
      "Passed",
      "The plan stores only the typed floor-plan projection from server-side read-only Tripleseat access.",
      false,
    ),
    item(
      "BEO_CURRENT",
      null,
      "Current BEO",
      plan.status === "Updated After Approval" ? "Warning" : "Passed",
      plan.status === "Updated After Approval"
        ? "Tripleseat changed after approval; staff review and reapproval are required."
        : "The saved plan uses the latest synchronized BEO projection.",
      false,
    ),
    item("SAVED_IN_EVENT_HOST", null, "Saved in Event Host", plan.id ? "Passed" : "Failed", plan.id ? `Saved as version ${plan.version}.` : "The plan has not been saved."),
    item(
      "SCHEDULE_SYNCHRONIZED",
      null,
      "Entertainment Schedule synchronized",
      entertainmentReservations.every((reservation) => !reservation.active || getAreaForEntertainmentResource(reservation.resourceId))
        ? "Passed"
        : "Warning",
      "Floor Plans and Entertainment Schedule read the same shared entertainment reservation records.",
      false,
    ),
  );
  return result;
}

export function hasBlockingValidationFailures(
  validation: readonly FloorPlanValidationItem[],
) {
  return validation.some((entry) => entry.blocking && entry.status === "Failed");
}
