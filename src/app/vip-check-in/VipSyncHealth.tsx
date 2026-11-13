"use client";

import { useState } from "react";
import type { VipSyncHealth as Health } from "@/lib/vip-prep/sync-health-types";

export default function VipSyncHealth({ date, reservationId }: { date: string; reservationId: string }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function verify() {
    setLoading(true);
    setError("");
    setHealth(null);
    try {
      const response = await fetch(`/api/vip-checkin/health?${new URLSearchParams({ date, reservationId })}`, { cache: "no-store" });
      const value = await response.json() as { health?: Health; error?: string };
      if (!response.ok || !value.health) throw new Error(value.error ?? "View verification failed.");
      setHealth(value.health);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "View verification failed."); }
    finally { setLoading(false); }
  }
  return <details className="vip-sync-health"><summary>Verify this VIP across Event Host</summary>
    <p>Read-only view checks. This does not check in the customer, save a floor plan, or release food.</p>
    <button disabled={loading} onClick={() => void verify()} type="button">{loading ? "Verifying views…" : "Verify view sync"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {health ? <div aria-live="polite">
      <p>Source reservation: {health.sourceFound === true ? "Found" : health.sourceFound === false ? "Not active on this date" : "Unavailable — not verified"}.</p>
      <p>Last successful booking refresh: {health.lastSuccessfulRefreshAt ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(health.lastSuccessfulRefreshAt)) : "not recorded"}.</p>
      {health.sourceError ? <p role="alert">{health.sourceError}</p> : null}
      <ul>{([ ["Floor Plans", health.floorPlan], ["Entertainment Schedule", health.entertainment], ["Kitchen and print", health.kitchen], ["VIP CHECK-IN", health.checkIn] ] as const).map(([label, check]) => <li key={label}><a href={check.href}>{label}</a>: <strong>{check.represented === true ? "Represented" : check.represented === false ? "Needs attention" : "Not verified"}</strong>. {check.detail}</li>)}</ul>
      <p>Arrival: {health.arrival.replaceAll("-", " ")}. Food release: {health.foodRelease ?? "not verified"}.</p>
    </div> : null}
  </details>;
}
