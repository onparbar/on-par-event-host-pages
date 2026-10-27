"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useEventContext } from "@/app/_components/EventContext";
import AssetImageWithOverlays from "@/app/_components/AssetImageWithOverlays";
import {
  PortalCard,
  PortalPageHeader,
  PortalShell,
  PortalStatusBadge,
  PortalZoomControls,
} from "@/app/_components/PortalShell";
import type { AdminAssetOverlay, AdminState } from "@/lib/admin-types";
import type { DateAsset } from "@/lib/events";
import type {
  FloorPlanDayPayload,
  FloorPlanDocument,
  FloorPlanEvent,
} from "@/lib/floor-plans/types";
import PublishedFloorPlanMap from "./PublishedFloorPlanMap";
import { findOperationalFloorPlanEvent } from "@/lib/operations/floor-plan-context";
import { floorPlanEventView } from "@/lib/floor-plans/event-view";
import { ENTERTAINMENT_UPDATE_CHANNEL } from "@/lib/entertainment/live-updates";

const FLOOR_PLAN_ZOOM_MIN = 50;
const FLOOR_PLAN_ZOOM_MAX = 200;
const FLOOR_PLAN_ZOOM_STEP = 10;

export type FloorPlanDisplayAsset = DateAsset & {
  archiveReason: "manual" | "past" | null;
  specialPage: boolean;
};

type FloorPlanLiveState = {
  payload: FloorPlanDayPayload | null;
  status: "idle" | "syncing" | "success" | "error";
  message: string;
};

type FloorPlanWindowSyncResult = {
  eventCount: number;
  floorPlans: {
    startDate: string;
    endDate: string;
    results: Array<{
      status: "generated" | "skipped" | "error";
      eventCount: number;
    }>;
  };
  warning?: string;
  error?: string;
};

type FloorPlanMonthDraftResult = {
  month: string;
  startDate: string;
  endDate: string;
  results: Array<{ date: string; status: "created" | "skipped" | "error"; eventCount: number; planStatus?: string; message?: string }>;
};

export type FloorPlanPublication = {
  plan: FloorPlanDocument;
  payload: FloorPlanDayPayload | null;
};

export type FloorPlanUpcomingEntry =
  | {
      date: string;
      key: string;
      kind: "static";
      asset: FloorPlanDisplayAsset;
    }
  | {
      date: string;
      key: string;
      kind: "saved";
      publication: FloorPlanPublication;
    };

/** A staff workspace never substitutes an all-party image or another date. */
export function SelectedEventFloorPlan({ payload, eventId, date, zoom = 100 }: {
  payload: FloorPlanDayPayload | null;
  eventId: string;
  date: string | null;
  zoom?: number;
}) {
  const selected = payload && payload.plan.eventDate === date ? findOperationalFloorPlanEvent(payload.plan.events, eventId) : null;
  const view = payload && selected ? floorPlanEventView(payload.plan, payload.entertainmentReservations, selected.id) : null;
  const assigned = selected && (selected.fullBuyout || Boolean(view?.plan.reservations.length) || Boolean(view?.entertainmentReservations.length));
  if (!payload || !assigned) return <PortalCard className="floor-plan-empty-card"><h2>No floor plan assigned</h2><p>No saved floor plan is assigned to this exact event and date. No other party’s seating or whole-day image has been substituted. Ask a manager to assign the plan.</p></PortalCard>;
  return <PublishedFloorPlanMap focusEventId={eventId} payload={payload} zoom={zoom} />;
}

export function buildUpcomingFloorPlanEntries(
  assets: readonly FloorPlanDisplayAsset[],
  publications: readonly FloorPlanPublication[],
): FloorPlanUpcomingEntry[] {
  const saved = publications.filter((publication) => publication.payload);
  const savedDates = new Set(
    saved.map((publication) => publication.plan.eventDate),
  );
  return [
    ...assets
      .filter((asset) => !savedDates.has(asset.date))
      .map((asset) => ({
        date: asset.date,
        key: asset.image,
        kind: "static" as const,
        asset,
      })),
    ...saved.map((publication) => ({
      date: publication.plan.eventDate,
      key: `saved:${publication.plan.eventDate}`,
      kind: "saved" as const,
      publication,
    })),
  ].sort((left, right) => left.date.localeCompare(right.date));
}

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

export async function syncFloorPlanWindowFromTripleseat(
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl("/api/event-plans/sync", {
    method: "POST",
  });
  const result = (await response.json().catch(() => null)) as
    | FloorPlanWindowSyncResult
    | null;
  if (!response.ok || !result) {
    throw new Error(
      result?.error || "Unable to sync upcoming floor plans from Tripleseat.",
    );
  }
  return result;
}

