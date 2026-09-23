"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PortalPageHeader, PortalShell } from "@/app/_components/PortalShell";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import type { VipCheckinRow, VipFoodStatus } from "@/lib/vip-checkin/service";

const EMPLOYEE_STORAGE_KEY = "event-host-vip-check-in-employee";
const statusLabels: Record<VipFoodStatus, string> = {
  NOT_CHECKED_IN: "Waiting for check-in",
  SENDING_FOOD: "Sending Food",
  FOOD_SENT: "Food Sent",
  FOOD_SEND_FAILED: "Food Send Failed",
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

export default function VipCheckInClient() {
  const [date, setDate] = useState(todayInEntertainmentTimeZone);
  const [rows, setRows] = useState<VipCheckinRow[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessState, setAccessState] = useState<"authorized" | "needs-admin" | "can-authorize">("authorized");
  const [pendingId, setPendingId] = useState<string | null>(null);
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
        canAuthorize?: boolean;
      };
      if (response.status === 403) {
        if (selectedDate !== dateRef.current || sequence !== refreshSeq.current) return;
        setRows([]);
        setError("");
        setAccessState(payload.canAuthorize ? "can-authorize" : "needs-admin");
        return;
      }
      if (!response.ok || !payload.reservations) {
        throw new Error(payload.error || "VIP reservations could not be loaded.");
      }
      if (selectedDate !== dateRef.current || sequence !== refreshSeq.current) return;
      setRows(payload.reservations);
      setEmployees(payload.employees ?? []);
      setAccessState("authorized");
      setError("");
    } catch (loadError) {
      if (selectedDate === dateRef.current && sequence === refreshSeq.current) {
        setError(loadError instanceof Error ? loadError.message : "VIP reservations could not be loaded.");
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
    setLoading(true);
    void refresh(date);
    const interval = window.setInterval(() => void refresh(date), 10_000);
    return () => window.clearInterval(interval);
  }, [date, refresh]);

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
      if (payload.reservation.foodStatus === "FOOD_SEND_FAILED") {
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

  async function authorizeTablet() {
    setError("");
    try {
      const response = await fetch("/api/vip-checkin/device", { method: "POST" });
      if (!response.ok) throw new Error("An admin must authorize this tablet before staff can check in VIPs.");
      await refresh(date);
    } catch (authorizationError) {
      setError(authorizationError instanceof Error ? authorizationError.message : "Tablet authorization failed.");
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

  return (
    <PortalShell
      mainClassName="page vip-checkin-page"
      sectionSubtitle="Arrival and kitchen release"
      sectionTitle="VIP CHECK-IN"
    >
      <PortalPageHeader
        eyebrow="Staff operations"
        title="VIP CHECK-IN"
        description="Confirm a VIP group when they arrive. Their reserved food is released to the kitchen only after check-in."
      />

      <div className="vip-checkin-controls">
        <label>
          Reservation date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="button" onClick={() => setDate(todayInEntertainmentTimeZone())}>Today</button>
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
      {accessState !== "authorized" ? (
        <div className="vip-checkin-access">
          <h2>Authorize this staff tablet</h2>
          <p>An admin authorizes each tablet once. Employees then select their name here—no employee code is needed.</p>
          {accessState === "can-authorize" ? (
            <button type="button" onClick={() => void authorizeTablet()}>Authorize this tablet</button>
          ) : (
            <p>Ask an admin to sign in on the <a href="/admin">Admin tab</a> using this tablet, then return here and tap Refresh.</p>
          )}
        </div>
      ) : null}
      {loading ? <p className="vip-checkin-empty">Loading VIP reservations…</p> : null}
      {!loading && accessState === "authorized" && !rows.length ? (
        <p className="vip-checkin-empty">No active VIP reservations found for {easternDate(date)}.</p>
      ) : null}

      <div className="vip-checkin-list">
        {rows.map((row) => (
          <article className="vip-checkin-card" key={row.reservationId}>
            <div className="vip-checkin-card-main">
              <h2>{row.vipName}</h2>
              <dl>
                <div><dt>Reservation Date</dt><dd>{easternDate(row.reservationDate)}</dd></div>
                <div><dt>Reservation Time</dt><dd>{easternTime(row.reservationTime)}</dd></div>
                <div><dt>Customer Name</dt><dd>{row.customerName}</dd></div>
                <div><dt>Reserved VIP Area</dt><dd>{row.vipArea}</dd></div>
              </dl>
            </div>
            <div className="vip-checkin-card-action">
              <div className="vip-checkin-status-group">
                <span className="vip-checkin-status-label">Check-in status</span>
                <span className="vip-checkin-status">{row.checkedInAt ? "Checked In" : "Not Checked In"}</span>
              </div>
              <div className="vip-checkin-status-group">
                <span className="vip-checkin-status-label">Food status</span>
                <span className={`vip-checkin-status ${row.foodStatus === "FOOD_SEND_FAILED" ? "is-failed" : ""}`}>
                  {statusLabels[row.foodStatus]}
                </span>
              </div>
              {row.checkedInAt ? (
                <p className="vip-checkin-confirmed">
                  Checked in by {row.checkedInBy} at {easternTime(row.checkedInAt)}
                </p>
              ) : (
                <button
                  className="vip-checkin-primary"
                  disabled={!employeeName || pendingId !== null}
                  onClick={() => void confirmCheckIn(row.reservationId)}
                  type="button"
                >
                  {pendingId === row.reservationId ? "CHECKING IN…" : "CONFIRM CHECK-IN"}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </PortalShell>
  );
}
