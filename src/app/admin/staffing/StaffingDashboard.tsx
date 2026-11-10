"use client";

import Link from "next/link";
import { useState } from "react";
import { PortalCard, PortalPageHeader, PortalShell, PortalStatusBadge } from "@/app/_components/PortalShell";
import { formatClock } from "@/lib/entertainment/time";
import { formatEventDate } from "@/lib/event-format";
import { MAX_STAFFING_EARLY_START_MINUTES, type StaffingReview } from "@/lib/staffing/domain";
import type { StaffingState } from "@/lib/staffing/storage";

type Action = { action: "sync" } |
  { action: "assign"; eventId: string; shiftId: string } |
  { action: "remove-manual"; eventId: string; employeeId: string } |
  { action: "keep-clear"; eventId: string; enabled: boolean } |
  { action: "policy"; earlyStartMinutes: number; allowIntermediateStarts: boolean };

const reviewMessage: Record<StaffingReview["code"], string> = {
  "invalid-event-time": "The event time could not be verified.",
  "invalid-source": "The source snapshot was incomplete or invalid.",
  "overlapping-shifts": "An employee has overlapping shifts or event assignments.",
  "uncertain-start": "The shift does not start at a verified matching time.",
  "ambiguous-event": "More than one event could match the shift.",
  "conflicting-note": "The shift note does not identify one eligible event.",
  "unmatched-shift": "No event matched this published shift.",
  "manual-shift-changed": "A shift connected to a manual assignment was removed or changed.",
};

function times(start: string | null, end: string | null) {
  return start && end ? `${formatClock(start)} – ${formatClock(end)}` : "Time not confirmed";
}

function sourceTime(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(value)) + " Eastern" : "Not verified";
}

