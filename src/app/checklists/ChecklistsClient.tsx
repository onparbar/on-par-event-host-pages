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
import {
  checklistSections,
  currency,
  defaultChecklistState,
  entertainmentAddOns,
  entertainmentUnitPrice,
  eventCompletion,
  foodAddOns,
  foodUnitPrice,
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
type KitchenSyncState = "idle" | "syncing" | "live" | "error";
type AddOnTab = "food" | "entertainment";
type ChecklistWorkspace = "checklist" | "addons";

type ChecklistSaveResponse = {
  record: ChecklistRecord;
  kitchenSync?: {
    status: "live" | "error";
    updatedAt?: string | null;
    error?: string;
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

function formatTimestamp(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
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

function mergeRecordState(record: ChecklistRecord, dateValue: string) {
  return recordToChecklistState(dateValue, record);
}

export default function ChecklistsClient({
  activeEventIds,
  events,
  workspace = "checklist",
}: {
  activeEventIds: number[];
  events: ChecklistEvent[];
  workspace?: ChecklistWorkspace;
}) {
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
  const [dirtyEventIds, setDirtyEventIds] = useState<number[]>([]);
  const [dirtyFoodEventIds, setDirtyFoodEventIds] = useState<number[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const revisionByEventRef = useRef<Record<number, number>>(
    buildInitialRevisionMap(events),
  );
  const isAddOnWorkspace = workspace === "addons";
  const sectionTitle = isAddOnWorkspace ? "Event Add-Ons" : "Event Checklists";
  const pageTitle = isAddOnWorkspace ? "Event Add-Ons" : "Digital Event Checklists";
  const pageDescription = isAddOnWorkspace
    ? "Manage Food and Entertainment add-ons in their own shared event workspace."
    : "Complete event tasks with drafts saved automatically to the shared event record.";

  async function lockPortal() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

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
              return [event.id, record ? mergeRecordState(record, event.date) : current[event.id] ?? defaultChecklistState(event.date)];
            }),
          ),
        );
        setMetaByEvent((current) => {
          const next = { ...current };
          for (const event of events) {
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

  const saveDrafts = useEffectEvent(async (eventIds: number[]) => {
    const revisionSnapshot = Object.fromEntries(eventIds.map((eventId) => [eventId, revisionByEventRef.current[eventId] ?? 0]));

    setSaveStateByEvent((current) => {
      const next = { ...current };
      for (const eventId of eventIds) {
        next[eventId] = "saving";
      }
      return next;
    });

    for (const eventId of eventIds) {
      const event = events.find((item) => item.id === eventId);
      const checklist = checklistsByEvent[eventId];
      const syncFoodAddOns = dirtyFoodEventIds.includes(eventId);

      if (!event || !checklist || metaByEvent[eventId]?.status === "submitted") {
        continue;
      }

      try {
        if (syncFoodAddOns) {
          setKitchenSyncByEvent((current) => ({
            ...current,
            [eventId]: "syncing",
          }));
        }
        const response = await fetch("/api/checklists", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            eventId,
            checklist,
            syncFoodAddOns,
          }),
        });

        if (!response.ok) {
          throw new Error("Unable to save draft.");
        }

        const payload = (await response.json()) as ChecklistSaveResponse;
        const revisionIsCurrent =
          (revisionByEventRef.current[eventId] ?? 0) ===
          revisionSnapshot[eventId];

        if (revisionIsCurrent) {
          setChecklistsByEvent((current) => ({
            ...current,
            [eventId]: mergeRecordState(payload.record, event.date),
          }));
        }
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
        }
        if (syncFoodAddOns) {
          const kitchenStatus = payload.kitchenSync?.status ?? "error";
          setKitchenSyncByEvent((current) => ({
            ...current,
            [eventId]: revisionIsCurrent
              ? kitchenStatus === "live"
                ? "live"
                : "error"
              : "idle",
          }));
          if (kitchenStatus === "live" && revisionIsCurrent) {
            setDirtyFoodEventIds((current) =>
              current.filter((item) => item !== eventId),
            );
          }
        }
      } catch {
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
      }
    }
  });

  useEffect(() => {
    if (loadState === "loading" || dirtyEventIds.length === 0) {
      return;
    }

    const eventIds = uniqueIds(dirtyEventIds);
    const timeoutId = window.setTimeout(() => {
      void saveDrafts(eventIds);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [dirtyEventIds, loadState, saveDrafts]);

  const submitChecklist = useEffectEvent(async (eventId: number) => {
    const event = events.find((item) => item.id === eventId);
    const checklist = checklistsByEvent[eventId];

    if (!event || !checklist) {
      return;
    }

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
          checklist,
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to submit checklist.");
      }

      const payload = (await response.json()) as ChecklistSaveResponse;

      setChecklistsByEvent((current) => ({
        ...current,
        [eventId]: mergeRecordState(payload.record, event.date),
      }));
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
          payload.kitchenSync?.status === "live" ? "live" : "error",
      }));
      if (payload.kitchenSync?.status === "live") {
        setDirtyFoodEventIds((current) =>
          current.filter((item) => item !== eventId),
        );
      }
    } catch {
      setSaveStateByEvent((current) => ({
        ...current,
        [eventId]: "error",
      }));
    }
  });

  const activeEvent = visibleEvents.find((event) => event.id === activeEventId) ?? visibleEvents[0];
  const activeChecklist = activeEvent ? checklistsByEvent[activeEvent.id] : undefined;
  const activeMeta = activeEvent ? metaByEvent[activeEvent.id] : undefined;
  const activeSaveState = activeEvent ? saveStateByEvent[activeEvent.id] : "idle";
  const activeKitchenSyncState = activeEvent
    ? kitchenSyncByEvent[activeEvent.id]
    : "idle";

  if (!visibleEvents.length) {
    return (
      <PortalShell
        mainClassName="page checklist-page"
        onLock={() => void lockPortal()}
        sectionSubtitle={isAddOnWorkspace ? "Food & entertainment" : "Tablet workflow"}
        sectionTitle={sectionTitle}
      >
        <PortalPageHeader
          aside={<PortalStatusBadge>Queue clear</PortalStatusBadge>}
          description={
            isAddOnWorkspace
              ? "Submitted records remain in Admin, and completed events leave the active queue automatically."
              : "Submitted checklists remain in Admin, and completed events leave the active queue automatically."
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
          <span className="meta">Only current and upcoming draft events stay on this page.</span>
        </section>
      </PortalShell>
    );
  }

  if (!activeEvent || !activeChecklist || !activeMeta) {
    return null;
  }

  const isSubmitted = activeMeta.status === "submitted";
  const isEditable = loadState !== "loading" && !isSubmitted;
  const canSubmit = isEditable && activeChecklist.bwa.trim().length > 0 && activeSaveState !== "submitting";
  const progress = eventCompletion(activeChecklist);
  const entertainmentSubtotal = entertainmentAddOns.reduce((sum, item) => {
    const state = activeChecklist.entertainment[item.key];
    return sum + entertainmentUnitPrice(item, state) * numeric(state.quantity);
  }, 0);
  const foodSubtotal = foodAddOns.reduce((sum, item) => {
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
    saveMessage = "Supabase save failed. Refresh and try again.";
  }

  return (
    <PortalShell
      mainClassName="page checklist-page"
      onLock={() => void lockPortal()}
      sectionSubtitle={isAddOnWorkspace ? "Food & entertainment" : "Tablet workflow"}
      sectionTitle={sectionTitle}
    >
      <PortalPageHeader
        aside={
          <div className="checklist-meta-card">
            <span className="eyebrow">Current Event</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {progress.completed} of {progress.total} checklist items complete
            </span>
            <span className={`sync-chip sync-chip-${activeSaveState}`}>{saveMessage}</span>
          </div>
        }
        description={pageDescription}
        eyebrow="Event Host workspace"
        title={pageTitle}
      />

        <section
          className="event-tab-strip"
          aria-label={isAddOnWorkspace ? "Event add-on tabs" : "Event checklist tabs"}
        >
          {visibleEvents.map((event) => {
            const eventState = checklistsByEvent[event.id];
            const eventMeta = metaByEvent[event.id];
            const eventProgress = eventCompletion(eventState);

            return (
              <button
                key={event.id}
                type="button"
                className={`event-switcher${event.id === activeEvent.id ? " active" : ""}`}
                onClick={() => setActiveEventId(event.id)}
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
            <Field label="POC" value={activeEvent.poc} />
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
              label="Extras Added"
              value={activeChecklist.extrasAdded}
              placeholder="Track extra items added during the event."
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
                    : "Enter the BWA name before submitting the final checklist."}
              </span>
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
            {checklistSections.map((section) => (
              <article className="task-section-card" key={section.key}>
                <header className="task-section-header">{section.title}</header>
                <div className="task-list">
                  {section.items.map((item) => (
                    <label className={`task-row${!isEditable ? " task-row-disabled" : ""}`} key={item.key}>
                      <input
                        type="checkbox"
                        checked={activeChecklist.tasks[item.key]}
                        disabled={!isEditable}
                        onChange={(event) =>
                          updateEventChecklist(activeEvent.id, (current) => ({
                            ...current,
                            tasks: {
                              ...current.tasks,
                              [item.key]: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
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
                      : "Entertainment & Drink Add-Ons"}
                  </h3>
                  <p>
                    {activeAddOnTab === "food"
                      ? "Food changes save here and are sent to the Kitchen Dashboard live."
                      : "Entertainment and drink changes stay out of Kitchen and are included in the final Admin record."}
                  </p>
                </div>
                <strong>
                  {currency(
                    activeAddOnTab === "food"
                      ? foodSubtotal
                      : entertainmentSubtotal,
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

              {activeAddOnTab === "food" ? (
                <div
                  className={`kitchen-sync-banner kitchen-sync-${activeKitchenSyncState}`}
                  role="status"
                >
                  <div>
                    <strong>
                      {activeKitchenSyncState === "syncing"
                        ? "Sending food changes to Kitchen…"
                        : activeKitchenSyncState === "live"
                          ? "Food add-ons are live in Kitchen"
                          : activeKitchenSyncState === "error"
                            ? "Kitchen live sync needs a retry"
                            : "Food add-ons save live to Kitchen"}
                    </strong>
                    <span>
                      The complete Food and Entertainment add-on record is still
                      submitted to Admin when the event is closed.
                    </span>
                  </div>
                  {activeKitchenSyncState === "error" ? (
                    <button
                      disabled={!isEditable}
                      onClick={() => retryKitchenSync(activeEvent.id)}
                      type="button"
                    >
                      Retry Kitchen Sync
                    </button>
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

              <div className="addon-grid">
                {activeAddOnTab === "entertainment"
                  ? entertainmentAddOns.map((item) => {
                  const state = activeChecklist.entertainment[item.key];
                  const unitPrice = entertainmentUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);

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
                            onChange={(event) =>
                              updateEventChecklist(activeEvent.id, (current) => ({
                                ...current,
                                entertainment: {
                                  ...current.entertainment,
                                  [item.key]: {
                                    ...current.entertainment[item.key],
                                    quantity: event.target.value,
                                  },
                                },
                              }))
                            }
                            placeholder="0"
                          />
                        </label>
                      </div>
                    </article>
                  );
                    })
                  : foodAddOns.map((item) => {
                  const state = activeChecklist.food[item.key];
                  const unitPrice = foodUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);

                  return (
                    <Fragment key={item.key}>
                      {item.key === "taco-beef" ? (
                        <div className="addon-grid-section-heading">
                          <div>
                            <span className="eyebrow">Taco Bar</span>
                            <strong>Taco Bar Items</strong>
                          </div>
                          <small>Quantities sync live to Kitchen</small>
                        </div>
                      ) : null}
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
                                updateEventChecklist(activeEvent.id, (current) => ({
                                  ...current,
                                  food: {
                                    ...current.food,
                                    [item.key]: {
                                      ...current.food[item.key],
                                      manualPrice: event.target.value,
                                    },
                                  },
                                }))
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
                            disabled={!isEditable}
                            value={state.quantity}
                            onChange={(event) =>
                              updateFoodAddOn(
                                activeEvent.id,
                                item.key,
                                event.target.value,
                              )
                            }
                            placeholder="0"
                          />
                        </label>
                      </div>
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
    if (metaByEvent[eventId]?.status === "submitted") {
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

  function updateFoodAddOn(
    eventId: number,
    key: string,
    quantity: string,
  ) {
    updateEventChecklist(eventId, (current) => ({
      ...current,
      food: {
        ...current.food,
        [key]: {
          ...current.food[key],
          quantity,
        },
      },
    }));
    setDirtyFoodEventIds((current) =>
      current.includes(eventId) ? current : [...current, eventId],
    );
    setKitchenSyncByEvent((current) => ({
      ...current,
      [eventId]: "idle",
    }));
  }

  function retryKitchenSync(eventId: number) {
    if (metaByEvent[eventId]?.status === "submitted") {
      return;
    }

    revisionByEventRef.current[eventId] =
      (revisionByEventRef.current[eventId] ?? 0) + 1;
    setDirtyFoodEventIds((current) =>
      current.includes(eventId) ? current : [...current, eventId],
    );
    setDirtyEventIds((current) =>
      current.includes(eventId) ? current : [...current, eventId],
    );
    setKitchenSyncByEvent((current) => ({
      ...current,
      [eventId]: "idle",
    }));
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
