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

export type FloorPlanDisplayAsset = DateAsset & {
  archiveReason: "manual" | "past" | null;
  specialPage: boolean;
};

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

export function FloorPlanCard({
  asset,
  isOpen,
  onOpenChange,
  overlays,
}: {
  asset: FloorPlanDisplayAsset;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  overlays: AdminAssetOverlay[];
}) {
  const date = dateBlock(asset.date);
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
            <span>{asset.events.join(" · ") || "No event name listed"}</span>
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
            <p className="floor-plan-special-note">
              {asset.specialPage
                ? "This published special page is kept separate from the main event floor map."
                : "Published floor plan. Highlight editing and Tripleseat synchronization are available to administrators only."}
            </p>
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

  async function handleLogout() {
    await fetch("/api/admin-session", { method: "DELETE" });
    window.location.reload();
  }

  function renderPlan(asset: FloorPlanDisplayAsset) {
    return (
      <FloorPlanCard
        asset={asset}
        isOpen={openAssetKey === asset.image}
        key={`${asset.specialPage ? "special" : "plan"}-${asset.image}`}
        onOpenChange={(open) =>
          setOpenAssetKey((current) =>
            open ? asset.image : current === asset.image ? null : current,
          )
        }
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