export default function StaffingDashboard({ rolloutEnabled, initialState, initialFresh, initialEventId, window }: {
  rolloutEnabled: boolean;
  initialState: StaffingState | null;
  initialFresh: boolean;
  initialEventId: string;
  window: { startDate: string; endDate: string };
}) {
  const [state, setState] = useState(initialState);
  const [fresh, setFresh] = useState(initialFresh);
  const [eventId, setEventId] = useState(initialEventId);
  const [shiftId, setShiftId] = useState("");
  const [earlyStart, setEarlyStart] = useState(String(initialState?.policy.earlyStartMinutes ?? 60));
  const [intermediate, setIntermediate] = useState(initialState?.policy.allowIntermediateStarts ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reconciled = state?.reconciliation;
  const visibleWindow = fresh && reconciled ? reconciled.window : window;
  const inWindow = (date: string) => date >= visibleWindow.startDate && date <= visibleWindow.endDate;
  const events = (state?.events ?? []).filter((event) => inWindow(event.date));
  const selected = events.find((event) => event.eventId === eventId);
  const alerts = (reconciled?.alerts ?? []).filter((alert) => !alert.resolvedAt && inWindow(alert.eventDate) &&
    reconciled?.eventStatuses[alert.eventId] === "unassigned");
  const reviews = (reconciled?.reviews ?? []).filter((review) => !review.eventIds.length || review.eventIds.includes(eventId));
  const assignments = (reconciled?.assignments ?? []).filter((row) => row.eventId === eventId && row.eventDate === selected?.date);
  const candidateShifts = selected?.startAt && selected.endAt ? (state?.shifts ?? []).filter((shift) =>
    Date.parse(shift.startAt) < Date.parse(selected.endAt!) && Date.parse(shift.endAt) > Date.parse(selected.startAt!),
  ) : [];
  const keepClear = state?.keepClearEventIds.includes(eventId) ?? false;
  const leadMinutes = Number(earlyStart);
  const validLead = earlyStart.trim() !== "" && Number.isInteger(leadMinutes) && leadMinutes >= 0 && leadMinutes <= MAX_STAFFING_EARLY_START_MINUTES;
  const canAssign = Boolean(rolloutEnabled && fresh && state && selected && !busy);
  const otherAssignment = (id: string) => reconciled?.assignments.find((row) => row.shiftId === id && row.eventId !== eventId);

  function chooseEvent(id: string) {
    setEventId(id);
    setShiftId("");
    setMessage("");
  }

  async function submit(action: Action) {
    if (busy || !rolloutEnabled || (action.action !== "sync" && !state)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/staffing", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(action.action === "sync" ? action : { ...action, expectedVersion: state!.version }),
      });
      const result = await response.json().catch(() => null) as { state?: StaffingState; fresh?: boolean; error?: string } | null;
      if (!response.ok || !result?.state || typeof result.fresh !== "boolean") {
        if (response.status === 409 || response.status === 503) setFresh(false);
        throw new Error(result?.error || "The staffing update could not be completed. Your selection was kept.");
      }
      setState(result.state);
      setFresh(result.fresh);
      setShiftId("");
      setMessage(action.action === "sync" ? result.fresh ? "Published shifts refreshed." : "Staffing could not be verified. Saved assignments were retained." : "Staffing update saved.");
    } catch (error) {
      if (action.action === "sync") setFresh(false);
      setMessage(error instanceof Error ? error.message : "The staffing update could not be completed. Your selection was kept.");
    } finally {
      setBusy(false);
    }
  }

  return <PortalShell mainClassName="page" sectionTitle="Staffing Review" sectionSubtitle="Admin">
    <PortalPageHeader title="Staffing Review" eyebrow="Admin only" description="Review published Corporate Parties shifts and make corrections in Event Host. These controls do not edit the 7shifts schedule." aside={<Link className="button-link" href="/admin">Back to Admin</Link>} />
    {!rolloutEnabled ? <PortalCard><p>Staffing setup is not active. Complete the secure Staff Tools connection and Admin verification setup before syncing or assigning staff.</p></PortalCard> :
      <div className="admin-operations-review">
        <PortalCard>
          <h2>Schedule verification</h2>
          <p><PortalStatusBadge tone={fresh ? "success" : "warning"}>{fresh ? "Verified" : "Not verified"}</PortalStatusBadge></p>
          <p>Last successful sync: {sourceTime(reconciled?.lastSuccessfulSyncAt ?? null)}</p>
          {state?.lastAttemptAt ? <p>Last attempt: {sourceTime(state.lastAttemptAt)}</p> : null}
          {!fresh ? <p role="status">{state?.failure === "events" ? "Tripleseat events could not be verified." : state?.failure === "shifts" ? "Published 7shifts schedules could not be verified." : state?.failure === "incomplete" ? "The source returned incomplete staffing data." : "A current staffing snapshot is not available."} Saved assignments and unresolved alerts below are not proof of current coverage. Refresh before editing.</p> : null}
          <button className="button-link" disabled={busy} onClick={() => void submit({ action: "sync" })} type="button">{busy ? "Working…" : "Sync published shifts"}</button>
          {message ? <p role="status">{message}</p> : null}
        </PortalCard>
        <PortalCard>
          <h2>Unassigned events</h2>
          {alerts.length ? <ul>{alerts.map((alert) => <li key={alert.key}>
            <button className="button-link" type="button" onClick={() => chooseEvent(alert.eventId)}>{alert.eventName}</button>{" "}
            {formatEventDate(alert.eventDate)} · {times(alert.startAt, alert.endAt)}
          </li>)}</ul> : <p>{fresh ? "No confirmed unassigned events are open." : "No current alert status can be verified."}</p>}
        </PortalCard>
        <PortalCard>
          <h2>Assignments and match review</h2>
          <label>Event <select value={eventId} onChange={(event) => chooseEvent(event.target.value)}>
            <option value="">Choose an event…</option>
            {events.map((event) => <option key={event.eventId} value={event.eventId}>{event.eventName} · {formatEventDate(event.date)}</option>)}
          </select></label>
          {selected ? <>
            <p>{formatEventDate(selected.date)} · {times(selected.startAt, selected.endAt)}</p>
            {assignments.length ? <ul>{assignments.map((row) => <li key={row.employeeId}>{row.employeeName} · {row.source === "manual" ? "Admin assigned" : "Automatically matched"}
              {row.source === "manual" ? <> <button className="button-link" disabled={!canAssign} type="button" onClick={() => void submit({ action: "remove-manual", eventId, employeeId: row.employeeId })}>Remove manual assignment</button></> : null}
            </li>)}</ul> : <p>{fresh ? "No saved assignments for this event." : "Assignments are not confirmed."}</p>}
            <label>Published shift <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} disabled={!canAssign}>
              <option value="">Choose a shift…</option>
              {candidateShifts.map((shift) => {
                const previous = otherAssignment(shift.shiftId);
                return <option key={shift.shiftId} value={shift.shiftId}>{shift.employeeName} · {times(shift.startAt, shift.endAt)}
                  {previous ? ` · Assigned to ${events.find((event) => event.eventId === previous.eventId)?.eventName ?? "another event"}` : ""}
                </option>;
              })}
            </select></label>{" "}
            <button className="button-link" disabled={!canAssign || !candidateShifts.some((shift) => shift.shiftId === shiftId)} type="button" onClick={() => {
              if (!otherAssignment(shiftId) || globalThis.confirm("Move this shift from its current event to the selected event?")) void submit({ action: "assign", eventId, shiftId });
            }}>{otherAssignment(shiftId) ? "Move shift" : "Assign shift"}</button>{" "}
            <button className="button-link" disabled={!canAssign} type="button" onClick={() => void submit({ action: "keep-clear", eventId, enabled: !keepClear })}>{keepClear ? "Resume automatic matching" : "Pause automatic matching for this event"}</button>
          </> : null}
          {reviews.length ? <ul aria-label="Match review details">{reviews.map((review, index) => {
            const shift = state?.shifts.find((row) => row.shiftId === review.shiftId);
            const choices = review.eventIds.flatMap((id) => events.find((event) => event.eventId === id)?.eventName ?? []);
            return <li key={`${review.code}:${review.shiftId ?? ""}:${index}`}>{reviewMessage[review.code]}{shift ? ` ${shift.employeeName} · ${times(shift.startAt, shift.endAt)}.` : ""}{choices.length ? ` Possible events: ${choices.join(", ")}.` : ""}</li>;
          })}</ul> : null}
        </PortalCard>
        <PortalCard>
          <h2>Matching rules</h2>
          <form onSubmit={(event) => { event.preventDefault(); if (validLead) void submit({ action: "policy", earlyStartMinutes: leadMinutes, allowIntermediateStarts: intermediate }); }}>
            <label>Early start minutes <input type="number" min="0" max={MAX_STAFFING_EARLY_START_MINUTES} step="1" value={earlyStart} onChange={(event) => setEarlyStart(event.target.value)} /></label>
            <label><input type="checkbox" checked={intermediate} onChange={(event) => setIntermediate(event.target.checked)} /> Allow shift starts between the early start and event start</label>
            <p>Leave intermediate starts off until this policy is confirmed. By default only the exact early start and the event start qualify automatically.</p>
            <button className="button-link" disabled={busy || !state || !validLead} type="submit">Save matching rules</button>
          </form>
        </PortalCard>
      </div>}
  </PortalShell>;
}
