"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  PortalFrame,
  PortalHeader,
  PortalZoomControls,
} from "@/app/_components/PortalShell";
import {
  ENTERTAINMENT_CATEGORY_LABELS,
  ENTERTAINMENT_RESOURCES,
  getEntertainmentResource,
  resourcesForCategory,
  textColorForBackground,
} from "@/lib/entertainment/resources";
import { broadcastEntertainmentUpdate } from "@/lib/entertainment/live-updates";
import {
  addCalendarDays,
  clampOperatingMinutes,
  formatClock,
  formatFullDate,
  isoForOperatingMinutes,
  operatingMinutesForIso,
  snapOperatingMinutes,
  startOfWeek,
  todayInEntertainmentTimeZone,
  zonedDateTimeToIso,
} from "@/lib/entertainment/time";
import type {
  EntertainmentAuditEntry,
  EntertainmentCategory,
  EntertainmentConflict,
  EntertainmentDayPayload,
  EntertainmentEventSnapshot,
  EntertainmentReservation,
  EntertainmentResource,
} from "@/lib/entertainment/types";

const PIXELS_PER_MINUTE = 1.2;
const COMPACT_PIXELS_PER_MINUTE = 0.98;
const OPERATING_MINUTES = 15 * 60;
const RESOURCE_COLUMN_WIDTH = 190;
const COMPACT_RESOURCE_COLUMN_WIDTH = 140;
const RESOURCE_ROW_HEIGHT_MIN = 14;
const RESOURCE_ROW_HEIGHT_MAX = 22;
const ENTERTAINMENT_ZOOM_MIN = 27;
const ENTERTAINMENT_ZOOM_MAX = 120;
const ENTERTAINMENT_ZOOM_STEP = 10;
const ENTERTAINMENT_ZOOM_DEFAULT = 80;
const ENTERTAINMENT_LAYOUT_GAP = 8;
const ENTERTAINMENT_FIT_GUTTER = 20;
const ENTERTAINMENT_KIOSK_GRID_HEADER_HEIGHT = 30;
const ENTERTAINMENT_KIOSK_GROUP_HEADER_HEIGHT = 18;
const ENTERTAINMENT_VERTICAL_FIT_GUTTER = 28;
const CATEGORY_ORDER: EntertainmentCategory[] = [
  "bowling",
  "darts",
  "pool",
  "shuffleboard",
  "private-rooms",
];
const MAIN_CATEGORIES: EntertainmentCategory[] = [
  "bowling",
  "private-rooms",
];
const COMPACT_CATEGORIES: EntertainmentCategory[] = [
  "darts",
  "pool",
  "shuffleboard",
];

export function calculateEntertainmentFitZoom(availableWidth: number) {
  const fixedWidth =
    RESOURCE_COLUMN_WIDTH +
    COMPACT_RESOURCE_COLUMN_WIDTH +
    ENTERTAINMENT_LAYOUT_GAP +
    ENTERTAINMENT_FIT_GUTTER;
  const timelineWidthAtFullScale =
    OPERATING_MINUTES *
    (PIXELS_PER_MINUTE + COMPACT_PIXELS_PER_MINUTE);
  const fittedZoom = Math.floor(
    ((Math.max(0, availableWidth) - fixedWidth) /
      timelineWidthAtFullScale) *
      100,
  );

  return Math.max(
    ENTERTAINMENT_ZOOM_MIN,
    Math.min(ENTERTAINMENT_ZOOM_MAX, fittedZoom),
  );
}

export function calculateEntertainmentFitRowHeight(
  availableHeight: number,
  mainSlotUnits: number,
  compactSlotUnits: number,
) {
  function fitColumn(slotUnits: number, groupCount: number) {
    const fixedHeight =
      ENTERTAINMENT_KIOSK_GRID_HEADER_HEIGHT +
      groupCount * ENTERTAINMENT_KIOSK_GROUP_HEADER_HEIGHT +
      ENTERTAINMENT_VERTICAL_FIT_GUTTER;
    return Math.floor(
      (Math.max(0, availableHeight) - fixedHeight) /
        Math.max(1, slotUnits),
    );
  }

  const fittedHeight = Math.min(
    fitColumn(mainSlotUnits, MAIN_CATEGORIES.length),
    fitColumn(compactSlotUnits, COMPACT_CATEGORIES.length),
  );

  return Math.max(
    RESOURCE_ROW_HEIGHT_MIN,
    Math.min(RESOURCE_ROW_HEIGHT_MAX, fittedHeight),
  );
}

type DragPreview = {
  reservationId: string;
  startMinute: number;
  endMinute: number;
  resourceId: string;
};

type RangeDraft = {
  resourceId: string;
  startMinute: number;
  endMinute: number;
};

type ReservationDraft = {
  reservation: EntertainmentReservation | null;
  operatingDate: string;
  eventId: string;
  eventName: string;
  resourceId: string;
  startAt: string;
  endAt: string;
  eventColor: string;
  notes: string;
  reason: string;
  needsReview: boolean;
};

type ConflictApiPayload = {
  error?: string;
  conflict?: boolean;
  reservations?: Array<{
    eventName: string;
    resourceName: string;
    startAt: string;
    endAt: string;
  }>;
};

function eventKey(event: EntertainmentEventSnapshot) {
  return (
    event.tripleseatEventId ||
    event.localEventId ||
    event.eventId
  );
}

function reservationEventKey(reservation: EntertainmentReservation) {
  return (
    reservation.tripleseatEventId ||
    reservation.localEventId ||
    `manual:${reservation.eventName}`
  );
}

function dateTabParts(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "UTC",
    })
      .format(value)
      .toUpperCase(),
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    })
      .format(value)
      .toUpperCase(),
  };
}

function localInputFromIso(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function isoFromLocalInput(value: string) {
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) {
    throw new Error("Choose a valid date and time.");
  }
  return zonedDateTimeToIso(
    match[1],
    Number(match[2]),
    Number(match[3]),
  );
}

function syncLabel(payload: EntertainmentDayPayload | null) {
  if (!payload?.sync) {
    return "Not synced yet";
  }
  const time =
    payload.sync.lastSuccessfulSyncAt ??
    payload.sync.completedAt ??
    payload.sync.startedAt;
  return `${payload.sync.status === "success" ? "Last synced" : "Last attempt"} ${new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    },
  ).format(new Date(time))}`;
}

function hourLabels() {
  return Array.from({ length: 16 }, (_, index) => {
    const total = 10 * 60 + index * 60;
    const hour = Math.floor(total / 60) % 24;
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return {
      label: `${displayHour} ${period}`,
      minute: index * 60,
    };
  });
}

