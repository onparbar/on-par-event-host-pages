"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PortalShell,
  PortalState,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { findOperationalFloorPlanEvent, operationalFloorPlanEventId } from "@/lib/operations/floor-plan-context";
import {
  AREAS,
  DISPLAY_AREAS,
  areaUsesSeatingBuffer,
  floorPlanAreaAssignmentType,
  getAreaForEntertainmentResource,
  getFloorPlanArea,
  getPhysicalFloorPlanAreaId,
} from "@/lib/floor-plans/configuration/areas";
import {
  floorPlanEventColorsAreDistinct,
  readableOverlayText,
} from "@/lib/floor-plans/configuration/colors";
import { detectFloorPlanConflicts, floorPlanAreaTimeOverlap, timeRangesOverlap } from "@/lib/floor-plans/conflicts";
import { buildFloorPlanExportModel } from "@/lib/floor-plans/export";
import { floorPlanEventView, floorPlanLocalReservationOutlines } from "@/lib/floor-plans/event-view";
import { seatingCoverageMessage, summarizeEventSeating } from "@/lib/floor-plans/seating-summary";
import { reservationTimingSource } from "@/lib/floor-plans/reservation-state";
import { formatEntertainmentDurationHours, normalizeEntertainmentDurationHours } from "@/lib/entertainment/duration";
import { reservationOccupancy, RESERVATION_CLEANUP_MINUTES, RESERVATION_SETUP_MINUTES } from "@/lib/operations/reservation-buffer";
import { entertainmentReservationMatchesFloorPlanEvent } from "@/lib/floor-plans/identity";
import {
  displayEventForFloorPlanArea,
  assignLocalFloorPlanArea,
  entertainmentMultipleReservationOutlines,
  entertainmentTimingLabel,
  eventForFloorPlanEntertainment,
  floorPlanCustomGeometry,
  floorPlanOverlayLabel,
  isEntertainmentTimeAnchor,
  localHighlightIdsForDeletion,
  primaryLocalFloorPlanReservation,
  visibleEntertainmentReservations,
} from "@/lib/floor-plans/presentation";
import type {
  FloorPlanArea,
  FloorPlanDayPayload,
  FloorPlanDocument,
  FloorPlanEvent,
  FloorPlanGenerationMode,
  FloorPlanReservation,
} from "@/lib/floor-plans/types";
import { validateFloorPlan } from "@/lib/floor-plans/validator";
import {
  addCalendarDays,
  formatClock,
  formatFullDate,
  todayInEntertainmentTimeZone,
  zonedDateTimeToIso,
} from "@/lib/entertainment/time";
import type {
  EntertainmentDayPayload,
  EntertainmentReservation,
} from "@/lib/entertainment/types";
import FloorPlanEventLegend from "./FloorPlanEventLegend";
import FloorPlanLocalOutlines from "./FloorPlanLocalOutlines";

type RequestState = "idle" | "loading" | "saving" | "error";

function statusTone(status: FloorPlanDocument["status"]) {
  if (status === "Approved" || status === "Completed") return "success" as const;
  if (status === "Conflict") return "danger" as const;
  if (status === "Needs Review" || status === "Updated After Approval") return "warning" as const;
  return "neutral" as const;
}

function eventStatusClass(event: FloorPlanEvent) {
  if (event.fullBuyout) return "is-full-buyout";
  const status = event.status.toLowerCase();
  if (status.includes("closed")) return "is-closed";
  if (status.includes("prospect")) return "is-prospect";
  if (status.includes("lost")) return "is-lost";
  return "is-definite";
}

function eventTime(event: Pick<FloorPlanEvent, "startAt" | "endAt">) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" });
  if (!event.startAt || !event.endAt || !Number.isFinite(Date.parse(event.startAt)) || !Number.isFinite(Date.parse(event.endAt))) return "Time needs review";
  if (event.startAt && event.endAt && day.format(new Date(event.startAt)) !== day.format(new Date(event.endAt))) return datedInterval(event.startAt, event.endAt);
  return event.startAt && event.endAt
    ? `${formatClock(event.startAt)} – ${formatClock(event.endAt)}`
    : "Time needs review";
}

function reservationForAreaAndEvent(
  plan: FloorPlanDocument,
  areaId: string,
  eventId: string,
) {
  const reservation = primaryLocalFloorPlanReservation(plan, areaId, eventId);
  return reservation?.floorPlanEventId === eventId ? reservation : null;
}

function entertainmentForAreaAndEvent(
  payload: FloorPlanDayPayload,
  area: FloorPlanArea,
  event: FloorPlanEvent,
) {
  if (!area.entertainmentResourceId) return null;
  return payload.entertainmentReservations.find(
    (reservation) =>
      reservation.active &&
      reservation.resourceId === area.entertainmentResourceId &&
      entertainmentReservationMatchesFloorPlanEvent(reservation, event),
  ) ?? null;
}

function dateTimeInput(iso: string | null) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function isoFromDateTimeInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Choose a valid date and time.");
  return zonedDateTimeToIso(
    `${match[1]}-${match[2]}-${match[3]}`,
    Number(match[4]),
    Number(match[5]),
  );
}

function datedInterval(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt))) return "Time needs review";
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
  const offsetChanges = zone.formatToParts(new Date(startAt)).find((part) => part.type === "timeZoneName")?.value !== zone.formatToParts(new Date(endAt)).find((part) => part.type === "timeZoneName")?.value;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    ...(offsetChanges ? { timeZoneName: "short" } as const : {}),
  });
  return `${format.format(new Date(startAt))} – ${format.format(new Date(endAt))}`;
}

export function floorPlanGenerationRequest(
  plan: FloorPlanDocument,
  mode: FloorPlanGenerationMode,
  selectedEventId?: string,
) {
  return { action: "generate", expectedVersion: plan.version, mode,
    ...(selectedEventId ? { selectedEventId } : {}) };
}

export function editFloorPlanReservation(
  reservation: FloorPlanReservation,
  patch: Partial<FloorPlanReservation>,
): FloorPlanReservation {
  const placementChanged = patch.areaId !== undefined && patch.areaId !== reservation.areaId ||
    patch.reservationType !== undefined && patch.reservationType !== reservation.reservationType;
  const timeChanged = patch.startAt !== undefined && patch.startAt !== reservation.startAt ||
    patch.endAt !== undefined && patch.endAt !== reservation.endAt;
  return {
    ...reservation, ...patch,
    ...(placementChanged ? { source: "manual", placementOverride: true } : {}),
    ...(timeChanged && patch.timingSource !== "event-default" ? { timingSource: "staff-override" } : {}),
  };
}

