"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  PortalFrame,
  PortalHeader,
} from "@/app/_components/PortalShell";
import {
  AUDIO_ALERT_ERROR,
  ensureAudioContextRunning,
  playAlertTone,
  soundAlertButtonLabel,
  type SoundAlertState,
} from "../../lib/kitchen/alert-sound";
import {
  currentKitchenAddOnAlerts,
  dueKitchenAlerts,
  easternMinuteKey,
  kitchenTimedAlerts,
  newlyObservedDueKitchenAlerts,
  type KitchenDashboardAlert,
  type KitchenLiveAddOnAlert,
  type KitchenTimedAlert,
} from "../../lib/kitchen/alerts";
import { quantityAwareReadinessKey } from "../../lib/kitchen/readiness";
import type {
  KitchenAddOnActivity,
  KitchenAddOnCompletion,
  KitchenCategory,
  KitchenChecklist,
  KitchenChecklistRow,
  KitchenChecklistSection,
  KitchenFoodNoteSource,
  KitchenLiveFoodAddOn,
} from "@/lib/kitchen/types";

type KitchenDayResponse = {
  date: string;
  serverTime: string;
  events: KitchenChecklist[];
  bwaOptions: string[];
  archivedEventCount: number;
  addOnActivity: KitchenAddOnActivity[];
  addOnCompletions: KitchenAddOnCompletion[];
  lastSyncedAt: string | null;
  sourceMode: string;
  syncStatus: "running" | "success" | "error" | "never";
  syncError: string | null;
  warnings: string[];
  missingEnvironmentVariables: string[];
};

type LoadState = "loading" | "ready" | "error";
type SyncState = "idle" | "syncing" | "error";
type BwaSaveState = "idle" | "saving" | "saved" | "error";
type StaffAssignmentDraft = {
  foodRunners: string[];
  pocs: string[];
  preppedBy: string;
  verifiedBy: string;
};
type FoodDescriptionItem = {
  foodName: string;
  description: string;
  quantity: number | null;
  unit: string;
  numberOfPans: number | null;
  panSize: string | null;
};

const DISMISSED_ALERTS_STORAGE_KEY = "ope-kitchen-dismissed-alerts-v1";
const KITCHEN_ZOOM_STORAGE_KEY = "ope-kitchen-dashboard-zoom-v1";
const KITCHEN_ZOOM_MIN = 70;
const KITCHEN_ZOOM_MAX = 130;
const KITCHEN_ZOOM_STEP = 10;
const LIVE_REFRESH_INTERVAL_MS = 3_000;
const ALERT_CHECK_INTERVAL_MS = 10_000;
const EMPTY_READINESS_KEYS: ReadonlySet<string> = new Set();

export {
  ensureAudioContextRunning,
  soundAlertButtonLabel,
} from "../../lib/kitchen/alert-sound";
export type { SoundAlertState } from "../../lib/kitchen/alert-sound";

const categoryOrder: KitchenCategory[] = ["dessert", "taco", "wing", "appetizer", "platters", "sauces"];

const categoryLabels: Record<KitchenCategory, string> = {
  dessert: "Assorted Desserts",
  taco: "Taco Bar",
  wing: "Wing Bar",
  appetizer: "Appetizer Bar",
  platters: "Platters",
  sauces: "Sauce Bowls",
};

const categoryClassNames: Record<KitchenCategory, string> = {
  dessert: "dessert",
  taco: "taco",
  wing: "wing",
  appetizer: "appetizer",
  platters: "platter",
  sauces: "sauce",
};

const foodNoteSourceLabels: Record<KitchenFoodNoteSource, string> = {
  "event-description": "Event description",
  "event-note": "Event note",
  "event-document": "Event contract",
  "booking-note": "Booking note",
  "booking-document": "Booking contract",
};

const SIMPLE_TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AP]M))?$/i;
const LOCAL_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

export function clockParts(value: string) {
  const match = value.match(SIMPLE_TIME_PATTERN) ?? value.match(LOCAL_DATE_TIME_PATTERN);
  if (!match) {
    return null;
  }
  const originalHours = Number(match[1]);
  const minutes = Number(match[2]);
  const suppliedSuffix = match[3]?.toUpperCase();
  if (
    minutes > 59 ||
    (suppliedSuffix
      ? originalHours < 1 || originalHours > 12
      : originalHours > 23)
  ) {
    return null;
  }
  const hours =
    suppliedSuffix === "PM" && originalHours < 12
      ? originalHours + 12
      : suppliedSuffix === "AM" && originalHours === 12
        ? 0
        : originalHours;
  return { hours, minutes };
}

function easternToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateLabel(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function formatTime(value: string | null) {
  if (!value) {
    return "Needs review";
  }

  const clock = clockParts(value);
  if (clock) {
    const suffix = clock.hours >= 12 ? "PM" : "AM";
    const displayHours = clock.hours % 12 || 12;
    return `${displayHours}:${String(clock.minutes).padStart(2, "0")} ${suffix}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(parsed);
  }

  return "Needs review";
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not synced yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(parsed);
}

export function timeSortValue(value: string | null) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const clock = clockParts(value);
  if (clock) {
    return clock.hours * 60 + clock.minutes;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

function sameEventId(left: string | number | null, right: string | number) {
  return left !== null && String(left) === String(right);
}

function formatCount(value: number | null, singular: string, plural = `${singular}s`) {
  if (value === null) {
    return "Needs review";
  }
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatQuantity(
  row: Pick<KitchenChecklistRow | KitchenLiveFoodAddOn, "quantity" | "unit">,
) {
  if (row.quantity === null) {
    return "Needs review";
  }
  const unit =
    row.quantity === 1 && row.unit === "pretzel plates"
      ? "pretzel plate"
      : row.unit;
  return `${row.quantity} ${unit}`.trim();
}

function readinessRequestKey(eventId: string | number, itemKey: string) {
  return `${String(eventId)}::${itemKey}`;
}

export function shouldApplyKitchenDayResponse(
  requestedDate: string,
  requestGeneration: number,
  selectedDate: string,
  currentGeneration: number,
) {
  return (
    requestedDate === selectedDate &&
    requestGeneration === currentGeneration
  );
}

function safeStoredAlertIds() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DISMISSED_ALERTS_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function persistDismissedAlertIds(ids: ReadonlySet<string>) {
  window.localStorage.setItem(
    DISMISSED_ALERTS_STORAGE_KEY,
    JSON.stringify([...ids]),
  );
}

export function clampKitchenZoom(value: number) {
  if (!Number.isFinite(value)) {
    return 100;
  }
  const stepped = Math.round(value / KITCHEN_ZOOM_STEP) * KITCHEN_ZOOM_STEP;
  return Math.min(KITCHEN_ZOOM_MAX, Math.max(KITCHEN_ZOOM_MIN, stepped));
}

export function nextKitchenZoom(current: number, direction: -1 | 1) {
  return clampKitchenZoom(current + direction * KITCHEN_ZOOM_STEP);
}

function safeStoredKitchenZoom() {
  try {
    const stored = window.localStorage.getItem(KITCHEN_ZOOM_STORAGE_KEY);
    return stored === null ? 100 : clampKitchenZoom(Number(stored));
  } catch {
    return 100;
  }
}

function persistKitchenZoom(value: number) {
  try {
    window.localStorage.setItem(KITCHEN_ZOOM_STORAGE_KEY, String(value));
  } catch {
    // The selected zoom still applies for this session if storage is blocked.
  }
}

function sourceModeLabel(mode: string) {
  if (mode.toLowerCase() === "mock") {
    return "Mock data";
  }
  if (mode.toLowerCase() === "live") {
    return "Live Tripleseat";
  }
  return mode || "Unknown source";
}

export default function KitchenDashboard() {
  const [selectedDate, setSelectedDate] = useState(easternToday);
  const [day, setDay] = useState<KitchenDayResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | number | null>(null);
  const [pendingPrintId, setPendingPrintId] = useState<string | number | null>(null);
  const [staffDrafts, setStaffDrafts] = useState<
    Record<string, StaffAssignmentDraft>
  >({});
  const [bwaSaveStates, setBwaSaveStates] = useState<Record<string, BwaSaveState>>({});
  const [readinessPending, setReadinessPending] = useState<Set<string>>(
    () => new Set(),
  );
  const [completionPending, setCompletionPending] = useState<Set<string>>(
    () => new Set(),
  );
  const [preppedPending, setPreppedPending] = useState<Set<string>>(
    () => new Set(),
  );
  const [descriptionItem, setDescriptionItem] =
    useState<FoodDescriptionItem | null>(null);
  const [soundAlertState, setSoundAlertState] =
    useState<SoundAlertState>("waiting");
  const [dashboardZoom, setDashboardZoom] = useState(100);
  const [alertQueue, setAlertQueue] = useState<KitchenTimedAlert[]>([]);
  const [addOnAlertQueue, setAddOnAlertQueue] = useState<
    KitchenLiveAddOnAlert[]
  >([]);
  const [liveRefreshHealthy, setLiveRefreshHealthy] = useState(true);
  const [lastLiveRefreshAt, setLastLiveRefreshAt] = useState<string | null>(
    null,
  );
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundActivationInFlightRef = useRef(false);
  const dismissedAlertIdsRef = useRef<Set<string>>(new Set());
  const knownTimedAlertIdsRef = useRef<Set<string>>(new Set());
  const knownTimedAlertDateRef = useRef<string | null>(null);
  const lastAlertCheckAtRef = useRef<string | null>(null);
  const selectedDateRef = useRef(selectedDate);
  const dayLoadGenerationRef = useRef(0);
  selectedDateRef.current = selectedDate;

  const selectKitchenDate = useCallback((nextDate: string) => {
    if (!nextDate || nextDate === selectedDateRef.current) {
      return;
    }
    selectedDateRef.current = nextDate;
    dayLoadGenerationRef.current += 1;
    setAddOnAlertQueue([]);
    setSelectedDate(nextDate);
    setSyncState("idle");
    setError("");
  }, []);

  const loadDay = useCallback(async (
    date: string,
    signal?: AbortSignal,
    background = false,
  ) => {
    if (date !== selectedDateRef.current) {
      return false;
    }
    const requestGeneration = ++dayLoadGenerationRef.current;
    if (!background) {
      setLoadState("loading");
      setError("");
    }

    try {
      const response = await fetch(`/api/kitchen/day?date=${encodeURIComponent(date)}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as (KitchenDayResponse & { error?: string }) | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Unable to load the kitchen day.");
      }
      if (
        !shouldApplyKitchenDayResponse(
          date,
          requestGeneration,
          selectedDateRef.current,
          dayLoadGenerationRef.current,
        )
      ) {
        return false;
      }

      const nextAddOnAlerts = currentKitchenAddOnAlerts(
        payload.addOnActivity ?? [],
        dismissedAlertIdsRef.current,
      );
      setAddOnAlertQueue((current) => {
        const applicableIds = new Set(
          nextAddOnAlerts.map((alert) => alert.id),
        );
        const stillApplicable = current.filter((alert) =>
          applicableIds.has(alert.id),
        );
        const queuedIds = new Set(
          stillApplicable.map((alert) => alert.id),
        );
        const additions = nextAddOnAlerts.filter(
          (alert) => !queuedIds.has(alert.id),
        );
        return additions.length
          ? [...stillApplicable, ...additions]
          : stillApplicable;
      });
      setDay(payload);
      setLiveRefreshHealthy(true);
      setLastLiveRefreshAt(new Date().toISOString());
      setStaffDrafts((current) =>
        Object.fromEntries(
          payload.events.map((checklist) => {
            const eventKey = String(checklist.event.eventId);
            return [
              eventKey,
              background && Object.hasOwn(current, eventKey)
                ? current[eventKey]
                : {
                    foodRunners: checklist.foodRunners ?? (
                      checklist.foodRunnerOrBwa
                        ? [checklist.foodRunnerOrBwa]
                        : []
                    ),
                    pocs: checklist.pocs ?? [],
                    preppedBy: checklist.preppedBy ?? "",
                    verifiedBy: checklist.verifiedBy ?? "",
                  },
            ];
          }),
        ),
      );
      if (!background) {
        setBwaSaveStates({});
      }
      setSelectedEventId((current) => {
        if (current !== null && payload.events.some((checklist) => sameEventId(current, checklist.event.eventId))) {
          return current;
        }
        return null;
      });
      setLoadState("ready");
      return true;
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") {
        return false;
      }
      if (
        !shouldApplyKitchenDayResponse(
          date,
          requestGeneration,
          selectedDateRef.current,
          dayLoadGenerationRef.current,
        )
      ) {
        return false;
      }
      if (background) {
        setLiveRefreshHealthy(false);
        return false;
      }
      setLoadState("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load the kitchen day.");
      return false;
    }
  }, []);

  useEffect(() => {
    setDashboardZoom(safeStoredKitchenZoom());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDay(selectedDate, controller.signal);
    return () => controller.abort();
  }, [loadDay, selectedDate]);

  useEffect(() => {
    if (loadState !== "ready") {
      return;
    }

    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState !== "visible") {
        return;
      }
      refreshing = true;
      try {
        await loadDay(selectedDate, undefined, true);
      } finally {
        refreshing = false;
      }
    };
    const interval = window.setInterval(
      () => void refresh(),
      LIVE_REFRESH_INTERVAL_MS,
    );
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    window.addEventListener("focus", refreshOnVisible);
    window.addEventListener("online", refreshOnVisible);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnVisible);
      window.removeEventListener("online", refreshOnVisible);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [loadDay, loadState, selectedDate]);

  const sortedEvents = useMemo(
    () =>
      [...(day?.events ?? [])].sort(
        (left, right) =>
          timeSortValue(left.timing.startTime ?? left.event.startTime) -
            timeSortValue(right.timing.startTime ?? right.event.startTime) ||
          left.event.name.localeCompare(right.event.name),
      ),
    [day?.events],
  );

  const selectedChecklist =
    sortedEvents.find((checklist) => sameEventId(selectedEventId, checklist.event.eventId)) ?? null;
  const warningCount = sortedEvents.reduce((sum, checklist) => sum + checklist.warnings.length, 0);
  const reviewCount = sortedEvents.filter((checklist) => checklist.needsReview).length;
  const timedAlerts = useMemo(
    () => kitchenTimedAlerts(sortedEvents, selectedDate),
    [selectedDate, sortedEvents],
  );
  const timedAlertsRef = useRef(timedAlerts);
  timedAlertsRef.current = timedAlerts;
  const activeAlert =
    addOnAlertQueue[0] ?? alertQueue[0] ?? null;
  const activeAlertId = activeAlert?.id ?? null;

  useEffect(() => {
    if (pendingPrintId === null || !sameEventId(selectedEventId, pendingPrintId)) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      window.print();
      setPendingPrintId(null);
      setSelectedEventId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingPrintId, selectedEventId]);

  useEffect(() => {
    dismissedAlertIdsRef.current = safeStoredAlertIds();
  }, []);

  useEffect(() => {
    let active = true;
    const removeActivationListeners = () => {
      window.removeEventListener("pointerdown", activateFromInteraction, true);
      window.removeEventListener("keydown", activateFromInteraction, true);
    };
    const activate = async (reportFailure: boolean) => {
      const enabled = await enableSoundAlerts(reportFailure);
      if (active && enabled) {
        removeActivationListeners();
      }
    };
    function activateFromInteraction() {
      void activate(true);
    }

    window.addEventListener("pointerdown", activateFromInteraction, true);
    window.addEventListener("keydown", activateFromInteraction, true);
    void activate(false);

    return () => {
      active = false;
      removeActivationListeners();
    };
  }, []);

  useEffect(() => {

    const scanForAlerts = () => {
      const currentMinute = easternMinuteKey(new Date());
      const lastCheckedAt = lastAlertCheckAtRef.current ?? currentMinute;
      const selectedDateChanged =
        knownTimedAlertDateRef.current !== selectedDate;
      const newlyOverdue = selectedDateChanged
        ? []
        : newlyObservedDueKitchenAlerts(
            timedAlerts,
            knownTimedAlertIdsRef.current,
            currentMinute,
            dismissedAlertIdsRef.current,
          );
      knownTimedAlertDateRef.current = selectedDate;
      for (const alert of timedAlerts) {
        knownTimedAlertIdsRef.current.add(alert.id);
      }
      const due = dueKitchenAlerts(
        timedAlerts,
        lastCheckedAt,
        currentMinute,
        dismissedAlertIdsRef.current,
      );
      const dueThisMinute = timedAlerts.filter(
        (alert) =>
          alert.scheduledAt === currentMinute &&
          !dismissedAlertIdsRef.current.has(alert.id),
      );
      setAlertQueue((current) => {
        const currentAlertIds = new Set(
          timedAlerts.map((alert) => alert.id),
        );
        const stillApplicable = current.filter(
          (alert) => currentAlertIds.has(alert.id),
        );
        const existingIds = new Set(
          stillApplicable.map((alert) => alert.id),
        );
        const additions = [
          ...newlyOverdue,
          ...due,
          ...dueThisMinute,
        ].filter(
          (alert, index, candidates) =>
            !existingIds.has(alert.id) &&
            candidates.findIndex((candidate) => candidate.id === alert.id) ===
              index,
        );
        return additions.length
          ? [...stillApplicable, ...additions]
          : stillApplicable;
      });
      lastAlertCheckAtRef.current = currentMinute;
    };

    scanForAlerts();
    const interval = window.setInterval(
      scanForAlerts,
      ALERT_CHECK_INTERVAL_MS,
    );
    const scanWhenVisible = () => {
      if (document.visibilityState === "visible") {
        scanForAlerts();
      }
    };
    window.addEventListener("focus", scanWhenVisible);
    document.addEventListener("visibilitychange", scanWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", scanWhenVisible);
      document.removeEventListener("visibilitychange", scanWhenVisible);
    };
  }, [selectedDate, timedAlerts]);

  useEffect(() => {
    const context = audioContextRef.current;
    if (
      soundAlertState !== "on" ||
      activeAlertId === null ||
      context === null
    ) {
      return;
    }

    let active = true;
    const play = async () => {
      try {
        await playAlertTone(context);
      } catch {
        if (active) {
          setSoundAlertState("error");
          setError(AUDIO_ALERT_ERROR);
        }
      }
    };
    void play();
    const interval = window.setInterval(
      () => void play(),
      2_500,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [activeAlertId, soundAlertState]);

  const closeChecklist = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  function printChecklist(eventId: string | number) {
    setSelectedEventId(eventId);
    setPendingPrintId(eventId);
  }

  async function enableSoundAlerts(reportFailure = true) {
    if (audioContextRef.current?.state === "running") {
      setSoundAlertState("on");
      return true;
    }
    if (soundActivationInFlightRef.current) {
      return false;
    }
    soundActivationInFlightRef.current = true;
    setSoundAlertState("enabling");
    setError((current) =>
      current === AUDIO_ALERT_ERROR ? "" : current,
    );
    try {
      const context =
        audioContextRef.current?.state === "closed"
          ? new window.AudioContext()
          : (audioContextRef.current ?? new window.AudioContext());
      audioContextRef.current = context;
      await ensureAudioContextRunning(context);
      lastAlertCheckAtRef.current = easternMinuteKey(new Date());
      knownTimedAlertDateRef.current = selectedDateRef.current;
      knownTimedAlertIdsRef.current = new Set(
        timedAlertsRef.current.map((alert) => alert.id),
      );
      setSoundAlertState("on");
      return true;
    } catch {
      if (reportFailure) {
        setSoundAlertState("error");
        setError(AUDIO_ALERT_ERROR);
      } else {
        setSoundAlertState("waiting");
      }
      return false;
    } finally {
      soundActivationInFlightRef.current = false;
    }
  }

  function dismissActiveAlert() {
    if (!activeAlert) {
      return;
    }
    dismissedAlertIdsRef.current.add(activeAlert.id);
    try {
      persistDismissedAlertIds(dismissedAlertIdsRef.current);
    } catch {
      // The alert remains dismissed for this page even if storage is blocked.
    }
    if (activeAlert.kind === "add-on") {
      setAddOnAlertQueue((current) =>
        current.filter((alert) => alert.id !== activeAlert.id),
      );
    } else {
      setAlertQueue((current) =>
        current.filter((alert) => alert.id !== activeAlert.id),
      );
    }
  }

  async function syncDay() {
    const syncDate = selectedDateRef.current;
    setSyncState("syncing");
    setError("");
    try {
      const response = await fetch("/api/kitchen/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ date: syncDate }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to sync this kitchen day.");
      }
      if (selectedDateRef.current !== syncDate) {
        return;
      }
      await loadDay(syncDate);
      if (selectedDateRef.current !== syncDate) {
        return;
      }
      setSyncState("idle");
    } catch (syncError) {
      if (selectedDateRef.current !== syncDate) {
        return;
      }
      const message =
        syncError instanceof Error
          ? syncError.message
          : "Unable to sync this kitchen day.";
      await loadDay(syncDate);
      if (selectedDateRef.current !== syncDate) {
        return;
      }
      setSyncState("error");
      setError(message);
    }
  }

  async function saveStaffAssignments(checklist: KitchenChecklist) {
    const eventKey = String(checklist.event.eventId);
    const assignments = staffDrafts[eventKey] ?? {
      foodRunners: [],
      pocs: [],
      preppedBy: "",
      verifiedBy: "",
    };
    setBwaSaveStates((current) => ({ ...current, [eventKey]: "saving" }));

    try {
      const response = await fetch(`/api/kitchen/events/${encodeURIComponent(eventKey)}/manual`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(assignments),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save staff assignments.");
      }
      setDay((current) =>
        current
          ? {
              ...current,
              events: current.events.map((eventChecklist) =>
                sameEventId(eventChecklist.event.eventId, checklist.event.eventId)
                  ? {
                      ...eventChecklist,
                      foodRunnerOrBwa: assignments.foodRunners.join(", "),
                      foodRunners: assignments.foodRunners,
                      pocs: assignments.pocs,
                      preppedBy: assignments.preppedBy,
                      verifiedBy: assignments.verifiedBy,
                    }
                  : eventChecklist,
              ),
            }
          : current,
      );
      setBwaSaveStates((current) => ({ ...current, [eventKey]: "saved" }));
    } catch {
      setBwaSaveStates((current) => ({ ...current, [eventKey]: "error" }));
    }
  }

  async function saveItemReadiness(
    checklist: KitchenChecklist,
    itemKey: string,
    ready: boolean,
  ) {
    const eventId = String(checklist.event.eventId);
    const requestKey = readinessRequestKey(eventId, itemKey);
    const wasReady = (checklist.completedItemKeys ?? []).includes(itemKey);
    const updateLocalState = (nextReady: boolean) => {
      setDay((current) =>
        current
          ? {
              ...current,
              events: current.events.map((eventChecklist) => {
                if (!sameEventId(eventChecklist.event.eventId, eventId)) {
                  return eventChecklist;
                }
                const completed = new Set(
                  eventChecklist.completedItemKeys ?? [],
                );
                if (nextReady) {
                  completed.add(itemKey);
                } else {
                  completed.delete(itemKey);
                }
                return {
                  ...eventChecklist,
                  completedItemKeys: [...completed].sort(),
                };
              }),
            }
          : current,
      );
    };

    updateLocalState(ready);
    setReadinessPending((current) => new Set(current).add(requestKey));
    try {
      const response = await fetch(
        `/api/kitchen/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemKey)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ ready }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error || "Unable to save item readiness.",
        );
      }
    } catch {
      updateLocalState(wasReady);
      setError(
        `Could not save the Ready checkbox for ${checklist.event.name}. Try again.`,
      );
    } finally {
      setReadinessPending((current) => {
        const next = new Set(current);
        next.delete(requestKey);
        return next;
      });
    }
  }

  async function saveItemCompletion(
    checklist: KitchenChecklist,
    itemKey: string,
    completed: boolean,
  ) {
    const eventId = String(checklist.event.eventId);
    const requestKey = readinessRequestKey(eventId, itemKey);
    const wasCompleted = (
      checklist.finalCompletedItemKeys ?? []
    ).includes(itemKey);
    const updateLocalState = (nextCompleted: boolean) => {
      setDay((current) =>
        current
          ? {
              ...current,
              events: current.events.map((eventChecklist) => {
                if (!sameEventId(eventChecklist.event.eventId, eventId)) {
                  return eventChecklist;
                }
                const finalCompleted = new Set(
                  eventChecklist.finalCompletedItemKeys ?? [],
                );
                if (nextCompleted) {
                  finalCompleted.add(itemKey);
                } else {
                  finalCompleted.delete(itemKey);
                }
                return {
                  ...eventChecklist,
                  finalCompletedItemKeys: [...finalCompleted].sort(),
                };
              }),
            }
          : current,
      );
    };

    updateLocalState(completed);
    setCompletionPending((current) =>
      new Set(current).add(requestKey),
    );
    try {
      const response = await fetch(
        `/api/kitchen/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemKey)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ completed }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error || "Unable to save item completion.",
        );
      }
    } catch {
      updateLocalState(wasCompleted);
      setError(
        `Could not save the Verified checkbox for ${checklist.event.name}. Try again.`,
      );
    } finally {
      setCompletionPending((current) => {
        const next = new Set(current);
        next.delete(requestKey);
        return next;
      });
    }
  }

  async function saveItemPrepped(
    checklist: KitchenChecklist,
    itemKey: string,
    prepped: boolean,
  ) {
    const eventId = String(checklist.event.eventId);
    const requestKey = readinessRequestKey(eventId, itemKey);
    const wasPrepped = (checklist.preppedItemKeys ?? []).includes(itemKey);
    const updateLocalState = (nextPrepped: boolean) => {
      setDay((current) =>
        current
          ? {
              ...current,
              events: current.events.map((eventChecklist) => {
                if (!sameEventId(eventChecklist.event.eventId, eventId)) {
                  return eventChecklist;
                }
                const preppedKeys = new Set(
                  eventChecklist.preppedItemKeys ?? [],
                );
                if (nextPrepped) preppedKeys.add(itemKey);
                else preppedKeys.delete(itemKey);
                return {
                  ...eventChecklist,
                  preppedItemKeys: [...preppedKeys].sort(),
                };
              }),
            }
          : current,
      );
    };

    updateLocalState(prepped);
    setPreppedPending((current) => new Set(current).add(requestKey));
    try {
      const response = await fetch(
        `/api/kitchen/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemKey)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prepped }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save item preparation.");
      }
    } catch {
      updateLocalState(wasPrepped);
      setError(
        `Could not save the Prepped checkbox for ${checklist.event.name}. Try again.`,
      );
    } finally {
      setPreppedPending((current) => {
        const next = new Set(current);
        next.delete(requestKey);
        return next;
      });
    }
  }

  async function lockDashboard() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  function changeDashboardZoom(direction: -1 | 1) {
    setDashboardZoom((current) => {
      const next = nextKitchenZoom(current, direction);
      persistKitchenZoom(next);
      return next;
    });
  }

  function resetDashboardZoom() {
    setDashboardZoom(100);
    persistKitchenZoom(100);
  }

  const hasBlockingOverlay =
    selectedChecklist !== null ||
    descriptionItem !== null ||
    activeAlert !== null;
  const tripleseatReconnectRequired = [day?.syncError, error].some(
    (message) => message?.includes("Reconnect Tripleseat"),
  );

  return (
    <PortalFrame
      className={`kitchen-dashboard-shell${selectedChecklist ? " kitchen-dashboard-shell-focus" : ""}`}
    >
      <PortalHeader
        actions={
          <>
            <div
              aria-label="Dashboard zoom"
              className="kitchen-zoom-controls"
              role="group"
            >
              <button
                aria-label="Zoom out"
                className="kitchen-zoom-button"
                disabled={dashboardZoom === KITCHEN_ZOOM_MIN}
                onClick={() => changeDashboardZoom(-1)}
                type="button"
              >
                −
              </button>
              <button
                aria-label={`Reset dashboard zoom from ${dashboardZoom}% to 100%`}
                className="kitchen-zoom-value"
                disabled={dashboardZoom === 100}
                onClick={resetDashboardZoom}
                type="button"
              >
                {dashboardZoom}%
              </button>
              <button
                aria-label="Zoom in"
                className="kitchen-zoom-button"
                disabled={dashboardZoom === KITCHEN_ZOOM_MAX}
                onClick={() => changeDashboardZoom(1)}
                type="button"
              >
                +
              </button>
            </div>
            <button
              className="portal-header-button kitchen-sound-button"
              disabled={
                soundAlertState === "on" ||
                soundAlertState === "enabling"
              }
              onClick={() => void enableSoundAlerts(true)}
              type="button"
            >
              {soundAlertButtonLabel(soundAlertState)}
            </button>
          </>
        }
        allowFullscreen
        blocked={hasBlockingOverlay}
        onLock={() => void lockDashboard()}
        sectionSubtitle="Prep dashboard"
        sectionTitle="Event Kitchen"
      />

      <main
        aria-hidden={hasBlockingOverlay ? true : undefined}
        className="kitchen-dashboard-main"
        inert={hasBlockingOverlay ? true : undefined}
        style={
          {
            "--kitchen-dashboard-zoom": dashboardZoom / 100,
            "--kitchen-dashboard-zoom-height": `calc(${10000 / dashboardZoom}dvh - ${8200 / dashboardZoom}px)`,
            "--kitchen-dashboard-zoom-max-width": `${192000 / dashboardZoom}px`,
            "--kitchen-dashboard-zoom-width": `${10000 / dashboardZoom}%`,
          } as CSSProperties
        }
      >
        <section className="kitchen-dashboard-intro">
          <div>
            <span className="kitchen-eyebrow">Daily production view</span>
            <h1>{dateLabel(selectedDate)}</h1>
            <p>Definite events and their generated kitchen prep requirements.</p>
          </div>
          <div className="kitchen-day-summary" aria-live="polite">
            <span className="kitchen-summary-chip">{formatCount(sortedEvents.length, "event")}</span>
            <span className="kitchen-summary-chip">{formatCount(warningCount, "warning")}</span>
            {reviewCount ? (
              <span className="kitchen-summary-chip kitchen-summary-chip-review">
                {formatCount(reviewCount, "Needs Review event", "Needs Review events")}
              </span>
            ) : null}
          </div>
        </section>

        <section className="kitchen-day-toolbar" aria-label="Kitchen day controls">
          <div className="kitchen-date-controls">
            <button
              aria-label="Previous day"
              className="kitchen-icon-button"
              onClick={() => selectKitchenDate(shiftDate(selectedDate, -1))}
              type="button"
            >
              ←
            </button>
            <label className="kitchen-visually-hidden" htmlFor="kitchen-date">
              Selected kitchen date
            </label>
            <input
              className="kitchen-date-input"
              id="kitchen-date"
              onChange={(event) => {
                if (event.target.value) {
                  selectKitchenDate(event.target.value);
                }
              }}
              type="date"
              value={selectedDate}
            />
            <button
              aria-label="Next day"
              className="kitchen-icon-button"
              onClick={() => selectKitchenDate(shiftDate(selectedDate, 1))}
              type="button"
            >
              →
            </button>
            <button className="kitchen-secondary-button kitchen-today-button" onClick={() => selectKitchenDate(easternToday())} type="button">
              Today
            </button>
          </div>

          <div className="kitchen-sync-controls">
            <div className="kitchen-sync-copy" aria-live="polite">
              <strong>Last synced: {formatTimestamp(day?.lastSyncedAt ?? null)}</strong>
              <span className="kitchen-source-note">{sourceModeLabel(day?.sourceMode ?? "")}</span>
            </div>
            <button
              className="kitchen-primary-button"
              disabled={syncState === "syncing"}
              onClick={() => void syncDay()}
              type="button"
            >
              {syncState === "syncing" ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </section>

        {day?.missingEnvironmentVariables.length ? (
          <section className="kitchen-alert" role="status">
            <span className="kitchen-alert-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>Live kitchen data is not fully configured</strong>
              <p>
                Missing environment variables: {day.missingEnvironmentVariables.join(", ")}.
                Local mock mode remains available; database-backed mock sync is blocked to protect real event data.
              </p>
            </div>
          </section>
        ) : null}

        {day?.syncError ? (
          <section className="kitchen-alert" role="alert">
            <span className="kitchen-alert-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>Latest Tripleseat sync failed</strong>
              <p>{day.syncError} Stored checklists are marked Needs Review until a successful sync.</p>
            </div>
          </section>
        ) : null}

        {!liveRefreshHealthy ? (
          <section className="kitchen-alert" role="alert">
            <span className="kitchen-alert-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>Live add-on updates are temporarily paused</strong>
              <p>
                The dashboard is retrying automatically. Last successful
                refresh: {formatTimestamp(lastLiveRefreshAt)}.
              </p>
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="kitchen-alert" role="alert">
            <span className="kitchen-alert-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>{syncState === "error" ? "Sync failed" : "Kitchen data unavailable"}</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        {tripleseatReconnectRequired ? (
          <section className="kitchen-reconnect-panel" aria-label="Tripleseat reconnection required">
            <div>
              <strong>Tripleseat authorization expired</strong>
              <span>Reconnect once, then use Sync now again for the selected date.</span>
            </div>
            <a className="kitchen-primary-button kitchen-reconnect-link" href="/api/kitchen/oauth/start">
              Reconnect Tripleseat
            </a>
          </section>
        ) : null}

        {loadState === "loading" ? (
          <StateCard icon="…" title="Loading kitchen events" message="Building the selected day’s prep checklists." />
        ) : null}

        {loadState === "error" ? (
          <StateCard
            action={<button className="kitchen-primary-button" onClick={() => void loadDay(selectedDate)} type="button">Try again</button>}
            icon="!"
            message="The day could not be loaded. Try again or choose another date."
            title="Kitchen data unavailable"
          />
        ) : null}

        {loadState === "ready" && sortedEvents.length === 0 ? (
          <StateCard
            icon="✓"
            message={
              day?.archivedEventCount
                ? "All scheduled kitchen events for this date have ended and were archived."
                : "No definite Tripleseat events are scheduled for this date."
            }
            title={
              day?.archivedEventCount
                ? "Events archived"
                : "No kitchen events"
            }
          />
        ) : null}

        {loadState === "ready" && sortedEvents.length ? (
          <section
            className="kitchen-event-grid kitchen-event-checklist-grid kitchen-event-accordion-list"
            aria-label="Definite event kitchen checklists"
          >
            {sortedEvents.map((checklist) => {
              const eventKey = String(checklist.event.eventId);
              return (
                <KitchenEventAccordion
                  checklist={checklist}
                  key={eventKey}
                >
                  <KitchenChecklistSheet
                    staffDraft={
                      staffDrafts[eventKey] ?? {
                        foodRunners: [],
                        pocs: [],
                        preppedBy: "",
                        verifiedBy: "",
                      }
                    }
                    bwaOptions={day?.bwaOptions ?? []}
                    bwaSaveState={bwaSaveStates[eventKey] ?? "idle"}
                    checklist={checklist}
                    completionPending={completionPending}
                    hideEventIdentity
                    inline
                    onStaffChange={(value) => {
                      setStaffDrafts((current) => ({ ...current, [eventKey]: value }));
                      setBwaSaveStates((current) => ({ ...current, [eventKey]: "idle" }));
                    }}
                    onOpenDescription={setDescriptionItem}
                    onPrint={() => printChecklist(checklist.event.eventId)}
                    onCompletedChange={(itemKey, completed) =>
                      void saveItemCompletion(
                        checklist,
                        itemKey,
                        completed,
                      )
                    }
                    onReadyChange={(itemKey, ready) =>
                      void saveItemReadiness(checklist, itemKey, ready)
                    }
                    onPreppedChange={(itemKey, prepped) =>
                      void saveItemPrepped(checklist, itemKey, prepped)
                    }
                    preppedPending={preppedPending}
                    onSaveStaff={() => void saveStaffAssignments(checklist)}
                    readinessPending={readinessPending}
                  />
                </KitchenEventAccordion>
              );
            })}
          </section>
        ) : null}
      </main>

      {selectedChecklist && !activeAlert ? (
        <ChecklistPanel
          staffDraft={
            staffDrafts[String(selectedChecklist.event.eventId)] ?? {
              foodRunners: [],
              pocs: [],
              preppedBy: "",
              verifiedBy: "",
            }
          }
          bwaOptions={day?.bwaOptions ?? []}
          bwaSaveState={bwaSaveStates[String(selectedChecklist.event.eventId)] ?? "idle"}
          checklist={selectedChecklist}
          completionPending={completionPending}
          onStaffChange={(value) => {
            const eventKey = String(selectedChecklist.event.eventId);
            setStaffDrafts((current) => ({ ...current, [eventKey]: value }));
            setBwaSaveStates((current) => ({ ...current, [eventKey]: "idle" }));
          }}
          onClose={closeChecklist}
          onCompletedChange={(itemKey, completed) =>
            void saveItemCompletion(
              selectedChecklist,
              itemKey,
              completed,
            )
          }
          onOpenDescription={setDescriptionItem}
          onPrint={() => printChecklist(selectedChecklist.event.eventId)}
          onReadyChange={(itemKey, ready) =>
            void saveItemReadiness(selectedChecklist, itemKey, ready)
          }
          onPreppedChange={(itemKey, prepped) =>
            void saveItemPrepped(selectedChecklist, itemKey, prepped)
          }
          preppedPending={preppedPending}
          onSaveStaff={() => void saveStaffAssignments(selectedChecklist)}
          readinessPending={readinessPending}
        />
      ) : null}

      {descriptionItem && !activeAlert ? (
        <FoodDescriptionDialog
          item={descriptionItem}
          onClose={() => setDescriptionItem(null)}
        />
      ) : null}

      {activeAlert ? (
        <KitchenAlertDialog
          alert={activeAlert}
          onEnableSound={() => void enableSoundAlerts(true)}
          onDismiss={dismissActiveAlert}
          soundAlertState={soundAlertState}
        />
      ) : null}
    </PortalFrame>
  );
}

function StateCard({
  action,
  icon,
  message,
  title,
}: {
  action?: React.ReactNode;
  icon: string;
  message: string;
  title: string;
}) {
  return (
    <section className="kitchen-state-card" aria-live="polite">
      <div>
        <span className="kitchen-state-icon" aria-hidden="true">
          {icon}
        </span>
        <h2>{title}</h2>
        <p>{message}</p>
        {action}
      </div>
    </section>
  );
}

function ChecklistPanel({
  staffDraft,
  bwaOptions,
  bwaSaveState,
  checklist,
  completionPending,
  onStaffChange,
  onClose,
  onCompletedChange,
  onOpenDescription,
  onPrint,
  onPreppedChange,
  onReadyChange,
  onSaveStaff,
  readinessPending,
  preppedPending,
}: {
  staffDraft: StaffAssignmentDraft;
  bwaOptions: readonly string[];
  bwaSaveState: BwaSaveState;
  checklist: KitchenChecklist;
  completionPending?: ReadonlySet<string>;
  onStaffChange: (value: StaffAssignmentDraft) => void;
  onClose: () => void;
  onCompletedChange?: (itemKey: string, completed: boolean) => void;
  onOpenDescription: (item: FoodDescriptionItem) => void;
  onPrint: () => void;
  onPreppedChange?: (itemKey: string, prepped: boolean) => void;
  onReadyChange: (itemKey: string, ready: boolean) => void;
  onSaveStaff: () => void;
  readinessPending: ReadonlySet<string>;
  preppedPending?: ReadonlySet<string>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <section
      aria-labelledby="kitchen-focus-view-title"
      aria-modal="true"
      className="kitchen-checklist-wrap"
      id="kitchen-selected-checklist"
      role="dialog"
    >
      <div className="kitchen-checklist-toolbar">
        <h2 id="kitchen-focus-view-title">Kitchen event view</h2>
        <div className="kitchen-checklist-toolbar-actions">
          <button
            className="kitchen-secondary-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            Close checklist
          </button>
          <button className="kitchen-primary-button" onClick={onPrint} type="button">
            Print this event
          </button>
        </div>
      </div>

      <KitchenChecklistSheet
        staffDraft={staffDraft}
        bwaOptions={bwaOptions}
        bwaSaveState={bwaSaveState}
        checklist={checklist}
        completionPending={completionPending}
        onStaffChange={onStaffChange}
        onCompletedChange={onCompletedChange}
        onOpenDescription={onOpenDescription}
        onPreppedChange={onPreppedChange}
        onReadyChange={onReadyChange}
        onSaveStaff={onSaveStaff}
        readinessPending={readinessPending}
        preppedPending={preppedPending}
      />
    </section>
  );
}

export function KitchenEventAccordion({
  checklist,
  children,
}: {
  checklist: KitchenChecklist;
  children?: ReactNode;
}) {
  const startTime = formatTime(
    checklist.timing.startTime ?? checklist.event.startTime,
  );
  const eventTime = checklist.event.endTime
    ? `${startTime}–${formatTime(checklist.event.endTime)}`
    : startTime;

  return (
    <details
      className="kitchen-event-accordion"
      data-kitchen-event-accordion={String(checklist.event.eventId)}
    >
      <summary className="kitchen-event-accordion-summary">
        <strong>{checklist.event.name}</strong>
        <span>{eventTime}</span>
      </summary>
      <div className="kitchen-event-accordion-content">{children}</div>
    </details>
  );
}

function StaffMultiSelect({
  label,
  onChange,
  options,
  selected,
}: {
  label: string;
  onChange: (values: string[]) => void;
  options: readonly string[];
  selected: readonly string[];
}) {
  const selectedSet = new Set(selected);
  return (
    <details className="kitchen-staff-select">
      <summary>
        <span>{label}</span>
        <strong>{selected.length ? selected.join(", ") : "Select employees"}</strong>
      </summary>
      <fieldset>
        <legend>{label}</legend>
        {options.map((option) => (
          <label key={option}>
            <input
              checked={selectedSet.has(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, option]
                    : selected.filter((value) => value !== option),
                )
              }
              type="checkbox"
            />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function KitchenChecklistSheet({
  staffDraft = { foodRunners: [], pocs: [], preppedBy: "", verifiedBy: "" },
  bwaDraft: _legacyBwaDraft,
  bwaOptions = [],
  bwaSaveState,
  checklist,
  completionPending = EMPTY_READINESS_KEYS,
  hideEventIdentity = false,
  inline = false,
  onStaffChange = () => {},
  onBwaChange: _legacyOnBwaChange,
  onCompletedChange,
  onOpenDescription,
  onPrint,
  onPreppedChange,
  onReadyChange,
  onSaveStaff = () => {},
  onSaveBwa: _legacyOnSaveBwa,
  readinessPending = EMPTY_READINESS_KEYS,
  preppedPending = EMPTY_READINESS_KEYS,
}: {
  staffDraft?: StaffAssignmentDraft;
  bwaDraft?: string;
  bwaOptions?: readonly string[];
  bwaSaveState: BwaSaveState;
  checklist: KitchenChecklist;
  completionPending?: ReadonlySet<string>;
  hideEventIdentity?: boolean;
  inline?: boolean;
  onStaffChange?: (value: StaffAssignmentDraft) => void;
  onBwaChange?: (value: string) => void;
  onCompletedChange?: (itemKey: string, completed: boolean) => void;
  onOpenDescription?: (item: FoodDescriptionItem) => void;
  onPrint?: () => void;
  onPreppedChange?: (itemKey: string, prepped: boolean) => void;
  onReadyChange?: (itemKey: string, ready: boolean) => void;
  onSaveStaff?: () => void;
  onSaveBwa?: () => void;
  readinessPending?: ReadonlySet<string>;
  preppedPending?: ReadonlySet<string>;
}) {
  const visibleSections = [...checklist.sections]
    .filter((section) => section.rows.length > 0)
    .sort((left, right) => categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category));
  const reviewMessages = [
    ...new Set([
      ...checklist.warnings.map((warning) => warning.message),
      ...checklist.referenceConflicts.map((conflict) => `${conflict.title}: ${conflict.currentResolution}`),
    ]),
  ];
  const bwaChanged =
    JSON.stringify(staffDraft.foodRunners) !==
      JSON.stringify(checklist.foodRunners ?? []) ||
    JSON.stringify(staffDraft.pocs) !== JSON.stringify(checklist.pocs ?? []);
  const availableBwaOptions = [
    ...new Set(
      [...bwaOptions]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
  const completedItemKeys = new Set(checklist.completedItemKeys ?? []);
  const preppedItemKeys = new Set(checklist.preppedItemKeys ?? []);
  const finalCompletedItemKeys = new Set(
    checklist.finalCompletedItemKeys ?? [],
  );
  const liveFoodAddOns = checklist.liveFoodAddOns ?? [];
  const eventId = checklist.event.eventId;
  const isCompletionPending = (itemKey: string) =>
    completionPending.has(readinessRequestKey(eventId, itemKey));
  const isReadinessPending = (itemKey: string) =>
    readinessPending.has(readinessRequestKey(eventId, itemKey));
  const isPreppedPending = (itemKey: string) =>
    preppedPending.has(readinessRequestKey(eventId, itemKey));

  return (
    <article
      aria-label={`${checklist.event.name} kitchen checklist`}
      className={`kitchen-checklist${inline ? " kitchen-checklist-inline" : ""}`}
      data-kitchen-event-id={String(checklist.event.eventId)}
    >
      <header
        className={`kitchen-checklist-heading${hideEventIdentity ? " kitchen-checklist-heading-accordion" : ""}`}
        data-kitchen-checklist-header
      >
        {!hideEventIdentity ? (
          <div className="kitchen-checklist-event-name">
            <span>Event name</span>
            <div className="kitchen-event-name-line">
              <h2>{checklist.event.name}</h2>
              {checklist.needsReview ? (
                <strong className="kitchen-needs-review-badge">
                  Needs review
                </strong>
              ) : null}
            </div>
            <p>
              {formatTime(checklist.timing.startTime ?? checklist.event.startTime)}
              {checklist.event.endTime ? `–${formatTime(checklist.event.endTime)}` : ""}
              {" · "}
              {checklist.event.room || "Room or area not listed"}
              {checklist.selectedCategories.length
                ? ` · ${checklist.selectedCategories
                    .map((category) => categoryLabels[category])
                    .join(", ")}`
                : ""}
            </p>
          </div>
        ) : null}
        <div className="kitchen-checklist-header-fact">
          <span>Number of guests</span>
          <strong>{checklist.event.guestCount ?? "Needs review"}</strong>
        </div>
        <div className="kitchen-checklist-header-fact">
          <span>Chafing dishes</span>
          <strong>{checklist.chafingDishes.total ?? "—"}</strong>
        </div>
        <div className="kitchen-checklist-brand-actions">
          <Image
            alt="On Par Entertainment"
            className="kitchen-print-logo"
            height={235}
            src="/brand/on-par-logo-black-on-white.jpg"
            width={432}
          />
          {inline && onPrint ? (
            <button
              aria-label={`Print checklist for ${checklist.event.name}`}
              className="kitchen-card-button kitchen-card-button-secondary"
              onClick={onPrint}
              type="button"
            >
              Print
            </button>
          ) : null}
        </div>
      </header>

      <div className="kitchen-checklist-schedule">
        <div className="kitchen-checklist-bwa">
          <div className="kitchen-bwa-field">
            <StaffMultiSelect
              label="Food Runner"
              onChange={(foodRunners) =>
                onStaffChange({ ...staffDraft, foodRunners })
              }
              options={availableBwaOptions}
              selected={staffDraft.foodRunners}
            />
            <StaffMultiSelect
              label="POC"
              onChange={(pocs) => onStaffChange({ ...staffDraft, pocs })}
              options={availableBwaOptions}
              selected={staffDraft.pocs}
            />
            <button
              className="kitchen-primary-button kitchen-bwa-save"
              disabled={!bwaChanged || bwaSaveState === "saving"}
              onClick={onSaveStaff}
              type="button"
            >
              {bwaSaveState === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
          <span className="kitchen-bwa-status" role="status">
            {bwaSaveState === "saved"
              ? "Staff assignments saved separately from Tripleseat."
              : bwaSaveState === "error"
                ? "Save failed. Try again."
                : bwaChanged
                  ? "Unsaved staff changes"
                  : ""}
          </span>
        </div>
        <ChecklistFact
          label="Start time"
          tone="start"
          value={formatTime(checklist.timing.startTime ?? checklist.event.startTime)}
        />
        <ChecklistFact
          label="Earliest prep time"
          tone="prep"
          value={formatTime(checklist.timing.earliestPrepTime)}
        />
        <ChecklistFact
          label="Food ready by"
          tone="prep"
          value={formatTime(checklist.timing.foodReadyBy)}
        />
      </div>

      <div className="kitchen-table-scroll">
        <table className="kitchen-checklist-table">
          <thead>
            <tr>
              <th scope="col">Ready</th>
              <th scope="col">
                <span className="kitchen-verified-heading">Prepped</span>
                <select
                  aria-label="Employee responsible for prep"
                  className="kitchen-column-staff-select"
                  onChange={(event) =>
                    onStaffChange({
                      ...staffDraft,
                      preppedBy: event.target.value,
                    })
                  }
                  value={staffDraft.preppedBy}
                >
                  <option value="">Employee</option>
                  {availableBwaOptions.map((employee) => (
                    <option key={employee} value={employee}>
                      {employee}
                    </option>
                  ))}
                </select>
              </th>
              <th scope="col">Food Name</th>
              <th scope="col">Number of Pans</th>
              <th scope="col">Pan Size</th>
              <th scope="col">Quantity</th>
              <th scope="col">
                <span className="kitchen-verified-heading">Verified</span>
                <small className="kitchen-verified-subheading">
                  Different person
                </small>
                <select
                  aria-label="Employee responsible for verification"
                  className="kitchen-column-staff-select"
                  onChange={(event) =>
                    onStaffChange({
                      ...staffDraft,
                      verifiedBy: event.target.value,
                    })
                  }
                  value={staffDraft.verifiedBy}
                >
                  <option value="">Employee</option>
                  {availableBwaOptions.map((employee) => (
                    <option key={employee} value={employee}>
                      {employee}
                    </option>
                  ))}
                </select>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleSections.map((section) => (
              <ChecklistSection
                completedItemKeys={completedItemKeys}
                preppedItemKeys={preppedItemKeys}
                finalCompletedItemKeys={finalCompletedItemKeys}
                isCompletionPending={isCompletionPending}
                isReadinessPending={isReadinessPending}
                isPreppedPending={isPreppedPending}
                key={section.category}
                onCompletedChange={onCompletedChange}
                onOpenDescription={onOpenDescription}
                onReadyChange={onReadyChange}
                onPreppedChange={onPreppedChange}
                ruleVersion={checklist.ruleVersion}
                section={section}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="kitchen-review-area" data-kitchen-review-area>
        <section
          aria-live="polite"
          className="kitchen-review-panel kitchen-addon-panel"
        >
          <div className="kitchen-panel-heading">
            <h3>Live food add-ons</h3>
            <span>Updates automatically</span>
          </div>
          {liveFoodAddOns.length ? (
            <div className="kitchen-addon-list">
              {liveFoodAddOns.map((item) => {
                const readinessKey = quantityAwareReadinessKey({
                  ...item,
                  ruleVersion: checklist.ruleVersion,
                });
                const isReady = completedItemKeys.has(readinessKey);
                const isPrepped = preppedItemKeys.has(readinessKey);
                const isCompleted =
                  finalCompletedItemKeys.has(readinessKey);
                return (
                  <div
                    className={`kitchen-addon-item${isReady ? " kitchen-item-complete" : ""}`}
                    key={item.itemKey}
                  >
                    <label className="kitchen-ready-control">
                      <input
                        aria-label={`Mark add-on ${item.foodName} ready`}
                        checked={isReady}
                        disabled={
                          !onReadyChange ||
                          isReadinessPending(readinessKey)
                        }
                        onChange={(event) =>
                          onReadyChange?.(
                            readinessKey,
                            event.target.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>Ready</span>
                    </label>
                    <label className="kitchen-ready-control">
                      <input
                        aria-label={`Mark add-on ${item.foodName} prepped`}
                        checked={isPrepped}
                        disabled={
                          !onPreppedChange ||
                          isPreppedPending(readinessKey)
                        }
                        onChange={(event) =>
                          onPreppedChange?.(
                            readinessKey,
                            event.target.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>Prepped</span>
                    </label>
                    <button
                      aria-haspopup="dialog"
                      className="kitchen-food-button"
                      onClick={() =>
                        onOpenDescription?.({
                          foodName: item.foodName,
                          description: item.description,
                          quantity: item.quantity,
                          unit: item.unit,
                          numberOfPans: item.numberOfPans,
                          panSize: item.panSize,
                        })
                      }
                      type="button"
                    >
                      {item.foodName}
                    </button>
                    <span className="kitchen-addon-quantity">
                      {formatQuantity(item)}
                      {item.numberOfPans === null
                        ? ""
                        : ` · ${item.numberOfPans} × ${item.panSize} pans`}
                    </span>
                    <label className="kitchen-completed-control">
                      <input
                        aria-label={`Mark add-on ${item.foodName} verified by a different person`}
                        checked={isCompleted}
                        disabled={
                          !onCompletedChange ||
                          isCompletionPending(readinessKey)
                        }
                        onChange={(event) =>
                          onCompletedChange?.(
                            readinessKey,
                            event.target.checked,
                          )
                        }
                        type="checkbox"
                      />
                      <span>Verified (different person)</span>
                    </label>
                  </div>
                );
              })}
            </div>
          ) : (
            <p>No food add-ons have been entered for this event.</p>
          )}
        </section>
        <section className="kitchen-review-panel">
          <h3>Food contract notes</h3>
          {(checklist.event.foodNotes ?? []).length ? (
            <ul>
              {(checklist.event.foodNotes ?? []).map((note, index) => (
                <li key={`${note.source}-${note.sourceId ?? index}-${index}`}>
                  <strong>{foodNoteSourceLabels[note.source]}:</strong>{" "}
                  {note.text}
                </li>
              ))}
            </ul>
          ) : (
            <p>No food notes found in the contract Special Instructions section.</p>
          )}
        </section>
        <details
          className={`kitchen-review-panel kitchen-safety-details${reviewMessages.length > 0 && checklist.needsReview ? " kitchen-review-panel-warning" : ""}`}
          open={!inline && checklist.needsReview}
        >
          <summary>
            {reviewMessages.length
              ? `Needs review: ${reviewMessages[0]}${
                  reviewMessages.length > 1
                    ? ` (+${reviewMessages.length - 1} more)`
                    : ""
                }`
              : "Safety and calculation review (0)"}
          </summary>
          {reviewMessages.length ? (
            <ul>
              {reviewMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : (
            <p>No calculation warnings.</p>
          )}
        </details>
      </div>
    </article>
  );
}

function ChecklistFact({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "start" | "prep";
  value: string;
}) {
  return (
    <div className={`kitchen-checklist-fact kitchen-checklist-fact-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChecklistSection({
  completedItemKeys,
  preppedItemKeys,
  finalCompletedItemKeys,
  isCompletionPending,
  isReadinessPending,
  isPreppedPending,
  onCompletedChange,
  onOpenDescription,
  onReadyChange,
  onPreppedChange,
  ruleVersion,
  section,
}: {
  completedItemKeys: ReadonlySet<string>;
  preppedItemKeys: ReadonlySet<string>;
  finalCompletedItemKeys: ReadonlySet<string>;
  isCompletionPending: (itemKey: string) => boolean;
  isReadinessPending: (itemKey: string) => boolean;
  isPreppedPending: (itemKey: string) => boolean;
  onCompletedChange?: (itemKey: string, completed: boolean) => void;
  onOpenDescription?: (item: FoodDescriptionItem) => void;
  onReadyChange?: (itemKey: string, ready: boolean) => void;
  onPreppedChange?: (itemKey: string, prepped: boolean) => void;
  ruleVersion: string;
  section: KitchenChecklistSection;
}) {
  const categoryClassName = categoryClassNames[section.category];
  return (
    <>
      <tr className={`kitchen-category-heading kitchen-category-${categoryClassName}`}>
        <th colSpan={7} scope="colgroup">
          {section.label || categoryLabels[section.category]}
        </th>
      </tr>
      {section.rows.map((row) => {
        const readinessKey = quantityAwareReadinessKey({
          itemKey: row.key,
          quantity: row.quantity,
          numberOfPans: row.numberOfPans,
          panSize: row.panSize,
          unit: row.unit,
          ruleVersion,
        });
        const isReady = completedItemKeys.has(readinessKey);
        const isPrepped = preppedItemKeys.has(readinessKey);
        const isCompleted = finalCompletedItemKeys.has(readinessKey);
        return (
          <tr
            className={`kitchen-category-${categoryClassName}${isReady ? " kitchen-item-complete" : ""}`}
            key={row.key}
          >
            <td className="kitchen-ready-cell" data-label="Ready">
              <label className="kitchen-ready-control">
                <input
                  aria-label={`Mark ${row.foodName} ready`}
                  checked={isReady}
                  disabled={
                    !onReadyChange || isReadinessPending(readinessKey)
                  }
                  onChange={(event) =>
                    onReadyChange?.(readinessKey, event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="kitchen-visually-hidden">Ready</span>
              </label>
            </td>
            <td className="kitchen-ready-cell" data-label="Prepped">
              <label className="kitchen-ready-control">
                <input
                  aria-label={`Mark ${row.foodName} prepped`}
                  checked={isPrepped}
                  disabled={
                    !onPreppedChange || isPreppedPending(readinessKey)
                  }
                  onChange={(event) =>
                    onPreppedChange?.(readinessKey, event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="kitchen-visually-hidden">Prepped</span>
              </label>
            </td>
            <td data-label="Food name">
              <button
                aria-haspopup="dialog"
                className="kitchen-food-button"
                onClick={() =>
                  onOpenDescription?.({
                    foodName: row.foodName,
                    description:
                      row.description ||
                      "No additional food description is available.",
                    quantity: row.quantity,
                    unit: row.unit,
                    numberOfPans: row.numberOfPans,
                    panSize: row.panSize,
                  })
                }
                type="button"
              >
                {row.foodName}
              </button>
            </td>
            <td data-label="Number of pans">{row.numberOfPans ?? "—"}</td>
            <td data-label="Pan size">{row.panSize ?? "—"}</td>
            <td data-label="Quantity">{formatQuantity(row)}</td>
            <td
              className="kitchen-completed-cell"
              data-label="Verified (different person)"
            >
              <label className="kitchen-completed-control">
                <input
                  aria-label={`Mark ${row.foodName} verified by a different person`}
                  checked={isCompleted}
                  disabled={
                    !onCompletedChange ||
                    isCompletionPending(readinessKey)
                  }
                  onChange={(event) =>
                    onCompletedChange?.(
                      readinessKey,
                      event.target.checked,
                    )
                  }
                  type="checkbox"
                />
                <span className="kitchen-visually-hidden">
                  Verified by a different person
                </span>
              </label>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function FoodDescriptionDialog({
  item,
  onClose,
}: {
  item: FoodDescriptionItem;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="kitchen-modal-backdrop kitchen-description-backdrop">
      <section
        aria-labelledby="kitchen-food-description-title"
        aria-modal="true"
        className="kitchen-modal-card kitchen-description-dialog"
        role="dialog"
      >
        <span className="kitchen-eyebrow">Food item details</span>
        <h2 id="kitchen-food-description-title">{item.foodName}</h2>
        <p>{item.description}</p>
        <dl>
          <div>
            <dt>Quantity</dt>
            <dd>{formatQuantity(item)}</dd>
          </div>
          <div>
            <dt>Pan setup</dt>
            <dd>
              {item.numberOfPans === null
                ? "No pan setup listed"
                : `${item.numberOfPans} × ${item.panSize} pans`}
            </dd>
          </div>
        </dl>
        <button
          className="kitchen-primary-button"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          Close
        </button>
      </section>
    </div>
  );
}

function KitchenAlertDialog({
  alert,
  onEnableSound,
  onDismiss,
  soundAlertState,
}: {
  alert: KitchenDashboardAlert;
  onEnableSound: () => void;
  onDismiss: () => void;
  soundAlertState: SoundAlertState;
}) {
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    dismissButtonRef.current?.focus();
  }, [alert.id]);

  return (
    <div className="kitchen-modal-backdrop kitchen-alert-backdrop">
      <section
        aria-describedby="kitchen-alert-description"
        aria-labelledby="kitchen-timed-alert-title"
        aria-modal="true"
        className="kitchen-modal-card kitchen-timed-alert-dialog"
        role="alertdialog"
      >
        <span className="kitchen-alert-bell" aria-hidden="true">
          !
        </span>
        <span className="kitchen-eyebrow">
          {alert.kind === "add-on"
            ? "New kitchen order"
            : "Kitchen timed alert"}
        </span>
        <h2 id="kitchen-timed-alert-title">
          {alert.kind === "add-on"
            ? "New or updated food add-on"
            : alert.kind === "prep"
              ? "Start prepping now"
              : "Food should be ready"}
        </h2>
        <strong>{alert.eventName}</strong>
        <p id="kitchen-alert-description">
          {alert.kind === "add-on"
            ? `Current add-on order: ${alert.itemNames.join(", ")}.`
            : `Scheduled for ${formatTime(alert.scheduledAt)}`}
        </p>
        {soundAlertState === "error" ? (
          <p role="status">{AUDIO_ALERT_ERROR}</p>
        ) : null}
        <div className="kitchen-alert-dialog-actions">
          {soundAlertState !== "on" ? (
            <button
              className="kitchen-secondary-button"
              disabled={soundAlertState === "enabling"}
              onClick={onEnableSound}
              type="button"
            >
              {soundAlertButtonLabel(soundAlertState)}
            </button>
          ) : null}
          <button
            className="kitchen-alert-dismiss"
            onClick={onDismiss}
            ref={dismissButtonRef}
            type="button"
          >
            Dismiss alert
          </button>
        </div>
      </section>
    </div>
  );
}