function layoutReservations(
  reservations: EntertainmentReservation[],
  rowHeight: number,
) {
  const sorted = [...reservations].sort(
    (left, right) =>
      Date.parse(left.startAt) - Date.parse(right.startAt) ||
      Date.parse(left.endAt) - Date.parse(right.endAt) ||
      left.id.localeCompare(right.id),
  );
  const slotEnds: number[] = [];
  const placed = sorted.map((reservation) => {
    const start = Date.parse(reservation.startAt);
    let slot = slotEnds.findIndex((end) => end <= start);
    if (slot < 0) {
      slot = slotEnds.length;
    }
    slotEnds[slot] = Date.parse(reservation.endAt);
    return { reservation, slot };
  });
  return {
    placed,
    slotCount: Math.max(1, slotEnds.length),
    height: Math.max(1, slotEnds.length) * rowHeight,
  };
}

export function calculateEntertainmentColumnSlotUnits(
  reservations: EntertainmentReservation[],
  categories: readonly EntertainmentCategory[],
) {
  return categories
    .flatMap((category) => resourcesForCategory(category))
    .reduce(
      (total, resource) =>
        total +
        layoutReservations(
          reservations.filter(
            (reservation) => reservation.resourceId === resource.id,
          ),
          1,
        ).slotCount,
      0,
    );
}

function eventTimes(event: EntertainmentEventSnapshot) {
  if (!event.eventStartAt || !event.eventEndAt) {
    return "Time needs review";
  }
  return `${formatClock(event.eventStartAt)} – ${formatClock(event.eventEndAt)}`;
}

function compactClock(iso: string) {
  const match = formatClock(iso).match(/^(\d{1,2}):(\d{2})\s(AM|PM)$/);
  if (!match) {
    return formatClock(iso);
  }
  const time = match[2] === "00" ? match[1] : `${match[1]}:${match[2]}`;
  return { time, period: match[3].toLowerCase().charAt(0) };
}

function compactTimeRange(startAt: string, endAt: string) {
  const start = compactClock(startAt);
  const end = compactClock(endAt);
  if (typeof start === "string" || typeof end === "string") {
    return `${formatClock(startAt)} – ${formatClock(endAt)}`;
  }
  if (start.period === end.period) {
    return `${start.time}–${end.time}${end.period}`;
  }
  return `${start.time}${start.period}–${end.time}${end.period}`;
}

async function responseError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || `Request failed (${response.status}).`;
}

