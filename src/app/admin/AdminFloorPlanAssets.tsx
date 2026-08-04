"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import EditableAssetSection from "@/app/_components/EditableAssetSection";
import {
  PortalCard,
  PortalStatusBadge,
} from "@/app/_components/PortalShell";
import {
  organizeFloorPlanAssets,
  type FloorPlanDisplayAsset,
} from "@/app/floor-plans/FloorPlansClient";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import type { DateAsset } from "@/lib/events";

type AdminFloorPlanAssetsProps = {
  archivedAssetKeys: string[];
  assets: DateAsset[];
  onOverlaysChange: (
    assetKey: string,
    overlays: AdminAssetOverlay[],
  ) => void;
  overlaysByAsset: Record<string, AdminAssetOverlay[]>;
  today: string;
};

export default function AdminFloorPlanAssets({
  archivedAssetKeys,
  assets,
  onOverlaysChange,
  overlaysByAsset,
  today,
}: AdminFloorPlanAssetsProps) {
  const organized = useMemo(
    () => organizeFloorPlanAssets(assets, [], today, archivedAssetKeys),
    [archivedAssetKeys, assets, today],
  );
  const [openAssetKey, setOpenAssetKey] = useState<string | null>(
    organized.defaultAssetKey,
  );

  function renderAsset(asset: FloorPlanDisplayAsset) {
    const isOpen = openAssetKey === asset.image;
    return (
      <PortalCard className="floor-plan-display-card" key={asset.image}>
        <details
          onToggle={(event) =>
            setOpenAssetKey((current) =>
              event.currentTarget.open
                ? asset.image
                : current === asset.image
                  ? null
                  : current,
            )
          }
          open={isOpen}
        >
          <summary className="floor-plan-card-summary">
            <span className="floor-plan-card-heading">
              <strong>{asset.label}</strong>
              <span>{asset.events.join(" · ") || "No event name listed"}</span>
            </span>
            <PortalStatusBadge tone={asset.archiveReason ? "neutral" : "success"}>
              {asset.archiveReason ? "Archived" : "Upcoming"}
            </PortalStatusBadge>
            <span className="floor-plan-expand-label">
              <span className="when-closed">Edit highlights</span>
              <span className="when-open">Close editor</span>
              <span aria-hidden="true" className="floor-plan-chevron">⌄</span>
            </span>
          </summary>
          {isOpen ? (
            <div className="floor-plan-card-body">
              <EditableAssetSection
                asset={asset}
                onOverlaysChange={(overlays) =>
                  onOverlaysChange(asset.image, overlays)
                }
                overlays={overlaysByAsset[asset.image] ?? []}
                persistenceMode="remote"
                subtitle="Add, move, resize, label, or cover published floor-plan highlights. Changes save to the Event Host admin state."
                title={`${asset.label} Floor Plan`}
              />
            </div>
          ) : null}
        </details>
      </PortalCard>
    );
  }

  return (
    <>
      <section className="asset-section admin-section-card admin-floor-plan-heading">
        <div>
          <h3>Published Floor Plan Highlights</h3>
          <p className="meta">
            These are the only floor-plan highlight controls published to the
            employee view.
          </p>
        </div>
        <Link className="button-link" href="/admin/floor-plans">
          Live Tripleseat Floor Plan Sync
        </Link>
      </section>

      <div className="floor-plan-display-list">
        {organized.upcoming.map(renderAsset)}
      </div>

      {organized.archived.length ? (
        <details className="floor-plan-archive">
          <summary>
            <span>
              <span className="portal-eyebrow">Past events</span>
              <strong>Archived floor plans</strong>
            </span>
            <span className="floor-plan-archive-count">
              {organized.archived.length} plan
              {organized.archived.length === 1 ? "" : "s"}
            </span>
          </summary>
          <div className="floor-plan-display-list">
            {organized.archived.map(renderAsset)}
          </div>
        </details>
      ) : null}
    </>
  );
}
