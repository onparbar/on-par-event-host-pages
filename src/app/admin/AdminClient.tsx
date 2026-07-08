"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import EditableAssetSection from "@/app/_components/EditableAssetSection";
import {
  checklistSections,
  entertainmentAddOns,
  foodAddOns,
  type ChecklistRecord,
} from "@/lib/checklist-model";
import { checklistEvents } from "@/lib/checklist-events";
import type { AdminState } from "@/lib/admin-types";
import { entertainmentSchedules, floorPlans, formatEventDate } from "@/lib/events";

type AdminClientProps = {
  initialState: AdminState;
  records: ChecklistRecord[];
  today: string;
};

type AdminTab = "assets" | "completed";

const BLANK_FLOOR_MAP_IMAGE = "/floor-plans/blank-floor-map.png";

function Header() {
  return (
    <header className="topbar">
      <h1 className="brand">On Par Admin</h1>
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

export default function AdminClient({ initialState, records, today }: AdminClientProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("assets");
  const [adminState, setAdminState] = useState<AdminState>(initialState);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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

  async function handleLogout() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  function updateFloorPlanBaseImage(assetKey: string, nextImage: string) {
    setAdminState((current) => ({
      ...current,
      baseImageByAsset: {
        ...current.baseImageByAsset,
        [assetKey]: nextImage,
      },
    }));
  }

  function archiveDate(date: string, nextArchived: boolean) {
    const floorPlan = floorPlans.find((item) => item.date === date);
    const schedule = entertainmentSchedules.find((item) => item.date === date);
    const eventIds = checklistEvents.filter((item) => item.date === date).map((item) => item.id);

    setAdminState((current) => {
      const archivedAssetKeys = new Set(current.archivedAssetKeys);
      const archivedEventIds = new Set(current.archivedEventIds);

      for (const key of [floorPlan?.image, schedule?.image].filter(Boolean) as string[]) {
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
    <>
      <Header />
      <main className="page admin-page">
        <section className="intro">
          <div>
            <h2>Admin</h2>
            <p>Edit published floor plans and entertainment schedules, archive ended event assets, and review submitted checklists.</p>
          </div>
          <div className="admin-status-group">
            <span className={`admin-save-pill ${saveState}`}>{saveState === "idle" ? "Admin changes ready" : saveState}</span>
            <button className="editor-tool" onClick={() => void handleLogout()} type="button">
              Lock Admin
            </button>
          </div>
        </section>

        <section className="sheet-tab-strip" aria-label="Admin sections">
          <button className={`sheet-tab${activeTab === "assets" ? " active" : ""}`} onClick={() => setActiveTab("assets")} type="button">
            Asset Editor
          </button>
          <button className={`sheet-tab${activeTab === "completed" ? " active" : ""}`} onClick={() => setActiveTab("completed")} type="button">
            Completed Checklists
          </button>
        </section>

        {activeTab === "assets" ? (
          <>
            <section className="asset-section admin-section-card">
              <h3>Floor Plan Editor</h3>
              <p className="meta">Edits saved here are published to the employee-facing floor plan and schedule pages. Archive controls only apply after an event date has passed.</p>
            </section>
            {floorPlans.map((plan) => {
              const isEnded = plan.date < today;
              const isArchived = adminState.archivedAssetKeys.includes(plan.image);
              const publishedImage = adminState.baseImageByAsset[plan.image] ?? plan.image;
              const usingBlankMap = publishedImage === BLANK_FLOOR_MAP_IMAGE;
              return (
                <EditableAssetSection
                  archiveAction={
                    isEnded
                      ? {
                          label: isArchived ? "Restore Date Assets" : "Delete Ended Event Assets",
                          onClick: () => archiveDate(plan.date, !isArchived),
                        }
                      : undefined
                  }
                  archived={isArchived}
                  asset={plan}
                  image={publishedImage}
                  helperNote={
                    isEnded ? "Ended dates can be removed from the public host here and restored later if needed." : undefined
                  }
                  key={`admin-floor-${plan.date}`}
                  managementSlot={
                    <div className="base-map-card">
                      <span className="eyebrow">Published Base Map</span>
                      <div className="base-map-actions">
                        <button
                          className={`editor-tool${!usingBlankMap ? " active" : ""}`}
                          onClick={() => updateFloorPlanBaseImage(plan.image, plan.image)}
                          type="button"
                        >
                          Use Event Map
                        </button>
                        <button
                          className={`editor-tool${usingBlankMap ? " active" : ""}`}
                          onClick={() => updateFloorPlanBaseImage(plan.image, BLANK_FLOOR_MAP_IMAGE)}
                          type="button"
                        >
                          Use Blank Map
                        </button>
                      </div>
                      <p className="meta">
                        Switch to the blank map when you need full control over every highlight. Then add only the seating and notes you want published.
                      </p>
                    </div>
                  }
                  onOverlaysChange={(overlays) =>
                    setAdminState((current) => ({
                      ...current,
                      overlaysByAsset: {
                        ...current.overlaysByAsset,
                        [plan.image]: overlays,
                      },
                    }))
                  }
                  overlays={adminState.overlaysByAsset[plan.image] ?? []}
                  persistenceMode="remote"
                  subtitle={
                    isEnded
                      ? "This date has ended. Use the archive button to remove the floor plan, entertainment schedule, and itineraries from the public host."
                      : usingBlankMap
                        ? "Blank floor map is active for this date. Everything guests see now comes from your editable highlights."
                        : "Admin editor for floor-plan revisions and live published overlays."
                  }
                  title={plan.label}
                />
              );
            })}

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
                    isEnded ? "This archive control removes the ended date from the public floor plans, schedules, and itineraries." : undefined
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
        ) : (
          <section className="completed-grid">
            {submittedRecords.length ? (
              submittedRecords.map((record) => {
                const event = checklistEvents.find((item) => item.id === record.eventId);
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
      </main>
    </>
  );
}
