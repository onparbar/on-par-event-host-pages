"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import EditableAssetSection from "@/app/_components/EditableAssetSection";
import AdminFloorPlanAssets from "./AdminFloorPlanAssets";
import {
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import {
  checklistSections,
  entertainmentAddOns,
  foodAddOns,
  type ChecklistRecord,
} from "@/lib/checklist-model";
import type { AdminState } from "@/lib/admin-types";
import type {
  AdminContractEvidence,
  AdminEventCompleteness,
  AdminOperationsConflict,
  AdminOperationsPayload,
} from "@/lib/admin-operations";
import { formatEventDate } from "@/lib/event-format";

type AdminDateAsset = {
  date: string;
  label: string;
  image: string;
  events: string[];
  source?: string;
};

type ChecklistEventSummary = {
  id: number;
  name: string;
  date: string;
  time: string;
  poc: string;
};

type AdminClientProps = {
  checklistEventSummaries: ChecklistEventSummary[];
  entertainmentSchedules: AdminDateAsset[];
  floorPlans: AdminDateAsset[];
  initialState: AdminState;
  localPreview: boolean;
  operations: AdminOperationsPayload;
  records: ChecklistRecord[];
  today: string;
};

type AdminTab = "readiness" | "assets" | "completed";

type EvidenceState = "idle" | "loading" | "ready" | "error";

function submittedAddOnLines(record: ChecklistRecord) {
  const entertainmentLines = entertainmentAddOns
    .map((config) => {
      const value = record.entertainment?.[config.key];
      if (!value?.quantity) {
        return null;
      }
      const details = [value.quantity];
      if (value.manualPrice) {
        details.push(`$${value.manualPrice}`);
      }
      if (value.selectedRateKey) {
        details.push(value.selectedRateKey);
      }
      return `${config.label}: ${details.join(" | ")}`;
    })
    .filter(Boolean) as string[];

  const foodLines = foodAddOns
    .map((config) => {
      const value = record.food?.[config.key];
      if (!value?.quantity) {
        return null;
      }
      const details = [value.quantity];
      if (value.manualPrice) {
        details.push(`$${value.manualPrice}`);
      }
      return `${config.label}: ${details.join(" | ")}`;
    })
    .filter(Boolean) as string[];

  return [...entertainmentLines, ...foodLines];
}

function completedTaskCount(record: ChecklistRecord) {
  const total = checklistSections.reduce((sum, section) => sum + section.items.length, 0);
  const completed = Object.values(record.tasks ?? {}).filter(Boolean).length;
  return { completed, total };
}

export default function AdminClient({
  checklistEventSummaries,
  entertainmentSchedules,
  floorPlans,
  initialState,
  localPreview,
  operations,
  records,
  today,
}: AdminClientProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("readiness");
  const [assetEditorMode, setAssetEditorMode] = useState<
    "entertainment" | "floor-plans"
  >("floor-plans");
  const [adminState, setAdminState] = useState<AdminState>(initialState);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [evidenceEventId, setEvidenceEventId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<AdminContractEvidence | null>(null);
  const [evidenceState, setEvidenceState] = useState<EvidenceState>("idle");
  const closeEvidenceDrawer = useCallback(() => setEvidenceEventId(null), []);

  const submittedRecords = records
    .filter((record) => record.status === "submitted" && record.eventId !== 99990001)
    .sort((left, right) => (right.submittedAt || "").localeCompare(left.submittedAt || ""));

  useEffect(() => {
    if (adminState === initialState) {
      return;
    }

    setSaveState("saving");
    const timeoutId = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const response = await fetch("/api/admin-state", {
            method: "PUT",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              state: adminState,
            }),
          });

          if (!response.ok) {
            throw new Error("Unable to save admin changes.");
          }

          setSaveState("saved");
          window.setTimeout(() => setSaveState("idle"), 1400);
        } catch {
          setSaveState("error");
        }
      });
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [adminState, initialState]);

  useEffect(() => {
    if (evidenceEventId === null) {
      setEvidence(null);
      setEvidenceState("idle");
      return;
    }
    const controller = new AbortController();
    setEvidence(null);
    setEvidenceState("loading");
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/events/${encodeURIComponent(evidenceEventId)}/evidence`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as
          | (AdminContractEvidence & { error?: string })
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error || "Unable to load source evidence.");
        }
        setEvidence(payload);
        setEvidenceState("ready");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setEvidenceState("error");
        }
      }
    })();
    return () => controller.abort();
  }, [evidenceEventId]);

  async function handleLogout() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  function archiveDate(date: string, nextArchived: boolean) {
    const schedule = entertainmentSchedules.find((item) => item.date === date);
    const eventIds = checklistEventSummaries
      .filter((item) => item.date === date)
      .map((item) => item.id);

    setAdminState((current) => {
      const archivedAssetKeys = new Set(current.archivedAssetKeys);
      const archivedEventIds = new Set(current.archivedEventIds);

      for (const key of [schedule?.image].filter(Boolean) as string[]) {
        if (nextArchived) {
          archivedAssetKeys.add(key);
        } else {
          archivedAssetKeys.delete(key);
        }
      }

      for (const eventId of eventIds) {
        if (nextArchived) {
          archivedEventIds.add(eventId);
        } else {
          archivedEventIds.delete(eventId);
        }
      }

      return {
        ...current,
        archivedAssetKeys: Array.from(archivedAssetKeys),
        archivedEventIds: Array.from(archivedEventIds),
      };
    });
  }

  return (
    <PortalShell
      mainClassName="page admin-page"
      onLock={() => void handleLogout()}
      blocked={evidenceEventId !== null}
      sectionSubtitle="Portal controls"
      sectionTitle="Admin"
    >
      <div
        aria-hidden={evidenceEventId !== null ? true : undefined}
        className="admin-dashboard-content"
        inert={evidenceEventId !== null ? true : undefined}
      >
      <PortalPageHeader
        aside={
          <div className="admin-status-group">
            <PortalStatusBadge
              tone={operations.completeness.some((event) => event.issueCount > 0) ? "warning" : "success"}
            >
              {operations.completeness.filter((event) => event.issueCount > 0).length} events need review
            </PortalStatusBadge>
            <PortalStatusBadge tone={operations.conflicts.length ? "danger" : "success"}>
              {operations.conflicts.length} conflicts
            </PortalStatusBadge>
            <PortalStatusBadge
              tone={
                saveState === "error"
                  ? "danger"
                  : saveState === "saved"
                    ? "success"
                    : saveState === "saving"
                      ? "warning"
                      : "neutral"
              }
            >
              {saveState === "idle" ? "Admin changes ready" : saveState}
            </PortalStatusBadge>
          </div>
        }
        description="Manage published assets, live operations, and submitted staff records."
        eyebrow="Protected operations"
        title="Admin Dashboard"
      />

        {localPreview ? (
          <section className="admin-local-preview-notice" role="status">
            <strong>Local preview</strong>
            <span>
              Readiness cards use the existing redacted Event Host records. Live Supabase and Tripleseat data are not being shown.
            </span>
          </section>
        ) : null}

        <section className="portal-operations-grid" aria-label="Live operations">
          <Link className="portal-operation-card" href="/admin/floor-plans">
            <span className="portal-module-kicker">Live Tripleseat sync</span>
            <strong>Floor Plans</strong>
            <span>Synchronize, edit, validate, approve, and print operational floor plans.</span>
          </Link>
          <Link className="portal-operation-card" href="/entertainment-schedules">
            <span className="portal-module-kicker">Supabase-backed</span>
            <strong>Entertainment Schedule</strong>
            <span>Open live reservations, conflicts, audits, and Tripleseat sync.</span>
          </Link>
          <Link className="portal-operation-card" href="/kitchen">
            <span className="portal-module-kicker">Live production</span>
            <strong>Kitchen Dashboard</strong>
            <span>Review definite events, prep timing, readiness, and BWA assignments.</span>
          </Link>
          <Link className="portal-operation-card" href="/event-host-addons">
            <span className="portal-module-kicker">Unified event record</span>
            <strong>Event Add-Ons</strong>
            <span>Enter Food and Entertainment additions; only Food is mirrored live to Kitchen.</span>
          </Link>
        </section>

        <section className="sheet-tab-strip" aria-label="Admin sections">
          <button aria-pressed={activeTab === "readiness"} className={`sheet-tab${activeTab === "readiness" ? " active" : ""}`} onClick={() => setActiveTab("readiness")} type="button">
            Event Readiness
          </button>
          <button aria-pressed={activeTab === "assets"} className={`sheet-tab${activeTab === "assets" ? " active" : ""}`} onClick={() => setActiveTab("assets")} type="button">
            Asset Editor
          </button>
          <button aria-pressed={activeTab === "completed"} className={`sheet-tab${activeTab === "completed" ? " active" : ""}`} onClick={() => setActiveTab("completed")} type="button">
            Completed Checklists
          </button>
        </section>

        {activeTab === "readiness" ? (
          <AdminOperationsReview
            onViewSource={setEvidenceEventId}
            operations={operations}
          />
        ) : activeTab === "assets" ? (
          <>
            <section className="sheet-tab-strip" aria-label="Asset editor type">
              <button
                aria-pressed={assetEditorMode === "floor-plans"}
                className={`sheet-tab${assetEditorMode === "floor-plans" ? " active" : ""}`}
                onClick={() => setAssetEditorMode("floor-plans")}
                type="button"
              >
                Floor Plans
              </button>
              <button
                aria-pressed={assetEditorMode === "entertainment"}
                className={`sheet-tab${assetEditorMode === "entertainment" ? " active" : ""}`}
                onClick={() => setAssetEditorMode("entertainment")}
                type="button"
              >
                Entertainment Schedules
              </button>
            </section>
            {assetEditorMode === "floor-plans" ? (
              <AdminFloorPlanAssets
                archivedAssetKeys={adminState.archivedAssetKeys}
                assets={floorPlans}
                onOverlaysChange={(assetKey, overlays) =>
                  setAdminState((current) => ({
                    ...current,
                    overlaysByAsset: {
                      ...current.overlaysByAsset,
                      [assetKey]: overlays,
                    },
                  }))
                }
                overlaysByAsset={adminState.overlaysByAsset}
                today={today}
              />
            ) : (
              <>
                <section className="asset-section admin-section-card">
                  <h3>Entertainment Schedule Editor</h3>
                  <p className="meta">Published overlays from here appear on the employee entertainment schedule page without exposing editing controls there.</p>
                </section>
                {entertainmentSchedules.map((schedule) => {
                  const isEnded = schedule.date < today;
                  const isArchived = adminState.archivedAssetKeys.includes(schedule.image);
                  return (
                    <EditableAssetSection
                      archiveAction={
                        isEnded
                          ? {
                              label: isArchived ? "Restore Date Assets" : "Delete Ended Event Assets",
                              onClick: () => archiveDate(schedule.date, !isArchived),
                            }
                          : undefined
                      }
                      archived={isArchived}
                      asset={schedule}
                      helperNote={
                        isEnded ? "This archive control removes the ended date from published schedules, itineraries, and checklists." : undefined
                      }
                      key={`admin-schedule-${schedule.date}`}
                      onOverlaysChange={(overlays) =>
                        setAdminState((current) => ({
                          ...current,
                          overlaysByAsset: {
                            ...current.overlaysByAsset,
                            [schedule.image]: overlays,
                          },
                        }))
                      }
                      overlays={adminState.overlaysByAsset[schedule.image] ?? []}
                      persistenceMode="remote"
                      subtitle={schedule.source ?? "Admin editor for entertainment schedule revisions."}
                      title={schedule.label}
                    />
                  );
                })}
              </>
            )}
          </>
        ) : (
          <section className="completed-grid">
            {submittedRecords.length ? (
              submittedRecords.map((record) => {
                const event = checklistEventSummaries.find(
                  (item) => item.id === record.eventId,
                );
                const addOnLines = submittedAddOnLines(record);
                const progress = completedTaskCount(record);
                return (
                  <article className="asset-section completed-card" key={record.eventId}>
                    <h3>{event?.name ?? `Event ${record.eventId}`}</h3>
                    <p className="meta">
                      {event ? formatEventDate(event.date) : "Unknown date"}{event?.time ? ` | ${event.time}` : ""}{event?.poc ? ` | ${event.poc}` : ""}
                    </p>
                    <div className="completed-meta-grid">
                      <div className="checklist-meta-card">
                        <span className="eyebrow">Submitted</span>
                        <strong>{record.submittedAt ? new Date(record.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Unknown"}</strong>
                        <span className="meta">{progress.completed}/{progress.total} tasks complete</span>
                      </div>
                      <div className="checklist-meta-card">
                        <span className="eyebrow">BWA</span>
                        <strong>{record.bwa || "Not entered"}</strong>
                        <span className="meta">Remaining drink card balance: {record.remainingDrinkCardBalance || "Not entered"}</span>
                      </div>
                    </div>
                    <div className="notes-grid">
                      <div className="task-section-card completed-section-card">
                        <span className="eyebrow">Add-On Sheet Notes</span>
                        <p>{record.extrasAdded || "No extra notes entered."}</p>
                      </div>
                      <div className="task-section-card completed-section-card">
                        <span className="eyebrow">Add-On Summary</span>
                        {addOnLines.length ? (
                          <ul className="editor-help-list">
                            {addOnLines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No add-ons were entered on the submitted sheet.</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <section className="asset-section">
                <h3>Completed Checklists</h3>
                <p className="meta">Submitted checklist and add-on sheets will appear here after a BWA submits them from the checklist page.</p>
              </section>
            )}
          </section>
        )}
      </div>

      {evidenceEventId !== null ? (
        <ContractEvidenceDrawer
          evidence={evidence}
          onClose={closeEvidenceDrawer}
          state={evidenceState}
        />
      ) : null}
    </PortalShell>
  );
}

const completenessStatusLabels = {
  complete: "Complete",
  missing: "Missing",
  "needs-review": "Needs review",
  "not-applicable": "N/A",
} as const;

function formatOperationsTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }).format(parsed);
}

function formatConflictRange(conflict: AdminOperationsConflict) {
  return `${formatOperationsTimestamp(conflict.startAt)}–${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(conflict.endAt))}`;
}

function EventCompletenessCard({
  event,
  onViewSource,
}: {
  event: AdminEventCompleteness;
  onViewSource: (eventId: number) => void;
}) {
  return (
    <article
      className={`admin-readiness-card${event.issueCount ? " has-issues" : " is-complete"}`}
      style={{ borderLeftColor: event.color }}
    >
      <header>
        <div>
          <span className="portal-eyebrow">{formatEventDate(event.date)} · {event.time}</span>
          <h3>{event.eventName}</h3>
        </div>
        <button
          className="admin-source-button"
          onClick={() => onViewSource(event.eventId)}
          type="button"
        >
          View Source
        </button>
      </header>
      <div className="admin-completeness-list">
        {event.checks.map((item) => (
          <div className={`admin-completeness-row is-${item.status}`} key={item.key}>
            <span>{item.label}</span>
            <strong>{completenessStatusLabels[item.status]}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

export function AdminOperationsReview({
  onViewSource,
  operations,
}: {
  onViewSource: (eventId: number) => void;
  operations: AdminOperationsPayload;
}) {
  const issueEvents = operations.completeness.filter(
    (event) => event.issueCount > 0,
  );
  const missingFields = operations.completeness.reduce(
    (total, event) =>
      total + event.checks.filter((item) => item.status === "missing").length,
    0,
  );

  return (
    <section className="admin-operations-review">
      <div className="admin-operations-summary" aria-label="Event readiness summary">
        <article>
          <span>Review window</span>
          <strong>{formatEventDate(operations.windowStart)}–{formatEventDate(operations.windowEnd)}</strong>
          <small>Calculated automatically from venue time</small>
        </article>
        <article>
          <span>Events needing attention</span>
          <strong>{issueEvents.length}</strong>
          <small>{missingFields} critical fields are missing</small>
        </article>
        <article>
          <span>Blocking conflicts</span>
          <strong>{operations.conflicts.length}</strong>
          <small>Rooms, sections, lanes, and entertainment</small>
        </article>
      </div>

      {operations.warnings.length ? (
        <section className="admin-operations-warning" role="status">
          <strong>Some readiness sources are unavailable</strong>
          <ul>
            {operations.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="admin-review-section" aria-labelledby="admin-completeness-title">
        <div className="admin-review-heading">
          <div>
            <span className="portal-eyebrow">Automatic completeness check</span>
            <h2 id="admin-completeness-title">Upcoming event readiness</h2>
          </div>
          <span>Updated {formatOperationsTimestamp(operations.generatedAt)}</span>
        </div>
        {operations.completeness.length ? (
          <div className="admin-readiness-grid">
            {operations.completeness.map((event) => (
              <EventCompletenessCard
                event={event}
                key={event.eventId}
                onViewSource={onViewSource}
              />
            ))}
          </div>
        ) : (
          <div className="admin-operations-empty">
            <strong>No upcoming events in this review window.</strong>
            <span>The check will populate automatically when event plans are synchronized.</span>
          </div>
        )}
      </section>

      <section className="admin-review-section" aria-labelledby="admin-conflict-title">
        <div className="admin-review-heading">
          <div>
            <span className="portal-eyebrow">Shared resource review</span>
            <h2 id="admin-conflict-title">Entertainment &amp; floor-plan conflicts</h2>
          </div>
        </div>
        {operations.conflicts.length ? (
          <div className="admin-conflict-list">
            {operations.conflicts.map((conflict) => (
              <article className="admin-conflict-card" key={conflict.id}>
                <div>
                  <span className="admin-conflict-kind">{conflict.kind.replace("-", " ")}</span>
                  <h3>{conflict.resourceName}</h3>
                  <p>{conflict.eventNames.join(" ↔ ")}</p>
                </div>
                <div className="admin-conflict-time">
                  <strong>{formatEventDate(conflict.date)}</strong>
                  <span>{formatConflictRange(conflict)}</span>
                  <b>Blocking overlap</b>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-operations-empty is-success">
            <strong>No overlapping resources found.</strong>
            <span>Saved rooms, sections, lanes, and entertainment reservations do not overlap in this review window.</span>
          </div>
        )}
      </section>
    </section>
  );
}

export function ContractEvidenceDrawer({
  evidence,
  onClose,
  state,
}: {
  evidence: AdminContractEvidence | null;
  onClose: () => void;
  state: EvidenceState;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.removeEventListener("keydown", handleDialogKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="admin-evidence-backdrop">
      <aside
        aria-labelledby="admin-evidence-title"
        aria-modal="true"
        className="admin-evidence-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <header>
          <div>
            <span className="portal-eyebrow">Administrator source evidence</span>
            <h2 id="admin-evidence-title">{evidence?.eventName ?? "Contract evidence"}</h2>
            {evidence ? (
              <p>
                {formatEventDate(evidence.eventDate)} · Tripleseat event {evidence.sourceEventId ?? "not captured"}
                {evidence.sourceBookingId ? ` · Booking ${evidence.sourceBookingId}` : ""}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close contract evidence"
            className="admin-evidence-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </header>

        {state === "loading" ? (
          <div className="admin-evidence-state" role="status">Loading source evidence…</div>
        ) : state === "error" ? (
          <div className="admin-evidence-state is-error" role="alert">
            Source evidence is temporarily unavailable. The Event Host value has not been changed.
          </div>
        ) : evidence ? (
          <>
            <p className="admin-evidence-note">
              Source text is the sanitized wording retained by the read-only Tripleseat import. Derived defaults are labeled and never presented as contract wording.
            </p>
            <div
              aria-label="Contract evidence comparison table"
              className="admin-evidence-table-wrap"
              role="region"
              tabIndex={0}
            >
              <table className="admin-evidence-table">
                <thead>
                  <tr>
                    <th scope="col">Event Host field</th>
                    <th scope="col">Imported value</th>
                    <th scope="col">Contract source</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.field}</th>
                      <td>{row.importedValue}</td>
                      <td>
                        <strong>{row.sourceKind}</strong>
                        <span>{row.sourceText}</span>
                        {row.sourceReference ? <small>Source: {row.sourceReference}</small> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              Source updated {evidence.sourceUpdatedAt ? formatOperationsTimestamp(evidence.sourceUpdatedAt) : "time not captured"}
            </footer>
          </>
        ) : null}
      </aside>
    </div>
  );
}