export async function prepareFloorPlanMonthDrafts(month: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl("/api/floor-plans/planning-month", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ month }),
  });
  const result = await response.json().catch(() => null) as (FloorPlanMonthDraftResult & { error?: string }) | null;
  if (!response.ok || result?.month !== month || result.startDate !== `${month}-01` || result.endDate !== `${month}-31` || !Array.isArray(result.results) || result.results.length !== 31 || result.results.some((entry) => !entry || !["created", "skipped", "error"].includes(entry.status) || typeof entry.date !== "string" || !entry.date.startsWith(`${month}-`))) {
    throw new Error(result?.error || "Unable to prepare this month’s floor-plan drafts. Existing plans are unchanged.");
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
  zoom = 100,
}: {
  asset: FloorPlanDisplayAsset;
  isOpen: boolean;
  liveState?: FloorPlanLiveState;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
  overlays: AdminAssetOverlay[];
  zoom?: number;
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
              {!asset.specialPage ? (
                <p className="floor-plan-special-note">
                  This static image shows the whole day. Individual-event filtering is available on saved editable Event Host plans.
                </p>
              ) : null}
              <div
                className="floor-plan-zoom-stage"
                style={{ width: `${zoom}%` }}
              >
                <AssetImageWithOverlays
                  alt={`Floor plan for ${asset.label}`}
                  image={asset.image}
                  overlays={overlays}
                />
              </div>
            </div>
          </div>
        ) : null}
      </details>
    </PortalCard>
  );
}

export function PublishedFloorPlanCard({
  publication,
  isOpen,
  liveState,
  onOpenChange,
  onSync,
  zoom = 100,
  showPlanningStatus = false,
}: {
  publication: FloorPlanPublication;
  isOpen: boolean;
  liveState?: FloorPlanLiveState;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
  zoom?: number;
  showPlanningStatus?: boolean;
}) {
  const payload = liveState?.payload ?? publication.payload;
  const plan = payload?.plan ?? publication.plan;
  if (!payload) return null;
  const approved = plan.status === "Approved";
  const bookingOnlyProjection = plan.version === 0 && plan.events.every((event) => event.tripleseatEventId.startsWith("vip-"));
  const bookingRefresh = plan.events.flatMap((event) => event.source.onParBooking?.refreshedAt ? [event.source.onParBooking.refreshedAt] : []).sort().at(-1) ?? null;
  const date = dateBlock(plan.eventDate);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${plan.eventDate}T12:00:00Z`));

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
            <strong>{label}</strong>
            <span>{plan.events.map((event) => event.name).join(" · ")}</span>
          </span>
          <PortalStatusBadge tone={approved ? "success" : "warning"}>
            {showPlanningStatus ? plan.status : bookingOnlyProjection ? "On Par Bookings" : approved ? "Approved" : "Saved edits"}
          </PortalStatusBadge>
          <span className="floor-plan-expand-label">
            <span className="when-closed">View plan</span>
            <span className="when-open">Close plan</span>
            <span aria-hidden="true" className="floor-plan-chevron">⌄</span>
          </span>
        </summary>
        {isOpen ? (
          <div className="floor-plan-card-body">
            <div className="floor-plan-live-sync-bar">
              <div>
                <strong>{bookingOnlyProjection ? "On Par Bookings reservation plan" : `${approved ? "Approved" : "Saved"} Event Host floor plan`}</strong>
                {bookingRefresh ? <span>On Par Bookings · {syncTime(bookingRefresh)}</span> : null}
                <span aria-live="polite">
                  {liveState?.status === "syncing"
                    ? "Refreshing On Par Bookings and Tripleseat…"
                    : liveState?.message || syncTime(plan.lastTripleseatSyncAt)}
                </span>
              </div>
              <div className="floor-plan-live-sync-actions">
                <a
                  className="floor-plan-edit-button"
                  href={`/admin/floor-plans?date=${encodeURIComponent(plan.eventDate)}`}
                >
                  Edit in Admin
                </a>
                <button
                  className="floor-plan-live-sync-button"
                  disabled={liveState?.status === "syncing"}
                  onClick={onSync}
                  type="button"
                >
                  {liveState?.status === "syncing"
                    ? "Syncing…"
                    : "Sync On Par + Tripleseat"}
                </button>
              </div>
            </div>
            {payload.warnings.length ? <div className="floor-plan-live-sync-message is-error" role="status">{payload.warnings.join(" ")}</div> : null}
            <PublishedFloorPlanMap payload={payload} zoom={zoom} />
          </div>
        ) : null}
      </details>
    </PortalCard>
  );
}

export function PendingFloorPlanCard({
  plan,
}: {
  plan: FloorPlanDocument;
}) {
  const date = dateBlock(plan.eventDate);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${plan.eventDate}T12:00:00Z`));

  return (
    <PortalCard className="floor-plan-pending-card">
      <div className="floor-plan-card-summary">
        <span className="floor-plan-date-block">
          <small>{date.month}</small>
          <strong>{date.day}</strong>
        </span>
        <span className="floor-plan-card-heading">
          <strong>{label}</strong>
          <span>{plan.events.map((event) => event.name).join(" · ")}</span>
        </span>
        <PortalStatusBadge tone="warning">{plan.status}</PortalStatusBadge>
        <a
          className="button-link floor-plan-review-link"
          href={`/admin/floor-plans?date=${encodeURIComponent(plan.eventDate)}`}
        >
          Edit and approve
        </a>
      </div>
    </PortalCard>
  );
}

