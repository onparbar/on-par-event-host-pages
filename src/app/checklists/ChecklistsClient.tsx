"use client";

import {
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
import AddOnQuickOrder, { addQuickOrderQuantity, isValidQuickOrder, type QuickOrderInput, type QuickOrderResult } from "./AddOnQuickOrder";
import { operationalEventFromPlan } from "@/lib/operations/event-context";
import { contractSetup, reconcileChecklistSetup, setupTaskFingerprint } from "@/lib/operations/setup";
import { eventFoodDeliveryState, type EventFoodDelivery } from "@/lib/gotab/delivery";
import {
  checklistSections,
  completeChecklistTask,
  checklistEventForSelection,
  defaultChecklistState,
  entertainmentAddOns,
  entertainmentUnitPrice,
  numeric,
  recordToChecklistState,
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

const EMPTY_META: EventChecklistMeta = { status: "draft", updatedAt: null, submittedAt: null };

function recordForEvent(records: ReadonlyMap<number, ChecklistRecord>, event: ChecklistEvent) {
  const record = records.get(event.id);
  return record?.eventDate === event.date ? record : undefined;
}

function buildInitialChecklistMap(events: readonly ChecklistEvent[], records: ReadonlyMap<number, ChecklistRecord>) {
  return Object.fromEntries(events.map((event) => {
    const record = recordForEvent(records, event);
    return [event.id, record ? mergeRecordState(record, event) : defaultChecklistState(event.date)];
  }));
}

function buildInitialMetaMap(events: readonly ChecklistEvent[], records: ReadonlyMap<number, ChecklistRecord>) {
  return Object.fromEntries(events.map((event) => {
    const record = recordForEvent(records, event);
    return [event.id, record ? metaFromRecord(record) : { ...EMPTY_META }];
  }));
}

function saveStateForRecord(record?: ChecklistRecord): SaveState {
  return record?.status === "submitted" ? "submitted" : record?.updatedAt ? "saved" : "idle";
}

function snapshotIsCurrent(record: ChecklistRecord | undefined, previous: EventChecklistMeta | undefined) {
  return !previous?.updatedAt || Boolean(record?.updatedAt && Date.parse(record.updatedAt) >= Date.parse(previous.updatedAt));
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
  initialRecords,
  staffingPrefills,
  workspace = "checklist",
  sourceWarning = "",
}: {
  activeEventIds: number[];
  events: ChecklistEvent[];
  initialRecords: ChecklistRecord[] | null;
  staffingPrefills?: Readonly<Record<string, readonly string[]>>;
  workspace?: ChecklistWorkspace;
  sourceWarning?: string;
}) {
  const { preferredEventId, ready: contextReady, selectEvent, clearEvent, staffName } = useEventContext();
  const savedRecordsById = useMemo(() => new Map(initialRecords?.map((record) => [record.eventId, record])), [initialRecords]);
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
  const [checklistsByEvent, setChecklistsByEvent] = useState<Record<number, EventChecklistState>>(
    () => buildInitialChecklistMap(events, savedRecordsById),
  );
  const [metaByEvent, setMetaByEvent] = useState<Record<number, EventChecklistMeta>>(
    () => buildInitialMetaMap(events, savedRecordsById),
  );
  const [saveStateByEvent, setSaveStateByEvent] = useState<Record<number, SaveState>>(
    () => Object.fromEntries(events.map((event) => [event.id, saveStateForRecord(recordForEvent(savedRecordsById, event))])),
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
  const loadState = initialRecords === null ? "error" : "ready";
  const [saveErrorByEvent, setSaveErrorByEvent] = useState<Record<number, string>>({});
  const [conflictByEvent, setConflictByEvent] = useState<Record<number, boolean>>({});
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const [warningConfirmationByEvent, setWarningConfirmationByEvent] = useState<Record<number, { sourceFingerprint: string; employeeName: string }>>({});
  const inFlightEventIds = useRef(new Set<number>());
  const finalSubmissionEventIds = useRef(new Set<number>());
  const touchedBwaEventIds = useRef(new Set<number>());
  const metaByEventRef = useRef(metaByEvent);
  const appliedSnapshot = useRef({ events, savedRecordsById });
  const revisionByEventRef = useRef<Record<number, number>>(
    buildInitialRevisionMap(events),
  );
  const isAddOnWorkspace = workspace === "addons";
  const sectionTitle = isAddOnWorkspace ? "Event Add-Ons" : "Event Checklists";
  const pageTitle = isAddOnWorkspace ? "Event Add-Ons" : "Digital Event Checklists";
  const pageDescription = isAddOnWorkspace
    ? "Choose an item, enter the quantity, and submit."
    : "Complete event tasks with drafts saved automatically to the shared event record.";
  const draftSavePending = dirtyEventIds.some((eventId) => inFlightEventIds.current.has(eventId) || (
    loadState === "ready" && !conflictByEvent[eventId] && saveStateByEvent[eventId] !== "error" &&
    metaByEvent[eventId]?.status !== "submitted" && events.some((event) => event.id === eventId)
  ));

  function beforeNavigate() {
    if (draftSavePending) {
      setNavigationBlocked(true);
      return false;
    }
    return !dirtyEventIds.length || window.confirm("This tab has unsaved checklist changes. Leave and discard those changes?");
  }

  useEffect(() => {
    function receiveWorkspaceUpdate(event: Event) {
      const record = (event as CustomEvent<{ record?: ChecklistRecord }>).detail?.record;
      if (!record) return;
      const plan = events.find((item) => item.id === record.eventId);
      const previous = metaByEventRef.current[record.eventId];
      if (!plan || plan.date !== record.eventDate || previous?.updatedAt === record.updatedAt || !snapshotIsCurrent(record, previous)) return;
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
    const previous = appliedSnapshot.current;
    if (previous.events === events && previous.savedRecordsById === savedRecordsById) return;
    appliedSnapshot.current = { events, savedRecordsById };
    if (loadState !== "ready") return;

    // A server navigation may have started before a local edit, save, or live refresh.
    const updates = events.flatMap((event) => {
      if ((revisionByEventRef.current[event.id] ?? 0) > 0 || inFlightEventIds.current.has(event.id)) return [];
      const record = recordForEvent(savedRecordsById, event);
      if (!snapshotIsCurrent(record, metaByEventRef.current[event.id])) return [];
      return [{ id: event.id, checklist: record ? mergeRecordState(record, event) : defaultChecklistState(event.date),
        meta: record ? metaFromRecord(record) : { ...EMPTY_META }, save: saveStateForRecord(record) }];
    });
    if (!updates.length) return;
    const nextMeta = Object.fromEntries(updates.map(({ id, meta }) => [id, meta]));
    metaByEventRef.current = { ...metaByEventRef.current, ...nextMeta };
    setChecklistsByEvent((current) => ({ ...current, ...Object.fromEntries(updates.map(({ id, checklist }) => [id, checklist])) }));
    setMetaByEvent((current) => ({ ...current, ...nextMeta }));
    setSaveStateByEvent((current) => ({ ...current, ...Object.fromEntries(updates.map(({ id, save }) => [id, save])) }));
  }, [events, loadState, savedRecordsById]);

  useEffect(() => {
    if (!draftSavePending) setNavigationBlocked(false);
  }, [draftSavePending]);

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
    if (loadState !== "ready") return savedEventIds;
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

    if (loadState !== "ready" || !event || !checklist || metaByEventRef.current[eventId]?.status === "submitted" || conflictByEvent[eventId] || inFlightEventIds.current.has(eventId)) {
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
        const previous = metaByEventRef.current[pollingEventId!];
        if (!record || !event || record.eventDate !== event.date || previous?.updatedAt === record.updatedAt || !snapshotIsCurrent(record, previous)) return;
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

  const savedRecordsError = loadState === "error" ? <section className="checklist-meta-card" role="alert">
    <strong>{isAddOnWorkspace ? "Unable to load saved add-ons. Ordering is paused." : "Unable to load saved checklists. Editing is paused."}</strong>
    <button type="button" onClick={() => { if (!dirtyEventIds.length || window.confirm("Discard this screen’s unsaved drafts and reload?")) window.location.reload(); }}>{isAddOnWorkspace ? "Reload saved add-ons" : "Reload saved checklists"}</button>
  </section> : null;

  if (preferredEventId && !checklistEventForSelection(visibleEvents, preferredEventId, 0)) {
    return <PortalShell mainClassName="page checklist-page" sectionTitle={sectionTitle} sectionSubtitle="Selected event">{savedRecordsError}<section className="checklist-meta-card"><strong>The selected event is not available in this active workspace.</strong><p>It may already be submitted or outside the active event window. No other party has been selected automatically.</p><button type="button" onClick={clearEvent}>Choose another event</button></section></PortalShell>;
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
        {savedRecordsError}
        {sourceWarning ? <section className="checklist-meta-card" role="alert">{sourceWarning}</section> : null}
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
    return <PortalShell mainClassName="page checklist-page" sectionTitle={sectionTitle} sectionSubtitle="Event workspace"><p role="status">Loading the selected event workspace…</p></PortalShell>;
  }

  const isSubmitted = activeMeta.status === "submitted";
  const isEditable = loadState === "ready" && !isSubmitted && activeSaveState !== "submitting";
  const assignedBwaNames = isEditable && !activeChecklist.bwa && !activeMeta.updatedAt
    && !recordForEvent(savedRecordsById, activeEvent) && !touchedBwaEventIds.current.has(activeEvent.id)
    ? staffingPrefills?.[activeEvent.source_event_id ?? String(activeEvent.id)] ?? [] : [];
  const foodSaveBusy = activeKitchenSyncState === "syncing" || activeSaveState === "saving";
  const canSendFood = isEditable && !conflictByEvent[activeEvent.id] && !foodSaveBusy;
  const readiness = activeReadiness!;
  const setup = contractSetup(activeEvent);
  const warningActor = staffName.trim() || activeChecklist.bwa.trim();
  const warningConfirmation = warningConfirmationByEvent[activeEvent.id];
  const warningsConfirmed = Boolean(readiness.warningFingerprint && warningConfirmation?.sourceFingerprint === readiness.warningFingerprint && warningConfirmation.employeeName === warningActor);
  const canSubmit = isEditable && (readiness.canSubmit || warningsConfirmed && readiness.canSubmitAfterWarningConfirmation) && !conflictByEvent[activeEvent.id] && !["submitting", "saving"].includes(activeSaveState);
  const progress = readiness;

  let saveMessage = "Draft not saved yet.";
  if (loadState === "error") {
    saveMessage = "Saved checklists unavailable. Editing is paused.";
  } else if (activeSaveState === "saving") {
    saveMessage = "Saving draft to Supabase…";
  } else if (activeSaveState === "submitting") {
    saveMessage = "Submitting final checklist…";
  } else if (activeMeta.status === "submitted" && activeMeta.submittedAt) {
    saveMessage = `Submitted ${formatTimestamp(activeMeta.submittedAt)}`;
  } else if (activeSaveState === "saved" && activeMeta.updatedAt) {
    saveMessage = `Draft saved ${formatTimestamp(activeMeta.updatedAt)}`;
  } else if (activeSaveState === "error") {
    saveMessage = saveErrorByEvent[activeEvent.id] ?? "Save unavailable. Your draft is retained on this screen; do not close it before resolving the error.";
  }

  return (
    <PortalShell
      beforeNavigate={beforeNavigate}
      mainClassName="page checklist-page"
      sectionSubtitle={isAddOnWorkspace ? "Food & entertainment" : "Tablet workflow"}
      sectionTitle={sectionTitle}
    >
      <EventSelectionBridge event={operationalEventFromPlan(activeEvent)} />
      <PortalPageHeader
        aside={!isAddOnWorkspace ?
          <div className="checklist-meta-card">
            <span className="eyebrow">Current Event</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">{progress.completed} of {progress.total} required checklist items complete</span>
            <progress aria-label="Checklist completion" className="checklist-progress" max={Math.max(1, progress.total)} value={progress.completed} />
            <span className={`sync-chip sync-chip-${activeSaveState}`}>{saveMessage}</span>
          </div>
          : null}
        description={pageDescription}
        eyebrow="Event Host workspace"
        title={pageTitle}
      />
      {sourceWarning ? <section className="checklist-meta-card" role="alert">{sourceWarning}</section> : null}
      {!isAddOnWorkspace ? savedRecordsError : null}
      {navigationBlocked && draftSavePending ? <p className="portal-navigation-notice" role="status">Please wait for your checklist draft to save before switching tabs.</p> : null}

      {conflictByEvent[activeEvent.id] ? <section className="checklist-meta-card" role="alert">
        <strong>A newer saved version exists. Your draft is still here.</strong>
        <p>Review your unsaved changes before reloading. Reloading discards this screen’s draft; it does not overwrite the other staff member’s saved work.</p>
        <button type="button" onClick={() => void reloadChecklist(activeEvent.id)}>Reload latest and review</button>
      </section> : null}
      {!isAddOnWorkspace && activeSaveState === "error" && !conflictByEvent[activeEvent.id] ? <section className="checklist-meta-card" role="alert"><p>Automatic saving is paused after the error. Your draft is still on this screen. This retry saves the draft only; food items still require their own Submit button.</p><button type="button" onClick={() => setSaveStateByEvent((current) => ({ ...current, [activeEvent.id]: "idle" }))}>Retry saving draft</button></section> : null}

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
                  {event.dateLabel}{!isAddOnWorkspace ? ` · ${eventMeta.status === "submitted" ? "Submitted" : "Draft"} · ${eventProgress.completed}/${eventProgress.total}` : ""}
                </small>
              </button>
            );
          })}
        </section>

        {!isAddOnWorkspace ? <section className="event-header-card">
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
            <div>
              <EditableField
                disabled={!isEditable}
                label="BWA"
                value={activeChecklist.bwa}
                placeholder={assignedBwaNames.join(", ") || "Type employee name"}
                onChange={(value) => enterBwa(value)}
              />
              {assignedBwaNames.length ? <div className="meta">
                <p>From this event’s staffing assignment. Choose the BWA or type another name.</p>
                {assignedBwaNames.map((name) => <button type="button" className="button-link" key={name} onClick={() => enterBwa(name)}>Use {name}</button>)}
              </div> : null}
            </div>
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
            {isSubmitted ? <div className="action-copy">
              <strong>Final checklist submitted</strong>
              <span className="meta">
                Submitted checklists are locked to preserve the final event record.
              </span>
            </div> : !activeChecklist.bwa.trim() ? <span className="meta">Enter the BWA name before submitting.</span> : null}
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
        </section> : null}

        {!isAddOnWorkspace ? (
          <section className="paper-checklist">
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
                        checked={activeChecklist.tasks[item.key]}
                        disabled={!isEditable || !(staffName.trim() || activeChecklist.bwa.trim())}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          updateEventChecklist(activeEvent.id, (current) => completeChecklistTask(current, item.key, checked, staffName, new Date().toISOString(), setupTaskFingerprint(activeEvent, item.key, setup)));
                        }}
                      />
                      <span>{item.label}{requirement.critical && requirement.applicability !== "optional" ? " · Critical" : ""}<small className="meta">{requirement.applicability === "optional" ? "Available if needed — check against the contract." : requirement.applicability === "needs-review" ? requirement.reason : requirement.dueAt ? `Due ${formatTimestamp(requirement.dueAt)} Eastern` : section.title}{evidence && activeChecklist.tasks[item.key] ? ` · Recorded by ${evidence.employeeName} · ${formatTimestamp(evidence.completedAt)} Eastern` : ""}</small></span>
                    </label>
                  ); })}
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section aria-label="Add-on ordering">
            {savedRecordsError}
            <AddOnQuickOrder
              key={`${activeEvent.id}:${activeEvent.date}`}
              eventName={activeEvent.name}
              eventDate={activeEvent.date}
              errorMessage={kitchenSyncErrorByEvent[activeEvent.id]}
              existingEntertainment={activeChecklist.entertainment}
              getItemResult={(key) => {
                const state = foodSubmitByItem[`${activeEvent.id}:${key}`];
                return state === "sent" ? "accepted" : state === "pending" || state === "error" || state === "uncertain" ? state : null;
              }}
              disabled={!canSendFood}
              isItemLocked={(key) => foodSubmissionLocked(foodSubmitByItem[`${activeEvent.id}:${key}`])}
              onSubmit={(order) => submitQuickOrder(activeEvent.id, order)}
            />
            {activeKitchenSyncState === "pending" || activeKitchenSyncState === "error" ? <div className="checklist-meta-card" role={activeKitchenSyncState === "error" ? "alert" : "status"}>
              <strong>{activeKitchenSyncState === "pending" ? "Saved · Waiting for GoTab acceptance" : "Order needs attention"}</strong>
              <span>{kitchenSyncErrorByEvent[activeEvent.id] || "Check the saved order before submitting again."}</span>
              {deliveryByEvent[activeEvent.id]?.filter((item) => !eventFoodDeliveryState(item).accepted).map((item) => <small key={item.requestId}>{item.quantity} × {item.foodName} · {eventFoodDeliveryState(item).label} · Order: {item.orderReference ?? "Not yet available"}</small>)}
            </div> : null}
          </section>
        )}
    </PortalShell>
  );

  function enterBwa(value: string) {
    if (!activeEvent) return;
    touchedBwaEventIds.current.add(activeEvent.id);
    updateEventChecklist(activeEvent.id, (current) => ({ ...current, bwa: value }));
  }

  function updateEventChecklist(eventId: number, updater: (current: EventChecklistState) => EventChecklistState) {
    if (loadState !== "ready" || metaByEventRef.current[eventId]?.status === "submitted" || finalSubmissionEventIds.current.has(eventId)) {
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

  async function submitQuickOrder(eventId: number, order: QuickOrderInput): Promise<QuickOrderResult> {
    const current = checklistsByEvent[eventId];
    const event = events.find((item) => item.id === eventId);
    const itemStateKey = `${eventId}:${order.key}`;
    if (!event || !current || !isValidQuickOrder(order) || loadState !== "ready" ||
      metaByEventRef.current[eventId]?.status === "submitted" || conflictByEvent[eventId] ||
      finalSubmissionEventIds.current.has(eventId) || inFlightEventIds.current.has(eventId) ||
      foodSubmissionLocked(foodSubmitByItem[itemStateKey])) return "error";
    const foodOrder = order.category !== "entertainment";
    const priorEntertainment = current.entertainment[order.key];
    const entertainmentItem = entertainmentAddOns.find((item) => item.key === order.key);
    const entertainmentQuantity = foodOrder ? null : addQuickOrderQuantity(priorEntertainment.quantity, order.quantity);
    if (!foodOrder && (entertainmentQuantity === null || numeric(priorEntertainment.quantity) > 0 && entertainmentItem &&
      entertainmentUnitPrice(entertainmentItem, priorEntertainment) !== entertainmentUnitPrice(entertainmentItem, order))) {
      setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: "Use the existing event rate for this add-on. Earlier quantities and prices have not been changed." }));
      setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "error" }));
      return "error";
    }
    const checklist: EventChecklistState = foodOrder
      ? { ...current, food: { ...current.food, [order.key]: { ...current.food[order.key], quantity: order.quantity, panSize: order.panSize, notes: order.notes } } }
      : { ...current, entertainment: { ...current.entertainment, [order.key]: {
        ...current.entertainment[order.key],
        quantity: entertainmentQuantity!,
        selectedRateKey: order.selectedRateKey,
        manualPrice: order.manualPrice,
      } } };
    // Keep keypad drafts local. Only this explicit Submit can save or dispatch.
    inFlightEventIds.current.add(eventId);
    revisionByEventRef.current[eventId] = (revisionByEventRef.current[eventId] ?? 0) + 1;
    setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "submitting" }));
    setSaveStateByEvent((current) => ({ ...current, [eventId]: "saving" }));
    if (foodOrder) setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "syncing" }));
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
          syncFoodAddOns: foodOrder,
          ...(foodOrder ? { syncFoodAddOnKeys: [order.key], sourceType: order.category === "refills" ? "REFILL" : "EVENT_HOST_ADDON" } : {}),
          ...((staffName.trim() || current.bwa.trim()) ? { requesterName: staffName.trim() || current.bwa.trim() } : {}),
        }),
      });
      const payload = await response.json() as ChecklistSaveResponse;
      if (response.status === 409) setConflictByEvent((current) => ({ ...current, [eventId]: true }));
      if (!response.ok) {
        // A conflict or rejected request is not evidence that an order was accepted.
        outcomeUncertain = response.status >= 500;
        throw new Error(payload.error ?? "Unable to save this order. Your entries are retained.");
      }
      if (!payload.record || payload.record.eventId !== eventId || payload.record.eventDate !== event.date ||
        payload.record.status !== "draft" || !payload.record.updatedAt || !Number.isFinite(Date.parse(payload.record.updatedAt))) {
        throw new Error("The saved order could not be verified for this event. Check the saved record before submitting again.");
      }
      metaByEventRef.current[eventId] = metaFromRecord(payload.record);
      setMetaByEvent((current) => ({ ...current, [eventId]: metaFromRecord(payload.record) }));
      setChecklistsByEvent((current) => ({ ...current, [eventId]: mergeRecordState(payload.record, event) }));
      setSaveStateByEvent((current) => ({ ...current, [eventId]: "saved" }));
      setDirtyEventIds((current) => current.filter((id) => id !== eventId));
      window.dispatchEvent(new Event("event-host:checklist-updated"));
      if (!foodOrder) {
        setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "sent" }));
        return "accepted";
      }
      rememberDelivery(eventId, payload.kitchenSync?.deliveries);
      if (payload.kitchenSync?.status === "pending" && payload.kitchenSync.requestIds?.length) {
        setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "pending" }));
        setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "pending" }));
        setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: "No approval is needed. Delivery status updates automatically; do not submit again." }));
        setPendingFoodByItem((current) => ({ ...current, [itemStateKey]: { eventId, kitchenEventId: payload.kitchenSync!.eventId ?? String(eventId), requestIds: payload.kitchenSync!.requestIds! } }));
        return "pending";
      }
      if (payload.kitchenSync?.status !== "live") {
        outcomeUncertain = !payload.kitchenSync?.exceptions &&
          (!payload.kitchenSync?.deliveries?.length || payload.kitchenSync.deliveries.some((item) => ["HELD", "SENDING", "UNKNOWN"].includes(item.status)));
        throw new Error(payload.kitchenSync?.error ?? "GoTab acceptance is not confirmed. Check the saved order before submitting again.");
      }
      setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: "sent" }));
      setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "live" }));
      return "accepted";
    } catch (error) {
      setFoodSubmitByItem((current) => ({ ...current, [itemStateKey]: outcomeUncertain ? "uncertain" : "error" }));
      setSaveStateByEvent((current) => ({ ...current, [eventId]: "error" }));
      setSaveErrorByEvent((current) => ({ ...current, [eventId]: error instanceof Error ? error.message : "Unable to save this order." }));
      setKitchenSyncByEvent((current) => ({ ...current, [eventId]: "error" }));
      setKitchenSyncErrorByEvent((current) => ({ ...current, [eventId]: error instanceof Error ? error.message : "Order acceptance could not be confirmed." }));
      return outcomeUncertain ? "uncertain" : "error";
    } finally { inFlightEventIds.current.delete(eventId); }
  }

  async function reloadChecklist(eventId: number) {
    setWarningConfirmationByEvent((current) => {
      const next = { ...current };
      delete next[eventId];
      return next;
    });
    const event = events.find((item) => item.id === eventId);
    if (!event || inFlightEventIds.current.has(eventId) || !window.confirm("Discard this screen’s unsaved draft and load the latest saved checklist?")) return;
    const revision = revisionByEventRef.current[eventId] ?? 0;
    try {
      const response = await fetch(`/api/checklists?eventId=${encodeURIComponent(String(eventId))}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to reload. Your draft has been kept.");
      const payload = await response.json() as { records?: ChecklistRecord[] };
      const record = payload.records?.find((item) => item.eventId === eventId);
      if (inFlightEventIds.current.has(eventId) || (revisionByEventRef.current[eventId] ?? 0) !== revision ||
        (record && record.eventDate !== event.date) || !snapshotIsCurrent(record, metaByEventRef.current[eventId])) {
        throw new Error("A newer draft or different event was detected. Your draft has been kept.");
      }
      const meta = record ? metaFromRecord(record) : { ...EMPTY_META };
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