export function FloorPlanSeatingSummary({ plan, event, dirty, saveConflict, disabled, onGenerate }: {
  plan: FloorPlanDocument;
  event: FloorPlanEvent;
  dirty: boolean;
  saveConflict: boolean;
  disabled: boolean;
  onGenerate: (mode: FloorPlanGenerationMode) => void;
}) {
  const summary = summarizeEventSeating(event, plan.reservations.filter((reservation) => reservation.floorPlanEventId === event.id), { allReservations: plan.reservations });
  return <section className="floor-plan-seating-summary" aria-label={`Seating summary for ${event.name}`}>
    <h3>Seating for {event.name}</h3>
    <dl className="floor-plan-detail-list">
      <div><dt>Contracted guests</dt><dd>{event.guestCount}</dd></div>
      <div><dt>Assigned seats</dt><dd>{summary.assignedCapacity}</dd></div>
      <div><dt>Full-event seats</dt><dd>{summary.coveredCapacity}</dd></div>
      <div><dt>Seats still needed</dt><dd>{summary.seatsNeeded}</dd></div>
      <div><dt>Spare seats</dt><dd>{summary.spareSeats} — held for this event</dd></div>
      <div><dt>Full-event coverage</dt><dd>{summary.fullEventCoverage ? "Complete" : "Needs attention"}</dd></div>
      <div><dt>Food tables</dt><dd>{summary.foodAssigned} assigned / {summary.foodRequired} required</dd></div>
      <div><dt>Contracted area</dt><dd>{event.source.rooms.join(", ") || "Needs review"}</dd></div>
      <div><dt>Required seating interval</dt><dd>{datedInterval(event.startAt, event.endAt)}</dd></div>
      <div><dt>Save state</dt><dd>{saveConflict ? "Newer saved version exists — your draft is retained" : dirty ? "Unsaved draft" : `Saved version ${plan.version}`}</dd></div>
    </dl>
    <p>Seating setup: {formatEntertainmentDurationHours(RESERVATION_SETUP_MINUTES)}; cleanup: {formatEntertainmentDurationHours(RESERVATION_CLEANUP_MINUTES)}. Entertainment uses its own purchased interval, without these buffers.</p>
    {!summary.fullEventCoverage ? <p className="floor-plan-warning-copy">{seatingCoverageMessage(event, summary)}</p> : null}
    {summary.issues.length ? <ul className="floor-plan-warning-copy">{summary.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
    <div className="floor-plan-inspector-actions">
      <button disabled={disabled || dirty || saveConflict} onClick={() => onGenerate("fill-missing")} type="button">Fill remaining seats</button>
      <button disabled={disabled || dirty || saveConflict} onClick={() => onGenerate("replace-generated")} type="button">Rework generated seating</button>
    </div>
    <small>Selected event only. Staff-selected and locked tables stay in place. Save your draft before running a repair. Saving does not prove that capacity or conflicts are resolved.</small>
  </section>;
}

export function FloorPlanTableDetails({ plan, event, area, reservation, entertainmentReservation = null, allEntertainmentReservations = [] }: {
  plan: FloorPlanDocument; event: FloorPlanEvent; area: FloorPlanArea;
  reservation: FloorPlanReservation | null;
  entertainmentReservation?: EntertainmentReservation | null;
  allEntertainmentReservations?: readonly EntertainmentReservation[];
}) {
  const physicalId = getPhysicalFloorPlanAreaId(area.id);
  const physical = getFloorPlanArea(physicalId) ?? area;
  const assignments = plan.reservations.filter((item) => item.reservationType !== "custom" && getPhysicalFloorPlanAreaId(item.areaId) === physicalId);
  const blockers = assignments.filter((item) => item.floorPlanEventId !== event.id && floorPlanAreaTimeOverlap(physicalId, event.startAt, event.endAt, item.startAt, item.endAt));
  const entertainmentBlockers = allEntertainmentReservations.filter((item) => item.active && item.resourceId === area.entertainmentResourceId && !entertainmentReservationMatchesFloorPlanEvent(item, event) && timeRangesOverlap(event.startAt, event.endAt, item.startAt, item.endAt));
  const displayed = reservation ?? entertainmentReservation;
  const timingSource = reservation ? reservationTimingSource(reservation, event) : null;
  const occupancy = reservation && areaUsesSeatingBuffer(physicalId) ? reservationOccupancy(reservation.startAt, reservation.endAt) : displayed;
  const unavailable = [...blockers.map((item) => `${plan.events.find((candidate) => candidate.id === item.floorPlanEventId)?.name ?? "Another event"} holds ${datedInterval(item.startAt, item.endAt)}${areaUsesSeatingBuffer(physicalId) ? " plus seating setup/cleanup" : ""}`), ...entertainmentBlockers.map((item) => `${item.eventName} has entertainment reserved ${datedInterval(item.startAt, item.endAt)}`)];
  for (const hold of assignments.filter((item) => item.floorPlanEventId !== event.id && (!item.startAt || !item.endAt || !Number.isFinite(Date.parse(item.startAt)) || !Number.isFinite(Date.parse(item.endAt))))) unavailable.push(`${plan.events.find((candidate) => candidate.id === hold.floorPlanEventId)?.name ?? "Another event"} has an incomplete reservation time; availability needs review`);
  for (const hold of plan.reservations.filter((item) => item.areaId === "facility" && item.floorPlanEventId !== event.id && floorPlanAreaTimeOverlap(physicalId, event.startAt, event.endAt, item.startAt, item.endAt))) unavailable.push(`${plan.events.find((candidate) => candidate.id === hold.floorPlanEventId)?.name ?? "Another event"} has a full-facility reservation ${datedInterval(hold.startAt, hold.endAt)}`);
  if (reservation?.reservationType === "seating" && assignments.some((item) => item.floorPlanEventId === event.id && item.reservationType === "food-table" && timeRangesOverlap(reservation.startAt, reservation.endAt, item.startAt, item.endAt))) unavailable.push("This event also uses the same physical table for food during its seating interval; those seats cannot be counted");
  return <section aria-label={`Table details for ${area.name}`}>
    <dl className="floor-plan-detail-list">
      <div><dt>Physical table ID</dt><dd>{physicalId}</dd></div>
      <div><dt>Display name</dt><dd>{physical.name}</dd></div>
      <div><dt>Type</dt><dd>{physical.type}</dd></div>
      <div><dt>Verified capacity</dt><dd>{physical.capacity > 0 ? `${physical.capacity} seats` : "Not counted — no verified seating capacity"}</dd></div>
      <div><dt>Assignment purpose</dt><dd>{reservation?.reservationType ?? (entertainmentReservation ? "entertainment" : "Unassigned for selected event")}{reservation?.reservationType === "food-table" ? " — 0 guest seats" : ""}</dd></div>
      <div><dt>Assigned event</dt><dd>{displayed ? event.name : "Unassigned for selected event"}</dd></div>
      <div><dt>Reservation interval</dt><dd>{displayed ? datedInterval(displayed.startAt, displayed.endAt) : "Not assigned"}</dd></div>
      <div><dt>Occupied interval</dt><dd>{occupancy ? datedInterval(occupancy.startAt, occupancy.endAt) : "Not assigned"}</dd></div>
      <div><dt>Placement</dt><dd>{!displayed ? "Not assigned" : reservation ? reservation.placementOverride || reservation.source === "manual" ? "Staff-selected" : "Generated" : entertainmentReservation?.manualOverride ? "Staff-selected entertainment" : "Shared entertainment assignment"}{reservation?.lockedByUser ? " · Locked" : ""}</dd></div>
      <div><dt>Timing</dt><dd>{!displayed ? "Not assigned" : reservation ? timingSource === "staff-override" ? reservation.timingSource ? "Staff time override" : "Distinct legacy times preserved as a staff override — review" : reservation.timingSource ? "Follows event time" : "Follows event time by legacy inference — source metadata not yet recorded" : entertainmentReservation?.startTimeSource === "staff-override" ? "Staff entertainment time override" : entertainmentReservation?.startTimeSource === "event-start-default" ? "Entertainment starts with event; purchased duration" : "Explicit or legacy entertainment time"}</dd></div>
      {reservation && entertainmentReservation ? <div><dt>Separate entertainment interval</dt><dd>{datedInterval(entertainmentReservation.startAt, entertainmentReservation.endAt)} — does not release seating</dd></div> : null}
      {reservation?.changeDetails ? <div><dt>Latest change</dt><dd>{reservation.changeDetails.reason} Fields: {reservation.changeDetails.fields.join(", ")}</dd></div> : null}
    </dl>
    <p className={unavailable.length || !area.isReservable ? "floor-plan-warning-copy" : undefined}>{!area.isReservable ? "Unavailable: this is a reference-only permanent map object." : !event.startAt || !event.endAt ? "Availability needs review: the event interval is missing." : unavailable.length ? `Unavailable for this event: ${unavailable.join("; ")}.` : "No other event occupies this object during the required interval and applicable buffers."}</p>
    {assignments.length ? <details><summary>All assignments for this physical object ({assignments.length})</summary><ul>{assignments.map((item) => <li key={item.id}>{plan.events.find((candidate) => candidate.id === item.floorPlanEventId)?.name ?? "Unknown event"} · {item.reservationType} · {datedInterval(item.startAt, item.endAt)}</li>)}</ul></details> : null}
  </section>;
}

class FloorPlanSaveConflict extends Error {}

async function floorPlanRequest(date: string, body?: Record<string, unknown>) {
  const response = await fetch(
    body ? "/api/floor-plans" : `/api/floor-plans?date=${encodeURIComponent(date)}`,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date, ...body }),
        }
      : { cache: "no-store" },
  );
  const result = (await response.json().catch(() => null)) as
    | (FloorPlanDayPayload & { error?: string })
    | null;
  if (!response.ok || !result) {
    if (response.status === 409) throw new FloorPlanSaveConflict(result?.error || "A newer floor plan exists. Your draft has been retained; reload and review before saving.");
    throw new Error(result?.error || "Unable to load the floor plan.");
  }
  return result;
}

