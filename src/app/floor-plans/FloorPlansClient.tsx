"use client";

import { useMemo, useState } from "react";
import AssetImageWithOverlays from "@/app/_components/AssetImageWithOverlays";
import {
  PortalCard,
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import type { AdminAssetOverlay, AdminState } from "@/lib/admin-types";
import type { DateAsset } from "@/lib/events";
import type {
  FloorPlanDayPayload,
  FloorPlanEvent,
} from "@/lib/floor-plans/types";

export type FloorPlanDisplayAsset = DateAsset & {
  archiveReason: "manual" | "past" | null;
  specialPage: boolean;
};

type FloorPlanLiveState = {
  payload: FloorPlanDayPayload | null;
  status: "idle" | "syncing" | "success" | "error";
  message: string;
};

export async function syncFloorPlanFromTripleseat(
  date: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/floor-plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, action: "refresh" }),
  });
  const result = (await response.json().catch(() => null)) as
    | (FloorPlanDayPayload & { error?: string })
    | null;
  if (!response.ok || !result?.plan) {
    throw new Error(result?.error || "Unable to sync this floor plan from Tripleseat.");
  }
  return result;
}

export function organizeFloorPlanAssets(
  plans: DateAsset[],
  specialPages: DateAsset[],
  today: string,
  archivedAssetKeys: string[] = [],
) {
  const manualArchive = new Set(archivedAssetKeys);
  const assets: FloorPlanDisplayAsset[] = [
    ...plans.map((plan) => ({
      ...plan,
      archiveReason: manualArchive.has(plan.image)
        ? ("manual" as const)
        : plan.date < today
          ? ("past" as const)
          : null,
      specialPage: false,
    })),
    ...specialPages.map((plan) => ({
      ...plan,
      archiveReason: manualArchive.has(plan.image)
        ? ("manual" as const)
        : plan.date < today
          ? ("past" as const)
          : null,
      specialPage: true,
    })),
  ];
  const byDateAscending = (left: FloorPlanDisplayAsset, right: FloorPlanDisplayAsset) =>
    left.date.localeCompare(right.date) ||
    Number(left.specialPage) - Number(right.specialPage) ||
    left.image.localeCompare(right.image);
  const upcoming = assets
    .filter((asset) => asset.archiveReason === null)
    .sort(byDateAscending);
  const archived = assets
    .filter((asset) => asset.archiveReason !== null)
    .sort((left, right) => byDateAscending(right, left));

  return {
    upcoming,
    archived,
    defaultAssetKey: upcoming[0]?.image ?? archived[0]?.image ?? null,
  };
}

function dateBlock(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return {
    month: new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
    }).format(value),
    day: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      timeZone: "UTC",
    }).format(value),
  };
}

