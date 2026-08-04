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
import {
  AREAS,
  getAreaForEntertainmentResource,
  getFloorPlanArea,
} from "@/lib/floor-plans/configuration/areas";
import { readableOverlayText } from "@/lib/floor-plans/configuration/colors";
import { detectFloorPlanConflicts } from "@/lib/floor-plans/conflicts";
import { buildFloorPlanExportModel } from "@/lib/floor-plans/export";
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
  return event.startAt && event.endAt
    ? `${formatClock(event.startAt)} – ${formatClock(event.endAt)}`
    : "Time needs review";
}

function eventForEntertainment(
  plan: FloorPlanDocument,
  reservation: EntertainmentReservation | null,
) {
  if (!reservation) return null;
  return (
    plan.events.find(
      (event) =>
        event.tripleseatEventId === reservation.tripleseatEventId ||
        event.tripleseatEventId === reservation.localEventId ||
        event.id === reservation.localEventId,
    ) ?? null
  );
}

function reservationForAreaAndEvent(
  plan: FloorPlanDocument,
  areaId: string,
  eventId: string,
) {
  return plan.reservations.find(
    (reservation) =>
      reservation.areaId === areaId &&
      reservation.floorPlanEventId === eventId,
  ) ?? null;
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
      (reservation.tripleseatEventId === event.tripleseatEventId ||
        reservation.localEventId === event.tripleseatEventId ||
        reservation.localEventId === event.id),
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
    throw new Error(result?.error || "Unable to load the floor plan.");
  }
  return result;
}

function floorPlanOverlayLabel(
  area: FloorPlanArea,
  local: FloorPlanReservation | null,
  shared: EntertainmentReservation | null,
) {
  if (shared) return area.shortLabel;
  if (!local) return "";
  if (local.reservationType === "food-table") return "F";
  if (area.type === "room" || area.type === "seating-section") {
    return area.shortLabel || local.label;
  }
  return "";
}

function sameEntertainmentGroup(
  left: EntertainmentReservation,
  right: EntertainmentReservation,
) {
  return (
    left.tripleseatEventId === right.tripleseatEventId &&
    left.localEventId === right.localEventId &&
    left.resourceCategory === right.resourceCategory &&
    left.startAt === right.startAt &&
    left.endAt === right.endAt
  );
}

function isEntertainmentTimeAnchor(
  reservations: readonly EntertainmentReservation[],
  area: FloorPlanArea,
  reservation: EntertainmentReservation,
) {
  return AREAS.find(
    (candidate) =>
      candidate.entertainmentResourceId &&
      reservations.some(
        (item) =>
          item.active &&
          item.resourceId === candidate.entertainmentResourceId &&
          sameEntertainmentGroup(item, reservation),
      ),
  )?.id === area.id;
}

function sourceDurationForArea(event: FloorPlanEvent, area: FloorPlanArea) {
  const pattern =
    area.type === "bowling"
      ? /bowling/i
      : area.type === "darts"
        ? /dart/i
        : area.type === "pool"
          ? /pool/i
          : area.type === "shuffleboard"
            ? /shuffle/i
            : area.type === "mini-golf"
              ? /mini\s*golf/i
              : null;
  if (!pattern) return "";
  const duration = event.source.entertainment.find((item) =>
    pattern.test(item.name),
  )?.duration.trim();
  if (!duration || /not listed|unknown|tbd/i.test(duration)) return "";
  return duration
    .toUpperCase()
    .replace(/\bHOURS\b/g, "HRS")
    .replace(/\bHOUR\b/g, "HR");
}

function entertainmentTimingLabel(
  reservation: EntertainmentReservation,
  event: FloorPlanEvent,
  area: FloorPlanArea,
) {
  const needsTimeReview = reservation.reviewIssues.some(
    (issue) => issue.code === "TIME_NEEDS_REVIEW",
  );
  const time = needsTimeReview
    ? "TIME TBD"
    : `${formatClock(reservation.startAt)} – ${formatClock(reservation.endAt)}`;
  const duration = sourceDurationForArea(event, area);
  return duration ? `${duration} · ${time}` : time;
}

