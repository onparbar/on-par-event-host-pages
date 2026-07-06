"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { checklistEvents } from "@/lib/checklist-events";
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

function buildInitialChecklistMap() {
  return Object.fromEntries(checklistEvents.map((event) => [event.id, defaultChecklistState(event.date)]));
}

function buildInitialMetaMap() {
  return Object.fromEntries(
    checklistEvents.map((event) => [
      event.id,
      {
        status: "draft" as ChecklistRecordStatus,
        updatedAt: null,
        submittedAt: null,
      },
    ]),
  );
}

function buildInitialSaveStateMap() {
  return Object.fromEntries(checklistEvents.map((event) => [event.id, "idle" as SaveState]));
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

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Event Checklists</h1>
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/">Home</Link>
        <Link href="/floor-plans">Floor Plans</Link>
        <Link href="/entertainment-schedules">Entertainment Schedules</Link>
        <Link href="/itineraries">Itineraries</Link>
        <Link href="/checklists">Checklists</Link>
        <Link href="/admin">Admin</Link>
      </nav>
    </header>
  );
}

export default function ChecklistsPage() {
  const [activeEventId, setActiveEventId] = useState<number>(checklistEvents[0]?.id ?? 0);
  const [activeEventTab, setActiveEventTab] = useState<"checklist" | "addons">("checklist");
  const [checklistsByEvent, setChecklistsByEvent] = useState<Record<number, EventChecklistState>>(buildInitialChecklistMap);
  const [metaByEvent, setMetaByEvent] = useState<Record<number, EventChecklistMeta>>(buildInitialMetaMap);
  const [saveStateByEvent, setSaveStateByEvent] = useState<Record<number, SaveState>>(buildInitialSaveStateMap);
  const [dirtyEventIds, setDirtyEventIds] = useState<number[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const revisionByEventRef = useRef<Record<number, number>>(Object.fromEntries(checklistEvents.map((event) => [event.id, 0])));

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
            checklistEvents.map((event) => {
              const record = recordsById.get(event.id);
              return [event.id, record ? mergeRecordState(record, event.date) : current[event.id] ?? defaultChecklistState(event.date)];
            }),
          ),
        );
        setMetaByEvent((current) => {
          const next = { ...current };
          for (const event of checklistEvents) {
            const record = recordsById.get(event.id);
            if (record) {
              next[event.id] = metaFromRecord(record);
            }
          }
          return next;
        });
        setSaveStateByEvent((current) => {
          const next = { ...current };
          for (const event of checklistEvents) {
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
  }, []);

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
      const event = checklistEvents.find((item) => item.id === eventId);
      const checklist = checklistsByEvent[eventId];

      if (!event || !checklist || metaByEvent[eventId]?.status === "submitted") {
        continue;
      }

      try {
        const response = await fetch("/api/checklists", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            eventId,
            checklist,
          }),
        });

        if (!response.ok) {
          throw new Error("Unable to save draft.");
        }

        const payload = (await response.json()) as { record: ChecklistRecord };

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
          [eventId]: payload.record.status === "submitted" ? "submitted" : "saved",
        }));
        if ((revisionByEventRef.current[eventId] ?? 0) === revisionSnapshot[eventId]) {
          setDirtyEventIds((current) => current.filter((item) => item !== eventId));
        }
      } catch {
        setSaveStateByEvent((current) => ({
          ...current,
          [eventId]: "error",
        }));
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
    const event = checklistEvents.find((item) => item.id === eventId);
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

      const payload = (await response.json()) as { record: ChecklistRecord };

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
    } catch {
      setSaveStateByEvent((current) => ({
        ...current,
        [eventId]: "error",
      }));
    }
  });

  const activeEvent = checklistEvents.find((event) => event.id === activeEventId) ?? checklistEvents[0];
  const activeChecklist = activeEvent ? checklistsByEvent[activeEvent.id] : undefined;
  const activeMeta = activeEvent ? metaByEvent[activeEvent.id] : undefined;
  const activeSaveState = activeEvent ? saveStateByEvent[activeEvent.id] : "idle";

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
    <>
      <Header />
      <main className="page checklist-page">
        <section className="intro">
          <div>
            <h2>Digital Event Checklists</h2>
            <p>Each event has its own checklist page and add-on page. Drafts save to Supabase and final checklists can be submitted here.</p>
          </div>
          <div className="checklist-meta-card">
            <span className="eyebrow">Current Event</span>
            <strong>{activeEvent.name}</strong>
            <span className="meta">
              {progress.completed} of {progress.total} checklist items complete
            </span>
            <span className={`sync-chip sync-chip-${activeSaveState}`}>{saveMessage}</span>
          </div>
        </section>

        <section className="event-tab-strip" aria-label="Event checklist tabs">
          {checklistEvents.map((event) => {
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
              <strong>{isSubmitted ? "Final checklist submitted" : "Draft saves automatically"}</strong>
              <span className="meta">
                {isSubmitted
                  ? "Submitted checklists are locked to preserve the final event record."
                  : canSubmit
                    ? "Use the submit button when the event checklist is final."
                    : "Enter the BWA name before submitting the final checklist."}
              </span>
            </div>
            <button
              type="button"
              className={`submit-button${isSubmitted ? " submitted" : ""}`}
              disabled={!canSubmit || isSubmitted}
              onClick={() => void submitChecklist(activeEvent.id)}
            >
              {activeSaveState === "submitting" ? "Submitting..." : isSubmitted ? "Checklist Submitted" : "Submit Final Checklist"}
            </button>
          </div>
        </section>

        <section className="sheet-tab-strip" aria-label="Event detail tabs">
          <button
            type="button"
            className={`sheet-tab${activeEventTab === "checklist" ? " active" : ""}`}
            onClick={() => setActiveEventTab("checklist")}
          >
            Checklist Page
          </button>
          <button
            type="button"
            className={`sheet-tab${activeEventTab === "addons" ? " active" : ""}`}
            onClick={() => setActiveEventTab("addons")}
          >
            Add-On Page
          </button>
        </section>

        {activeEventTab === "checklist" ? (
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
                  <h3>Entertainment &amp; Drink Add-Ons</h3>
                  <p>Use the required pricing rules for each event add-on.</p>
                </div>
                <strong>{currency(entertainmentSubtotal)}</strong>
              </div>
              <div className="addon-grid">
                {entertainmentAddOns.map((item) => {
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
                })}
              </div>
            </article>

            <article className="addon-card">
              <div className="addon-card-header">
                <div>
                  <h3>Food Add-Ons</h3>
                  <p>Locked prices stay fixed. Dessert Platter can be edited manually.</p>
                </div>
                <strong>{currency(foodSubtotal)}</strong>
              </div>
              <div className="addon-grid">
                {foodAddOns.map((item) => {
                  const state = activeChecklist.food[item.key];
                  const unitPrice = foodUnitPrice(item, state);
                  const subtotal = unitPrice * numeric(state.quantity);

                  return (
                    <article className="addon-row-card" key={item.key}>
                      <div className="addon-row-top">
                        <div>
                          <h4>{item.label}</h4>
                          <p>{item.kind === "manual-price" ? "Manual price" : "Locked price"}</p>
                        </div>
                        <strong>{currency(subtotal)}</strong>
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
                                food: {
                                  ...current.food,
                                  [item.key]: {
                                    ...current.food[item.key],
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
            </aside>
          </section>
        )}
      </main>
    </>
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