function ReservationModal({
  draft,
  events,
  conflicts,
  saving,
  onClose,
  onRemove,
  onRevert,
  onSave,
}: {
  draft: ReservationDraft;
  events: EntertainmentEventSnapshot[];
  conflicts: EntertainmentConflict[];
  saving: boolean;
  onClose: () => void;
  onRemove: (reason: string) => void;
  onRevert: (reason: string) => void;
  onSave: (draft: ReservationDraft) => void;
}) {
  const [value, setValue] = useState(draft);
  const [audit, setAudit] = useState<EntertainmentAuditEntry[]>([]);
  const reservationConflicts = conflicts.filter((conflict) =>
    value.reservation
      ? conflict.reservationIds.includes(value.reservation.id)
      : false,
  );
  const sourceReservation =
    value.reservation != null && value.reservation.source !== "manual";
  const selectedCategory =
    getEntertainmentResource(value.resourceId)?.category ?? "bowling";

  useEffect(() => {
    setValue(draft);
  }, [draft]);

  useEffect(() => {
    if (!draft.reservation) {
      setAudit([]);
      return;
    }
    const controller = new AbortController();
    void fetch(
      `/api/entertainment/reservations/${encodeURIComponent(
        draft.reservation.id,
      )}/audit`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : { audit: [] }))
      .then((payload: { audit?: EntertainmentAuditEntry[] }) =>
        setAudit(payload.audit ?? []),
      )
      .catch(() => setAudit([]));
    return () => controller.abort();
  }, [draft.reservation]);

  function chooseEvent(nextId: string) {
    const selected = events.find((event) => eventKey(event) === nextId);
    setValue((current) => ({
      ...current,
      eventId: nextId,
      eventName: selected?.eventName ?? current.eventName,
      eventColor: selected?.eventColor ?? current.eventColor,
    }));
  }

  return (
    <div
      aria-labelledby="reservation-modal-title"
      aria-modal="true"
      className="entertainment-modal-backdrop"
      role="dialog"
    >
      <form
        className="entertainment-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <header>
          <div>
            <span className="entertainment-eyebrow">
              {value.reservation ? "Reservation details" : "Manual reservation"}
            </span>
            <h2 id="reservation-modal-title">
              {value.reservation ? "Edit reservation" : "Add reservation"}
            </h2>
          </div>
          <button
            aria-label="Close reservation editor"
            className="entertainment-close-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        {value.reservation?.hasSourceUpdate ? (
          <div className="entertainment-modal-alert" role="status">
            <strong>Tripleseat has newer information.</strong>
            <span>
              The local manual value is still active. Compare it with the
              Tripleseat value below, then keep or revert it explicitly.
            </span>
          </div>
        ) : null}

        <div className="entertainment-form-grid">
          <label className="entertainment-field entertainment-field-wide">
            <span>Event</span>
            <select
              disabled={sourceReservation}
              onChange={(event) => chooseEvent(event.target.value)}
              value={value.eventId}
            >
              <option value="">Manual / unlisted event</option>
              {events.map((event) => (
                <option key={event.eventId} value={eventKey(event)}>
                  {event.eventName}
                </option>
              ))}
            </select>
          </label>
          <label className="entertainment-field entertainment-field-wide">
            <span>Event name</span>
            <input
              disabled={sourceReservation}
              maxLength={200}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  eventName: event.target.value,
                }))
              }
              required
              value={value.eventName}
            />
          </label>
          <label className="entertainment-field">
            <span>Resource category</span>
            <select
              onChange={(event) => {
                const category = event.target.value as EntertainmentCategory;
                setValue((current) => ({
                  ...current,
                  resourceId:
                    resourcesForCategory(category)[0]?.id ??
                    current.resourceId,
                }));
              }}
              value={selectedCategory}
            >
              {CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {ENTERTAINMENT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          <label className="entertainment-field">
            <span>Exact resource</span>
            <select
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  resourceId: event.target.value,
                }))
              }
              required
              value={value.resourceId}
            >
              {resourcesForCategory(selectedCategory).map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.canonicalName}
                </option>
              ))}
            </select>
          </label>
          <label className="entertainment-field">
            <span>Event color</span>
            <input
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  eventColor: event.target.value,
                }))
              }
              type="color"
              value={value.eventColor}
            />
          </label>
          <label className="entertainment-field">
            <span>Start date and time</span>
            <input
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  startAt: event.target.value,
                }))
              }
              required
              step={900}
              type="datetime-local"
              value={value.startAt}
            />
          </label>
          <label className="entertainment-field">
            <span>End date and time</span>
            <input
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  endAt: event.target.value,
                }))
              }
              required
              step={900}
              type="datetime-local"
              value={value.endAt}
            />
          </label>
          <label className="entertainment-field entertainment-field-wide">
            <span>Notes</span>
            <textarea
              maxLength={1_000}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              value={value.notes}
            />
          </label>
          <label className="entertainment-field entertainment-field-wide">
            <span>Change reason (optional)</span>
            <input
              maxLength={500}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              placeholder="Reason recorded in audit history"
              value={value.reason}
            />
          </label>
        </div>

        <div className="entertainment-detail-grid">
          <div>
            <span>Source</span>
            <strong>
              {value.reservation?.source ?? "Manual Event Host entry"}
            </strong>
          </div>
          <div>
            <span>Manual override</span>
            <strong>
              {value.reservation?.manualOverride || !value.reservation
                ? "Yes"
                : "No"}
            </strong>
          </div>
          <div>
            <span>Review status</span>
            <strong>
              {value.needsReview ? "Needs Review" : "Verified"}
            </strong>
          </div>
          <div>
            <span>Conflict status</span>
            <strong>
              {reservationConflicts.length
                ? `${reservationConflicts.length} conflict${
                    reservationConflicts.length === 1 ? "" : "s"
                  }`
                : "No overlap"}
            </strong>
          </div>
        </div>

        <label className="entertainment-check-field">
          <input
            checked={value.needsReview}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                needsReview: event.target.checked,
              }))
            }
            type="checkbox"
          />
          Mark this reservation as needing staff review
        </label>

        {reservationConflicts.length ? (
          <section className="entertainment-conflict-list">
            <h3>Conflict information</h3>
            {reservationConflicts.map((conflict) => (
              <p key={conflict.id}>
                <strong>{conflict.resourceName}:</strong>{" "}
                {conflict.eventNames.join(" overlaps ")} from{" "}
                {formatClock(conflict.startAt)} to {formatClock(conflict.endAt)}
              </p>
            ))}
          </section>
        ) : null}

        {value.reservation?.sourceStartAt &&
        value.reservation.sourceEndAt &&
        value.reservation.sourceResourceId ? (
          <section className="entertainment-source-compare">
            <h3>Tripleseat value</h3>
            <p>
              {getEntertainmentResource(value.reservation.sourceResourceId)
                ?.canonicalName ?? value.reservation.sourceResourceId}
              {" · "}
              {formatClock(value.reservation.sourceStartAt)} –{" "}
              {formatClock(value.reservation.sourceEndAt)}
            </p>
          </section>
        ) : null}

        {audit.length ? (
          <details className="entertainment-audit">
            <summary>Audit history ({audit.length})</summary>
            <ul>
              {audit.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action.replaceAll("-", " ")}</strong>
                  <span>
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/New_York",
                    }).format(new Date(entry.createdAt))}
                    {" · "}
                    {entry.changedBy}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <footer>
          <div className="entertainment-destructive-actions">
            {value.reservation ? (
              <button
                className="entertainment-danger-button"
                disabled={saving}
                onClick={() => onRemove(value.reason)}
                type="button"
              >
                Remove from schedule
              </button>
            ) : null}
            {value.reservation?.sourceStartAt ? (
              <button
                className="entertainment-secondary-button"
                disabled={saving}
                onClick={() => onRevert(value.reason)}
                type="button"
              >
                Use Tripleseat value
              </button>
            ) : null}
          </div>
          <div>
            <button
              className="entertainment-secondary-button"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="entertainment-primary-button"
              disabled={saving}
              type="submit"
            >
              {saving ? "Saving…" : "Save reservation"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export default function EntertainmentScheduleDashboard({
  initialDate,
  initialPayload = null,
}: {
  initialDate: string;
  initialPayload?: EntertainmentDayPayload | null;
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [payload, setPayload] = useState<EntertainmentDayPayload | null>(
    initialPayload,
  );
  const [state, setState] = useState<
    "loading" | "ready" | "syncing" | "saving" | "error"
  >(initialPayload ? "ready" : "loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [scheduleZoom, setScheduleZoom] = useState(
    ENTERTAINMENT_ZOOM_DEFAULT,
  );
  const [scheduleFitZoom, setScheduleFitZoom] = useState(
    ENTERTAINMENT_ZOOM_DEFAULT,
  );
  const [scheduleRowHeight, setScheduleRowHeight] = useState(
    RESOURCE_ROW_HEIGHT_MAX,
  );
  const [modal, setModal] = useState<ReservationDraft | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const [rangeDraft, setRangeDraft] = useState<RangeDraft | null>(null);
  const autoSyncDates = useRef(new Set<string>());
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const previousFitZoomRef = useRef(ENTERTAINMENT_ZOOM_DEFAULT);
  const [now, setNow] = useState(() => new Date());

  const weekStart = startOfWeek(selectedDate);
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(weekStart, index),
  );
  const today = todayInEntertainmentTimeZone(now);
  const nowMinutes =
    selectedDate === today
      ? operatingMinutesForIso(now.toISOString(), selectedDate)
      : null;
  const pixelsPerMinute =
    PIXELS_PER_MINUTE * (scheduleZoom / 100);
  const compactPixelsPerMinute =
    COMPACT_PIXELS_PER_MINUTE * (scheduleZoom / 100);
  const timelineWidth = OPERATING_MINUTES * pixelsPerMinute;
  const compactTimelineWidth =
    OPERATING_MINUTES * compactPixelsPerMinute;
  const scheduleGridWidth = RESOURCE_COLUMN_WIDTH + timelineWidth;
  const compactScheduleGridWidth =
    COMPACT_RESOURCE_COLUMN_WIDTH + compactTimelineWidth;

  async function loadDay(date: string, signal?: AbortSignal) {
    const response = await fetch(
      `/api/entertainment/schedule?date=${encodeURIComponent(date)}`,
      { cache: "no-store", signal },
    );
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    const next = (await response.json()) as EntertainmentDayPayload;
    setPayload(next);
    setState("ready");
    setError("");
    return next;
  }

  async function retryLoad() {
    setState("loading");
    setError("");
    try {
      await loadDay(selectedDate);
    } catch (loadError) {
      setState("error");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the entertainment schedule.",
      );
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setError("");
    setNotice("");
    setSelectedEvent(null);
    setIsEditing(false);
    setModal(null);
    setDragPreview(null);
    dragPreviewRef.current = null;
    setRangeDraft(null);
    void loadDay(selectedDate, controller.signal).catch((loadError) => {
      if (controller.signal.aborted) {
        return;
      }
      setState("error");
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the entertainment schedule.",
      );
    });
    return () => controller.abort();
  }, [selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const mainSlotUnits = useMemo(
    () =>
      calculateEntertainmentColumnSlotUnits(
        payload?.reservations ?? [],
        MAIN_CATEGORIES,
      ),
    [payload?.reservations],
  );
  const compactSlotUnits = useMemo(
    () =>
      calculateEntertainmentColumnSlotUnits(
        payload?.reservations ?? [],
        COMPACT_CATEGORIES,
      ),
    [payload?.reservations],
  );

  useEffect(() => {
    const scheduleScroll = scheduleScrollRef.current;
    if (!scheduleScroll) {
      return;
    }
    const observedScheduleScroll = scheduleScroll;

    function updateScheduleFit() {
      const nextFitZoom = calculateEntertainmentFitZoom(
        observedScheduleScroll.clientWidth,
      );
      const nextRowHeight = calculateEntertainmentFitRowHeight(
        observedScheduleScroll.clientHeight,
        mainSlotUnits,
        compactSlotUnits,
      );
      const previousFitZoom = previousFitZoomRef.current;
      setScheduleFitZoom(nextFitZoom);
      setScheduleRowHeight(nextRowHeight);
      setScheduleZoom((currentZoom) =>
        currentZoom === previousFitZoom
          ? nextFitZoom
          : currentZoom,
      );
      previousFitZoomRef.current = nextFitZoom;
    }

    updateScheduleFit();
    const resizeObserver = new ResizeObserver(updateScheduleFit);
    resizeObserver.observe(observedScheduleScroll);
    return () => resizeObserver.disconnect();
  }, [compactSlotUnits, mainSlotUnits, state]);

  async function syncDay(automatic = false) {
    if (state === "syncing") {
      return;
    }
    setState("syncing");
    setError("");
    setIsEditing(false);
    setModal(null);
    setRangeDraft(null);
    setDragPreview(null);
    dragPreviewRef.current = null;
    if (!automatic) {
      setNotice("");
    }
    try {
      const response = await fetch("/api/entertainment/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: selectedDate }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const next = (await response.json()) as EntertainmentDayPayload;
      setPayload(next);
      setState("ready");
      broadcastEntertainmentUpdate("sync", selectedDate);
      setNotice(
        `Sync complete: ${next.sync?.eventsProcessed ?? 0} events, ${
          next.sync?.reservationsCreated ?? 0
        } created, ${next.sync?.reservationsUpdated ?? 0} updated, ${
          next.sync?.warningsCreated ?? 0
        } review items.`,
      );
    } catch (syncError) {
      setState("ready");
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Tripleseat synchronization failed.",
      );
      await loadDay(selectedDate).catch(() => undefined);
    }
  }

  useEffect(() => {
    if (
      payload &&
      payload.date === selectedDate &&
      payload.sync == null &&
      payload.sourceMode === "live" &&
      payload.missingEnvironmentVariables.length === 0 &&
      !autoSyncDates.current.has(selectedDate)
    ) {
      autoSyncDates.current.add(selectedDate);
      void syncDay(true);
    }
  }, [payload, selectedDate]);

  async function lockDashboard() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  function finishEditing() {
    if (state === "saving") {
      return;
    }
    setIsEditing(false);
    setModal(null);
    setRangeDraft(null);
    setDragPreview(null);
    dragPreviewRef.current = null;
    setNotice("Schedule saved. Editing is locked.");
  }

  const conflictReservationIds = useMemo(
    () =>
      new Set(
        payload?.conflicts.flatMap((conflict) => conflict.reservationIds) ??
          [],
      ),
    [payload?.conflicts],
  );

  const displayedReservations = useMemo(() => {
    return (payload?.reservations ?? []).map((reservation) => {
      if (dragPreview?.reservationId !== reservation.id) {
        return reservation;
      }
      const resource = getEntertainmentResource(dragPreview.resourceId);
      return {
        ...reservation,
        resourceId: dragPreview.resourceId,
        resourceName: resource?.canonicalName ?? reservation.resourceName,
        resourceCategory:
          resource?.category ?? reservation.resourceCategory,
        startAt: isoForOperatingMinutes(
          selectedDate,
          dragPreview.startMinute,
        ),
        endAt: isoForOperatingMinutes(
          selectedDate,
          dragPreview.endMinute,
        ),
      };
    });
  }, [
    dragPreview,
    payload?.reservations,
    selectedDate,
  ]);

  const reservationsByResource = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof layoutReservations>
    >();
    for (const resource of ENTERTAINMENT_RESOURCES) {
      map.set(
        resource.id,
        layoutReservations(
          displayedReservations.filter(
            (reservation) => reservation.resourceId === resource.id,
          ),
          scheduleRowHeight,
        ),
      );
    }
    return map;
  }, [displayedReservations, scheduleRowHeight]);

  function draftForReservation(reservation: EntertainmentReservation) {
    setModal({
      reservation,
      operatingDate: reservation.operatingDate,
      eventId: reservationEventKey(reservation),
      eventName: reservation.eventName,
      resourceId: reservation.resourceId,
      startAt: localInputFromIso(reservation.startAt),
      endAt: localInputFromIso(reservation.endAt),
      eventColor: reservation.eventColor,
      notes: reservation.notes,
      reason: "",
      needsReview: reservation.needsReview,
    });
  }

  function draftForRange(resourceId: string, startMinute: number, endMinute: number) {
    const event =
      payload?.events.find((item) => eventKey(item) === selectedEvent) ??
      payload?.events[0] ??
      null;
    setModal({
      reservation: null,
      operatingDate: selectedDate,
      eventId: event ? eventKey(event) : "",
      eventName: event?.eventName ?? "",
      resourceId,
      startAt: localInputFromIso(
        isoForOperatingMinutes(selectedDate, startMinute),
      ),
      endAt: localInputFromIso(
        isoForOperatingMinutes(selectedDate, endMinute),
      ),
      eventColor: event?.eventColor ?? "#0F766E",
      notes: "",
      reason: "",
      needsReview: event?.needsReview ?? false,
    });
  }

  async function mutationFetch(
    url: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    allowConflictPrompt = true,
  ) {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 409 && allowConflictPrompt) {
      const conflict = (await response.json()) as ConflictApiPayload;
      const details = (conflict.reservations ?? [])
        .map(
          (reservation) =>
            `${reservation.eventName} on ${reservation.resourceName} (${formatClock(
              reservation.startAt,
            )}–${formatClock(reservation.endAt)})`,
        )
        .join("\n");
      const confirmed = window.confirm(
        `This creates an overlap conflict.\n\n${details}\n\nSave this intentional conflict anyway?`,
      );
      if (confirmed) {
        return mutationFetch(
          url,
          method,
          { ...body, forceConflict: true },
          false,
        );
      }
      throw new Error("The conflicting change was not saved.");
    }
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    return response.json();
  }

  async function saveDraft(draft: ReservationDraft) {
    setState("saving");
    setError("");
    try {
      const body = {
        operatingDate: draft.operatingDate,
        eventId: draft.eventId,
        eventName: draft.eventName,
        resourceId: draft.resourceId,
        startAt: isoFromLocalInput(draft.startAt),
        endAt: isoFromLocalInput(draft.endAt),
        eventColor: draft.eventColor,
        notes: draft.notes,
        reason: draft.reason,
        needsReview: draft.needsReview,
      };
      if (draft.reservation) {
        await mutationFetch(
          `/api/entertainment/reservations/${encodeURIComponent(
            draft.reservation.id,
          )}`,
          "PATCH",
          body,
        );
      } else {
        await mutationFetch(
          "/api/entertainment/reservations",
          "POST",
          body,
        );
      }
      setModal(null);
      await loadDay(selectedDate);
      broadcastEntertainmentUpdate(
        draft.reservation ? "update" : "create",
        selectedDate,
      );
      setNotice("Reservation saved locally in Event Host.");
    } catch (saveError) {
      setState("ready");
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the reservation.",
      );
    }
  }

  async function saveQuickEdit(
    reservation: EntertainmentReservation,
    preview: DragPreview,
  ) {
    setState("saving");
    setError("");
    try {
      await mutationFetch(
        `/api/entertainment/reservations/${encodeURIComponent(
          reservation.id,
        )}`,
        "PATCH",
        {
          operatingDate: selectedDate,
          eventId: reservationEventKey(reservation),
          eventName: reservation.eventName,
          resourceId: preview.resourceId,
          startAt: isoForOperatingMinutes(
            selectedDate,
            preview.startMinute,
          ),
          endAt: isoForOperatingMinutes(
            selectedDate,
            preview.endMinute,
          ),
          eventColor: reservation.eventColor,
          notes: reservation.notes,
          reason: "Schedule drag or resize",
          needsReview: reservation.needsReview,
        },
      );
      setDragPreview(null);
      dragPreviewRef.current = null;
      await loadDay(selectedDate);
      broadcastEntertainmentUpdate("update", selectedDate);
      setNotice("Reservation updated and conflicts recalculated.");
    } catch (saveError) {
      setDragPreview(null);
      dragPreviewRef.current = null;
      setState("ready");
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to move the reservation.",
      );
    }
  }

  async function removeReservation(reason: string) {
    if (!modal?.reservation) {
      return;
    }
    if (!window.confirm("Remove this reservation from the local schedule?")) {
      return;
    }
    setState("saving");
    try {
      const response = await fetch(
        `/api/entertainment/reservations/${encodeURIComponent(
          modal.reservation.id,
        )}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setModal(null);
      await loadDay(selectedDate);
      broadcastEntertainmentUpdate("remove", selectedDate);
      setNotice("Reservation removed from the local schedule.");
    } catch (removeError) {
      setState("ready");
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove the reservation.",
      );
    }
  }

  async function revertReservation(reason: string) {
    if (!modal?.reservation) {
      return;
    }
    setState("saving");
    try {
      await mutationFetch(
        `/api/entertainment/reservations/${encodeURIComponent(
          modal.reservation.id,
        )}/revert`,
        "POST",
        { reason },
      );
      setModal(null);
      await loadDay(selectedDate);
      broadcastEntertainmentUpdate("revert", selectedDate);
      setNotice("The saved Tripleseat value is active again.");
    } catch (revertError) {
      setState("ready");
      setError(
        revertError instanceof Error
          ? revertError.message
          : "Unable to revert the reservation.",
      );
    }
  }

  function beginBlockInteraction(
    event: React.PointerEvent<HTMLElement>,
    reservation: EntertainmentReservation,
    mode: "move" | "resize-start" | "resize-end",
    interactionPixelsPerMinute: number,
  ) {
    if (!isEditing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const originStart =
      operatingMinutesForIso(reservation.startAt, selectedDate) ?? 0;
    const originEnd =
      operatingMinutesForIso(reservation.endAt, selectedDate) ?? 15;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    let current: DragPreview = {
      reservationId: reservation.id,
      startMinute: originStart,
      endMinute: originEnd,
      resourceId: reservation.resourceId,
    };
    dragPreviewRef.current = current;
    setDragPreview(current);

    function handleMove(pointerEvent: PointerEvent) {
      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        moved = true;
      }
      const deltaMinutes = snapOperatingMinutes(
        deltaX / interactionPixelsPerMinute,
      );
      let startMinute = originStart;
      let endMinute = originEnd;
      if (mode === "move") {
        const duration = originEnd - originStart;
        startMinute = clampOperatingMinutes(
          Math.min(
            OPERATING_MINUTES - duration,
            originStart + deltaMinutes,
          ),
        );
        endMinute = startMinute + duration;
      } else if (mode === "resize-start") {
        startMinute = Math.min(
          originEnd - 15,
          clampOperatingMinutes(originStart + deltaMinutes),
        );
      } else {
        endMinute = Math.max(
          originStart + 15,
          clampOperatingMinutes(originEnd + deltaMinutes),
        );
      }
      let resourceId = reservation.resourceId;
      if (mode === "move") {
        const row = document
          .elementsFromPoint(pointerEvent.clientX, pointerEvent.clientY)
          .find(
            (element): element is HTMLElement =>
              element instanceof HTMLElement &&
              Boolean(element.dataset.resourceId),
          );
        const candidate = row?.dataset.resourceId
          ? getEntertainmentResource(row.dataset.resourceId)
          : null;
        if (candidate?.category === reservation.resourceCategory) {
          resourceId = candidate.id;
        }
      }
      current = {
        reservationId: reservation.id,
        startMinute,
        endMinute,
        resourceId,
      };
      dragPreviewRef.current = current;
      setDragPreview(current);
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      if (!moved && mode === "move") {
        setDragPreview(null);
        dragPreviewRef.current = null;
        draftForReservation(reservation);
        return;
      }
      void saveQuickEdit(
        reservation,
        dragPreviewRef.current ?? current,
      );
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  function beginRangeSelection(
    event: React.PointerEvent<HTMLDivElement>,
    resource: EntertainmentResource,
    interactionPixelsPerMinute: number,
  ) {
    if (
      !isEditing ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest(".entertainment-reservation-block")
    ) {
      return;
    }
    const row = event.currentTarget;
    const rect = row.getBoundingClientRect();
    const startMinute = clampOperatingMinutes(
      snapOperatingMinutes(
        (event.clientX - rect.left) / interactionPixelsPerMinute,
      ),
    );
    let currentMinute = startMinute;
    setRangeDraft({
      resourceId: resource.id,
      startMinute,
      endMinute: Math.min(startMinute + 60, OPERATING_MINUTES),
    });

    function handleMove(pointerEvent: PointerEvent) {
      currentMinute = clampOperatingMinutes(
        snapOperatingMinutes(
          (pointerEvent.clientX - rect.left) /
            interactionPixelsPerMinute,
        ),
      );
      const low = Math.min(startMinute, currentMinute);
      const high = Math.max(startMinute, currentMinute);
      setRangeDraft({
        resourceId: resource.id,
        startMinute: low,
        endMinute:
          high - low < 15
            ? Math.min(low + 60, OPERATING_MINUTES)
            : high,
      });
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const low = Math.min(startMinute, currentMinute);
      const high = Math.max(startMinute, currentMinute);
      const end =
        high - low < 15
          ? Math.min(low + 60, OPERATING_MINUTES)
          : high;
      setRangeDraft(null);
      if (end > low) {
        draftForRange(resource.id, low, end);
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

  const eventList = payload?.events ?? [];
  const visibleWarnings = (payload?.warnings ?? []).filter(
    (warning) =>
      warning !==
      "The latest Tripleseat sync failed. The last saved schedule remains visible.",
  );

  function renderScheduleColumn(
    categories: readonly EntertainmentCategory[],
    variant: "main" | "compact",
    columnPixelsPerMinute: number,
    columnTimelineWidth: number,
    columnResourceWidth: number,
    columnGridWidth: number,
  ) {
    const labels = hourLabels();
    const visibleLabels =
      variant === "compact" || columnPixelsPerMinute < 0.62
        ? labels.filter((_, index) => index % 2 === 0)
        : labels;

    return (
      <div
        className={`entertainment-grid-column is-${variant}`}
        data-layout-region={variant}
        style={{
          "--ent-grid-width": `${columnGridWidth}px`,
          "--ent-hour-width": `${60 * columnPixelsPerMinute}px`,
          "--ent-quarter-width": `${15 * columnPixelsPerMinute}px`,
          "--ent-resource-width": `${columnResourceWidth}px`,
          "--ent-timeline-width": `${columnTimelineWidth}px`,
          width: columnGridWidth,
        } as CSSProperties}
      >
        <div className="entertainment-grid-header">
          <div className="entertainment-resource-heading">
            {variant === "main" ? "Physical resource" : "Other activities"}
          </div>
          <div
            className="entertainment-time-heading"
            style={{ width: columnTimelineWidth }}
          >
            {visibleLabels.map((hour) => (
              <span
                className={
                  hour.minute === OPERATING_MINUTES ? "is-end" : ""
                }
                key={hour.label}
                style={{
                  left: hour.minute * columnPixelsPerMinute,
                }}
              >
                {hour.label}
              </span>
            ))}
          </div>
        </div>
        {categories.map((category) => (
          <div
            className={`entertainment-resource-group has-category-border category-${category}`}
            data-category={category}
            data-layout-region={variant}
            key={category}
          >
            <div className="entertainment-group-heading">
              {ENTERTAINMENT_CATEGORY_LABELS[category]}
            </div>
            {resourcesForCategory(category).map((resource) => {
              const layout = reservationsByResource.get(resource.id) ?? {
                placed: [],
                slotCount: 1,
                height: scheduleRowHeight,
              };
              return (
                <div
                  className="entertainment-resource-row"
                  data-resource-id={resource.id}
                  key={resource.id}
                  style={{ minHeight: layout.height }}
                >
                  <div className="entertainment-resource-name">
                    {resource.canonicalName}
                  </div>
                  <div
                    aria-label={`${resource.canonicalName} timeline${
                      isEditing
                        ? ". Drag an empty range to add a reservation."
                        : ". Editing is locked."
                    }`}
                    className={`entertainment-resource-timeline${
                      isEditing ? " is-editable" : ""
                    }`}
                    data-resource-id={resource.id}
                    onPointerDown={
                      isEditing
                        ? (event) =>
                            beginRangeSelection(
                              event,
                              resource,
                              columnPixelsPerMinute,
                            )
                        : undefined
                    }
                    style={{
                      height: layout.height,
                      width: columnTimelineWidth,
                    }}
                  >
                    {nowMinutes != null &&
                    nowMinutes >= 0 &&
                    nowMinutes <= OPERATING_MINUTES ? (
                      <span
                        aria-hidden="true"
                        className="entertainment-now-line"
                        style={{
                          left: nowMinutes * columnPixelsPerMinute,
                        }}
                      />
                    ) : null}
                    {rangeDraft?.resourceId === resource.id ? (
                      <span
                        className="entertainment-range-draft"
                        style={{
                          height: Math.max(
                            12,
                            scheduleRowHeight -
                              (scheduleRowHeight <= 14 ? 2 : 3),
                          ),
                          left:
                            rangeDraft.startMinute *
                            columnPixelsPerMinute,
                          top: scheduleRowHeight <= 14 ? 1 : 2,
                          width:
                            (rangeDraft.endMinute -
                              rangeDraft.startMinute) *
                            columnPixelsPerMinute,
                        }}
                      />
                    ) : null}
                    {layout.placed.map(({ reservation, slot }) => {
                      const startMinute =
                        operatingMinutesForIso(
                          reservation.startAt,
                          selectedDate,
                        ) ?? 0;
                      const endMinute =
                        operatingMinutesForIso(
                          reservation.endAt,
                          selectedDate,
                        ) ?? startMinute + 15;
                      const left =
                        Math.max(0, startMinute) *
                        columnPixelsPerMinute;
                      const width =
                        Math.max(
                          15,
                          Math.min(OPERATING_MINUTES, endMinute) -
                            Math.max(0, startMinute),
                        ) * columnPixelsPerMinute;
                      const hasConflict = conflictReservationIds.has(
                        reservation.id,
                      );
                      const isUnrelated =
                        selectedEvent != null &&
                        reservationEventKey(reservation) !== selectedEvent;
                      return (
                        <button
                          aria-disabled={!isEditing}
                          aria-label={`${reservation.eventName}, ${reservation.resourceName}, ${formatClock(
                            reservation.startAt,
                          )} to ${formatClock(reservation.endAt)}${
                            hasConflict ? ", overlap conflict" : ""
                          }`}
                          className={[
                            "entertainment-reservation-block",
                            reservation.needsReview ? "needs-review" : "",
                            hasConflict ? "has-conflict" : "",
                            isUnrelated ? "is-dimmed" : "",
                            isEditing ? "is-editable" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={reservation.id}
                          onPointerDown={
                            isEditing
                              ? (event) =>
                                  beginBlockInteraction(
                                    event,
                                    reservation,
                                    "move",
                                    columnPixelsPerMinute,
                                  )
                              : undefined
                          }
                          style={{
                            backgroundColor: reservation.eventColor,
                            color: textColorForBackground(
                              reservation.eventColor,
                            ),
                            height: Math.max(
                              12,
                              scheduleRowHeight -
                                (scheduleRowHeight <= 14 ? 2 : 3),
                            ),
                            left,
                            top:
                              slot * scheduleRowHeight +
                              (scheduleRowHeight <= 14 ? 1 : 2),
                            width,
                          }}
                          tabIndex={isEditing ? 0 : -1}
                          title={`${formatClock(
                            reservation.startAt,
                          )} – ${formatClock(reservation.endAt)}\n${
                            reservation.eventName
                          }\n${reservation.resourceName}`}
                          type="button"
                        >
                          {isEditing ? (
                            <span
                              aria-hidden="true"
                              className="entertainment-resize-handle is-left"
                              onPointerDown={(event) =>
                                beginBlockInteraction(
                                  event,
                                  reservation,
                                  "resize-start",
                                  columnPixelsPerMinute,
                                )
                              }
                            />
                          ) : null}
                          <span className="entertainment-block-copy">
                            <strong>
                              {width >= 140
                                ? `${formatClock(reservation.startAt)} – ${formatClock(reservation.endAt)}`
                                : compactTimeRange(
                                    reservation.startAt,
                                    reservation.endAt,
                                  )}
                            </strong>
                            {width >= 210 ? (
                              <span>{reservation.eventName}</span>
                            ) : null}
                          </span>
                          {isEditing ? (
                            <span
                              aria-hidden="true"
                              className="entertainment-resize-handle is-right"
                              onPointerDown={(event) =>
                                beginBlockInteraction(
                                  event,
                                  reservation,
                                  "resize-end",
                                  columnPixelsPerMinute,
                                )
                              }
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <PortalFrame className="entertainment-dashboard-shell">
      <PortalHeader
        actions={
          <PortalZoomControls
            label="Entertainment schedule zoom"
            maximum={ENTERTAINMENT_ZOOM_MAX}
            minimum={ENTERTAINMENT_ZOOM_MIN}
            onChange={setScheduleZoom}
            resetValue={scheduleFitZoom}
            step={ENTERTAINMENT_ZOOM_STEP}
            value={scheduleZoom}
          />
        }
        allowFullscreen
        blocked={Boolean(modal)}
        onLock={() => void lockDashboard()}
        sectionSubtitle="Resource operations"
        sectionTitle="Entertainment Schedule"
      />
      <main className="entertainment-main">
        <h1 className="entertainment-visually-hidden">
          Entertainment Schedule
        </h1>

        <aside className="entertainment-sidebar">
          <section className="entertainment-date-toolbar">
          <div className="entertainment-week-controls">
            <button
              aria-label="Previous week"
              onClick={() =>
                setSelectedDate(addCalendarDays(selectedDate, -7))
              }
              type="button"
            >
              ‹
            </button>
            <button
              onClick={() => setSelectedDate(todayInEntertainmentTimeZone())}
              type="button"
            >
              Today
            </button>
            <button
              aria-label="Next week"
              onClick={() =>
                setSelectedDate(addCalendarDays(selectedDate, 7))
              }
              type="button"
            >
              ›
            </button>
          </div>
          <div
            aria-label="Selected week"
            className="entertainment-day-tabs"
            role="tablist"
          >
            {weekDates.map((date) => {
              const parts = dateTabParts(date);
              return (
                <button
                  aria-label={formatFullDate(date)}
                  aria-selected={selectedDate === date}
                  className={selectedDate === date ? "is-selected" : ""}
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  role="tab"
                  type="button"
                >
                  <span>{parts.day}</span>
                  <strong>{parts.date}</strong>
                </button>
              );
            })}
          </div>
          <div className="entertainment-sync-area">
            <div className="entertainment-sync-status">
              <strong>{syncLabel(payload)}</strong>
              <span>
                {isEditing
                  ? "Editing enabled · changes save as they are made"
                  : payload?.sync?.status === "error"
                  ? "Last saved schedule retained"
                  : "Editing locked"}
              </span>
            </div>
            <div className="entertainment-sync-actions">
              <button
                className="entertainment-primary-button"
                disabled={
                  isEditing || state === "syncing" || state === "saving"
                }
                onClick={() => void syncDay()}
                type="button"
              >
                {state === "syncing"
                  ? "Syncing…"
                  : (
                      <>
                        <span className="entertainment-sync-label-long">
                          ↻ Sync from Tripleseat
                        </span>
                        <span className="entertainment-sync-label-short">
                          ↻ Sync
                        </span>
                      </>
                    )}
              </button>
              <button
                aria-pressed={isEditing}
                className="entertainment-secondary-button entertainment-edit-mode-button"
                disabled={
                  isEditing ||
                  state === "loading" ||
                  state === "syncing" ||
                  state === "saving"
                }
                onClick={() => {
                  setIsEditing(true);
                  setNotice("Editing enabled. Select Save when you are finished.");
                }}
                type="button"
              >
                Edit
              </button>
              <button
                className="entertainment-primary-button entertainment-save-mode-button"
                disabled={!isEditing || state === "saving"}
                onClick={finishEditing}
                type="button"
              >
                {state === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          </section>

          {notice ? (
            <div className="entertainment-status-message" role="status">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="entertainment-error-message" role="alert">
              <strong>Schedule notice</strong>
              <span>{error}</span>
            </div>
          ) : null}
          {visibleWarnings.length ? (
            <div className="entertainment-warning-message">
              {visibleWarnings.join(" ")}
            </div>
          ) : null}
          {payload?.missingEnvironmentVariables.length ? (
            <div className="entertainment-warning-message">
              Server configuration required:{" "}
              {payload.missingEnvironmentVariables.join(", ")}.
            </div>
          ) : null}
        </aside>

        <div className="entertainment-workspace">
          <section
            aria-busy={state === "loading"}
            className={`entertainment-schedule-card ${
              isEditing ? "is-editing" : "is-locked"
            }`}
          >
            {state === "loading" && !payload ? (
              <div className="entertainment-loading-state">
                Loading saved schedule…
              </div>
            ) : state === "error" && !payload ? (
              <div className="entertainment-empty-state">
                <h2>Schedule unavailable</h2>
                <p>{error}</p>
                <button
                  className="entertainment-secondary-button"
                  onClick={() => void retryLoad()}
                  type="button"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div
                className="entertainment-grid-scroll"
                ref={scheduleScrollRef}
              >
                <div
                  className="entertainment-grid entertainment-grid-layout"
                  style={{
                    "--ent-layout-width": `${scheduleGridWidth + compactScheduleGridWidth + ENTERTAINMENT_LAYOUT_GAP}px`,
                    "--ent-main-grid-width": `${scheduleGridWidth}px`,
                    "--ent-compact-grid-width": `${compactScheduleGridWidth}px`,
                  } as CSSProperties}
                >
                  {renderScheduleColumn(
                    MAIN_CATEGORIES,
                    "main",
                    pixelsPerMinute,
                    timelineWidth,
                    RESOURCE_COLUMN_WIDTH,
                    scheduleGridWidth,
                  )}
                  {renderScheduleColumn(
                    COMPACT_CATEGORIES,
                    "compact",
                    compactPixelsPerMinute,
                    compactTimelineWidth,
                    COMPACT_RESOURCE_COLUMN_WIDTH,
                    compactScheduleGridWidth,
                  )}
                </div>
              </div>
            )}
          </section>

          <details className="entertainment-event-panel">
            <summary>
              <span>
                <span className="entertainment-eyebrow">Tripleseat events</span>
                <strong>Events on {formatFullDate(selectedDate)}</strong>
              </span>
              <span className="entertainment-event-panel-summary-meta">
                {payload?.events.length ?? 0} events
                <span aria-hidden="true">⌄</span>
              </span>
            </summary>
            <div className="entertainment-event-panel-body">
            {selectedEvent ? (
              <button
                className="entertainment-clear-filter"
                onClick={() => setSelectedEvent(null)}
                type="button"
              >
                Clear event highlight
              </button>
            ) : null}
            <div className="entertainment-event-list">
              {eventList.length ? (
                eventList.map((event) => {
                  const key = eventKey(event);
                  const eventReservations =
                    payload?.reservations.filter(
                      (reservation) =>
                        reservationEventKey(reservation) === key,
                    ) ?? [];
                  const eventConflictCount =
                    payload?.conflicts.filter((conflict) =>
                      conflict.reservationIds.some((id) =>
                        eventReservations.some(
                          (reservation) => reservation.id === id,
                        ),
                      ),
                    ).length ?? 0;
                  const resources = [
                    ...new Set(
                      eventReservations.map(
                        (reservation) => reservation.resourceName,
                      ),
                    ),
                  ];
                  return (
                    <article
                      className={
                        selectedEvent === key ? "is-selected" : ""
                      }
                      key={event.eventId}
                    >
                      <button
                        className="entertainment-event-chip"
                        onClick={() =>
                          setSelectedEvent((current) =>
                            current === key ? null : key,
                          )
                        }
                        style={{
                          backgroundColor: event.eventColor,
                          color: textColorForBackground(event.eventColor),
                        }}
                        type="button"
                      >
                        {event.eventName}
                      </button>
                      <p>{eventTimes(event)}</p>
                      <dl>
                        <div>
                          <dt>Tripleseat ID</dt>
                          <dd>
                            {event.tripleseatEventId || "Manual event"}
                          </dd>
                        </div>
                        <div>
                          <dt>Resources</dt>
                          <dd>
                            {resources.length
                              ? resources.join(", ")
                              : "No entertainment resources assigned"}
                          </dd>
                        </div>
                      </dl>
                      <div className="entertainment-event-badges">
                        {event.needsReview ? (
                          <span className="is-warning">Needs Review</span>
                        ) : null}
                        {eventConflictCount ? (
                          <span className="is-danger">
                            {eventConflictCount} conflict
                            {eventConflictCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {eventReservations.some(
                          (reservation) => reservation.manualOverride,
                        ) ? (
                          <span>✎ Manual override</span>
                        ) : null}
                      </div>
                      {event.reviewIssues.length ? (
                        <details>
                          <summary>
                            Review details ({event.reviewIssues.length})
                          </summary>
                          <ul>
                            {event.reviewIssues.map((issue, index) => (
                              <li key={`${issue.code}-${index}`}>
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </article>
                  );
                })
              ) : (
                <div className="entertainment-panel-empty">
                  <strong>No events found</strong>
                  <span>
                    Sync from Tripleseat or change the selected date.
                  </span>
                </div>
              )}
            </div>
            </div>
          </details>
        </div>

        <section
          aria-label="Schedule legend"
          className="entertainment-legend"
        >
          <span>
            <i className="legend-solid" /> Confirmed reservation
          </span>
          <span>
            <i className="legend-dashed" /> Auto-assigned / needs review
          </span>
          <span>
            <i className="legend-conflict" /> Overlap conflict
          </span>
          <span>✎ Manual override</span>
          <span>↻ Imported from Tripleseat</span>
        </section>
      </main>

      {modal ? (
        <ReservationModal
          conflicts={payload?.conflicts ?? []}
          draft={modal}
          events={payload?.events ?? []}
          onClose={() => setModal(null)}
          onRemove={(reason) => void removeReservation(reason)}
          onRevert={(reason) => void revertReservation(reason)}
          onSave={(draft) => void saveDraft(draft)}
          saving={state === "saving"}
        />
      ) : null}
    </PortalFrame>
  );
}
