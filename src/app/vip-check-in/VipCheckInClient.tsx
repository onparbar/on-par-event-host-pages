"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PortalPageHeader, PortalShell } from "@/app/_components/PortalShell";
import { EventSelectionBridge, useEventContext } from "@/app/_components/EventContext";
import { isValidEntertainmentDate, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import type { VipCheckinRow, VipFoodStatus } from "@/lib/vip-checkin/service";
import { vipCheckinNavigationRows } from "@/lib/vip-checkin/navigation";
import VipSyncHealth from "./VipSyncHealth";

const EMPLOYEE_STORAGE_KEY = "event-host-vip-check-in-employee";
export const vipFoodStatusLabels: Record<VipFoodStatus, string> = {
  NOT_CHECKED_IN: "Awaiting VIP check-in — food not released.",
  FOOD_SCHEDULED: "Scheduled for Kitchen Prep",
  SENDING_FOOD: "Sending — awaiting acceptance",
  FOOD_SENT: "Sent to KDS — GoTab accepted",
  FOOD_SEND_FAILED: "Food Send Failed",
  FOOD_PARTIAL: "Partially accepted — review remaining food",
  FOOD_HELD: "Held — review required",
  FOOD_UNCERTAIN: "Delivery uncertain — do not retry blindly",
  FOOD_PENDING: "Pending food release — acceptance not confirmed",
  NO_FOOD_ITEMS: "No Food Items",
};

function easternDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function easternTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function easternTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function VipCheckinCard({ row, employeeName, pendingId, disabled = false, onConfirm }: {
  row: VipCheckinRow; employeeName: string; pendingId: string | null; disabled?: boolean; onConfirm: (reservationId: string) => void;
}) {
  const warning = ["FOOD_SEND_FAILED", "FOOD_PARTIAL", "FOOD_HELD", "FOOD_UNCERTAIN"].includes(row.foodStatus);
  return <article className="vip-checkin-card" key={row.reservationId}>
    <div className="vip-checkin-card-main">
      <h2>{row.vipName}</h2>
      <p>On Par Bookings · {row.confirmationCode}</p>
      <dl>
        <div><dt>Reservation Date</dt><dd>{easternDate(row.reservationDate)}</dd></div>
        <div><dt>Reservation Time</dt><dd>{easternTimestamp(row.reservationTime)} – {easternTimestamp(row.endAt)} · {row.duration}</dd></div>
        <div><dt>Customer Name</dt><dd>{row.customerName}</dd></div>
        <div><dt>Reserved VIP Area</dt><dd>{row.vipArea}</dd></div>
        <div><dt>Party Size</dt><dd>{row.partySize} guests</dd></div>
        <div><dt>Food Release Time</dt><dd>{row.scheduledReleaseAt ? `${easternTimestamp(row.scheduledReleaseAt)} — requires Event Host check-in` : row.foodItems.length ? "Prep timing needs review" : "No food order"}</dd></div>
      </dl>
      <h3>Exact preordered food</h3>
      {row.foodItems.length ? <ul>{row.foodItems.map((item, index) => <li key={`${item.code}:${index}`}>{item.quantity} × {item.label}</li>)}</ul> : <p>No preordered food.</p>}
      <h3>Purchased non-food extras</h3>
      {row.extras.length ? <ul>{row.extras.map((extra, index) => <li key={`${extra.code ?? "extra"}:${index}`}>{extra.quantity == null ? "Quantity not supplied · " : `${extra.quantity} × `}{extra.label}</li>)}</ul> : <p>No non-food extras listed.</p>}
      {row.preorderChange ? <div role="note" aria-label="VIP preorder change">
        <strong>Preorder changed · {easternTimestamp(row.preorderChange.sourceUpdatedAt)}</strong>
        <p>{row.preorderChange.message}</p>
        <p>Previous: {row.preorderChange.previous.map((item) => `${item.quantity} × ${item.label}`).join("; ") || "No preordered food"}.</p>
        <p>Current: {row.preorderChange.current.map((item) => `${item.quantity} × ${item.label}`).join("; ") || "No preordered food"}.</p>
      </div> : null}
      {row.itemIssues.length ? <div className="vip-checkin-error" role="alert"><strong>Food item issues</strong><ul>{row.itemIssues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}</ul></div> : null}
      <small>Booking updated {easternTimestamp(row.sourceUpdatedAt)}. Last successful booking refresh {row.lastSuccessfulBookingRefresh ? easternTimestamp(row.lastSuccessfulBookingRefresh) : "not recorded"}.</small>
      <VipSyncHealth key={JSON.stringify([row.reservationDate, row.sourceUpdatedAt, row.foodItems, row.vipArea, row.reservationTime, row.endAt, row.partySize, row.checkedInAt, row.foodStatus, row.acceptedItemCount, disabled])} date={row.reservationDate} reservationId={row.reservationId} />
    </div>
    <div className="vip-checkin-card-action">
      <div className="vip-checkin-status-group"><span className="vip-checkin-status-label">Arrival status</span><span className="vip-checkin-status">{row.checkedInAt ? "Checked In" : "Not Checked In"}</span></div>
      <div className="vip-checkin-status-group"><span className="vip-checkin-status-label">Food release status</span><span className={`vip-checkin-status ${warning ? "is-failed" : ""}`}>{vipFoodStatusLabels[row.foodStatus]}</span></div>
      {row.checkedInAt && row.expectedItemCount > 0 ? <p>{row.acceptedItemCount} of {row.expectedItemCount} initial food items accepted by GoTab.</p> : null}
      {row.checkedInAt ? <p className="vip-checkin-confirmed">Checked in by {row.checkedInBy} at {easternTimestamp(row.checkedInAt)}</p> : <button className="vip-checkin-primary" disabled={disabled || !employeeName || pendingId !== null} onClick={() => onConfirm(row.reservationId)} type="button">{pendingId === row.reservationId ? "CHECKING IN…" : "CONFIRM CHECK-IN"}</button>}
    </div>
  </article>;
}

export default function VipCheckInClient() {
  const eventContext = useEventContext();
  const [manualDate, setManualDate] = useState(todayInEntertainmentTimeZone);
  const [dateTransition, setDateTransition] = useState(false);
  const preferredDate = eventContext.requestedDate ?? eventContext.selectedEvent?.date;
  const date = !dateTransition && eventContext.ready && preferredDate && isValidEntertainmentDate(preferredDate) ? preferredDate : manualDate;
  const preferredEventId = dateTransition ? null : eventContext.preferredEventId;
  const [rows, setRows] = useState<VipCheckinRow[]>([]);
  const [loadedDate, setLoadedDate] = useState("");
  const [employees, setEmployees] = useState<string[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingSourceError, setBookingSourceError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const dateRef = useRef(date);
  const refreshSeq = useRef(0);
  dateRef.current = date;

  const refresh = useCallback(async (selectedDate: string) => {
    const sequence = ++refreshSeq.current;
    try {
      const response = await fetch(`/api/vip-checkin?date=${encodeURIComponent(selectedDate)}`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        reservations?: VipCheckinRow[];
        employees?: string[];
        error?: string;
        lastSuccessfulBookingRefresh?: string | null;
        sourceError?: string | null;
      };
      if (!response.ok || !payload.reservations) {
        throw new Error(payload.error || "VIP reservations could not be loaded.");
      }
      if (selectedDate !== dateRef.current || sequence !== refreshSeq.current) return;
      setRows(payload.reservations);
      setLoadedDate(selectedDate);
      setEmployees(payload.employees ?? []);
      setLastSuccessfulRefresh(payload.lastSuccessfulBookingRefresh ?? payload.reservations[0]?.lastSuccessfulBookingRefresh ?? null);
      setBookingSourceError(payload.sourceError ?? "");
    } catch (loadError) {
      if (selectedDate === dateRef.current && sequence === refreshSeq.current) {
        setBookingSourceError(loadError instanceof Error ? loadError.message : "VIP reservations could not be loaded.");
      }
    } finally {
      if (selectedDate === dateRef.current && sequence === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      setEmployeeName(localStorage.getItem(EMPLOYEE_STORAGE_KEY) ?? "");
    } catch {
      // Employee selection remains available if local storage is blocked.
    }
  }, []);

  useEffect(() => {
    if (dateTransition && !eventContext.requestedDate && !eventContext.preferredEventId) setDateTransition(false);
  }, [dateTransition, eventContext.requestedDate, eventContext.preferredEventId]);

  useEffect(() => {
    if (!eventContext.ready) return;
    setLoading(true);
    void refresh(date);
    const interval = window.setInterval(() => void refresh(date), 10_000);
    return () => window.clearInterval(interval);
  }, [date, refresh, eventContext.ready]);

  async function confirmCheckIn(reservationId: string) {
    if (pendingRef.current || !employeeName) return;
    pendingRef.current = reservationId;
    refreshSeq.current += 1;
    setPendingId(reservationId);
    setError("");
    try {
      const response = await fetch("/api/vip-checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservationId, date, employeeName }),
      });
      const payload = await response.json() as { reservation?: VipCheckinRow; error?: string };
      if (!response.ok || !payload.reservation) {
        throw new Error(payload.error || "Check-in could not be completed.");
      }
      setRows((current) => current.map((row) =>
        row.reservationId === reservationId ? payload.reservation! : row,
      ));
      if (["FOOD_SEND_FAILED", "FOOD_PARTIAL", "FOOD_HELD", "FOOD_UNCERTAIN"].includes(payload.reservation.foodStatus)) {
        setError("Check-in was saved, but the food order needs review. Do not submit it again blindly.");
      }
    } catch (checkinError) {
      setError(checkinError instanceof Error ? checkinError.message : "Check-in could not be completed.");
      await refresh(date);
    } finally {
      pendingRef.current = null;
      setPendingId(null);
    }
  }

  function selectEmployee(value: string) {
    setEmployeeName(value);
    try {
      localStorage.setItem(EMPLOYEE_STORAGE_KEY, value);
    } catch {
      // The selected employee remains available for this page session.
    }
  }

  function selectDate(value: string) {
    if (pendingRef.current || !isValidEntertainmentDate(value)) return;
    // Ignore the old URL preference while router.replace clears it; never let
    // the old day's reservations remain actionable during that transition.
    setDateTransition(true);
    setManualDate(value);
    if (value !== date) {
      setRows([]);
      setLoadedDate("");
      setLoading(true);
      refreshSeq.current += 1;
    }
    eventContext.clearEvent();
  }

  const visibleRows = loadedDate === date ? vipCheckinNavigationRows(rows, preferredEventId, date) : [];
  const selectedVip = preferredEventId && visibleRows.length === 1 ? visibleRows[0] : null;

  return (
    <PortalShell
      mainClassName="page vip-checkin-page"
      sectionSubtitle="Arrival and kitchen release"
      sectionTitle="VIP CHECK-IN"
    >
      <EventSelectionBridge event={selectedVip ? { eventId: preferredEventId!, eventName: selectedVip.vipName, date: selectedVip.reservationDate, area: selectedVip.vipArea, time: easternTime(selectedVip.reservationTime) } : null} />
      <PortalPageHeader
        eyebrow="Staff operations"
        title="VIP CHECK-IN"
        description="Early check-in is available before the reservation starts. Booked food stays scheduled for kitchen prep time."
      />

      <div className="vip-checkin-controls">
        <label>
          Reservation date
          <input type="date" disabled={pendingId !== null} value={date} onChange={(event) => selectDate(event.target.value)} />
        </label>
        <button type="button" disabled={pendingId !== null} onClick={() => selectDate(todayInEntertainmentTimeZone())}>Today</button>
        {preferredEventId ? <button type="button" disabled={pendingId !== null} onClick={() => selectDate(date)}>Show all VIPs</button> : null}
        <label>
          Your name
          <select value={employeeName} onChange={(event) => selectEmployee(event.target.value)}>
            <option value="">Select employee</option>
            {employees.map((employee) => <option key={employee} value={employee}>{employee}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void refresh(date)}>Refresh</button>
      </div>

      {error ? <p className="vip-checkin-error" role="alert">{error}</p> : null}
      {bookingSourceError ? <p className="vip-checkin-error" role="alert">{bookingSourceError}</p> : null}
      {lastSuccessfulRefresh ? <p className="vip-checkin-empty">Last successful booking refresh: {easternTimestamp(lastSuccessfulRefresh)}{bookingSourceError ? loadedDate === date && rows.length ? " · Showing the last successful result; source refresh is unavailable." : " · Source refresh unavailable; no current reservation list is verified." : ""}</p> : null}
      {loading ? <p className="vip-checkin-empty">Loading VIP reservations…</p> : null}
      {!loading && !bookingSourceError && loadedDate === date && !visibleRows.length ? (
        <p className="vip-checkin-empty">{preferredEventId ? "The selected event has no matching VIP reservation on this date. No other party has been substituted. Use Show all VIPs to see this day’s reservations." : `No active VIP reservations found for ${easternDate(date)}.`}</p>
      ) : null}

      <div className="vip-checkin-list">
        {visibleRows.map((row) => <VipCheckinCard key={row.reservationId} row={row} employeeName={employeeName} pendingId={pendingId} disabled={loading || Boolean(bookingSourceError)} onConfirm={(reservationId) => void confirmCheckIn(reservationId)} />)}
      </div>
    </PortalShell>
  );
}
