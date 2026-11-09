import type { EntertainmentReservation } from "@/lib/entertainment/types";
import type { FloorPlanDayPayload, FloorPlanDocument } from "./types";

export const STAFF_FLOOR_PLAN_INCOMPLETE = "This floor plan is not finalized. Confirm assignments with a manager before use.";
export const STAFF_FLOOR_PLAN_REFRESH_ERROR = "Unable to refresh the floor plan. The last saved plan remains available.";

export type StaffFloorPlanPayload = Pick<FloorPlanDayPayload, "date" | "plan" | "entertainmentReservations"> & {
  incomplete?: boolean;
  bookingRefreshedAt?: string | null;
};

/** Build the display document field by field: nested source, review and audit data stay server-side. */
export function staffFloorPlanDocument(plan: FloorPlanDocument): FloorPlanDocument {
  return {
    id: plan.id, eventDate: plan.eventDate, status: plan.status === "Approved" ? "Approved" : "Draft",
    version: plan.version, ruleVersion: plan.ruleVersion, lastTripleseatSyncAt: plan.lastTripleseatSyncAt,
    createdAt: plan.createdAt, updatedAt: plan.updatedAt, approvedAt: null, approvedBy: null,
    events: plan.events.map((event) => ({
      id: event.id, floorPlanId: event.floorPlanId, tripleseatEventId: event.tripleseatEventId,
      name: event.name, status: "", guestCount: event.guestCount, startAt: event.startAt, endAt: event.endAt,
      contractedAreaIds: event.contractedAreaIds, unresolvedAreaNames: [], color: event.color, beoLastModifiedAt: null,
      fullBuyout: event.fullBuyout,
      source: {
        rooms: event.source.rooms, sourceEventIds: event.source.sourceEventIds,
        verifiedSourceEventIds: event.source.verifiedSourceEventIds,
        food: [], entertainment: [], operationalNotes: [], reviewReasons: [],
      },
    })),
    reservations: plan.reservations.map((row) => ({
      id: row.id, floorPlanEventId: row.floorPlanEventId, areaId: row.areaId, reservationType: row.reservationType,
      startAt: row.startAt, endAt: row.endAt, label: row.label, source: row.source, lockedByUser: row.lockedByUser,
      ...(row.customGeometry ? { customGeometry: { x: row.customGeometry.x, y: row.customGeometry.y, width: row.customGeometry.width, height: row.customGeometry.height } } : {}),
    })),
  };
}

function staffEntertainmentReservation(row: EntertainmentReservation): EntertainmentReservation {
  return {
    id: row.id, syncKey: null, localEventId: row.localEventId, tripleseatEventId: row.tripleseatEventId,
    tripleseatBookingId: null, eventName: row.eventName, operatingDate: row.operatingDate, resourceId: row.resourceId,
    resourceCategory: row.resourceCategory, resourceName: row.resourceName, startAt: row.startAt, endAt: row.endAt,
    sourceStartAt: null, sourceEndAt: null, sourceResourceId: null, contractedDurationMinutes: row.contractedDurationMinutes,
    eventColor: row.eventColor, colorSource: row.colorSource, source: row.source, sourceReference: null,
    manualOverride: false, hasSourceUpdate: false, needsReview: false, reviewIssues: [], autoAssigned: false, notes: "",
    sourceUpdatedAt: null, lastTripleseatSyncAt: null, active: row.active, createdAt: "", updatedAt: "", updatedBy: "",
  };
}

export function staffFloorPlanPayload(payload: FloorPlanDayPayload): StaffFloorPlanPayload {
  const { plan } = payload;
  const bookingOnly = plan.version === 0 && plan.events.length > 0 && plan.events.every((event) => event.tripleseatEventId.startsWith("vip-"));
  const incomplete = (!bookingOnly && plan.status !== "Approved") || payload.warnings.length > 0 ||
    payload.floorPlanConflicts.length > 0 || payload.entertainmentConflicts.length > 0 ||
    payload.validation.some((item) => item.status === "Failed" || (plan.status !== "Approved" && item.status === "Warning")) ||
    Boolean(payload.sourceRefresh && payload.sourceRefresh.tripleseat !== "success") ||
    Boolean(payload.sourceChanges?.some((change) => change.assignmentsReconciled === false));
  const published = staffFloorPlanDocument(plan);
  return {
    date: payload.date,
    plan: incomplete ? { ...published, status: "Draft" } : published,
    entertainmentReservations: payload.entertainmentReservations.filter((row) => row.active).map(staffEntertainmentReservation),
    bookingRefreshedAt: plan.events.flatMap((event) => event.source.onParBooking?.refreshedAt ? [event.source.onParBooking.refreshedAt] : []).sort().at(-1) ?? null,
    incomplete,
  };
}
