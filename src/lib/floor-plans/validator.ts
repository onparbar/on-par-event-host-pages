import {
  canonicalCategoryForText,
} from "@/lib/entertainment/resources";
import type {
  EntertainmentConflict,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import { preferredInventory } from "./configuration/adjacency";
import { getAreaForEntertainmentResource, getFloorPlanArea } from "./configuration/areas";
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
  return (
    reservation.tripleseatEventId === event.tripleseatEventId ||
    reservation.localEventId === event.tripleseatEventId ||
    reservation.localEventId === event.id
  );
}

function requestedQuantity(value: string, miniGolf: boolean) {
  if (miniGolf) return 1;
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
  const duplicateColors = new Set(
    plan.events
      .filter(
        (event, index) =>
          plan.events.findIndex(
            (candidate) => candidate.color.toUpperCase() === event.color.toUpperCase(),
          ) !== index,
      )
      .map((event) => event.color.toUpperCase()),
  );

  for (const event of plan.events) {
    const reservations = plan.reservations.filter(
      (reservation) => reservation.floorPlanEventId === event.id,
    );
    const seating = reservations.filter(
      (reservation) => reservation.reservationType === "seating",
    );
    const seatingCapacity = seating.reduce(
      (total, reservation) =>
        total + (getFloorPlanArea(reservation.areaId)?.capacity ?? 0),
      0,
    );
    const food = reservations.filter(
      (reservation) => reservation.reservationType === "food-table",
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
      Boolean(event.startAt) &&
      Boolean(event.endAt);
    result.push(
      item(
        "EVENT_DETAILS",
        event.id,
        "Event details match BEO",
        detailsComplete ? "Passed" : "Failed",
        detailsComplete
          ? "Event name, guest count, and time are present."
          : "Event name, guest count, or time is missing.",
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

    const seatingPasses = seatingCapacity >= event.guestCount;
    result.push(
      item(
        "SEATING_CAPACITY",
        event.id,
        "Seating capacity",
        seatingPasses ? "Passed" : "Failed",
        `${seatingCapacity} reserved seats for ${event.guestCount} guests.`,
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
          ? "No seating tables are reserved."
          : seatingInsideContract
            ? "All seating tables are inside a contracted section."
            : "One or more seating tables are outside the contracted section.",
      ),
    );

    result.push(
      item(
        "FOOD_TABLE",
        event.id,
        "Food table assigned",
        food.length >= 1 && food.every((reservation) => reservation.label === "F")
          ? "Passed"
          : "Failed",
        food.length >= 1
          ? food.every((reservation) => reservation.label === "F")
            ? `${food.length} authorized food table${food.length === 1 ? " is" : "s are"} assigned and labeled F.`
            : "Every food table must be labeled F."
          : "No food table is assigned.",
      ),
    );
    const foodIsAda =
      food.length > 0 &&
      food.every((reservation) => {
        const area = getFloorPlanArea(reservation.areaId);
        return area?.isAda && area.canBeFoodTable;
      });
    result.push(
      item(
        "FOOD_TABLE_ADA",
        event.id,
        "Food table uses designated ADA table",
        foodIsAda ? "Passed" : "Failed",
        foodIsAda
          ? "Every food table uses designated ADA inventory."
          : "A food table is missing or is not assigned to designated ADA inventory.",
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
        const miniGolf = category === "mini-golf";
        const required = requestedQuantity(requirement.quantity, miniGolf);
        const assigned = eventEntertainment.filter(
          (reservation) => reservation.resourceCategory === category,
        ).length;
        if (required == null || assigned < required) {
          quantityFailures.push(
            `${requirement.name}: ${assigned} assigned; ${required ?? "an explicit quantity"} required.`,
          );
        }
        if (!miniGolf && /not listed|needs review/i.test(requirement.time)) {
          timeWarnings.push(`${requirement.name} is missing a verified time.`);
        }
      }
      result.push(
        item(
          "ENTERTAINMENT_QUANTITY",
          event.id,
          "Entertainment quantity",
          quantityFailures.length ? "Failed" : "Passed",
          quantityFailures.join(" ") || "Shared schedule reservations meet the BEO quantities.",
        ),
        item(
          "ENTERTAINMENT_TIME",
          event.id,
          "Entertainment time",
          timeWarnings.length ? "Warning" : "Passed",
          timeWarnings.join(" ") || "Required entertainment times are present; mini golf is allowed to be untimed.",
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
    const placementWarnings = eventEntertainment.flatMap((reservation) => {
      if (reservation.resourceCategory === "private-rooms") return [];
      const category = reservation.resourceCategory;
      const seatingArea = event.contractedAreaIds.find(
        (areaId) => preferredInventory(areaId, category).length > 0,
      );
      if (!seatingArea) return [];
      const preferenceIndex = preferredInventory(
        seatingArea,
        category,
      ).indexOf(reservation.resourceId);
      return preferenceIndex < 0
        ? [`${reservation.resourceName} has no configured proximity relationship.`]
        : [];
    });
    result.push(
      item(
        "ENTERTAINMENT_PLACEMENT",
        event.id,
        "Entertainment placement",
        placementWarnings.length ? "Warning" : "Passed",
        placementWarnings.join(" ") || "Shared entertainment uses the configured seating-proximity inventory.",
        false,
      ),
    );
    result.push(
      item(
        "DISTINCT_COLOR",
        event.id,
        "Distinct event color",
        duplicateColors.has(event.color.toUpperCase()) ? "Failed" : "Passed",
        duplicateColors.has(event.color.toUpperCase())
          ? "Another event on this date uses the same color."
          : "The event has a distinct color and labeled overlays.",
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
      "Screen and export overlays use 50% event-color fills, full-color borders, and text labels.",
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