export default function FloorPlanDashboard({ initialDate }: { initialDate: string }) {
  const { ready: contextReady, preferredEventId, requestedDate, selectEvent, clearEvent } = useEventContext();
  const [date, setDate] = useState(initialDate);
  const [payload, setPayload] = useState<FloorPlanDayPayload | null>(null);
  const [activeEventId, setActiveEventId] = useState("");
  const [visibleEventId, setVisibleEventId] = useState<string | null>(null);
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [message, setMessage] = useState("Loading saved floor plan…");
  const [generationMode, setGenerationMode] =
    useState<FloorPlanGenerationMode>("fill-missing");
  const [zoom, setZoom] = useState(1);
  const [mapFocused, setMapFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [undoStack, setUndoStack] = useState<FloorPlanDocument[]>([]);
  const [redoStack, setRedoStack] = useState<FloorPlanDocument[]>([]);
  const [entStart, setEntStart] = useState("");
  const [entEnd, setEntEnd] = useState("");
  const [foodTableMode, setFoodTableMode] = useState(false);
  const [entertainmentMode, setEntertainmentMode] = useState(false);
  const mapImageRef = useRef<HTMLImageElement | null>(null);

  const loadDate = useCallback(async (nextDate: string) => {
    setRequestState("loading");
    setMessage("Loading saved floor plan…");
    try {
      const next = await floorPlanRequest(nextDate);
      setPayload(next);
      setVisibleEventId(null);
      setActiveEventId((current) =>
        next.plan.events.some((event) => event.id === current)
          ? current
          : next.plan.events[0]?.id ?? "",
      );
      setSelectedAreaIds([]);
      setSelectedReservationId("");
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSaveConflict(false);
      setRequestState("idle");
      setMessage(
        next.persistence === "database"
          ? `Version ${next.plan.version} loaded from Event Host.`
          : "Local development mode: apply the floor-plan migration for durable storage.",
      );
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Unable to load the floor plan.");
    }
  }, []);

  useEffect(() => {
    void loadDate(date);
  }, [date, loadDate]);

  useEffect(() => {
    if (contextReady && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
  }, [contextReady, requestedDate]);

  useEffect(() => {
    if (!contextReady || !preferredEventId || !payload) return;
    const requested = findOperationalFloorPlanEvent(payload.plan.events, preferredEventId);
    setActiveEventId(requested?.id ?? "");
    setVisibleEventId(requested?.id ?? null);
    if (!requested) setMessage("The requested event identity is unavailable or ambiguous. No party was selected; choose the exact event below.");
  }, [contextReady, preferredEventId, payload]);

  const plan = payload?.plan ?? null;
  const mapView = useMemo(
    () => plan && payload
      ? floorPlanEventView(plan, payload.entertainmentReservations, visibleEventId)
      : null,
    [payload, plan, visibleEventId],
  );
  const mapPlan = mapView?.plan ?? null;
  const visibleEntertainment = useMemo(
    () =>
      mapView
        ? visibleEntertainmentReservations(
            mapView.plan,
            mapView.entertainmentReservations,
            activeEventId,
          )
        : [],
    [activeEventId, mapView],
  );
  const multipleReservationOutlines = useMemo(
    () =>
      mapView
        ? entertainmentMultipleReservationOutlines(
            mapView.plan,
            mapView.entertainmentReservations,
            activeEventId,
          )
        : [],
    [activeEventId, mapView],
  );
  const activeEvent =
    plan?.events.find((event) => event.id === activeEventId) ?? null;
  const selectedArea =
    selectedAreaIds.length === 1 ? getFloorPlanArea(selectedAreaIds[0]) : null;
  const activePlanReservation =
    plan && activeEvent && selectedArea
      ? plan.reservations.find(
          (reservation) => reservation.id === selectedReservationId &&
            reservation.floorPlanEventId === activeEvent.id,
        ) ?? reservationForAreaAndEvent(plan, selectedArea.id, activeEvent.id)
      : null;
  const activeEntertainmentReservation =
    payload && activeEvent && selectedArea
      ? entertainmentForAreaAndEvent(payload, selectedArea, activeEvent)
      : null;

  useEffect(() => {
    setEntStart(
      dateTimeInput(activeEntertainmentReservation?.startAt ?? activeEvent?.startAt ?? null),
    );
    setEntEnd(
      dateTimeInput(activeEntertainmentReservation?.endAt ?? activeEvent?.endAt ?? null),
    );
  }, [activeEntertainmentReservation, activeEvent]);

  useEffect(() => {
    setFoodTableMode(Boolean(selectedArea?.canBeFoodTable && selectedArea.capacity === 0) ||
      activePlanReservation?.reservationType === "food-table");
    setEntertainmentMode(
      Boolean(
        selectedArea?.entertainmentResourceId &&
          selectedArea.type !== "room" &&
          selectedArea.type !== "mini-golf",
      ),
    );
  }, [selectedArea, activePlanReservation?.reservationType, activeEventId]);

  useEffect(() => {
    if (!mapFocused) return;
    function exitMapFocus(event: KeyboardEvent) {
      if (event.key === "Escape") setMapFocused(false);
    }
    window.addEventListener("keydown", exitMapFocus);
    return () => window.removeEventListener("keydown", exitMapFocus);
  }, [mapFocused]);

  function updatePayloadPlan(nextPlan: FloorPlanDocument) {
    if (!payload) return;
    const conflicts = detectFloorPlanConflicts(nextPlan);
    setPayload({
      ...payload,
      plan: nextPlan,
      floorPlanConflicts: conflicts,
      validation: validateFloorPlan(
        nextPlan,
        payload.entertainmentReservations,
        conflicts,
        payload.entertainmentConflicts,
      ),
    });
  }

  function commitPlan(nextPlan: FloorPlanDocument) {
    if (!plan) return;
    setUndoStack((stack) => [...stack.slice(-29), structuredClone(plan)]);
    setRedoStack([]);
    updatePayloadPlan(nextPlan);
    setDirty(true);
    setMessage("Unsaved changes");
  }

  function undo() {
    if (!plan || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, structuredClone(plan)]);
    updatePayloadPlan(previous);
    setDirty(true);
  }

  function redo() {
    if (!plan || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, structuredClone(plan)]);
    updatePayloadPlan(next);
    setDirty(true);
  }

  function changeDate(nextDate: string) {
    if (dirty && !window.confirm("Discard unsaved floor-plan changes and open another date?")) {
      return;
    }
    clearEvent();
    setDate(nextDate);
  }

  function selectEditingEvent(eventId: string) {
    setActiveEventId(eventId);
    const selected = plan?.events.find((event) => event.id === eventId);
    if (selected) selectEvent({ eventId: operationalFloorPlanEventId(selected), eventName: selected.name, date, area: selected.contractedAreaIds.map((id) => getFloorPlanArea(id)?.name ?? id).join(", "), guestCount: selected.guestCount });
    if (visibleEventId) setVisibleEventId(eventId);
    setSelectedAreaIds([]);
    setSelectedReservationId("");
  }

  function selectVisibleEvent(eventId: string | null) {
    setVisibleEventId(eventId);
    if (eventId) selectEditingEvent(eventId);
    else clearEvent();
    setSelectedAreaIds([]);
    setSelectedReservationId("");
  }

  async function runAction(
    action: "refresh" | "generate" | "save" | "validate" | "approve",
    generation?: { mode: FloorPlanGenerationMode; selectedEventId: string },
  ) {
    if (!plan && action !== "refresh") return;
    if (saveConflict) {
      setMessage("Your draft is retained. Reload and review the newer saved version before making another save or sync.");
      return;
    }
    if (dirty && action !== "save" && !window.confirm("Discard this unsaved draft before updating the saved plan?")) return;
    if (
      action === "generate" &&
      (generation?.mode ?? generationMode) === "reset-event" &&
      !window.confirm("Reset the entire date plan? This removes generated and manual floor-plan assignments before rebuilding suggestions.")
    ) {
      return;
    }
    const warningCount = payload?.validation.filter(
      (entry) => entry.status === "Warning",
    ).length ?? 0;
    if (
      action === "approve" &&
      warningCount > 0 &&
      !window.confirm(
        `This plan has ${warningCount} non-blocking warning${warningCount === 1 ? "" : "s"}. Approve and record your acknowledgement?`,
      )
    ) {
      return;
    }
    setRequestState("saving");
    setMessage(
      action === "refresh"
        ? "Synchronizing live Tripleseat fields…"
        : action === "generate"
          ? "Generating deterministic suggestions…"
          : action === "approve"
            ? "Checking approval requirements…"
            : `${action[0].toUpperCase()}${action.slice(1)} in progress…`,
    );
    try {
      const next = await floorPlanRequest(date, {
        ...(action === "generate" && plan
          ? floorPlanGenerationRequest(plan, generation?.mode ?? generationMode, generation?.selectedEventId)
          : { action, ...(plan ? { expectedVersion: plan.version } : {}) }),
        ...(action === "save" ? { plan } : {}),
        ...(action === "approve" ? { acknowledgeWarnings: warningCount > 0 } : {}),
      });
      setPayload(next);
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setRequestState("idle");
      if (
        (action === "save" || action === "approve") &&
        typeof BroadcastChannel !== "undefined"
      ) {
        const channel = new BroadcastChannel("event-host-floor-plans");
        channel.postMessage({ action, date, version: next.plan.version });
        channel.close();
      }
      setMessage(
        action === "approve"
          ? "Floor plan approved and published to the main Floor Plans page."
          : action === "save"
            ? `Floor plan saved as version ${next.plan.version} and published to the main Floor Plans page. ${next.validation.some((entry) => entry.status === "Failed" || entry.status === "Warning") ? "Unresolved seating or validation alerts remain; saving is not approval." : "Review validation before approval."}`
          : action === "refresh"
            ? "Live Tripleseat sync complete and saved. Review highlighted changes before approval."
            : action === "generate" && generation
              ? `${generation.mode === "fill-missing" ? "Remaining seating filled" : "Unlocked generated seating reworked"} for ${activeEvent?.name ?? "the selected event"} and saved as version ${next.plan.version}. Review additions and any remaining shortages below.`
              : `Floor plan ${action === "generate" ? "generated for the entire date" : `${action}d`} and saved as version ${next.plan.version}.`,
      );
    } catch (error) {
      if (error instanceof FloorPlanSaveConflict) setSaveConflict(true);
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Floor-plan action failed.");
    }
  }

  async function refreshEntertainment(currentPlan: FloorPlanDocument = plan!) {
    if (!payload || !currentPlan) return;
    const response = await fetch(
      `/api/entertainment/schedule?date=${encodeURIComponent(date)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Unable to reload the shared Entertainment Schedule.");
    const day = (await response.json()) as EntertainmentDayPayload;
    const conflicts = detectFloorPlanConflicts(currentPlan);
    setPayload({
      ...payload,
      plan: currentPlan,
      entertainmentReservations: day.reservations,
      entertainmentConflicts: day.conflicts,
      floorPlanConflicts: conflicts,
      validation: validateFloorPlan(currentPlan, day.reservations, conflicts, day.conflicts),
    });
  }

  async function saveEntertainmentAssignment(
    area: FloorPlanArea,
    event: FloorPlanEvent,
  ) {
    if (!area.entertainmentResourceId) return;
    const startAt = isoFromDateTimeInput(entStart || dateTimeInput(event.startAt));
    const endAt = isoFromDateTimeInput(entEnd || dateTimeInput(event.endAt));
    const existing = entertainmentForAreaAndEvent(payload!, area, event);
    const response = await fetch(
      existing
        ? `/api/entertainment/reservations/${encodeURIComponent(existing.id)}`
        : "/api/entertainment/reservations",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operatingDate: date,
          eventId: event.tripleseatEventId,
          eventName: event.name,
          resourceId: area.entertainmentResourceId,
          startAt,
          endAt,
          eventColor: event.color,
          notes: existing?.notes ?? "Assigned from Event Host Floor Plans",
          reason: existing ? "Updated from Event Host Floor Plans" : "Assigned from Event Host Floor Plans",
          needsReview: false,
        }),
      },
    );
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || "Unable to save the shared entertainment reservation.");
  }

  async function assignSelected() {
    if (!payload || !plan || !activeEvent || selectedAreaIds.length === 0) return;
    setRequestState("saving");
    try {
      let nextPlan = plan;
      for (const areaId of selectedAreaIds) {
        const area = getFloorPlanArea(areaId);
        if (!area || !area.isReservable) continue;
        if (
          area.entertainmentResourceId &&
          area.type !== "mini-golf" &&
          (area.type !== "room" || entertainmentMode)
        ) {
          await saveEntertainmentAssignment(area, activeEvent);
          if (area.type !== "room") continue;
        }
        const reservationType = floorPlanAreaAssignmentType(area, foodTableMode);
        nextPlan = assignLocalFloorPlanArea(nextPlan, activeEvent, area, reservationType);
      }
      if (nextPlan !== plan) commitPlan(nextPlan);
      await refreshEntertainment(nextPlan);
      setRequestState("idle");
      setMessage(nextPlan !== plan ? "Assignments updated; save the plan to persist seating changes." : "Shared entertainment assignments saved.");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Unable to assign the selected objects.");
    }
  }

  async function removeSelected() {
    if (!payload || !plan || !activeEvent || selectedAreaIds.length === 0) return;
    setRequestState("saving");
    try {
      const removeIds = new Set(
        localHighlightIdsForDeletion(
          plan,
          activeEvent.id,
          selectedAreaIds,
          selectedReservationId,
        ),
      );
      if (!selectedReservationId) {
        for (const areaId of selectedAreaIds) {
          const area = getFloorPlanArea(areaId);
          if (!area) continue;
          const shared = entertainmentForAreaAndEvent(payload, area, activeEvent);
          if (shared) {
            const response = await fetch(
              `/api/entertainment/reservations/${encodeURIComponent(shared.id)}`,
              {
                method: "DELETE",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ reason: "Removed from Event Host Floor Plans" }),
              },
            );
            if (!response.ok) {
              const result = (await response.json().catch(() => null)) as { error?: string } | null;
              throw new Error(result?.error || "Unable to remove the shared entertainment reservation.");
            }
          }
        }
      }
      const nextPlan = removeIds.size
        ? {
          ...plan,
          reservations: plan.reservations.filter((reservation) => !removeIds.has(reservation.id)),
        }
        : plan;
      if (removeIds.size) commitPlan(nextPlan);
      await refreshEntertainment(nextPlan);
      setRequestState("idle");
      setSelectedReservationId("");
      setMessage(removeIds.size ? "Highlights deleted; save the plan to persist the change." : "Shared entertainment highlights deleted.");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Unable to remove the selected assignments.");
    }
  }

  function updateActiveEventColor(color: string) {
    if (!plan || !activeEvent) return;
    const conflict = plan.events.find(
      (event) =>
        event.id !== activeEvent.id &&
        !floorPlanEventColorsAreDistinct(color, event.color),
    );
    if (conflict) {
      setRequestState("error");
      setMessage(`Choose a different color. ${conflict.name} already uses a similar color.`);
      return;
    }
    setRequestState("idle");
    setMessage(`Updated ${activeEvent.name}'s event name and highlights. Save to publish the color.`);
    commitPlan({
      ...plan,
      events: plan.events.map((event) =>
        event.id === activeEvent.id ? { ...event, color: color.toUpperCase() } : event,
      ),
    });
  }

  function updateReservation(patch: Partial<FloorPlanReservation>) {
    if (!plan || !activePlanReservation) return;
    commitPlan({
      ...plan,
      reservations: plan.reservations.map((reservation) =>
        reservation.id === activePlanReservation.id
          ? editFloorPlanReservation(reservation, patch)
          : reservation,
      ),
    });
  }

  function updateSeatingTime(field: "startAt" | "endAt", value: string) {
    try {
      updateReservation({ [field]: isoFromDateTimeInput(value) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Choose a valid seating time.");
    }
  }

  function addCustomHighlight() {
    if (!plan || !activeEvent || !selectedArea) return;
    const note: FloorPlanReservation = {
      id: `manual:${activeEvent.id}:custom:${crypto.randomUUID()}`,
      floorPlanEventId: activeEvent.id,
      areaId: selectedArea.id,
      reservationType: "custom",
      startAt: activeEvent.startAt,
      endAt: activeEvent.endAt,
      label: "New highlight",
      source: "manual",
      lockedByUser: true,
      customGeometry: {
        x: selectedArea.x,
        y: selectedArea.y,
        width: Math.max(140, selectedArea.width),
        height: Math.max(48, selectedArea.height),
      },
    };
    commitPlan({ ...plan, reservations: [...plan.reservations, note] });
    setSelectedReservationId(note.id);
  }

  async function exportPng() {
    const plan = mapView?.plan;
    if (!plan || !mapView || dirty || !mapImageRef.current || plan.status !== "Approved") return;
    const exportedVisibleEntertainment = visibleEntertainmentReservations(
      plan,
      mapView.entertainmentReservations,
    );
    const exportedMultipleReservationOutlines =
      entertainmentMultipleReservationOutlines(
        plan,
        mapView.entertainmentReservations,
      );
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.drawImage(mapImageRef.current, 0, 0, 1920, 1080);
    const exportModel = buildFloorPlanExportModel(
      plan,
      mapView.entertainmentReservations,
    );
    for (const event of plan.events.filter((candidate) => candidate.fullBuyout)) {
      context.globalAlpha = 0.14;
      context.fillStyle = event.color;
      context.fillRect(0, 0, 1920, 1080);
      context.globalAlpha = 1;
      context.strokeStyle = event.color;
      context.lineWidth = 8;
      context.strokeRect(4, 4, 1912, 1072);
    }
    context.fillStyle = "#000000";
    context.font = "700 30px Arial";
    context.fillText(formatFullDate(date), 34, 55);
    exportModel.events.forEach((event, index) => {
      context.fillStyle = event.color;
      context.font = "700 21px Arial";
      context.fillText(`${event.name} (${event.guestCount}) | ${eventTime(event)}`, 34, 96 + index * 34);
    });
    const drawOverlay = (area: FloorPlanArea, event: FloorPlanEvent, label: string) => {
      const fillColor = event.color;
      context.globalAlpha = 0.5;
      context.fillStyle = fillColor;
      context.fillRect(area.x, area.y, area.width, area.height);
      context.globalAlpha = 1;
      context.strokeStyle = event.color;
      context.lineWidth = 3;
      context.strokeRect(area.x, area.y, area.width, area.height);
      if (label) {
        context.fillStyle = readableOverlayText(fillColor);
        context.font = "700 15px Arial";
        context.fillText(label, area.x + 4, area.y + Math.min(area.height - 4, 18));
      }
    };
    const exportedLocalReservations = plan.reservations.filter((reservation) =>
      reservation.reservationType === "custom" ||
        primaryLocalFloorPlanReservation(plan, reservation.areaId)?.id === reservation.id,
    );
    for (const reservation of exportedLocalReservations) {
      const area = getFloorPlanArea(getPhysicalFloorPlanAreaId(reservation.areaId));
      const event = plan.events.find((candidate) => candidate.id === reservation.floorPlanEventId);
      if (!area || !event) continue;
      if (reservation.reservationType === "custom") {
        const geometry = floorPlanCustomGeometry(reservation)!;
        drawOverlay({ ...area, ...geometry }, event, reservation.label);
      } else {
        drawOverlay(
          area,
          event,
          floorPlanOverlayLabel(area, reservation, null),
        );
      }
    }
    const exportedEntertainmentGroups = new Set<string>();
    const exportedEntertainment = [...exportedVisibleEntertainment].sort(
      (left, right) =>
        AREAS.findIndex(
          (area) => area.entertainmentResourceId === left.resourceId,
        ) -
        AREAS.findIndex(
          (area) => area.entertainmentResourceId === right.resourceId,
        ),
    );
    for (const reservation of exportedEntertainment) {
      if (!reservation.active) continue;
      const area = getAreaForEntertainmentResource(reservation.resourceId);
      const event = eventForFloorPlanEntertainment(plan, reservation);
      if (!area || !event) continue;
      drawOverlay(area, event, area.shortLabel);
      const groupKey = [
        reservation.tripleseatEventId,
        reservation.localEventId,
        reservation.resourceCategory,
        reservation.startAt,
        reservation.endAt,
      ].join(":");
      if (
        area.type === "mini-golf" ||
        exportedEntertainmentGroups.has(groupKey)
      ) {
        continue;
      }
      exportedEntertainmentGroups.add(groupKey);
      const label = entertainmentTimingLabel(reservation, event, area);
      context.font = "700 15px Arial";
      const width = Math.ceil(context.measureText(label).width) + 22;
      const below = area.type === "pool" || area.type === "shuffleboard";
      const x = below ? area.x : area.x + area.width + 8;
      const y = below
        ? area.y + area.height + 8
        : area.y + area.height / 2 - 14;
      context.globalAlpha = 0.38;
      context.fillStyle = event.color;
      context.fillRect(x, y, width, 28);
      context.globalAlpha = 1;
      context.strokeStyle = event.color;
      context.strokeRect(x, y, width, 28);
      context.fillStyle = "#000000";
      context.fillText(label, x + 11, y + 19);
    }
    for (const outline of exportedMultipleReservationOutlines) {
      context.strokeStyle = outline.color;
      context.lineWidth = 7;
      context.strokeRect(outline.x, outline.y, outline.width, outline.height);
      if (outline.timeLabel) {
        context.font = "700 15px Arial";
        const width = Math.ceil(context.measureText(outline.timeLabel).width) + 22;
        const x = outline.x + outline.width + 8;
        const y = outline.y + outline.height / 2 + 16;
        context.globalAlpha = 0.38;
        context.fillStyle = outline.fillColor;
        context.fillRect(x, y, width, 28);
        context.globalAlpha = 1;
        context.strokeStyle = outline.color;
        context.strokeRect(x, y, width, 28);
        context.fillStyle = "#000000";
        context.fillText(outline.timeLabel, x + 11, y + 19);
      }
    }
    for (const outline of floorPlanLocalReservationOutlines(plan, "", mapView.entertainmentReservations)) {
      context.strokeStyle = outline.color;
      context.lineWidth = 3;
      context.strokeRect(outline.x, outline.y, outline.width, outline.height);
    }
    const link = document.createElement("a");
    link.download = `${date}-event-host-floor-plan${mapView.selectedEventId ? "-selected-event" : ""}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  const activeEventValidation = useMemo(
    () => payload?.validation.filter((entry) => entry.eventId === activeEventId) ?? [],
    [activeEventId, payload?.validation],
  );
  return (
    <PortalShell
      actions={plan ? <PortalStatusBadge tone={statusTone(plan.status)}>{plan.status}</PortalStatusBadge> : null}
      allowFullscreen
      mainClassName="floor-plan-editor-page"
      sectionSubtitle="Live Tripleseat planning"
      sectionTitle="Admin Floor Plans"
    >
      <EventSelectionBridge event={activeEvent && (!preferredEventId || plan && findOperationalFloorPlanEvent(plan.events, preferredEventId)?.id === activeEvent.id) ? { eventId: operationalFloorPlanEventId(activeEvent), eventName: activeEvent.name, date, area: activeEvent.contractedAreaIds.map((id) => getFloorPlanArea(id)?.name ?? id).join(", "), guestCount: activeEvent.guestCount } : null} />
      <fieldset disabled={requestState === "saving"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <section className="floor-plan-toolbar" aria-label="Floor plan controls">
        <div className="floor-plan-date-controls">
          <button onClick={() => changeDate(addCalendarDays(date, -1))} type="button" aria-label="Previous day">←</button>
          <input aria-label="Floor plan date" onChange={(event) => changeDate(event.target.value)} type="date" value={date} />
          <button onClick={() => changeDate(addCalendarDays(date, 1))} type="button" aria-label="Next day">→</button>
          <button onClick={() => changeDate(todayInEntertainmentTimeZone())} type="button">Today</button>
        </div>
        <div className="floor-plan-primary-actions">
          <button disabled={requestState === "saving"} onClick={() => void runAction("refresh")} type="button">Sync Live from Tripleseat</button>
          {requestState === "error" && message.includes("Reconnect Tripleseat") ? <a className="button-link" href="/api/kitchen/oauth/start">Reconnect Tripleseat</a> : null}
          <select aria-label="Entire date regeneration mode" onChange={(event) => setGenerationMode(event.target.value as FloorPlanGenerationMode)} value={generationMode}>
            <option value="fill-missing">Entire date: keep edits; fill missing</option>
            <option value="replace-generated">Entire date: rework generated only</option>
            <option value="reset-event">Reset the entire date plan</option>
          </select>
          <button disabled={!plan || saveConflict || requestState === "saving"} onClick={() => void runAction("generate")} type="button">Generate entire date</button>
          <button disabled={!dirty || saveConflict || requestState === "saving"} onClick={() => void runAction("save")} type="button">Save</button>
          <button disabled={!plan?.events.length || dirty || requestState === "saving"} onClick={() => void runAction("validate")} type="button">Validate</button>
          <button disabled={!plan?.events.length || dirty || requestState === "saving"} onClick={() => void runAction("approve")} type="button">Approve</button>
          {plan?.events.length && !dirty ? <a className="button-link" href="/floor-plans">View saved plan</a> : null}
          {plan?.status === "Approved" ? <><button disabled={dirty} onClick={() => void exportPng()} type="button">{mapView?.selectedEventId ? "Export selected event PNG" : "Export PNG"}</button><button disabled={dirty} onClick={() => window.print()} type="button">{mapView?.selectedEventId ? "Print selected event / PDF" : "Print / PDF"}</button></> : null}
        </div>
        <div className={`floor-plan-save-state is-${requestState}`} role="status">
          <strong>{dirty ? "Unsaved" : requestState === "saving" ? "Working" : requestState === "error" ? "Needs attention" : "Saved"}</strong>
          <span>{message}</span>
          {saveConflict ? <button type="button" onClick={() => {
            if (window.confirm("Your unsaved draft will be discarded. Load the latest saved plan to review it?")) void loadDate(date);
          }}>Reload latest and review</button> : null}
        </div>
      </section>

      {requestState === "loading" && !plan ? (
        <PortalState description="Loading the selected date from Event Host." icon="…" title="Loading floor plan" />
      ) : plan && payload && mapPlan && mapView ? (
        <div className="floor-plan-editor-grid">
          <aside className="floor-plan-events-panel" aria-label="Events on selected date">
            <div className="floor-plan-panel-heading">
              <span className="portal-module-kicker">{formatFullDate(date)}</span>
              <h2>Events</h2>
              <p>{plan.lastTripleseatSyncAt ? `Last synced ${new Date(plan.lastTripleseatSyncAt).toLocaleString()}` : "Generate after reviewing current Tripleseat fields."}</p>
            </div>
            <div className="floor-plan-event-list">
              {plan.events.map((event) => {
                const issues = payload.validation.filter(
                  (entry) => event.id === entry.eventId && (entry.status === "Warning" || entry.status === "Failed"),
                );
                return (
                  <button
                    className={`floor-plan-event-card${event.id === activeEventId ? " is-active" : ""}`}
                    key={event.id}
                    aria-pressed={event.id === activeEventId}
                    onClick={() => selectEditingEvent(event.id)}
                    style={{ "--event-color": event.color } as React.CSSProperties}
                    type="button"
                  >
                    <span className="floor-plan-event-card-title"><strong style={{ color: event.color }}>{event.name}</strong><span className={`floor-plan-source-status ${eventStatusClass(event)}`}>{event.fullBuyout ? "Full buyout" : event.status}</span></span>
                    <span>{event.guestCount} guests · {eventTime(event)}</span>
                    <span>{event.source.rooms.join(", ") || "Contracted section missing"}</span>
                    <span>{event.source.entertainment.map((item) => `${item.name} ${item.quantity}`).join(" · ") || "No entertainment listed"}</span>
                    <span className="floor-plan-event-card-footer"><i style={{ background: event.color }} />{plan.status}<b>{issues.length} alerts</b></span>
                  </button>
                );
              })}
              {!plan.events.length ? <p className="floor-plan-empty-copy">No live Tripleseat events have been loaded for this date. Refresh Tripleseat or generate the plan to retrieve the selected date.</p> : null}
            </div>
          </aside>

          <section className={`floor-plan-map-panel${mapFocused ? " is-focused" : ""}`} aria-label="Interactive floor plan">
            <div className="floor-plan-map-tools">
              <div><button disabled={undoStack.length === 0} onClick={undo} type="button">Undo</button><button disabled={redoStack.length === 0} onClick={redo} type="button">Redo</button></div>
              <div><button onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} type="button">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} type="button">+</button><button onClick={() => setZoom(1)} type="button">Fit</button><button onClick={() => setMapFocused((current) => !current)} type="button">{mapFocused ? "Exit map view" : "Focus map"}</button></div>
            </div>
            <div className="floor-plan-map-scroll">
              <div className="floor-plan-map-canvas" style={{ width: `${zoom * 100}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="On Par Entertainment floor map" draggable={false} ref={mapImageRef} src="/floor-plans/blank-floor-map.png" />
                {mapPlan.events.filter((event) => event.fullBuyout).map((event) => (
                  <span
                    aria-label={`Full facility buyout: ${event.name}`}
                    className="floor-plan-full-buyout-overlay"
                    key={`full-buyout-${event.id}`}
                    style={{
                      "--event-color": event.color,
                      backgroundColor: `${event.color}24`,
                      borderColor: event.color,
                    } as React.CSSProperties}
                  />
                ))}
                <FloorPlanEventLegend
                  onSelectEvent={selectVisibleEvent}
                  plan={plan}
                  selectedEventId={mapView.selectedEventId}
                />
                <div className="floor-plan-area-layer">
                  <FloorPlanLocalOutlines plan={mapPlan} preferredEventId={activeEventId} entertainmentReservations={mapView.entertainmentReservations} />
                  {multipleReservationOutlines.map((outline) => (
                    <span
                      aria-label={`${outline.resourceNames.join(", ")} also reserved by ${outline.eventName}${outline.timeLabel ? `, ${outline.timeLabel}` : ""}`}
                      className="floor-plan-entertainment-multiple-outline"
                      key={outline.id}
                      role="img"
                      style={{
                        left: `${(outline.x / 1920) * 100}%`,
                        top: `${(outline.y / 1080) * 100}%`,
                        width: `${(outline.width / 1920) * 100}%`,
                        height: `${(outline.height / 1080) * 100}%`,
                        "--event-color": outline.color,
                      } as React.CSSProperties}
                    >
                      {outline.timeLabel ? <small className="floor-plan-entertainment-outline-time">{outline.timeLabel}</small> : null}
                    </span>
                  ))}
                  {DISPLAY_AREAS.filter((area) => area.id !== "facility" || mapPlan.reservations.some((reservation) => reservation.areaId === "facility")).map((area) => {
                    const local = primaryLocalFloorPlanReservation(mapPlan, area.id, activeEventId);
                    const shared = area.entertainmentResourceId
                      ? visibleEntertainment.find((reservation) => reservation.resourceId === area.entertainmentResourceId) ?? null
                      : null;
                    const assignedEvent = displayEventForFloorPlanArea(
                      mapPlan,
                      local,
                      shared,
                    );
                    const label = floorPlanOverlayLabel(area, local, shared);
                    const showTimeLabel = Boolean(
                      shared &&
                      assignedEvent &&
                      area.type !== "mini-golf" &&
                      isEntertainmentTimeAnchor(
                        visibleEntertainment,
                        area,
                        shared,
                      ),
                    );
                    const conflict = payload.floorPlanConflicts.some((item) => getPhysicalFloorPlanAreaId(item.areaId) === area.id && (!mapView.selectedEventId || item.eventIds.includes(mapView.selectedEventId))) || (shared ? payload.entertainmentConflicts.some((item) => item.reservationIds.includes(shared.id)) : false);
                    return (
                      <button
                        aria-label={`${area.name}${assignedEvent ? ` assigned to ${assignedEvent.name}` : ", unassigned"}`}
                        aria-pressed={selectedAreaIds.includes(area.id)}
                        className={`floor-plan-area${assignedEvent ? " is-assigned" : ""}${selectedAreaIds.includes(area.id) ? " is-selected" : ""}${conflict ? " is-conflict" : ""}${showTimeLabel ? " has-time-label" : ""}${area.type === "pool" || area.type === "shuffleboard" ? " has-time-below" : ""}`}
                        key={area.id}
                        onClick={(event) => {
                          setSelectedReservationId("");
                          setSelectedAreaIds((current) =>
                            event.shiftKey || event.metaKey || event.ctrlKey
                              ? current.includes(area.id)
                                ? current.filter((id) => id !== area.id)
                                : [...current, area.id]
                              : [area.id],
                          );
                        }}
                        style={{
                          left: `${(area.x / 1920) * 100}%`, top: `${(area.y / 1080) * 100}%`, width: `${(area.width / 1920) * 100}%`, height: `${(area.height / 1080) * 100}%`,
                          ...(assignedEvent ? { "--event-color": assignedEvent.color, backgroundColor: `${assignedEvent.color}80`, borderColor: assignedEvent.color, color: readableOverlayText(assignedEvent.color) } : {}),
                        }}
                        title={`${area.name}${shared ? ` · ${formatClock(shared.startAt)}–${formatClock(shared.endAt)}` : ""}`}
                        type="button"
                      >
                        {label ? <span>{label}</span> : null}
                        {showTimeLabel && shared && assignedEvent ? <small className="floor-plan-time-label">{entertainmentTimingLabel(shared, assignedEvent, area)}</small> : null}
                        {conflict ? <b aria-label="Conflict">!</b> : null}
                      </button>
                    );
                  })}
                  {mapPlan.reservations.filter((reservation) => reservation.reservationType === "custom").map((reservation) => {
                    const area = getFloorPlanArea(reservation.areaId);
                    const event = plan.events.find((candidate) => candidate.id === reservation.floorPlanEventId);
                    if (!area || !event) return null;
                    const geometry = floorPlanCustomGeometry(reservation)!;
                    return <button aria-label={`Custom note: ${reservation.label}`} className={`floor-plan-custom-note${selectedReservationId === reservation.id ? " is-selected" : ""}`} key={reservation.id} onClick={() => { setActiveEventId(event.id); setSelectedAreaIds([area.id]); setSelectedReservationId(reservation.id); }} style={{ left: `${(geometry.x / 1920) * 100}%`, top: `${(geometry.y / 1080) * 100}%`, width: `${(geometry.width / 1920) * 100}%`, height: `${(geometry.height / 1080) * 100}%`, backgroundColor: `${event.color}80`, borderColor: event.color, color: readableOverlayText(event.color) }} type="button">{reservation.label}</button>;
                  })}
                </div>
              </div>
            </div>
            {mapView.selectedEventId && (payload.floorPlanConflicts.length || payload.entertainmentConflicts.length) ? (
              <p className="floor-plan-warning-copy" role="status">
                Full-day conflicts: {payload.floorPlanConflicts.length + payload.entertainmentConflicts.length}. Other parties are hidden from this view, but all reservations are still checked before saving and approval.
              </p>
            ) : null}
            <p className="floor-plan-map-help">Click an event name under the date to show only that party; Show all events restores the full day. Editing: <strong>{activeEvent?.name ?? "Select an event"}</strong>. Select map objects, then use Add highlight or Delete highlight in the inspector. Filtering never changes saved assignments or conflict checks.</p>
          </section>

          <aside className="floor-plan-inspector" aria-label="Floor plan inspector">
            <div className="floor-plan-panel-heading"><span className="portal-module-kicker">Inspector</span><h2>{selectedArea ? selectedArea.name : activeEvent?.name ?? "Select an event"}</h2></div>
            {activeEvent ? (
              <label className="floor-plan-event-color-editor">
                <span>Event name &amp; highlight color</span>
                <span className="floor-plan-event-color-control">
                  <input
                    aria-label={`Event name and highlight color for ${activeEvent.name}`}
                    onChange={(event) => updateActiveEventColor(event.target.value)}
                    type="color"
                    value={activeEvent.color}
                  />
                  <output>{activeEvent.color}</output>
                </span>
                <small>Updates this party&apos;s event name and every highlight. Each party must use a different color.</small>
              </label>
            ) : null}
            {activeEvent ? <FloorPlanSeatingSummary plan={plan} event={activeEvent} dirty={dirty} saveConflict={saveConflict} disabled={requestState === "saving"} onGenerate={(mode) => void runAction("generate", { mode, selectedEventId: activeEvent.id })} /> : null}
            {activeEvent && payload.sourceChanges?.some((change) => change.eventId === activeEvent.id) ? <section className="floor-plan-source-changes" aria-label="Contract changes needing attention"><h3>Contract changes</h3><ul>{payload.sourceChanges.filter((change) => change.eventId === activeEvent.id).map((change) => <li key={`${change.eventId}:${change.field}`}><strong>{change.field}</strong>: {change.message}</li>)}</ul><p>Review the saved seating after contract changes. Staff-selected tables and explicit timing overrides are not silently replaced.</p></section> : null}
            {selectedArea && activeEvent ? (
              <div className="floor-plan-inspector-body">
                <FloorPlanTableDetails plan={plan} event={activeEvent} area={selectedArea} reservation={activePlanReservation} entertainmentReservation={activeEntertainmentReservation} allEntertainmentReservations={payload.entertainmentReservations} />
                {selectedArea.entertainmentResourceId && selectedArea.type !== "mini-golf" ? <><label className="floor-plan-toggle-field"><input checked={entertainmentMode} disabled={selectedArea.type !== "room"} onChange={(event) => setEntertainmentMode(event.target.checked)} type="checkbox" />{selectedArea.type === "room" ? "Also reserve on Entertainment Schedule" : "Shared Entertainment Schedule reservation"}</label><div className="floor-plan-field-group"><label>Reservation start<input onChange={(event) => setEntStart(event.target.value)} type="datetime-local" value={entStart} /></label><label>Reservation end<input onChange={(event) => setEntEnd(event.target.value)} type="datetime-local" value={entEnd} /></label></div></> : null}
                {selectedArea.type === "mini-golf" ? <p className="floor-plan-warning-copy">Mini golf is open play and is not reserved on the Entertainment Schedule.</p> : null}
                {selectedArea.canBeFoodTable ? <label className="floor-plan-toggle-field"><input checked={foodTableMode} disabled={selectedArea.capacity === 0} onChange={(event) => setFoodTableMode(event.target.checked)} type="checkbox" />{selectedArea.capacity === 0 ? "Food-only table — always marked F" : "Mark as food table and label F"}</label> : null}
                {activePlanReservation ? <div className="floor-plan-field-group"><label>Highlight label<input maxLength={80} onChange={(event) => updateReservation({ label: event.target.value })} value={activePlanReservation.label} /></label></div> : null}
                {activePlanReservation && activePlanReservation.reservationType !== "custom" ? <section aria-label="Seating placement and timing">
                  <label className="floor-plan-toggle-field"><input checked={activePlanReservation.lockedByUser} onChange={(event) => updateReservation({ lockedByUser: event.target.checked })} type="checkbox" />Lock table placement</label>
                  <label className="floor-plan-toggle-field"><input checked={reservationTimingSource(activePlanReservation, activeEvent) === "event-default"} onChange={(event) => updateReservation(event.target.checked ? { timingSource: "event-default", startAt: activeEvent.startAt, endAt: activeEvent.endAt } : { timingSource: "staff-override" })} type="checkbox" />Follow event time</label>
                  <small>Placement and timing are separate. Locking tables does not freeze their seating times. Unchecking Follow event time records an explicit staff timing override.</small>
                  <div className="floor-plan-field-group"><label>Seating reservation start<input disabled={reservationTimingSource(activePlanReservation, activeEvent) !== "staff-override"} onChange={(event) => updateSeatingTime("startAt", event.target.value)} type="datetime-local" value={dateTimeInput(activePlanReservation.startAt)} /></label><label>Seating reservation end<input disabled={reservationTimingSource(activePlanReservation, activeEvent) !== "staff-override"} onChange={(event) => updateSeatingTime("endAt", event.target.value)} type="datetime-local" value={dateTimeInput(activePlanReservation.endAt)} /></label></div>
                </section> : null}
                {!selectedArea.isReservable ? <p className="floor-plan-warning-copy">This permanent map object is reference-only and cannot be reserved.</p> : null}
                <div className="floor-plan-inspector-actions"><button disabled={!selectedArea.isReservable} onClick={() => void assignSelected()} type="button">{activePlanReservation ? "Update" : "Add"} highlight for {activeEvent.name}</button><button className="is-danger" disabled={!activePlanReservation && !activeEntertainmentReservation} onClick={() => void removeSelected()} type="button">Delete highlight</button><button onClick={addCustomHighlight} type="button">Add custom highlight here</button></div>
                {activePlanReservation?.reservationType === "custom" && activePlanReservation.customGeometry ? <div className="floor-plan-geometry-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key}<input min={0} onChange={(event) => updateReservation({ customGeometry: { ...activePlanReservation.customGeometry!, [key]: Number(event.target.value) } })} type="number" value={activePlanReservation.customGeometry![key]} /></label>)}</div> : null}
                <div className={`floor-plan-conflict-state${payload.floorPlanConflicts.some((item) => getPhysicalFloorPlanAreaId(item.areaId) === getPhysicalFloorPlanAreaId(selectedArea.id)) ? " is-conflict" : ""}`}>{payload.floorPlanConflicts.some((item) => getPhysicalFloorPlanAreaId(item.areaId) === getPhysicalFloorPlanAreaId(selectedArea.id)) ? "Blocking overlap: resolve this assignment before approval." : "No floor-plan overlap detected for this object."}</div>
              </div>
            ) : activeEvent ? (
              <div className="floor-plan-inspector-body">
                <section><h3>Tripleseat fields used</h3><p><strong>Contracted:</strong> {activeEvent.source.rooms.join(", ") || "Missing"}</p><p><strong>Food service:</strong> {activeEvent.source.food?.join(" · ") || "None listed"}</p><p><strong>Entertainment:</strong> {activeEvent.source.entertainment.map((item) => /mini\s+golf/i.test(item.name) ? `${item.name} — ${item.quantity}` : `${item.name} — ${item.quantity} — ${item.time}${item.duration ? ` — ${normalizeEntertainmentDurationHours(item.duration)}` : ""}`).join(" · ") || "None listed"}</p><p><strong>Setup and placement notes:</strong> {activeEvent.source.operationalNotes?.map((note) => note.text).join(" · ") || "None listed"}</p>{activeEvent.source.reviewReasons.length ? <p className="floor-plan-warning-copy">{activeEvent.source.reviewReasons.join(" ")}</p> : null}</section>
                <section><h3>Verification checklist</h3><div className="floor-plan-validation-list">{activeEventValidation.map((entry) => <div className={`is-${entry.status.toLowerCase().replace(" ", "-")}`} key={`${entry.code}:${entry.eventId}`}><span>{entry.status}</span><p><strong>{entry.label}</strong>{entry.message}</p></div>)}</div></section>
              </div>
            ) : <p className="floor-plan-empty-copy">Select an event to review BEO details and validation.</p>}
            {payload.revisions.length ? <details className="floor-plan-history"><summary>Revision history ({payload.revisions.length})</summary>{payload.revisions.slice(0, 12).map((revision) => <div key={revision.id}><strong>Version {revision.version}</strong><span>{new Date(revision.changedAt).toLocaleString()}</span><p>{revision.description}</p></div>)}</details> : null}
          </aside>
        </div>
      ) : (
        <PortalState description={message} icon="!" title="Floor plan unavailable" />
      )}
      </fieldset>
    </PortalShell>
  );
}