function customGeometry(
  reservation: FloorPlanReservation,
  area: FloorPlanArea,
) {
  return reservation.customGeometry ?? {
    x: area.x,
    y: area.y,
    width: Math.max(area.width, 120),
    height: Math.max(area.height, 44),
  };
}

export default function FloorPlanDashboard({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [payload, setPayload] = useState<FloorPlanDayPayload | null>(null);
  const [activeEventId, setActiveEventId] = useState("");
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [selectedReservationId, setSelectedReservationId] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [message, setMessage] = useState("Loading saved floor plan…");
  const [generationMode, setGenerationMode] =
    useState<FloorPlanGenerationMode>("fill-missing");
  const [zoom, setZoom] = useState(1);
  const [mapFocused, setMapFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const plan = payload?.plan ?? null;
  const activeEvent =
    plan?.events.find((event) => event.id === activeEventId) ?? null;
  const selectedArea =
    selectedAreaIds.length === 1 ? getFloorPlanArea(selectedAreaIds[0]) : null;
  const activePlanReservation =
    plan && activeEvent && selectedArea
      ? plan.reservations.find(
          (reservation) => reservation.id === selectedReservationId,
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
    setFoodTableMode(Boolean(selectedArea?.canBeFoodTable));
    setEntertainmentMode(Boolean(selectedArea?.entertainmentResourceId && selectedArea.type !== "room"));
  }, [selectedArea]);

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
    setDate(nextDate);
  }

  async function runAction(
    action: "refresh" | "generate" | "save" | "validate" | "approve",
  ) {
    if (!plan && action !== "refresh") return;
    if (
      action === "generate" &&
      generationMode === "reset-event" &&
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
        action,
        ...(action === "generate" ? { mode: generationMode } : {}),
        ...(action === "save" ? { plan } : {}),
        ...(action === "approve" ? { acknowledgeWarnings: warningCount > 0 } : {}),
      });
      setPayload(next);
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setRequestState("idle");
      setMessage(
        action === "approve"
          ? "Floor plan approved and saved."
          : action === "refresh"
            ? "Live Tripleseat sync complete and saved. Review highlighted changes before approval."
            : `Floor plan ${action === "generate" ? "generated" : `${action}d`} and saved as version ${next.plan.version}.`,
      );
    } catch (error) {
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
      const localAdditions: FloorPlanReservation[] = [];
      for (const areaId of selectedAreaIds) {
        const area = getFloorPlanArea(areaId);
        if (!area || !area.isReservable) continue;
        if (
          area.entertainmentResourceId &&
          (area.type !== "room" || entertainmentMode)
        ) {
          await saveEntertainmentAssignment(area, activeEvent);
          if (area.type !== "room") continue;
        }
        if (reservationForAreaAndEvent(plan, area.id, activeEvent.id)) continue;
        const reservationType = area.canBeFoodTable && foodTableMode
          ? "food-table"
          : area.type === "rectangle-table" || area.type === "square-table"
            ? "seating"
            : "room";
        localAdditions.push({
          id: `manual:${activeEvent.id}:${reservationType}:${area.id}`,
          floorPlanEventId: activeEvent.id,
          areaId: area.id,
          reservationType,
          startAt: activeEvent.startAt,
          endAt: activeEvent.endAt,
          label: reservationType === "food-table" ? "F" : area.shortLabel,
          source: "manual",
          lockedByUser: true,
        });
      }
      const nextPlan = localAdditions.length
        ? { ...plan, reservations: [...plan.reservations, ...localAdditions] }
        : plan;
      if (localAdditions.length) commitPlan(nextPlan);
      await refreshEntertainment(nextPlan);
      setRequestState("idle");
      setMessage(localAdditions.length ? "Assignments added; save the plan to persist seating changes." : "Shared entertainment assignments saved.");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Unable to assign the selected objects.");
    }
  }

  async function removeSelected() {
    if (!payload || !plan || !activeEvent || selectedAreaIds.length === 0) return;
    setRequestState("saving");
    try {
      const removeIds = new Set<string>();
      for (const areaId of selectedAreaIds) {
        const area = getFloorPlanArea(areaId);
        if (!area) continue;
        const local = reservationForAreaAndEvent(plan, area.id, activeEvent.id);
        if (local) removeIds.add(local.id);
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
      const nextPlan = removeIds.size
        ? {
          ...plan,
          reservations: plan.reservations.filter((reservation) => !removeIds.has(reservation.id)),
        }
        : plan;
      if (removeIds.size) commitPlan(nextPlan);
      await refreshEntertainment(nextPlan);
      setRequestState("idle");
      setMessage(removeIds.size ? "Assignments removed; save the plan to persist seating changes." : "Shared entertainment assignments removed.");
    } catch (error) {
      setRequestState("error");
      setMessage(error instanceof Error ? error.message : "Unable to remove the selected assignments.");
    }
  }

  function updateActiveEventColor(color: string) {
    if (!plan || !activeEvent) return;
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
          ? { ...reservation, ...patch, source: "manual", lockedByUser: true }
          : reservation,
      ),
    });
  }

  function addCustomNote() {
    if (!plan || !activeEvent || !selectedArea) return;
    const note: FloorPlanReservation = {
      id: `manual:${activeEvent.id}:custom:${crypto.randomUUID()}`,
      floorPlanEventId: activeEvent.id,
      areaId: selectedArea.id,
      reservationType: "custom",
      startAt: activeEvent.startAt,
      endAt: activeEvent.endAt,
      label: "New note",
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
    if (!plan || !payload || !mapImageRef.current || plan.status !== "Approved") return;
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.drawImage(mapImageRef.current, 0, 0, 1920, 1080);
    const exportModel = buildFloorPlanExportModel(
      plan,
      payload.entertainmentReservations,
    );
    context.fillStyle = "#000000";
    context.font = "700 30px Arial";
    context.fillText(formatFullDate(date), 34, 55);
    exportModel.events.forEach((event, index) => {
      context.fillStyle = event.color;
      context.font = "700 21px Arial";
      context.fillText(`${event.name} (${event.guestCount}) | ${eventTime(event)}`, 34, 96 + index * 34);
    });
    const drawOverlay = (area: FloorPlanArea, event: FloorPlanEvent, label: string) => {
      context.globalAlpha = 0.5;
      context.fillStyle = event.color;
      context.fillRect(area.x, area.y, area.width, area.height);
      context.globalAlpha = 1;
      context.strokeStyle = event.color;
      context.lineWidth = 3;
      context.strokeRect(area.x, area.y, area.width, area.height);
      if (label) {
        context.fillStyle = readableOverlayText(event.color);
        context.font = "700 15px Arial";
        context.fillText(label, area.x + 4, area.y + Math.min(area.height - 4, 18));
      }
    };
    for (const reservation of plan.reservations) {
      const area = getFloorPlanArea(reservation.areaId);
      const event = plan.events.find((candidate) => candidate.id === reservation.floorPlanEventId);
      if (!area || !event) continue;
      if (reservation.reservationType === "custom") {
        const geometry = customGeometry(reservation, area);
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
    const exportedEntertainment = [...payload.entertainmentReservations].sort(
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
      const event = eventForEntertainment(plan, reservation);
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
    const link = document.createElement("a");
    link.download = `${date}-event-host-floor-plan.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  const activeEventValidation = useMemo(
    () => payload?.validation.filter((entry) => entry.eventId === activeEventId) ?? [],
    [activeEventId, payload?.validation],
  );
  const reservedSeats = useMemo(() => {
    if (!plan || !activeEvent) return 0;
    return plan.reservations
      .filter(
        (reservation) =>
          reservation.floorPlanEventId === activeEvent.id &&
          reservation.reservationType === "seating",
      )
      .reduce((total, reservation) => total + (getFloorPlanArea(reservation.areaId)?.capacity ?? 0), 0);
  }, [activeEvent, plan]);

  return (
    <PortalShell
      actions={plan ? <PortalStatusBadge tone={statusTone(plan.status)}>{plan.status}</PortalStatusBadge> : null}
      allowFullscreen
      mainClassName="floor-plan-editor-page"
      sectionSubtitle="Live Tripleseat planning"
      sectionTitle="Admin Floor Plans"
    >
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
          <select aria-label="Regeneration mode" onChange={(event) => setGenerationMode(event.target.value as FloorPlanGenerationMode)} value={generationMode}>
            <option value="fill-missing">Keep manual edits; fill missing</option>
            <option value="replace-generated">Replace generated only</option>
            <option value="reset-event">Reset the entire event plan</option>
          </select>
          <button disabled={!plan || requestState === "saving"} onClick={() => void runAction("generate")} type="button">Generate Floor Plan</button>
          <button disabled={!dirty || requestState === "saving"} onClick={() => void runAction("save")} type="button">Save</button>
          <button disabled={!plan?.events.length || dirty || requestState === "saving"} onClick={() => void runAction("validate")} type="button">Validate</button>
          <button disabled={!plan?.events.length || dirty || requestState === "saving"} onClick={() => void runAction("approve")} type="button">Approve</button>
          {plan?.status === "Approved" ? <><button onClick={() => void exportPng()} type="button">Export PNG</button><button onClick={() => window.print()} type="button">Print / PDF</button></> : null}
        </div>
        <div className={`floor-plan-save-state is-${requestState}`} role="status">
          <strong>{dirty ? "Unsaved" : requestState === "saving" ? "Working" : requestState === "error" ? "Needs attention" : "Saved"}</strong>
          <span>{message}</span>
        </div>
      </section>

      {requestState === "loading" && !plan ? (
        <PortalState description="Loading the selected date from Event Host." icon="…" title="Loading floor plan" />
      ) : plan && payload ? (
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
                    onClick={() => setActiveEventId(event.id)}
                    style={{ "--event-color": event.color } as React.CSSProperties}
                    type="button"
                  >
                    <span className="floor-plan-event-card-title"><strong>{event.name}</strong><span className={`floor-plan-source-status ${eventStatusClass(event)}`}>{event.fullBuyout ? "Full buyout" : event.status}</span></span>
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
                <div className="floor-plan-map-date" aria-hidden="true"><strong>{formatFullDate(date)}</strong>{plan.events.map((event) => <span key={event.id} style={{ color: event.color }}><b>{event.name} ({event.guestCount})</b><small>{eventTime(event)}</small></span>)}</div>
                <div className="floor-plan-area-layer">
                  {AREAS.filter((area) => area.id !== "facility" || plan.reservations.some((reservation) => reservation.areaId === "facility")).map((area) => {
                    const local = plan.reservations.find((reservation) => reservation.areaId === area.id && reservation.reservationType !== "custom" && (reservation.floorPlanEventId === activeEventId || !activeEventId)) ?? plan.reservations.find((reservation) => reservation.areaId === area.id && reservation.reservationType !== "custom") ?? null;
                    const shared = area.entertainmentResourceId
                      ? payload.entertainmentReservations.find((reservation) => reservation.active && reservation.resourceId === area.entertainmentResourceId && (eventForEntertainment(plan, reservation)?.id === activeEventId || !activeEventId)) ?? payload.entertainmentReservations.find((reservation) => reservation.active && reservation.resourceId === area.entertainmentResourceId) ?? null
                      : null;
                    const assignedEvent = local
                      ? plan.events.find((event) => event.id === local.floorPlanEventId) ?? null
                      : eventForEntertainment(plan, shared);
                    const label = floorPlanOverlayLabel(area, local, shared);
                    const showTimeLabel = Boolean(
                      shared &&
                      assignedEvent &&
                      area.type !== "mini-golf" &&
                      isEntertainmentTimeAnchor(
                        payload.entertainmentReservations,
                        area,
                        shared,
                      ),
                    );
                    const conflict = payload.floorPlanConflicts.some((item) => item.areaId === area.id) || (shared ? payload.entertainmentConflicts.some((item) => item.reservationIds.includes(shared.id)) : false);
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
                  {plan.reservations.filter((reservation) => reservation.reservationType === "custom").map((reservation) => {
                    const area = getFloorPlanArea(reservation.areaId);
                    const event = plan.events.find((candidate) => candidate.id === reservation.floorPlanEventId);
                    if (!area || !event) return null;
                    const geometry = customGeometry(reservation, area);
                    return <button aria-label={`Custom note: ${reservation.label}`} className={`floor-plan-custom-note${selectedReservationId === reservation.id ? " is-selected" : ""}`} key={reservation.id} onClick={() => { setActiveEventId(event.id); setSelectedAreaIds([area.id]); setSelectedReservationId(reservation.id); }} style={{ left: `${(geometry.x / 1920) * 100}%`, top: `${(geometry.y / 1080) * 100}%`, width: `${(geometry.width / 1920) * 100}%`, height: `${(geometry.height / 1080) * 100}%`, backgroundColor: `${event.color}80`, borderColor: event.color, color: readableOverlayText(event.color) }} type="button">{reservation.label}</button>;
                  })}
                </div>
              </div>
            </div>
            <p className="floor-plan-map-help">Tap an object to inspect it. Shift-click for multi-select. Permanent map geometry stays fixed; custom notes can be resized in the inspector.</p>
          </section>

          <aside className="floor-plan-inspector" aria-label="Floor plan inspector">
            <div className="floor-plan-panel-heading"><span className="portal-module-kicker">Inspector</span><h2>{selectedArea ? selectedArea.name : activeEvent?.name ?? "Select an event"}</h2></div>
            {selectedArea && activeEvent ? (
              <div className="floor-plan-inspector-body">
                <dl className="floor-plan-detail-list"><div><dt>Type</dt><dd>{selectedArea.type}</dd></div><div><dt>Capacity</dt><dd>{selectedArea.capacity || "Not counted"}</dd></div><div><dt>Parent</dt><dd>{selectedArea.parentAreaId ? getFloorPlanArea(selectedArea.parentAreaId)?.name ?? selectedArea.parentAreaId : "—"}</dd></div><div><dt>Assigned event</dt><dd>{activePlanReservation || activeEntertainmentReservation ? activeEvent.name : "Unassigned for selected event"}</dd></div></dl>
                {selectedArea.entertainmentResourceId ? <><label className="floor-plan-toggle-field"><input checked={entertainmentMode} disabled={selectedArea.type !== "room"} onChange={(event) => setEntertainmentMode(event.target.checked)} type="checkbox" />{selectedArea.type === "room" ? "Also reserve on Entertainment Schedule" : "Shared Entertainment Schedule reservation"}</label><div className="floor-plan-field-group"><label>Reservation start<input onChange={(event) => setEntStart(event.target.value)} type="datetime-local" value={entStart} /></label><label>Reservation end<input onChange={(event) => setEntEnd(event.target.value)} type="datetime-local" value={entEnd} /></label></div></> : null}
                {selectedArea.canBeFoodTable ? <label className="floor-plan-toggle-field"><input checked={foodTableMode} onChange={(event) => setFoodTableMode(event.target.checked)} type="checkbox" />Mark as food table and label F</label> : null}
                {activePlanReservation ? <div className="floor-plan-field-group"><label>Label<input maxLength={80} onChange={(event) => updateReservation({ label: event.target.value })} value={activePlanReservation.label} /></label><label>Event color<input onChange={(event) => updateActiveEventColor(event.target.value)} type="color" value={activeEvent.color} /></label></div> : <label className="floor-plan-color-field">Event color<input onChange={(event) => updateActiveEventColor(event.target.value)} type="color" value={activeEvent.color} /></label>}
                {!selectedArea.isReservable ? <p className="floor-plan-warning-copy">This permanent map object is reference-only and cannot be reserved.</p> : null}
                <div className="floor-plan-inspector-actions"><button disabled={!selectedArea.isReservable} onClick={() => void assignSelected()} type="button">Assign selected to {activeEvent.name}</button><button className="is-danger" disabled={!activePlanReservation && !activeEntertainmentReservation} onClick={() => void removeSelected()} type="button">Remove assignment</button><button onClick={addCustomNote} type="button">Add custom note here</button></div>
                {activePlanReservation?.reservationType === "custom" && activePlanReservation.customGeometry ? <div className="floor-plan-geometry-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key}<input min={0} onChange={(event) => updateReservation({ customGeometry: { ...activePlanReservation.customGeometry!, [key]: Number(event.target.value) } })} type="number" value={activePlanReservation.customGeometry![key]} /></label>)}</div> : null}
                <div className={`floor-plan-conflict-state${payload.floorPlanConflicts.some((item) => item.areaId === selectedArea.id) ? " is-conflict" : ""}`}>{payload.floorPlanConflicts.some((item) => item.areaId === selectedArea.id) ? "Blocking overlap: resolve this assignment before approval." : "No floor-plan overlap detected for this object."}</div>
              </div>
            ) : activeEvent ? (
              <div className="floor-plan-inspector-body">
                <dl className="floor-plan-detail-list"><div><dt>BEO guests</dt><dd>{activeEvent.guestCount}</dd></div><div><dt>Reserved seating</dt><dd>{reservedSeats}</dd></div><div><dt>Difference</dt><dd>{reservedSeats - activeEvent.guestCount}</dd></div><div><dt>Food table</dt><dd>{plan.reservations.some((item) => item.floorPlanEventId === activeEvent.id && item.reservationType === "food-table") ? "Assigned" : "Missing"}</dd></div></dl>
                <section><h3>Tripleseat fields used</h3><p><strong>Contracted:</strong> {activeEvent.source.rooms.join(", ") || "Missing"}</p><p><strong>Food service:</strong> {activeEvent.source.food?.join(" · ") || "None listed"}</p><p><strong>Entertainment:</strong> {activeEvent.source.entertainment.map((item) => `${item.name} — ${item.quantity} — ${item.time}`).join(" · ") || "None listed"}</p><p><strong>Setup and placement notes:</strong> {activeEvent.source.operationalNotes?.map((note) => note.text).join(" · ") || "None listed"}</p>{activeEvent.source.reviewReasons.length ? <p className="floor-plan-warning-copy">{activeEvent.source.reviewReasons.join(" ")}</p> : null}</section>
                <section><h3>Verification checklist</h3><div className="floor-plan-validation-list">{activeEventValidation.map((entry) => <div className={`is-${entry.status.toLowerCase().replace(" ", "-")}`} key={`${entry.code}:${entry.eventId}`}><span>{entry.status}</span><p><strong>{entry.label}</strong>{entry.message}</p></div>)}</div></section>
                <button className="floor-plan-regenerate-button" onClick={() => void runAction("generate")} type="button">Regenerate suggestions</button>
              </div>
            ) : <p className="floor-plan-empty-copy">Select an event to review BEO details and validation.</p>}
            {payload.revisions.length ? <details className="floor-plan-history"><summary>Revision history ({payload.revisions.length})</summary>{payload.revisions.slice(0, 12).map((revision) => <div key={revision.id}><strong>Version {revision.version}</strong><span>{new Date(revision.changedAt).toLocaleString()}</span><p>{revision.description}</p></div>)}</details> : null}
          </aside>
        </div>
      ) : (
        <PortalState description={message} icon="!" title="Floor plan unavailable" />
      )}
    </PortalShell>
  );
}