export function AwaitingApprovalSection({
  plans,
}: {
  plans: readonly FloorPlanDocument[];
}) {
  if (!plans.length) return null;

  const sortedPlans = [...plans].sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate),
  );

  return (
    <details className="floor-plan-archive floor-plan-awaiting-approval">
      <summary>
        <span>
          <span className="portal-eyebrow">Admin review</span>
          <strong>Awaiting approval</strong>
        </span>
        <span className="floor-plan-awaiting-summary-meta">
          <span className="floor-plan-archive-count">
            {sortedPlans.length} plan{sortedPlans.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true" className="floor-plan-awaiting-chevron">⌄</span>
        </span>
      </summary>
      <div className="floor-plan-awaiting-body">
        <p>Saved edits already replace the original plan. Approve after completing validation.</p>
        <div className="floor-plan-display-list">
          {sortedPlans.map((plan) => (
            <PendingFloorPlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </details>
  );
}

export default function FloorPlansClient({
  initialState,
  plans,
  publications,
  specialPages,
  today,
  planningMonth = "2026-12",
}: {
  initialState: AdminState;
  plans: DateAsset[];
  publications: FloorPlanPublication[];
  specialPages: DateAsset[];
  today: string;
  planningMonth?: string;
}) {
  const router = useRouter();
  const eventContext = useEventContext();
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
  const savedPublications = useMemo(
    () => publications.filter(
      (publication) => publication.payload,
    ),
    [publications],
  );
  const pendingPublications = useMemo(
    () => publications.filter(
      (publication) =>
        publication.plan.status !== "Approved" || !publication.payload,
    ),
    [publications],
  );
  const allUpcoming = useMemo(
    () => buildUpcomingFloorPlanEntries(organized.upcoming, savedPublications),
    [organized.upcoming, savedPublications],
  );
  const monthPrefix = `${planningMonth}-`;
  const december = allUpcoming.filter((entry) => entry.date.startsWith(monthPrefix));
  const upcoming = allUpcoming.filter((entry) => !entry.date.startsWith(monthPrefix));
  const decemberPending = pendingPublications.filter((publication) => publication.plan.eventDate.startsWith(monthPrefix) && !publication.payload);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${planningMonth}-01T12:00:00Z`));
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${planningMonth}-01T12:00:00Z`));
  const focusedDate = eventContext.requestedDate ?? eventContext.selectedEvent?.date ?? null;
  const [openAssetKey, setOpenAssetKey] = useState<string | null>(
    allUpcoming.find((entry) => entry.date === focusedDate)?.key ?? upcoming[0]?.key ?? organized.archived[0]?.image ?? null,
  );
  const [liveByDate, setLiveByDate] = useState<Record<string, FloorPlanLiveState>>({});
  const [windowSyncState, setWindowSyncState] = useState<{
    status: "idle" | "syncing" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [planZoom, setPlanZoom] = useState(100);
  const [monthDraftState, setMonthDraftState] = useState<{ status: "idle" | "preparing" | "success" | "error"; message: string }>({ status: "idle", message: "" });
  const focusedWorkspace = Boolean(eventContext.requestedEventId);
  const focusedPayload = focusedDate ? liveByDate[focusedDate]?.payload ?? savedPublications.find((publication) => publication.plan.eventDate === focusedDate)?.payload ?? null : null;

  useEffect(() => {
    const date = eventContext.requestedDate ?? eventContext.selectedEvent?.date;
    if (!eventContext.ready || !date) return;
    setOpenAssetKey(allUpcoming.find((entry) => entry.date === date)?.key ?? organized.archived.find((asset) => asset.date === date)?.image ?? null);
  }, [eventContext.ready, eventContext.requestedDate, eventContext.selectedEvent?.date, allUpcoming, organized.archived]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("event-host-floor-plans");
    const entertainment = new BroadcastChannel(ENTERTAINMENT_UPDATE_CHANNEL);
    channel.addEventListener("message", () => router.refresh());
    entertainment.addEventListener("message", () => router.refresh());
    return () => { channel.close(); entertainment.close(); };
  }, [router]);

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

  async function handleWindowSync() {
    setWindowSyncState({ status: "syncing", message: "" });
    try {
      const result = await syncFloorPlanWindowFromTripleseat();
      const generatedPlanCount = result.floorPlans.results.filter(
        (entry) => entry.status === "generated" && entry.eventCount > 0,
      ).length;
      setWindowSyncState({
        status: "success",
        message:
          result.warning ??
          `${result.eventCount} event${result.eventCount === 1 ? "" : "s"} synced · ${generatedPlanCount} floor plan${generatedPlanCount === 1 ? "" : "s"} ready`,
      });
    } catch (error) {
      setWindowSyncState({
        status: "error",
        message: error instanceof Error
          ? error.message
          : "Unable to sync upcoming floor plans from Tripleseat.",
      });
    } finally {
      // The page reads On Par Bookings independently even when Tripleseat fails.
      router.refresh();
    }
  }

  async function handlePrepareMonthDrafts() {
    if (monthDraftState.status === "preparing") return;
    setMonthDraftState({ status: "preparing", message: "Reading booked contracts and preparing missing drafts…" });
    try {
      const result = await prepareFloorPlanMonthDrafts(planningMonth);
      const created = result.results.filter((entry) => entry.status === "created").length;
      const skipped = result.results.filter((entry) => entry.status === "skipped").length;
      const errors = result.results.filter((entry) => entry.status === "error").length;
      setMonthDraftState({ status: errors ? "error" : "success", message: `${created} draft${created === 1 ? "" : "s"} created · ${skipped} date${skipped === 1 ? "" : "s"} skipped · ${errors} date${errors === 1 ? " needs" : "s need"} attention.${!created && !errors ? " No missing drafts were available to create." : ""} Skipped dates already have a saved plan or no active booking. Existing saved plans were preserved.` });
      router.refresh();
    } catch (error) {
      setMonthDraftState({ status: "error", message: error instanceof Error ? error.message : "Unable to prepare this month’s drafts. Existing saved plans were preserved." });
    }
  }

  function renderPlan(asset: FloorPlanDisplayAsset) {
    return (
      <FloorPlanCard
        asset={asset}
        isOpen={openAssetKey === asset.image}
        key={`${asset.specialPage ? "special" : "plan"}-${asset.image}`}
        liveState={liveByDate[asset.date]}
        onOpenChange={(open) => {
          setOpenAssetKey((current) =>
            open ? asset.image : current === asset.image ? null : current,
          );
        }}
        onSync={() => void handleLiveSync(asset.date)}
        overlays={initialState.overlaysByAsset[asset.image] ?? []}
        zoom={planZoom}
      />
    );
  }

  function renderUpcomingPlan(entry: (typeof upcoming)[number]) {
    return entry.kind === "static" ? renderPlan(entry.asset) : (
      <PublishedFloorPlanCard
        isOpen={openAssetKey === entry.key}
        key={entry.key}
        liveState={liveByDate[entry.date]}
        onOpenChange={(open) => {
          setOpenAssetKey((current) =>
            open ? entry.key : current === entry.key ? null : current,
          );
        }}
        onSync={() => void handleLiveSync(entry.date)}
        publication={entry.publication}
        showPlanningStatus={entry.date.startsWith(monthPrefix)}
        zoom={planZoom}
      />
    );
  }

  return (
    <PortalShell
      actions={
        <PortalZoomControls
          label="Floor plan zoom"
          maximum={FLOOR_PLAN_ZOOM_MAX}
          minimum={FLOOR_PLAN_ZOOM_MIN}
          onChange={setPlanZoom}
          resetValue={100}
          step={FLOOR_PLAN_ZOOM_STEP}
          value={planZoom}
        />
      }
      allowFullscreen
      mainClassName="floor-plan-page"
      sectionSubtitle="Event Host"
      sectionTitle="Floor Plans"
    >
      {focusedWorkspace ? <>
        <PortalPageHeader description="Reserved seating and entertainment for your selected event only. Use Switch Event in the header to choose another party." eyebrow="My event workspace" title="Floor Plan" />
        <p className="floor-plan-buffer-notice">Seating is reserved 1 hour before and 0.5 hour after the event. Entertainment uses booked times only, with no buffer.</p>
        {!eventContext.ready ? <p role="status">Loading the selected event floor plan…</p> : <SelectedEventFloorPlan date={focusedDate} eventId={eventContext.requestedEventId!} payload={focusedPayload} zoom={planZoom} />}
      </> : <>
      <PortalPageHeader
        aside={
          <div className="portal-status-row">
            <button
              className="floor-plan-live-sync-button"
              disabled={windowSyncState.status === "syncing"}
              onClick={() => void handleWindowSync()}
              type="button"
            >
              {windowSyncState.status === "syncing"
                ? "Syncing…"
                : "Sync On Par + Tripleseat"}
            </button>
            {windowSyncState.message ? (
              <PortalStatusBadge
                tone={windowSyncState.status === "success" ? "success" : "warning"}
              >
                {windowSyncState.message}
              </PortalStatusBadge>
            ) : null}
            <PortalStatusBadge tone="success">
              {upcoming.length} upcoming
            </PortalStatusBadge>
            {pendingPublications.length ? (
              <PortalStatusBadge tone="warning">
                {pendingPublications.length} awaiting approval
              </PortalStatusBadge>
            ) : null}
            <PortalStatusBadge>
              {organized.archived.length} archived
            </PortalStatusBadge>
            <PortalStatusBadge>View only</PortalStatusBadge>
          </div>
        }
        description="Each date starts with all parties. Click an event name on its map to see only that party, or choose Show all events to restore the day."
        eyebrow="Event Operations"
        title="Floor Plans"
      />

      <section aria-labelledby="upcoming-floor-plans" className="floor-plan-group">
        <p className="floor-plan-buffer-notice">Seating is reserved 1 hour before and 0.5 hour after the event. Entertainment uses its booked times only, with no buffer. Displayed event times stay unchanged.</p>
        <div className="floor-plan-group-heading">
          <div>
            <span className="portal-eyebrow">Current workspace</span>
            <h2 id="upcoming-floor-plans">Upcoming floor plans</h2>
          </div>
          <p>Plans are ordered by the next event date.</p>
        </div>
        {upcoming.length ? (
          <div className="floor-plan-display-list">
            {upcoming.map(renderUpcomingPlan)}
          </div>
        ) : (
          <PortalCard className="floor-plan-empty-card">
            {december.length || decemberPending.length ? `${monthLabel} plans are in the separate folder below.` : "No upcoming floor plans are available yet. The newest past plan is open in the archive."}
          </PortalCard>
        )}
      </section>

      <details
        className="floor-plan-archive floor-plan-planning-month"
        open={Boolean(focusedDate?.startsWith(monthPrefix))}
      >
        <summary>
          <span>
            <span className="portal-eyebrow">Advance planning</span>
            <strong>{monthLabel} floor plans</strong>
          </span>
          <span className="floor-plan-archive-count">{december.length + decemberPending.length} plan{december.length + decemberPending.length === 1 ? "" : "s"}</span>
        </summary>
        <div className="floor-plan-display-list">
          <p>{monthLabel} plans stay separate from upcoming events. Drafts and review warnings remain visible until the plans are approved.</p>
          <div className="floor-plan-live-sync-bar">
            <div><strong>Prepare missing drafts</strong><span>Reads booked contracts and creates only missing drafts. Existing saved plans, entertainment reservations, and approvals are never changed.</span></div>
            <button className="floor-plan-live-sync-button" disabled={monthDraftState.status === "preparing"} onClick={() => void handlePrepareMonthDrafts()} type="button">{monthDraftState.status === "preparing" ? `Preparing ${monthName} drafts…` : `Prepare ${monthName} drafts`}</button>
          </div>
          {monthDraftState.message ? <p className={`floor-plan-live-sync-message${monthDraftState.status === "error" ? " is-error" : ""}`} role="status" aria-live="polite">{monthDraftState.message}</p> : null}
          {december.map(renderUpcomingPlan)}
          {decemberPending.map((publication) => <PendingFloorPlanCard key={publication.plan.id} plan={publication.plan} />)}
          {!december.length && !decemberPending.length ? <PortalCard className="floor-plan-empty-card">No {monthLabel} floor plans have been prepared yet.</PortalCard> : null}
        </div>
      </details>

      <details
        className="floor-plan-archive"
        open={!allUpcoming.length && !decemberPending.length}
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

      <AwaitingApprovalSection
        plans={pendingPublications.filter((publication) => !publication.plan.eventDate.startsWith(monthPrefix)).map((publication) => publication.plan)}
      />
      </>}
    </PortalShell>
  );
}
