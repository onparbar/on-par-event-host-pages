"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import EditableAssetSection from "@/app/_components/EditableAssetSection";
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
  onOverlaysChange,
  overlays,
}: {
  asset: FloorPlanDisplayAsset;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOverlaysChange: (overlays: AdminAssetOverlay[]) => void;
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
            {asset.specialPage ? (
              <p className="floor-plan-special-note">
                This special page is kept separate from the main event floor map.
              </p>
            ) : null}
            <EditableAssetSection
              asset={asset}
              onOverlaysChange={onOverlaysChange}
              overlays={overlays}
              persistenceMode="remote"
              subtitle="Add, move, resize, label, cover, or download highlights exactly as you do on the entertainment schedule."
              title={`${asset.label} Floor Plan`}
            />
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
  const [adminState, setAdminState] = useState(initialState);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const organized = useMemo(
    () =>
      organizeFloorPlanAssets(
        plans,
        specialPages,
        today,
        adminState.archivedAssetKeys,
      ),
    [adminState.archivedAssetKeys, plans, specialPages, today],
  );
  const [openAssetKey, setOpenAssetKey] = useState<string | null>(
    organized.defaultAssetKey,
  );

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
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: adminState }),
          });
          if (!response.ok) {
            throw new Error("Unable to save floor-plan highlights.");
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

  function updateOverlays(
    assetKey: string,
    overlays: AdminAssetOverlay[],
  ) {
    setAdminState((current) => ({
      ...current,
      overlaysByAsset: {
        ...current.overlaysByAsset,
        [assetKey]: overlays,
      },
    }));
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
        onOverlaysChange={(overlays) => updateOverlays(asset.image, overlays)}
        overlays={adminState.overlaysByAsset[asset.image] ?? []}
      />
    );
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving highlights"
      : saveState === "saved"
        ? "Highlights saved"
        : saveState === "error"
          ? "Save needs attention"
          : "Highlights sync automatically";

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
            <PortalStatusBadge
              tone={
                saveState === "error"
                  ? "danger"
                  : saveState === "saving"
                    ? "warning"
                    : saveState === "saved"
                      ? "success"
                      : "neutral"
              }
            >
              {saveLabel}
            </PortalStatusBadge>
          </div>
        }
        description="Open one date at a time to review or edit its seating highlights. The nearest upcoming event opens automatically."
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
