import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "./types";

export function sameReservationInterval(
  left: Pick<FloorPlanReservation, "startAt" | "endAt">,
  right: Pick<FloorPlanReservation, "startAt" | "endAt">,
) {
  const sameTime = (a: string | null, b: string | null) =>
    a === b || Boolean(a && b && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
  return sameTime(left.startAt, right.startAt) && sameTime(left.endAt, right.endAt);
}

/** Legacy equal-to-event holds follow the event; preserve distinct legacy times. */
export function reservationTimingSource(reservation: FloorPlanReservation, event: FloorPlanEvent) {
  return reservation.timingSource ?? (
    reservation.source === "generated" || sameReservationInterval(reservation, event)
      ? "event-default" : "staff-override"
  );
}

type ReservationState = Pick<FloorPlanReservation, "timingSource" | "placementOverride" | "changeDetails">;
const STATE_KEY = "floorPlanReservationState";

/** Existing checked RPC persists event.source JSONB in the same transaction. */
export function encodeFloorPlanReservationState(plan: FloorPlanDocument): FloorPlanDocument {
  return {
    ...plan,
    events: plan.events.map((event) => {
      const state: Record<string, ReservationState> = Object.create(null);
      for (const row of plan.reservations.filter((item) => item.floorPlanEventId === event.id)) {
        if (row.timingSource === undefined && row.placementOverride === undefined && !row.changeDetails) continue;
        state[row.id] = {
          ...(row.timingSource ? { timingSource: row.timingSource } : {}),
          ...(row.placementOverride !== undefined ? { placementOverride: row.placementOverride } : {}),
          ...(row.changeDetails ? { changeDetails: row.changeDetails } : {}),
        };
      }
      return { ...event, source: { ...event.source, [STATE_KEY]: state } };
    }),
  };
}

export function decodeFloorPlanReservationState(plan: FloorPlanDocument): FloorPlanDocument {
  const states = new Map<string, ReservationState>();
  const events = plan.events.map((event) => {
    const { [STATE_KEY]: raw, ...source } = event.source as FloorPlanEvent["source"] & { [STATE_KEY]?: Record<string, ReservationState> };
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const row of plan.reservations.filter((item) => item.floorPlanEventId === event.id)) {
        const state = Object.hasOwn(raw, row.id) ? raw[row.id] : undefined;
        if (!state || typeof state !== "object") continue;
        states.set(row.id, {
          ...(["event-default", "staff-override"].includes(state.timingSource ?? "") ? { timingSource: state.timingSource } : {}),
          ...(typeof state.placementOverride === "boolean" ? { placementOverride: state.placementOverride } : {}),
          ...(state.changeDetails && Array.isArray(state.changeDetails.fields) && typeof state.changeDetails.reason === "string"
            ? { changeDetails: { fields: state.changeDetails.fields.filter((field) => typeof field === "string"), reason: state.changeDetails.reason } } : {}),
        });
      }
    }
    return { ...event, source };
  });
  return { ...plan, events, reservations: plan.reservations.map((row) => {
    // The existing SQL document emits JSON null for absent custom geometry.
    const { customGeometry, ...fields } = row;
    return { ...fields, ...(customGeometry ? { customGeometry } : {}), ...states.get(row.id) };
  }) };
}
