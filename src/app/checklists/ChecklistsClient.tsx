"use client";

import {
  Fragment,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import type { ChecklistEvent } from "@/lib/checklist-events";
import { checklistReadiness } from "@/lib/checklist-readiness";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { EventWorkspaceRequests } from "@/app/_components/EventWorkspace";
import { operationalEventFromPlan, operationalEventHref } from "@/lib/operations/event-context";
import { contractSetup, reconcileChecklistSetup, setupTaskFingerprint } from "@/lib/operations/setup";
import { eventFoodDeliveryState, type EventFoodDelivery } from "@/lib/gotab/delivery";
import {
  checklistSections,
  completeChecklistTask,
  checklistEventForSelection,
  appetizerBarRefillAddOns,
  currency,
  defaultChecklistState,
  entertainmentAddOns,
  entertainmentUnitPrice,
  foodAddOns,
  foodUnitPrice,
  numeric,
  recordToChecklistState,
  standardFoodAddOns,
  tacoBarRefillAddOns,
  wingBarRefillAddOns,
  type ChecklistRecord,
  type ChecklistRecordStatus,
  type EventChecklistState,
} from "@/lib/checklist-model";

type EventChecklistMeta = {
  status: ChecklistRecordStatus;
  updatedAt: string | null;
  submittedAt: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error" | "submitting" | "submitted";
type KitchenSyncState = "idle" | "syncing" | "pending" | "live" | "error";
type FoodSubmitState = "idle" | "submitting" | "pending" | "sent" | "error" | "uncertain";
type PendingFoodDelivery = { eventId: number; kitchenEventId: string; requestIds: string[] };
type AddOnTab =
  | "food"
  | "refills"
  | "entertainment";
type ChecklistWorkspace = "checklist" | "addons";

type ChecklistSaveResponse = {
  record: ChecklistRecord;
  error?: string;
  kitchenSync?: {
    status: "live" | "pending" | "error" | "not-required";
    eventId?: string;
    requestIds?: string[];
    exceptions?: number;
    updatedAt?: string | null;
    error?: string;
    deliveries?: EventFoodDelivery[];
  };
};

function buildInitialChecklistMap(events: readonly ChecklistEvent[]) {
  return Object.fromEntries(events.map((event) => [event.id, defaultChecklistState(event.date)]));
}

function buildInitialMetaMap(events: readonly ChecklistEvent[]) {
  return Object.fromEntries(
    events.map((event) => [
      event.id,
      {
        status: "draft" as ChecklistRecordStatus,
        updatedAt: null,
        submittedAt: null,
      },
    ]),
  );
}

function buildInitialSaveStateMap(events: readonly ChecklistEvent[]) {
  return Object.fromEntries(events.map((event) => [event.id, "idle" as SaveState]));
}

function buildInitialKitchenSyncMap(events: readonly ChecklistEvent[]) {
  return Object.fromEntries(
    events.map((event) => [
      event.id,
      "idle" as KitchenSyncState,
    ]),
  );
}

function buildInitialRevisionMap(events: readonly ChecklistEvent[]) {
  return Object.fromEntries(events.map((event) => [event.id, 0]));
}

function uniqueIds(values: number[]) {
  return Array.from(new Set(values));
}

function foodSubmissionLocked(state: FoodSubmitState | undefined) {
  return state === "submitting" || state === "pending" || state === "uncertain";
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function metaFromRecord(record: ChecklistRecord): EventChecklistMeta {
  return {
    status: record.status,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
  };
}

function mergeRecordState(record: ChecklistRecord, event: ChecklistEvent) {
  return reconcileChecklistSetup(event, recordToChecklistState(event.date, record));
}

export default function ChecklistsClient({
  activeEventIds,
  events,
  workspace = "checklist",
  sourceWarning = "",
}: {
  activeEventIds: number[];
  events: ChecklistEvent[];
  workspace?: ChecklistWorkspace;
  sourceWarning?: string;
}) {
  const { preferredEventId, ready: contextReady, selectEvent, clearEvent, staffName } = useEventContext();
  const eligibleEvents = useMemo(
    () =>
      activeEventIds
        .map((eventId) =>
          events.find((event) => event.id === eventId),
        )
        .filter((event) => event !== undefined),
    [activeEventIds, events],
  );
  const [activeEventId, setActiveEventId] = useState<number>(eligibleEvents[0]?.id ?? 0);
  const [activeAddOnTab, setActiveAddOnTab] = useState<AddOnTab>("food");
  const [refillBar, setRefillBar] = useState<"Taco Bar" | "Wing Bar" | "Appetizer Bar">("Taco Bar");
  const [refillItemKey, setRefillItemKey] = useState("");
  const [checklistsByEvent, setChecklistsByEvent] = useState<Record<number, EventChecklistState>>(
    () => buildInitialChecklistMap(events),
  );
  const [metaByEvent, setMetaByEvent] = useState<Record<number, EventChecklistMeta>>(
    () => buildInitialMetaMap(events),
  );
  const [saveStateByEvent, setSaveStateByEvent] = useState<Record<number, SaveState>>(
    () => buildInitialSaveStateMap(events),
  );
  const [kitchenSyncByEvent, setKitchenSyncByEvent] =
    useState<Record<number, KitchenSyncState>>(
      () => buildInitialKitchenSyncMap(events),
    );
  const [kitchenSyncErrorByEvent, setKitchenSyncErrorByEvent] =
    useState<Record<number, string>>({});
  const [dirtyEventIds, setDirtyEventIds] = useState<number[]>([]);
  const [dirtyFoodEventIds, setDirtyFoodEventIds] = useState<number[]>([]);
  const [foodSubmitByItem, setFoodSubmitByItem] = useState<Record<string, FoodSubmitState>>({});
  const [deliveryByEvent, setDeliveryByEvent] = useState<Record<number, EventFoodDelivery[]>>({});
  const [pendingFoodByItem, setPendingFoodByItem] = useState<Record<string, PendingFoodDelivery>>({});
  function rememberDelivery(eventId: number, items?: EventFoodDelivery[]) {
    if (!items) return;
    setDeliveryByEvent((current) => ({ ...current, [eventId]: [
      ...(current[eventId] ?? []).filter((prior) => !items.some((item) => item.requestId === prior.requestId)), ...items,
    ] }));
  }
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [saveErrorByEvent, setSaveErrorByEvent] = useState<Record<number, string>>({});
  const [conflictByEvent, setConflictByEvent] = useState<Record<number, boolean>>({});
  const [warningConfirmationByEvent, setWarningConfirmationByEvent] = useState<Record<number, { sourceFingerprint: string; employeeName: string }>>({});
  const inFlightEventIds = useRef(new Set<number>());
  const finalSubmissionEventIds = useRef(new Set<number>());
  const metaByEventRef = useRef(metaByEvent);
  metaByEventRef.current = metaByEvent;
  const revisionByEventRef = useRef<Record<number, number>>(
    buildInitialRevisionMap(events),
  );
  const isAddOnWorkspace = workspace === "addons";
  const sectionTitle = isAddOnWorkspace ? "Event Add-Ons" : "Event Checklists";
  const pageTitle = isAddOnWorkspace ? "Event Add-Ons" : "Digital Event Checklists";
  const pageDescription = isAddOnWorkspace
    ? "Manage Food and Entertainment add-ons in their own shared event workspace."
    : "Complete event tasks with drafts saved automatically to the shared event record.";

  useEffect(() => {
    function receiveWorkspaceUpdate(event: Event) {
      const record = (event as CustomEvent<{ record?: ChecklistRecord }>).detail?.record;
      if (!record) return;
      const plan = events.find((item) => item.id === record.eventId);
      if (!plan || metaByEventRef.current[record.eventId]?.updatedAt === record.updatedAt) return;
      if (dirtyEventIds.includes(record.eventId) || inFlightEventIds.current.has(record.eventId)) {
        setConflictByEvent((current) => ({ ...current, [record.eventId]: true }));
        return;
      }
      setChecklistsByEvent((current) => ({ ...current, [record.eventId]: mergeRecordState(record, plan) }));
      metaByEventRef.current[record.eventId] = metaFromRecord(record);
      setMetaByEvent((current) => ({ ...current, [record.eventId]: metaFromRecord(record) }));
      setSaveStateByEvent((current) => ({ ...current, [record.eventId]: record.status === "submitted" ? "submitted" : "saved" }));
    }
    window.addEventListener("event-host:workspace-updated", receiveWorkspaceUpdate);
    return () => window.removeEventListener("event-host:workspace-updated", receiveWorkspaceUpdate);
  }, [events, dirtyEventIds]);

  useEffect(() => {
    const pending = Object.entries(pendingFoodByItem);
    if (!pending.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const settled: string[] = [];
      await Promise.all(pending.map(async ([itemKey, item]) => {
        try {
          const query = new URLSearchParams({ requestIds: item.requestIds.join(",") });
          const response = await fetch(`/api/kitchen/events/${encodeURIComponent(item.kitchenEventId)}/food-delivery?${query}`, { cache: "no-store" });
          const payload = await response.json() as { status?: "live" | "pending" | "error"; deliveries?: EventFoodDelivery[]; error?: string };
          if (cancelled) return;
          if (!response.ok) throw new Error("Delivery status is temporarily unavailable. This order is still being checked; do not submit it again.");
          rememberDelivery(item.eventId, payload.deliveries);
          if (payload.status === "pending") return;
          const accepted = payload.status === "live";
          const uncertain = !accepted && (payload.deliveries?.length !== item.requestIds.length || payload.deliveries?.some((delivery) => ["HELD", "SENDING", "UNKNOWN"].includes(delivery.status)));
          setFoodSubmitByItem((current) => ({ ...current, [itemKey]: accepted ? "sent" : uncertain ? "uncertain" : "error" }));
          setKitchenSyncByEvent((current) => ({ ...current, [item.eventId]: accepted ? "live" : "error" }));
          setKitchenSyncErrorByEvent((current) => ({ ...current, [item.eventId]: accepted ? "" : payload.error ?? "Food acceptance could not be confirmed. Check the saved order before submitting again." }));
          settled.push(itemKey);
        } catch (error) {
          if (cancelled) return;
          setKitchenSyncErrorByEvent((current) => ({ ...current, [item.eventId]: error instanceof Error ? error.message : "Delivery status is temporarily unavailable. Do not submit this order again." }));
          // Polling is read-only: a failed status check must never resend food.
        }
      }));
      if (!cancelled) setPendingFoodByItem((current) => {
        const next = { ...current };
        for (const itemKey of settled) delete next[itemKey];
        return next;
      });
    }, 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pendingFoodByItem]);

  useEffect(() => {
    let isCancelled = false;

    async function loadSavedChecklists() {
      try {
        const response = await fetch("/api/checklists", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Unable to load saved checklists.");
        }

        const payload = (await response.json()) as { records?: ChecklistRecord[] };
        const recordsById = new Map((payload.records ?? []).map((record) => [record.eventId, record]));
        if (isCancelled) {
          return;
        }

        setChecklistsByEvent((current) =>
          Object.fromEntries(
            events.map((event) => {
              const record = recordsById.get(event.id);
              if ((revisionByEventRef.current[event.id] ?? 0) > 0 || inFlightEventIds.current.has(event.id)) return [event.id, current[event.id] ?? defaultChecklistState(event.date)];
              return [event.id, record ? mergeRecordState(record, event) : current[event.id] ?? defaultChecklistState(event.date)];
            }),
          ),
        );
        setMetaByEvent((current) => {
          const next = { ...current };
          for (const event of events) {
            if ((revisionByEventRef.current[event.id] ?? 0) > 0 || inFlightEventIds.current.has(event.id)) continue;
            const record = recordsById.get(event.id);
            if (record) {
              next[event.id] = metaFromRecord(record);
            }
          }
          return next;
        });
        setSaveStateByEvent((current) => {
          const next = { ...current };
          for (const event of events) {
            if ((revisionByEventRef.current[event.id] ?? 0) > 0 || inFlightEventIds.current.has(event.id)) continue;
            const record = recordsById.get(event.id);
            next[event.id] = record?.status === "submitted" ? "submitted" : "idle";
          }
          return next;
        });
        setLoadState("ready");
      } catch {
        if (!isCancelled) {
          setLoadState("error");
        }
      }
    }

    void loadSavedChecklists();

    return () => {
      isCancelled = true;
    };
  }, [events]);

  const visibleEvents = useMemo(
    () =>
      eligibleEvents.filter(
        (event) => metaByEvent[event.id]?.status !== "submitted",
      ),
    [eligibleEvents, metaByEvent],
  );

  useEffect(() => {
    if (!contextReady || !preferredEventId) return;
    const requested = checklistEventForSelection(visibleEvents, preferredEventId, 0);
    if (requested) setActiveEventId(requested.id);
  }, [contextReady, preferredEventId, visibleEvents]);

  useEffect(() => {
    if (!visibleEvents.length) {
      if (activeEventId !== 0) {
        setActiveEventId(0);
      }
      return;
    }

    if (!visibleEvents.some((event) => event.id === activeEventId)) {
      setActiveEventId(visibleEvents[0].id);
    }
  }, [activeEventId, visibleEvents]);

  const saveDrafts = useEffectEvent(async (eventIds: number[], options?: { syncFoodAddOns: false }) => {
    const savedEventIds = new Set<number>();
    const availableIds = eventIds.filter((eventId) => !conflictByEvent[eventId] && !inFlightEventIds.current.has(eventId) &&
      metaByEvent[eventId]?.status !== "submitted" && events.some((event) => event.id === eventId) && checklistsByEvent[eventId]);
    const revisionSnapshot = Object.fromEntries(eventIds.map((eventId) => [eventId, revisionByEventRef.current[eventId] ?? 0]));

    setSaveStateByEvent((current) => {
      const next = { ...current };
      for (const eventId of availableIds) {
        next[eventId] = "saving";
      }
      return next;
    });

    for (const eventId of availableIds) {
      const event = events.find((item) => item.id === eventId);
      const checklist = checklistsByEvent[eventId];
      const syncFoodAddOns = options?.syncFoodAddOns === false ? false : dirtyFoodEventIds.includes(eventId);

      if (!event || !checklist || metaByEvent[eventId]?.status === "submitted") {
        continue;
      }
      if (conflictByEvent[eventId] || inFlightEventIds.current.has(eventId)) continue;
      inFlightEventIds.current.add(eventId);

      try {
        if (syncFoodAddOns) {
          setKitchenSyncByEvent((current) => ({
            ...current,
            [eventId]: "syncing",
          }));
          setKitchenSyncErrorByEvent((current) => ({
            ...current,
            [eventId]: "",
          }));
        }
        const response = await fetch("/api/checklists", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            eventId,
            sourceEventId: event.source_event_id ?? String(event.id),
            eventDate: event.date,
            expectedUpdatedAt: metaByEventRef.current[eventId]?.updatedAt ?? null,
            checklist,
            syncFoodAddOns,
            ...((staffName.trim() || checklist.bwa.trim()) ? { requesterName: staffName.trim() || checklist.bwa.trim() } : {}),
          }),
        });

        const payload = (await response.json()) as ChecklistSaveResponse;
        rememberDelivery(eventId, payload.kitchenSync?.deliveries);
        if (!response.ok) {
          if (response.status === 409) setConflictByEvent((current) => ({ ...current, [eventId]: true }));
          throw new Error(payload.error ?? "Unable to save draft. Your draft is retained on this screen.");
        }
        if (!payload.record || payload.record.eventId !== eventId || payload.record.eventDate !== event.date ||
          payload.record.status !== "draft" || !payload.record.updatedAt || !Number.isFinite(Date.parse(payload.record.updatedAt))) {
          throw new Error("The saved draft could not be verified for this event. Your entries remain on this screen; do not leave until the save is confirmed.");
        }
        const revisionIsCurrent =
          (revisionByEventRef.current[eventId] ?? 0) ===
          revisionSnapshot[eventId];
        window.dispatchEvent(new Event("event-host:checklist-updated"));

        if (revisionIsCurrent) {
          savedEventIds.add(eventId);
          setChecklistsByEvent((current) => ({
            ...current,
            [eventId]: mergeRecordState(payload.record, event),
          }));
        }
        metaByEventRef.current[eventId] = metaFromRecord(payload.record);
        setMetaByEvent((current) => ({
          ...current,
          [eventId]: metaFromRecord(payload.record),
        }));
        if (revisionIsCurrent) {
          setSaveStateByEvent((current) => ({
            ...current,
            [eventId]:
              payload.record.status === "submitted" ? "submitted" : "saved",
          }));
          setDirtyEventIds((current) => current.filter((item) => item !== eventId));
        } else {
          setDirtyEventIds((current) => [...current]);
        }
        if (syncFoodAddOns) {
          const kitchenStatus = payload.kitchenSync?.status ?? "error";
          setKitchenSyncByEvent((current) => ({
            ...current,
            [eventId]: revisionIsCurrent
              ? kitchenStatus === "live"
                ? "live"
                : kitchenStatus === "pending" ? "pending" : kitchenStatus === "not-required" ? "idle" : "error"
              : "idle",
          }));
          if (kitchenStatus === "live" && revisionIsCurrent) {
            setDirtyFoodEventIds((current) =>
              current.filter((item) => item !== eventId),
            );
          }
        }
      } catch (error) {
        setSaveErrorByEvent((current) => ({ ...current, [eventId]: error instanceof Error ? error.message : "Save failed; your draft is retained." }));
        setSaveStateByEvent((current) => ({
          ...current,
          [eventId]: "error",
        }));
        if (syncFoodAddOns) {
          setKitchenSyncByEvent((current) => ({
            ...current,
            [eventId]: "error",
          }));
        }
      } finally {
        inFlightEventIds.current.delete(eventId);
      }
    }
    return savedEventIds;
  });

  useEffect(() => {
    if (loadState !== "ready" || dirtyEventIds.length === 0) {
      return;
    }

    const eventIds = uniqueIds(dirtyEventIds).filter((eventId) => !conflictByEvent[eventId] && saveStateByEvent[eventId] !== "error");
    if (!eventIds.length) return;
    const timeoutId = window.setTimeout(() => {
      void saveDrafts(eventIds);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [dirtyEventIds, loadState, saveDrafts, conflictByEvent, saveStateByEvent]);

  const submitChecklist = useEffectEvent(async (eventId: number) => {
    const event = events.find((item) => item.id === eventId);
    const checklist = checklistsByEvent[eventId];

    if (!event || !checklist || conflictByEvent[eventId] || inFlightEventIds.current.has(eventId)) {
      return;
    }
    const currentReadiness = checklistReadiness(event, checklist);
    const actor = staffName.trim() || checklist.bwa.trim();
    const confirmation = warningConfirmationByEvent[eventId];
    const confirmedWarnings = currentReadiness.warningFingerprint && confirmation?.sourceFingerprint === currentReadiness.warningFingerprint && confirmation.employeeName === actor;
    if (!currentReadiness.canSubmit && !(confirmedWarnings && currentReadiness.canSubmitAfterWarningConfirmation)) return;
    inFlightEventIds.current.add(eventId);
    finalSubmissionEventIds.current.add(eventId);

    setSaveStateByEvent((current) => ({
      ...current,
      [eventId]: "submitting",
    }));

    try {
      const response = await fetch("/api/checklists/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId,
          sourceEventId: event.source_event_id ?? String(event.id),
          eventDate: event.date,
          expectedUpdatedAt: metaByEventRef.current[eventId]?.updatedAt ?? null,
          checklist,
          ...(confirmedWarnings ? { warningConfirmation: { sourceFingerprint: currentReadiness.warningFingerprint } } : {}),
          ...((staffName.trim() || checklist.bwa.trim()) ? { requesterName: staffName.trim() || checklist.bwa.trim() } : {}),
        }),
      });

      const payload = (await response.json()) as ChecklistSaveResponse;
      rememberDelivery(eventId, payload.kitchenSync?.deliveries);
      if (!response.ok) {
        if (response.status === 409) setConflictByEvent((current) => ({ ...current, [eventId]: true }));
        throw new Error(payload.error ?? "Unable to submit checklist; your draft is retained.");
      }
      window.dispatchEvent(new Event("event-host:checklist-updated"));

      setChecklistsByEvent((current) => ({
        ...current,
        [eventId]: mergeRecordState(payload.record, event),
      }));
      metaByEventRef.current[eventId] = metaFromRecord(payload.record);
      setMetaByEvent((current) => ({
        ...current,
        [eventId]: metaFromRecord(payload.record),
      }));
      setSaveStateByEvent((current) => ({
        ...current,
        [eventId]: "submitted",
      }));
      setDirtyEventIds((current) => current.filter((item) => item !== eventId));
      setKitchenSyncByEvent((current) => ({
        ...current,
        [eventId]:
          payload.kitchenSync?.status === "live" ? "live" : payload.kitchenSync?.status === "pending" ? "pending" : payload.kitchenSync?.status === "not-required" ? "idle" : "error",
      }));
      if (payload.kitchenSync?.status === "pending" && payload.kitchenSync.requestIds?.length) {
        const itemKey = `${eventId}:final-submission`;
        setFoodSubmitByItem((current) => ({ ...current, [itemKey]: "pending" }));
        setPendingFoodByItem((current) => ({ ...current, [itemKey]: { eventId, kitchenEventId: payload.kitchenSync!.eventId ?? String(eventId), requestIds: payload.kitchenSync!.requestIds! } }));
      }
      if (payload.kitchenSync?.status === "live" || payload.kitchenSync?.status === "not-required") {
        setDirtyFoodEventIds((current) =>
          current.filter((item) => item !== eventId),
        );
      }
    } catch (error) {
      setSaveErrorByEvent((current) => ({ ...current, [eventId]: error instanceof Error ? error.message : "Submission failed; your draft is retained." }));
      setSaveStateByEvent((current) => ({
        ...current,
        [eventId]: "error",
      }));
    } finally { inFlightEventIds.current.delete(eventId); finalSubmissionEventIds.current.delete(eventId); }
  });

  const activeEvent = checklistEventForSelection(visibleEvents, preferredEventId, activeEventId);
  const activeChecklist = activeEvent ? checklistsByEvent[activeEvent.id] : undefined;
  const activeMeta = activeEvent ? metaByEvent[activeEvent.id] : undefined;
  const activeSaveState = activeEvent ? saveStateByEvent[activeEvent.id] : "idle";
  const activeReadiness = activeEvent && activeChecklist ? checklistReadiness(activeEvent, activeChecklist) : null;
  const activeWarningActor = staffName.trim() || activeChecklist?.bwa.trim() || "";
  const activeWarningFingerprint = activeReadiness?.warningFingerprint ?? null;
  useEffect(() => {
    if (!activeEvent) return;
    setWarningConfirmationByEvent((current) => {
      const confirmation = current[activeEvent.id];
      if (!confirmation || confirmation.sourceFingerprint === activeWarningFingerprint && confirmation.employeeName === activeWarningActor) return current;
      const next = { ...current };
      delete next[activeEvent.id];
      return next;
    });
  }, [activeEvent?.id, activeWarningActor, activeWarningFingerprint]);
  const pollingEventId = activeEvent?.id;
  useEffect(() => {
    if (!pollingEventId || loadState !== "ready") return;
    let cancelled = false;
    let reading = false;
    async function refreshSharedChecklist() {
      if (reading || document.visibilityState !== "visible" || dirtyEventIds.includes(pollingEventId!) || inFlightEventIds.current.has(pollingEventId!)) return;
      const revision = revisionByEventRef.current[pollingEventId!] ?? 0;
      reading = true;
      try {
        const response = await fetch(`/api/checklists?eventId=${encodeURIComponent(String(pollingEventId))}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { records?: ChecklistRecord[] };
        if (cancelled || inFlightEventIds.current.has(pollingEventId!) || (revisionByEventRef.current[pollingEventId!] ?? 0) !== revision) return;
        const record = body.records?.find((item) => item.eventId === pollingEventId);
        const event = events.find((item) => item.id === pollingEventId);
        if (!record || !event || metaByEventRef.current[record.eventId]?.updatedAt === record.updatedAt) return;
        setChecklistsByEvent((current) => ({ ...current, [record.eventId]: mergeRecordState(record, event) }));
        metaByEventRef.current[record.eventId] = metaFromRecord(record);
        setMetaByEvent((current) => ({ ...current, [record.eventId]: metaFromRecord(record) }));
        setSaveStateByEvent((current) => ({ ...current, [record.eventId]: record.status === "submitted" ? "submitted" : "saved" }));
      } catch {
        // Retain the visible draft on a read failure; writes remain revision checked.
      } finally { reading = false; }
    }
    const timer = window.setInterval(() => void refreshSharedChecklist(), 15_000);
    window.addEventListener("focus", refreshSharedChecklist);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refreshSharedChecklist); };
  }, [pollingEventId, loadState, events, dirtyEventIds]);
  const activeFoodSubmissionStates = activeEvent ? Object.entries(foodSubmitByItem).filter(([key]) => key.startsWith(`${activeEvent.id}:`)).map(([, state]) => state) : [];
  const activeKitchenSyncState = activeEvent
    ? activeFoodSubmissionStates.some((state) => state === "error" || state === "uncertain") ? "error"
      : activeFoodSubmissionStates.includes("pending") ? "pending" : kitchenSyncByEvent[activeEvent.id]
    : "idle";

  if (!contextReady) {
    return <PortalShell mainClassName="page checklist-page" sectionTitle={sectionTitle} sectionSubtitle="Event workspace"><p role="status">Loading the selected event workspace…</p></PortalShell>;
  }

  if (preferredEventId && !checklistEventForSelection(visibleEvents, preferredEventId, 0)) {
    return <PortalShell mainClassName="page checklist-page" sectionTitle={sectionTitle} sectionSubtitle="Selected event"><section className="checklist-meta-card"><strong>The selected event is not available in this active workspace.</strong><p>It may already be submitted or outside the active event window. No other party has been selected automatically.</p><button type="button" onClick={clearEvent}>Choose another event</button></section></PortalShell>;
  }

  if (!visibleEvents.length) {
    return (
      <PortalShell
        mainClassName="page checklist-page"
        sectionSubtitle={isAddOnWorkspace ? "Food & entertainment" : "Tablet workflow"}
        sectionTitle={sectionTitle}
      >
        <PortalPageHeader
          aside={<PortalStatusBadge>Queue clear</PortalStatusBadge>}
          description={
            isAddOnWorkspace
              ? "Submitted records remain in Admin. Unsubmitted events stay available through the following day."
              : "Submitted checklists move to Admin. Unsubmitted events stay available through the following day."
          }
          eyebrow="Event Host workspace"
          title={pageTitle}
        />
        <section className="checklist-meta-card">
          <span className="eyebrow">{isAddOnWorkspace ? "Add-On Queue" : "Checklist Queue"}</span>
          <strong>
            {isAddOnWorkspace
              ? "No active add-on events"
              : "No active checklist events"}
          </strong>
          <span className="meta">Current, upcoming, and unfinished previous-day drafts stay on this page.</span>
        </section>
      </PortalShell>
    );
  }

  if (!activeEvent || !activeChecklist || !activeMeta) {
    return null;
  }

  const isSubmitted = activeMeta.status === "submitted";
  const isEditable = loadState === "ready" && !isSubmitted && activeSaveState !== "submitting";
  const foodSaveBusy = activeKitchenSyncState === "syncing" || activeSaveState === "saving";
  const canSendFood = isEditable && !conflictByEvent[activeEvent.id] && !foodSaveBusy;
  const readiness = activeReadiness!;
  const setup = contractSetup(activeEvent);
  const warningActor = staffName.trim() || activeChecklist.bwa.trim();
  const warningConfirmation = warningConfirmationByEvent[activeEvent.id];
  const warningsConfirmed = Boolean(readiness.warningFingerprint && warningConfirmation?.sourceFingerprint === readiness.warningFingerprint && warningConfirmation.employeeName === warningActor);
  const canSubmit = isEditable && (readiness.canSubmit || warningsConfirmed && readiness.canSubmitAfterWarningConfirmation) && !conflictByEvent[activeEvent.id] && !["submitting", "saving"].includes(activeSaveState);
  const progress = readiness;
  const entertainmentSubtotal = entertainmentAddOns.reduce((sum, item) => {
    const state = activeChecklist.entertainment[item.key];
    return sum + entertainmentUnitPrice(item, state) * numeric(state.quantity);
  }, 0);
  const foodSubtotal = foodAddOns.reduce((sum, item) => {
    const state = activeChecklist.food[item.key];
    return sum + foodUnitPrice(item, state) * numeric(state.quantity);
  }, 0);
  const refillItems = refillBar === "Taco Bar"
    ? tacoBarRefillAddOns
    : refillBar === "Wing Bar"
      ? wingBarRefillAddOns
      : appetizerBarRefillAddOns;
  const activeRefillItem = refillItems.find((item) => item.key === refillItemKey) ?? refillItems[0];
  const activeFoodAddOns = activeAddOnTab === "food" ? standardFoodAddOns : [];
  const activeFoodSubtotal = activeFoodAddOns.reduce((sum, item) => {
    const state = activeChecklist.food[item.key];
    return sum + foodUnitPrice(item, state) * numeric(state.quantity);
  }, 0);

  let saveMessage = "Draft not saved yet.";
  if (loadState === "loading") {
    saveMessage = "Loading saved checklist…";
  } else if (activeSaveState === "saving") {
    saveMessage = "Saving draft to Supabase…";
  } else if (activeSaveState === "submitting") {
    saveMessage = "Submitting final checklist…";
  } else if (activeMeta.status === "submitted" && activeMeta.submittedAt) {
    saveMessage = `Submitted ${formatTimestamp(activeMeta.submittedAt)}`;
  } else if (activeSaveState === "saved" && activeMeta.updatedAt) {
    saveMessage = `Draft saved ${formatTimestamp(activeMeta.updatedAt)}`;
  } else if (activeSaveState === "error" || loadState === "error") {
    saveMessage = saveErrorByEvent[activeEvent.id] ?? "Save unavailable. Your draft is retained on this screen; do not close it before resolving the error.";
  }

  return (
    <PortalShell
      mainClassName="page checklist-page"
      sectionSubtitle={isAddOnWorkspace ? "Food & entertainment" : "Tablet workflow"}
      sectionTitle={sectionTitle}
    >
      <EventSelectionBridge event={operationalEventFromPlan(activeEvent)} />
      <PortalPageHeader
        aside={
          <div className="checklist-meta-card">
            <span className="eyebrow">Current Event</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {progress.completed} of {progress.total} checklist items complete
            </span>
            <progress aria-label="Checklist completion" className="checklist-progress" max={Math.max(1, progress.total)} value={progress.completed} />
            <span className={`sync-chip sync-chip-${activeSaveState}`}>{saveMessage}</span>
          </div>
        }
        description={pageDescription}
        eyebrow="Event Host workspace"
        title={pageTitle}
      />
      {sourceWarning ? <section className="checklist-meta-card" role="alert">{sourceWarning}</section> : null}
      {isAddOnWorkspace ? <>
        <EventWorkspaceRequests />
        <section className="checklist-meta-card">
          <strong>Contracted entertainment</strong>
          <ul>{activeEvent.entertainment.map((item, index) => <li key={`${index}:${item.name}`}>{item.name}: {item.quantity}{/\bmini(?:ature)?\s*golf\b/i.test(item.name) ? " · Untimed" : ` · ${item.time || "Time needs review"}`}</li>)}</ul>
          {!activeEvent.entertainment.length ? <p>No entertainment is listed in this event source.</p> : null}
        </section>
      </> : null}

      {conflictByEvent[activeEvent.id] ? <section className="checklist-meta-card" role="alert">
        <strong>A newer saved version exists. Your draft is still here.</strong>
        <p>Review your unsaved changes before reloading. Reloading discards this screen’s draft; it does not overwrite the other staff member’s saved work.</p>
        <button type="button" onClick={() => void reloadChecklist(activeEvent.id)}>Reload latest and review</button>
      </section> : null}
      {activeSaveState === "error" && !conflictByEvent[activeEvent.id] ? <section className="checklist-meta-card" role="alert"><p>Automatic saving is paused after the error. Your draft is still on this screen. This retry saves the draft only; food items still require their own Submit button.</p><button type="button" onClick={() => setSaveStateByEvent((current) => ({ ...current, [activeEvent.id]: "idle" }))}>Retry saving draft</button></section> : null}

        <section
          className="event-tab-strip"
          aria-label={isAddOnWorkspace ? "Event add-on tabs" : "Event checklist tabs"}
        >
          {visibleEvents.map((event) => {
            const eventState = checklistsByEvent[event.id];
            const eventMeta = metaByEvent[event.id];
            const eventProgress = checklistReadiness(event, eventState);

            return (
              <button
                key={event.id}
                type="button"
                className={`event-switcher${event.id === activeEvent.id ? " active" : ""}`}
                onClick={() => { setActiveEventId(event.id); selectEvent(operationalEventFromPlan(event)); }}
              >
                <span>{event.name}</span>
                <small>
                  {event.dateLabel} · {eventMeta.status === "submitted" ? "Submitted" : "Draft"} · {eventProgress.completed}/{eventProgress.total}
                </small>
              </button>
            );
          })}
        </section>

        <section className="event-header-card">
          <div className="event-field-grid">
            <Field label="Date" value={activeEvent.dateLabel} />
            <Field label="Event Name" value={activeEvent.name} />
            <EditableField
              disabled={!isEditable}
              label="Staff POC"
              value={activeChecklist.poc ?? ""}
              placeholder="Enter staff POC name"
              onChange={(value) => updateEventChecklist(activeEvent.id, (current) => ({ ...current, poc: value }))}
            />
            <EditableField
              disabled={!isEditable}
              label="BWA"
              value={activeChecklist.bwa}
              placeholder="Type employee name"
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  bwa: value,
                }))
              }
            />
          </div>
          <div className="notes-grid">
            <EditableTextArea
              disabled={!isEditable}
              label="Staff notes / extras added"
              value={activeChecklist.extrasAdded}
              placeholder="Enter staff notes, setup details, or extra items added during the event."
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  extrasAdded: value,
                }))
              }
            />
            <EditableTextArea
              disabled={!isEditable}
              label="Remaining Drink Card Balance"
              value={activeChecklist.remainingDrinkCardBalance}
              placeholder="Add any remaining drink card balance notes."
              onChange={(value) =>
                updateEventChecklist(activeEvent.id, (current) => ({
                  ...current,
                  remainingDrinkCardBalance: value,
                }))
              }
            />
          </div>
          {readiness.warningMessages.length ? <section className="event-workspace-panel" aria-label="Contract warning confirmation">
            <h3>Needs Review — contract warnings retained for Admin</h3>
            <p>Staff may close a completed checklist after confirming these warnings. This does not resolve the source warnings, change the contract, or mark unfinished tasks complete.</p>
            <details>
              <summary>Review {readiness.warningMessages.length} contract warning{readiness.warningMessages.length === 1 ? "" : "s"}</summary>
              <ul>{readiness.warningMessages.map((message) => <li key={message}>{message}</li>)}</ul>
            </details>
            <label className="task-row">
              <input type="checkbox" checked={warningsConfirmed} disabled={!isEditable || !warningActor} onChange={(event) => {
                const checked = event.target.checked;
                setWarningConfirmationByEvent((current) => {
                  const next = { ...current };
                  if (checked && readiness.warningFingerprint) next[activeEvent.id] = { sourceFingerprint: readiness.warningFingerprint, employeeName: warningActor };
                  else delete next[activeEvent.id];
                  return next;
                });
              }} />
              <span>I reviewed the unresolved contract warnings and confirm this checklist can be submitted with them retained for Admin.<small className="meta">{warningActor ? `Staff-entered confirmation: ${warningActor}. Name, submission time, and the warnings will be saved with the final record.` : "Enter the BWA or select your staff name before confirming."}</small></span>
            </label>
          </section> : null}
          <div className="checklist-actions">
            <div className="action-copy">
              <strong>
                {isSubmitted
                  ? isAddOnWorkspace
                    ? "Final event record submitted"
                    : "Final checklist submitted"
                  : "Draft saves automatically"}
              </strong>
              <span className="meta">
                {isSubmitted
                  ? "Submitted checklists are locked to preserve the final event record."
                  : canSubmit
                    ? isAddOnWorkspace
                      ? "Submit at the end of the event to send the complete add-on record to Admin."
                      : "Use the submit button when the event checklist is final."
                    : isAddOnWorkspace
                      ? "Final submission closes the same event checklist. Add-on quantities can be saved separately; finish critical tasks in Checklists and confirm retained warnings before closing the record."
                      : "Enter the BWA, finish critical tasks with completion evidence, and confirm any retained contract warnings before submitting."}
              </span>
              {!isSubmitted && !canSubmit ? (
                <ul aria-label="Checklist submission requirements" className="meta">
                  {!activeChecklist.bwa.trim() ? <li>Enter the BWA name.</li> : null}
                  {readiness.missing.map((task) => <li key={task.key}>{activeChecklist.tasks[task.key] ? "Reconfirm with your staff name and completion time: " : "Complete: "}{task.label}</li>)}
                  {readiness.warningMessages.length && !warningsConfirmed ? <li>Review and confirm the contract warnings above; they will remain flagged for Admin.</li> : null}
                  {conflictByEvent[activeEvent.id] ? <li>Review the newer saved version using “Reload latest and review” above.</li> : null}
                  {activeSaveState === "saving" ? <li>Wait for the current draft save to finish.</li> : null}
                  {loadState !== "ready" ? <li>Saved checklist data must load successfully before submission.</li> : null}
                </ul>
              ) : null}
              {isAddOnWorkspace && !isSubmitted && readiness.missing.length > 0 ? <div>
                <p className="meta">This saves the current add-on draft to Admin only. It does not order food, send anything to the KDS, or mark tasks complete.</p>
                <button type="button" disabled={!isEditable || foodSaveBusy || Boolean(conflictByEvent[activeEvent.id])} onClick={() => void openChecklistForCloseout(activeEvent)}>Save add-on draft and open checklist</button>
              </div> : null}
            </div>
            <button
              type="button"
              className={`submit-button${isSubmitted ? " submitted" : ""}`}
              disabled={!canSubmit || isSubmitted}
              onClick={() => void submitChecklist(activeEvent.id)}
            >
              {activeSaveState === "submitting"
                ? "Submitting..."
                : isSubmitted
                  ? isAddOnWorkspace
                    ? "Event Record Submitted"
                    : "Checklist Submitted"
                  : isAddOnWorkspace
                    ? "Submit Event Record to Admin"
                    : "Submit Final Checklist"}
            </button>
          </div>
        </section>

        {!isAddOnWorkspace ? (
          <section className="paper-checklist">
            <article className="task-section-card">
              <header className="task-section-header">Contract-driven Event Setup</header>
              <div className="task-list">
                <dl className="setup-equipment-grid">
                  <div><dt>Food tables</dt><dd data-needs-review={setup.foodTables === null}>{setup.foodTables ?? "Needs review"}</dd></div>
                  <div><dt>Chafing dishes</dt><dd data-needs-review={setup.chafingDishes === null}>{setup.chafingDishes ?? "Needs review"}</dd></div>
                  <div><dt>Tongs</dt><dd data-needs-review={setup.tongs === null}>{setup.tongs ?? "Needs review"}</dd></div>
                  <div><dt>Sauce containers</dt><dd data-needs-review={setup.sauceContainers === null}>{setup.sauceContainers ?? "Needs review"}</dd></div>
                  <div><dt>Spoons</dt><dd data-needs-review={setup.spoons === null}>{setup.spoons ?? "Needs review"}</dd></div>
                </dl>
                {setup.mirrored ? <p className="setup-mirror-note">Mirrored setup: duplicate equipment and supplies, not food quantities or charges.</p> : null}
                <strong>Purchased food — quantities unchanged</strong>
                <ul>{setup.purchasedFood.map((food, index) => <li key={`${index}:${food}`}>{food}</li>)}</ul>
                <ul>{setup.food.map((food) => <li key={food.name}>{food.name}: {food.quantity === null ? "Quantity needs review" : `${food.quantity} ${food.unit}`}{food.pans !== null && food.panSize ? ` · ${food.pans} ${food.panSize} pans` : ""}</li>)}</ul>
                <p className="meta">Chicken tenders and wings include ranch; mozzarella sticks include marinara. One spoon per sauce container; two tongs per purchased platter. Use approved kitchen packing for shared chafing dishes. Plates, napkins, linen, and unmapped bar supplies must be checked against the contract; no quantities are guessed.</p>
                {setup.review.length ? <ul role="alert">{setup.review.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              </div>
            </article>
            <p className="meta">Task completions record the staff name from this session, or the BWA name above, and the completion time. Names are staff-entered, not authenticated identity. Enter the BWA before final submission; only Admin can reopen a submitted checklist.</p>
            {readiness.review.length ? <p role="alert">Contract warnings affect {readiness.review.length} critical task(s). Complete these tasks and confirm the warnings before submission. Unverified items are not marked Not applicable, and the warnings remain in Admin.</p> : null}
            {checklistSections.map((section) => (
              <article className="task-section-card" key={section.key}>
                <header className="task-section-header">{section.title}</header>
                <div className="task-list">
                  {section.items.map((item) => {
                    const requirement = readiness.tasks.find((task) => task.key === item.key)!;
                    const evidence = activeChecklist.taskEvidence?.[item.key];
                    return (
                    <label className={`task-row${!isEditable ? " task-row-disabled" : ""}`} key={item.key}>
                      <input
                        type="checkbox"
                        checked={requirement.applicability !== "not-applicable" && activeChecklist.tasks[item.key]}
                        disabled={!isEditable || requirement.applicability === "not-applicable" || !(staffName.trim() || activeChecklist.bwa.trim())}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          updateEventChecklist(activeEvent.id, (current) => completeChecklistTask(current, item.key, checked, staffName, new Date().toISOString(), setupTaskFingerprint(activeEvent, item.key, setup)));
                        }}
                      />
                      <span>{item.label}{requirement.critical && requirement.applicability !== "not-applicable" ? " · Critical" : ""}<small className="meta">{requirement.applicability === "not-applicable" ? `Not applicable — ${requirement.reason}` : requirement.applicability === "needs-review" ? requirement.reason : requirement.dueAt ? `Due ${formatTimestamp(requirement.dueAt)} Eastern` : section.title}{evidence && activeChecklist.tasks[item.key] ? ` · Recorded by ${evidence.employeeName} · ${formatTimestamp(evidence.completedAt)} Eastern` : ""}</small></span>
                    </label>
                  ); })}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="addon-layout">
            <article className="addon-card">
              <div className="addon-card-header">
                <div>
                  <span className="eyebrow">One Add-On Workspace</span>
                  <h3>
                    {activeAddOnTab === "food"
                      ? "Food Add-Ons"
                      : activeAddOnTab === "refills"
                        ? "Refills"
                        : "Entertainment & Drink Add-Ons"}
                  </h3>
                  <p>
                    {activeAddOnTab === "entertainment"
                      ? "Entertainment and drink changes stay out of Kitchen and are included in the final Admin record."
                      : activeAddOnTab === "refills"
                        ? "Refills send directly to the Kitchen Dashboard and GoTab KDS. No pricing is collected here."
                        : "Food changes save here and are sent to the Kitchen Dashboard and GoTab KDS live."}
                  </p>
                </div>
                <strong>
                  {currency(
                    activeAddOnTab === "entertainment"
                      ? entertainmentSubtotal
                      : activeAddOnTab === "food" ? activeFoodSubtotal : 0,
                  )}
                </strong>
              </div>

              <div className="addon-category-tabs" role="tablist" aria-label="Add-on categories">
                <button
                  aria-selected={activeAddOnTab === "food"}
                  className={activeAddOnTab === "food" ? "active" : ""}
                  onClick={() => setActiveAddOnTab("food")}
                  role="tab"
                  type="button"
                >
                  <span>Food</span>
                  <small>Live to Kitchen</small>
                </button>
                <button
                  aria-selected={activeAddOnTab === "refills"}
                  className={activeAddOnTab === "refills" ? "active" : ""}
                  onClick={() => setActiveAddOnTab("refills")}
                  role="tab"
                  type="button"
                >
                  <span>Refills</span>
                  <small>Live to Kitchen + KDS</small>
                </button>
                <button
                  aria-selected={activeAddOnTab === "entertainment"}
                  className={activeAddOnTab === "entertainment" ? "active" : ""}
                  onClick={() => setActiveAddOnTab("entertainment")}
                  role="tab"
                  type="button"
                >
                  <span>Entertainment</span>
                  <small>Admin at event close</small>
                </button>
              </div>

              {activeAddOnTab !== "entertainment" ? (
                <div
                  className={`kitchen-sync-banner kitchen-sync-${activeKitchenSyncState === "pending" ? "syncing" : activeKitchenSyncState}`}
                  role="status"
                >
                  <div>
                    <strong>
                      {activeKitchenSyncState === "syncing"
                        ? "Sending food changes to Kitchen…"
                        : activeKitchenSyncState === "pending"
                          ? "Kitchen saved · Sending to GoTab…"
                        : activeKitchenSyncState === "live"
                          ? "Kitchen saved · GoTab accepted"
                          : activeKitchenSyncState === "error"
                            ? "Food delivery needs attention"
                            : "Submit each food item to Kitchen and GoTab"}
                    </strong>
                    <span>
                      The complete Food and Entertainment add-on record is still
                      submitted to Admin when the event is closed.
                    </span>
                  </div>
                  {activeKitchenSyncState === "error" || activeKitchenSyncState === "pending" ? (
                    <span>
                      {kitchenSyncErrorByEvent[activeEvent.id] ||
                        (activeKitchenSyncState === "pending" ? "No approval is needed. Delivery status updates automatically; do not submit again." : "Check the saved order status before submitting this item again.")}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="addon-admin-banner">
                  <strong>Admin-only until the event is submitted</strong>
                  <span>
                    Entertainment and drink add-ons will not appear on the Kitchen
                    Dashboard.
                  </span>
                </div>
              )}

              {activeAddOnTab !== "entertainment" && deliveryByEvent[activeEvent.id]?.length ? <section className="addon-delivery-status" aria-label="Submitted food-order results">
                <h3>Submitted food orders — {activeEvent.name}</h3>
                <p>GoTab acceptance does not confirm that a person saw the physical KDS. Check the order reference before retrying an uncertain send.</p>
                <ul>{deliveryByEvent[activeEvent.id].map((item) => <li key={item.requestId}><strong>{item.quantity} × {item.foodName}</strong> · {eventFoodDeliveryState(item).label}<small>Order: {item.orderReference ?? "Not yet available"}</small></li>)}</ul>
              </section> : null}

              <div className="addon-grid">
                {activeAddOnTab === "refills" ? (
                  <article className="addon-row-card refill-selector-card">
                    <div className="addon-controls">
                      <label className="control-block">
                        <span>Bar</span>
                        <select
                          disabled={!isEditable}
                          value={refillBar}
                          onChange={(event) => {
                            const nextBar = event.target.value as typeof refillBar;
                            setRefillBar(nextBar);
                            setRefillItemKey("");
                          }}
                        >
                          <option>Taco Bar</option>
                          <option value="Wing Bar">Wing Bar Refills</option>
                          <option value="Appetizer Bar">Appetizer Bar Refills</option>
                        </select>
                      </label>
                      <label className="control-block">
                        <span>Item</span>
                        <select
                          disabled={!isEditable}
                          value={activeRefillItem?.key ?? ""}
                          onChange={(event) => setRefillItemKey(event.target.value)}
                        >
                          {refillItems.map((item) => (
                            <option key={item.key} value={item.key}>{item.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="control-block quantity-block">
                        <span>Quantity</span>
                        <select
                          disabled={!isEditable || !activeRefillItem || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`])}
                          value={activeRefillItem ? activeChecklist.food[activeRefillItem.key].quantity : ""}
                          onChange={(event) => activeRefillItem && updateFoodAddOn(activeEvent.id, activeRefillItem.key, { quantity: event.target.value })}
                        >
                          <option value="">0</option>
                          <option value="1">1</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                          <option value="4">4</option>
                          <option value="5">5</option>
                          <option value="6">6</option>
                          <option value="7">7</option>
                          <option value="8">8</option>
                          <option value="9">9</option>
                          <option value="10">10</option>
                        </select>
                      </label>
                      <button
                        className="submit-button"
                        disabled={!canSendFood || !activeRefillItem || numeric(activeChecklist.food[activeRefillItem.key].quantity) < 1 || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`])}
                        onClick={() => activeRefillItem && void submitFoodAddOn(activeEvent.id, activeRefillItem.key, "REFILL")}
                        type="button"
                      >
                        {foodSaveBusy ? activeSaveState === "saving" ? "Saving…" : "Sending…" : activeRefillItem && ["submitting", "pending"].includes(foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`]) ? "Sending…" : activeRefillItem && foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`] === "sent" ? "GoTab accepted" : activeRefillItem && foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`] === "uncertain" ? "Check saved order" : "Submit Refill"}
                      </button>
                    </div>
                    <label className="control-block">
                      <span>Notes for this refill</span>
                      <textarea
                        maxLength={500}
                        disabled={!isEditable || !activeRefillItem || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`]) || foodSubmitByItem[`${activeEvent.id}:${activeRefillItem.key}`] === "sent"}
                        value={activeRefillItem ? activeChecklist.food[activeRefillItem.key].notes ?? "" : ""}
                        onChange={(event) => activeRefillItem && updateFoodAddOn(activeEvent.id, activeRefillItem.key, { notes: event.target.value })}
                        placeholder="Optional instructions for this refill only."
                      />
                      <small>Sent with this request. Editing notes never resends food.</small>
                    </label>
                  </article>
                ) : activeAddOnTab === "entertainment"
                  ? entertainmentAddOns.map((item) => {
                  const state = activeChecklist.entertainment[item.key];
                  const unitPrice = entertainmentUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);
                  const updateQuantity = (quantity: string) =>
                    updateEventChecklist(activeEvent.id, (current) => ({
                      ...current,
                      entertainment: {
                        ...current.entertainment,
                        [item.key]: {
                          ...current.entertainment[item.key],
                          quantity,
                        },
                      },
                    }));

                  return (
                    <article className="addon-row-card" key={item.key}>
                      <div className="addon-row-top">
                        <div>
                          <h4>{item.label}</h4>
                          <p>{item.unitLabel}</p>
                        </div>
                        <strong>{currency(subtotal)}</strong>
                      </div>
                      <div className="addon-controls">
                        {item.kind === "rate-select" ? (
                          <label className="control-block">
                            <span>Rate</span>
                            <select
                              disabled={!isEditable}
                              value={state.selectedRateKey}
                              onChange={(event) =>
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  entertainment: {
                                    ...current.entertainment,
                                    [item.key]: {
                                      ...current.entertainment[item.key],
                                      selectedRateKey: event.target.value,
                                    },
                                  },
                                }))
                              }
                            >
                              {item.options?.map((option) => (
                                <option key={option.key} value={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : item.kind === "manual-price" ? (
                          <label className="control-block">
                            <span>Price</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              disabled={!isEditable}
                              value={state.manualPrice}
                              onChange={(event) =>
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  entertainment: {
                                    ...current.entertainment,
                                    [item.key]: {
                                      ...current.entertainment[item.key],
                                      manualPrice: event.target.value,
                                    },
                                  },
                                }))
                              }
                              placeholder="0.00"
                            />
                          </label>
                        ) : (
                          <div className="control-block locked-price">
                            <span>Price</span>
                            <strong>{currency(item.fixedPrice ?? 0)}</strong>
                          </div>
                        )}

                        <label className="control-block quantity-block">
                          <span>Quantity</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            disabled={!isEditable}
                            value={state.quantity}
                            onChange={(event) => {
                              const quantity = event.target.value;
                              if (quantity !== "" && (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)))) return;
                              updateQuantity(quantity);
                            }}
                            placeholder="0"
                          />
                        </label>
                      </div>
                    </article>
                  );
                    })
                  : activeFoodAddOns.map((item) => {
                  const state = activeChecklist.food[item.key];
                  const unitPrice = foodUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);

                  return (
                    <Fragment key={item.key}>
                    <article className="addon-row-card">
                      <div className="addon-row-top">
                        <div>
                          <h4>{item.label}</h4>
                          <p>
                            {item.kind === "manual-price"
                              ? "Manual price"
                              : item.kind === "quantity-only"
                                ? "Quantity only"
                                : "Locked price"}
                          </p>
                        </div>
                        <strong>
                          {item.kind === "quantity-only"
                            ? "No price set"
                            : currency(subtotal)}
                        </strong>
                      </div>
                      <div className="addon-controls">
                        {item.kind === "manual-price" ? (
                          <label className="control-block">
                            <span>Price</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              disabled={!isEditable}
                              value={state.manualPrice}
                              onChange={(event) =>
                                updateFoodAddOn(activeEvent.id, item.key, {
                                  manualPrice: event.target.value,
                                })
                              }
                              placeholder="0.00"
                            />
                          </label>
                        ) : item.kind === "quantity-only" ? (
                          <div className="control-block locked-price">
                            <span>Pricing</span>
                            <strong>Not priced</strong>
                          </div>
                        ) : (
                          <div className="control-block locked-price">
                            <span>Price</span>
                            <strong>{currency(item.fixedPrice ?? 0)}</strong>
                          </div>
                        )}

                        <label className="control-block quantity-block">
                          <span>Quantity</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            disabled={!isEditable || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${item.key}`])}
                            value={state.quantity}
                            onChange={(event) =>
                              updateFoodAddOn(
                                activeEvent.id,
                                item.key,
                                { quantity: event.target.value },
                              )
                            }
                            placeholder="0"
                          />
                        </label>

                        <label className="control-block">
                          <span>Pan size</span>
                          <select
                            aria-label={`${item.label} pan size`}
                            disabled={!isEditable || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${item.key}`])}
                            value={state.panSize}
                            onChange={(event) =>
                              updateFoodAddOn(
                                activeEvent.id,
                                item.key,
                                {
                                  panSize: event.target.value as "" | "1/3" | "1/2",
                                },
                              )
                            }
                          >
                            <option value="">Automatic</option>
                            <option value="1/3">1/3 pan</option>
                            <option value="1/2">1/2 pan</option>
                          </select>
                        </label>
                        <button
                          className="submit-button"
                          disabled={!canSendFood || numeric(state.quantity) < 1 || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${item.key}`])}
                          onClick={() => void submitFoodAddOn(activeEvent.id, item.key)}
                          type="button"
                        >
                          {foodSaveBusy
                            ? activeSaveState === "saving" ? "Saving…" : "Sending…"
                            : ["submitting", "pending"].includes(foodSubmitByItem[`${activeEvent.id}:${item.key}`])
                            ? "Sending…"
                            : foodSubmitByItem[`${activeEvent.id}:${item.key}`] === "sent"
                              ? "GoTab accepted"
                              : foodSubmitByItem[`${activeEvent.id}:${item.key}`] === "uncertain"
                                ? "Check saved order"
                                : "Submit to Kitchen"}
                        </button>
                      </div>
                      <label className="control-block">
                        <span>Notes for this food request</span>
                        <textarea
                          maxLength={500}
                          disabled={!isEditable || foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${item.key}`]) || foodSubmitByItem[`${activeEvent.id}:${item.key}`] === "sent"}
                          value={state.notes ?? ""}
                          onChange={(event) => updateFoodAddOn(activeEvent.id, item.key, { notes: event.target.value })}
                          placeholder="Optional instructions for this order only."
                        />
                        <small>Sent with this request. Editing notes never resends food.</small>
                      </label>
                    </article>
                    </Fragment>
                  );
                    })}
              </div>
            </article>

            <aside className="totals-card">
              <span className="eyebrow">Add-On Summary</span>
              <div className="summary-line">
                <span>Entertainment &amp; Drink</span>
                <strong>{currency(entertainmentSubtotal)}</strong>
              </div>
              <div className="summary-line">
                <span>Food</span>
                <strong>{currency(foodSubtotal)}</strong>
              </div>
              <div className="summary-line grand-total">
                <span>Total</span>
                <strong>{currency(entertainmentSubtotal + foodSubtotal)}</strong>
              </div>
              <p className="meta">
                Both categories are included when the final event record is
                submitted to Admin.
              </p>
            </aside>
          </section>
        )}
    </PortalShell>
  );

  function updateEventChecklist(eventId: number, updater: (current: EventChecklistState) => EventChecklistState) {
    if (metaByEvent[eventId]?.status === "submitted" || finalSubmissionEventIds.current.has(eventId)) {
      return;
    }

    revisionByEventRef.current[eventId] = (revisionByEventRef.current[eventId] ?? 0) + 1;
    setChecklistsByEvent((current) => {
      const existing = current[eventId];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [eventId]: updater(existing),
      };
    });
    setDirtyEventIds((current) => (current.includes(eventId) ? current : [...current, eventId]));
    setSaveStateByEvent((current) => ({
      ...current,
      [eventId]: "idle",
    }));
  }

  async function openChecklistForCloseout(event: ChecklistEvent) {
    const saved = await saveDrafts([event.id], { syncFoodAddOns: false });
    if (saved.has(event.id)) window.location.assign(operationalEventHref("/checklists", operationalEventFromPlan(event)));
  }

  function updateFoodAddOn(
    eventId: number,
    key: string,
    changes: { quantity?: string; manualPrice?: string; panSize?: "" | "1/3" | "1/2"; notes?: string },
  ) {
    if (metaByEvent[eventId]?.status === "submitted" || finalSubmissionEventIds.current.has(eventId)) return;
    if (foodSubmissionLocked(foodSubmitByItem[`${eventId}:${key}`])) return;
    revisionByEventRef.current[eventId] = (revisionByEventRef.current[eventId] ?? 0) + 1;
    setChecklistsByEvent((current) => ({
      ...current,
      [eventId]: {
        ...current[eventId],
        food: {
          ...current[eventId].food,
          [key]: { ...current[eventId].food[key], ...changes },
        },
      },
    }));
    setFoodSubmitByItem((current) => ({
      ...current,
      [`${eventId}:${key}`]: "idle",
    }));
    setKitchenSyncByEvent((current) => ({
      ...current,
      [eventId]: "idle",
    }));
  }

  async function submitFoodAddOn(eventId: number, key: string, sourceType: "EVENT_HOST_ADDON" | "REFILL" = "EVENT_HOST_ADDON") {
    const checklist = checklistsByEvent[eventId];
    const event = events.find((item) => item.id === eventId);
    if (!event || !checklist || metaByEvent[eventId]?.status === "submitted" || conflictByEvent[eventId] || finalSubmissionEventIds.current.has(eventId)) return;
    const itemStateKey = `${eventId}:${key}`;
    if (foodSubmissionLocked(foodSubmitByItem[itemStateKey])) return;
    if (inFlightEventIds.current.has(eventId)) {
      setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: "A save is already in progress for this event. Wait for it to finish before submitting food." }));
      return;
    }
    inFlightEventIds.current.add(eventId);
    setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "submitting" }));
    setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "syncing" }));
    setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: "" }));
    let outcomeUncertain = true;
    try {
      const response = await fetch("/api/checklists", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId,
          sourceEventId: event.source_event_id ?? String(event.id),
          eventDate: event.date,
          expectedUpdatedAt: metaByEventRef.current[eventId]?.updatedAt ?? null,
          checklist,
          syncFoodAddOns: true,
          syncFoodAddOnKeys: [key],
          sourceType,
          ...((staffName.trim() || checklist.bwa.trim()) ? { requesterName: staffName.trim() || checklist.bwa.trim() } : {}),
        }),
      });
      const payload = (await response.json()) as ChecklistSaveResponse;
      outcomeUncertain = response.ok && payload.kitchenSync?.status === "error" && !payload.kitchenSync.exceptions &&
        (!payload.kitchenSync.deliveries?.length || payload.kitchenSync.deliveries.some((delivery) => ["HELD", "SENDING", "UNKNOWN"].includes(delivery.status)));
      rememberDelivery(eventId, payload.kitchenSync?.deliveries);
      if (response.status === 409) setConflictByEvent((current) => ({ ...current, [eventId]: true }));
      // A food delivery error can follow a successful checklist save. Keep its
      // revision, otherwise the next deliberate retry would use a stale draft.
      if (response.ok && payload.record) {
        window.dispatchEvent(new Event("event-host:checklist-updated"));
        metaByEventRef.current[eventId] = metaFromRecord(payload.record);
        setMetaByEvent((current) => ({ ...current, [eventId]: metaFromRecord(payload.record) }));
      }
      if (response.ok && payload.kitchenSync?.status === "pending" && payload.kitchenSync.requestIds?.length) {
        setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "pending" }));
        setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "pending" }));
        setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: "No approval is needed. Delivery status updates automatically; do not submit again." }));
        setPendingFoodByItem((current) => ({ ...current, [itemStateKey]: { eventId, kitchenEventId: payload.kitchenSync!.eventId ?? String(eventId), requestIds: payload.kitchenSync!.requestIds! } }));
        return;
      }
      if (!response.ok || payload.kitchenSync?.status !== "live") {
        if (outcomeUncertain) {
          setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "uncertain" }));
          setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "error" }));
          setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: payload.kitchenSync?.error ?? "Check the saved order before submitting again." }));
          return;
        }
        throw new Error(payload.error ?? payload.kitchenSync?.error ?? "Kitchen submission was not confirmed. Check the saved order before submitting again.");
      }
      setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "sent" }));
      setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "live" }));
    } catch (error) {
      setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: outcomeUncertain ? "uncertain" : "error" }));
      setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "error" }));
      setKitchenSyncErrorByEvent((current) => ({
        ...current,
        [eventId]: error instanceof Error ? error.message : "Kitchen and KDS sync failed.",
      }));
    } finally { inFlightEventIds.current.delete(eventId); }
  }

  async function reloadChecklist(eventId: number) {
    setWarningConfirmationByEvent((current) => {
      const next = { ...current };
      delete next[eventId];
      return next;
    });
    if (inFlightEventIds.current.has(eventId) || !window.confirm("Discard this screen’s unsaved draft and load the latest saved checklist?")) return;
    try {
      const response = await fetch("/api/checklists", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to reload. Your draft has been kept.");
      const payload = await response.json() as { records?: ChecklistRecord[] };
      const record = payload.records?.find((item) => item.eventId === eventId);
      const event = events.find((item) => item.id === eventId);
      if (!event) return;
      const meta = record ? metaFromRecord(record) : { status: "draft" as const, updatedAt: null, submittedAt: null };
      metaByEventRef.current[eventId] = meta;
      revisionByEventRef.current[eventId] = 0;
      setMetaByEvent((current) => ({ ...current, [eventId]: meta }));
      setChecklistsByEvent((current) => ({ ...current, [eventId]: record ? mergeRecordState(record, event) : defaultChecklistState(event.date) }));
      setConflictByEvent((current) => ({ ...current, [eventId]: false }));
      setDirtyEventIds((current) => current.filter((id) => id !== eventId));
      setDirtyFoodEventIds((current) => current.filter((id) => id !== eventId));
      setSaveStateByEvent((current) => ({ ...current, [eventId]: record ? "saved" : "idle" }));
      setSaveErrorByEvent((current) => ({ ...current, [eventId]: "" }));
    } catch (error) {
      setSaveErrorByEvent((current) => ({ ...current, [eventId]: error instanceof Error ? error.message : "Unable to reload; draft retained." }));
    }
  }

}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="field-card">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function EditableField({
  disabled,
  label,
  value,
  placeholder,
  onChange,
}: {
  disabled: boolean;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-card">
      <span>{label}</span>
      <input disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function EditableTextArea({
  disabled,
  label,
  value,
  placeholder,
  onChange,
}: {
  disabled: boolean;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-card textarea-card">
      <span>{label}</span>
      <textarea
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
      />
    </label>
  );
}