function eventTime(event: FloorPlanEvent) {
  if (!event.startAt || !event.endAt) return "Time needs review";
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${formatter.format(new Date(event.startAt))} – ${formatter.format(new Date(event.endAt))}`;
}

function syncTime(value: string | null) {
  if (!value) return "Not synced yet";
  return `Last synced ${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value))}`;
}

export function FloorPlanCard({
  asset,
  isOpen,
  liveState,
  onOpenChange,
  onSync,
  overlays,
}: {
  asset: FloorPlanDisplayAsset;
  isOpen: boolean;
  liveState?: FloorPlanLiveState;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
  overlays: AdminAssetOverlay[];
}) {
  const date = dateBlock(asset.date);
  const liveEvents = liveState?.payload?.plan.events ?? null;
  const displayedEvents = liveEvents?.map((event) => event.name) ?? asset.events;
  const badge = asset.specialPage
    ? "Special page"
    : asset.archiveReason === "manual"
      ? "Archived"
      : asset.archiveReason === "past"
        ? "Past event"
        : "Upcoming";

  return (
    <PortalCard className="floor-plan-display-card">
      <details
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
        open={isOpen}
      >
        <summary className="floor-plan-card-summary">
          <span className="floor-plan-date-block">
            <small>{date.month}</small>
            <strong>{date.day}</strong>
          </span>
          <span className="floor-plan-card-heading">
            <strong>{asset.label}</strong>
            <span>{displayedEvents.join(" · ") || "No event name listed"}</span>
          </span>
          <PortalStatusBadge
            tone={asset.archiveReason ? "neutral" : "success"}
          >
            {badge}
          </PortalStatusBadge>
          <span className="floor-plan-expand-label">
            <span className="when-closed">View plan</span>
            <span className="when-open">Close plan</span>
            <span aria-hidden="true" className="floor-plan-chevron">⌄</span>
          </span>
        </summary>
        {isOpen ? (
          <div className="floor-plan-card-body">
            {asset.specialPage ? (
              <p className="floor-plan-special-note">
                This published special page is kept separate from the main event floor map.
              </p>
            ) : (
              <>
                <div className="floor-plan-live-sync-bar">
                  <div>
                    <strong>Tripleseat live details</strong>
                    <span aria-live="polite">
                      {liveState?.status === "syncing"
                        ? "Refreshing event details from Tripleseat…"
                        : liveState?.message || "Refresh event names, times, guest counts, and reserved sections."}
                    </span>
                  </div>
                  <button
                    className="floor-plan-live-sync-button"
                    disabled={liveState?.status === "syncing"}
                    onClick={onSync}
                    type="button"
                  >
                    {liveState?.status === "syncing"
                      ? "Syncing…"
                      : "Sync live from Tripleseat"}
                  </button>
                </div>
                {liveEvents?.length ? (
                  <div className="floor-plan-event-row" aria-label="Live Tripleseat events">
                    {liveEvents.map((event) => (
                      <article
                        className="floor-plan-event-chip"
                        key={event.id}
                        style={{ "--event-color": event.color } as React.CSSProperties}
                      >
                        <strong>{event.name}</strong>
                        <span>{event.guestCount} guests · {eventTime(event)}</span>
                        <span>{event.source.rooms.join(", ") || "Reserved section needs review"}</span>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            <div className="floor-plan-image-frame">
              <AssetImageWithOverlays
                alt={`Floor plan for ${asset.label}`}
                image={asset.image}
                overlays={overlays}
              />
            </div>
          </div>
        ) : null}
      </details>
    </PortalCard>
  );
}

export default function FloorPlansClient({
  initialState,
  plans,
  specialPages,
  today,
}: {
  initialState: AdminState;
  plans: DateAsset[];
  specialPages: DateAsset[];
  today: string;
}) {
  const organized = useMemo(
    () =>
      organizeFloorPlanAssets(
        plans,
        specialPages,
        today,
        initialState.archivedAssetKeys,
      ),
    [initialState.archivedAssetKeys, plans, specialPages, today],
  );
  const [openAssetKey, setOpenAssetKey] = useState<string | null>(
    organized.defaultAssetKey,
  );
  const [liveByDate, setLiveByDate] = useState<Record<string, FloorPlanLiveState>>({});

  async function handleLogout() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  async function handleLiveSync(date: string) {
    setLiveByDate((current) => ({
      ...current,
      [date]: {
        payload: current[date]?.payload ?? null,
        status: "syncing",
        message: "",
      },
    }));
    try {
      const payload = await syncFloorPlanFromTripleseat(date);
      setLiveByDate((current) => ({
        ...current,
        [date]: {
          payload,
          status: "success",
          message: `${syncTime(payload.plan.lastTripleseatSyncAt)} · ${payload.plan.events.length} event${payload.plan.events.length === 1 ? "" : "s"} updated`,
        },
      }));
    } catch (error) {
      setLiveByDate((current) => ({
        ...current,
        [date]: {
          payload: current[date]?.payload ?? null,
          status: "error",
          message: error instanceof Error ? error.message : "Unable to sync this floor plan from Tripleseat.",
        },
      }));
    }
  }

  function renderPlan(asset: FloorPlanDisplayAsset) {
    return (
      <FloorPlanCard
        asset={asset}
        isOpen={openAssetKey === asset.image}
        key={`${asset.specialPage ? "special" : "plan"}-${asset.image}`}
        liveState={liveByDate[asset.date]}
        onOpenChange={(open) =>
          setOpenAssetKey((current) =>
            open ? asset.image : current === asset.image ? null : current,
          )
        }
        onSync={() => void handleLiveSync(asset.date)}
        overlays={initialState.overlaysByAsset[asset.image] ?? []}
      />
    );
  }

  return (
    <PortalShell
      allowFullscreen
      mainClassName="floor-plan-page"
      onLock={() => void handleLogout()}
      sectionSubtitle="Event Host"
      sectionTitle="Floor Plans"
    >
      <PortalPageHeader
        aside={
          <div className="portal-status-row">
            <PortalStatusBadge tone="success">
              {organized.upcoming.length} upcoming
            </PortalStatusBadge>
            <PortalStatusBadge>
              {organized.archived.length} archived
            </PortalStatusBadge>
            <PortalStatusBadge>View only</PortalStatusBadge>
          </div>
        }
        description="Open one date at a time to review its published seating highlights. The nearest upcoming event opens automatically."
        eyebrow="Event Operations"
        title="Floor Plans"
      />

      <section aria-labelledby="upcoming-floor-plans" className="floor-plan-group">
        <div className="floor-plan-group-heading">
          <div>
            <span className="portal-eyebrow">Current workspace</span>
            <h2 id="upcoming-floor-plans">Upcoming floor plans</h2>
          </div>
          <p>Plans are ordered by the next event date.</p>
        </div>
        {organized.upcoming.length ? (
          <div className="floor-plan-display-list">
            {organized.upcoming.map(renderPlan)}
          </div>
        ) : (
          <PortalCard className="floor-plan-empty-card">
            No upcoming floor plans are available yet. The newest past plan is open in the archive.
          </PortalCard>
        )}
      </section>

      <details
        className="floor-plan-archive"
        open={!organized.upcoming.length}
      >
        <summary>
          <span>
            <span className="portal-eyebrow">Past events</span>
            <strong>Floor-plan archive</strong>
          </span>
          <span className="floor-plan-archive-count">
            {organized.archived.length} plan{organized.archived.length === 1 ? "" : "s"}
          </span>
        </summary>
        <div className="floor-plan-display-list">
          {organized.archived.map(renderPlan)}
        </div>
      </details>
    </PortalShell>
  );
}
