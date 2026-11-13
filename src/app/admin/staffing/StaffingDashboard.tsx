"use client";

import { useState } from "react";
import { PortalCard, PortalPageHeader, PortalShell, PortalStatusBadge } from "@/app/_components/PortalShell";
import { formatClock } from "@/lib/entertainment/time";
import { formatEventDate } from "@/lib/event-format";
import { MAX_STAFFING_EARLY_START_MINUTES, staffingShiftCoversEvent, staffingShiftIsOnEventDay, type StaffingReview } from "@/lib/staffing/domain";
import type { StaffingAdminChange } from "@/lib/staffing/service";
import type { StaffingState } from "@/lib/staffing/storage";

type WithoutVersion<Change> = Change extends { expectedVersion: number } ? Omit<Change, "expectedVersion"> : never;
type Action = { action: "sync" } | WithoutVersion<StaffingAdminChange>;

const reviewMessage: Record<StaffingReview["code"], string> = {
  "invalid-event-time": "The event time could not be verified.",
  "invalid-source": "The source snapshot was incomplete or invalid.",
  "overlapping-shifts": "An employee has overlapping shifts or event assignments.",
  "uncertain-start": "The shift timing does not match the rule or cover the whole event.",
  "ambiguous-event": "More than one event could match the shift.",
  "conflicting-note": "The shift note does not identify one eligible event.",
  "unmatched-shift": "No event matched this published shift.",
  "manual-shift-changed": "A shift connected to a manual assignment was removed or changed.",
  "manual-coverage": "A manually assigned shift does not cover the full event.",
};

function times(start: string | null, end: string | null) {
  return start && end ? `${formatClock(start)} – ${formatClock(end)}` : "Time not confirmed";
}

function sourceTime(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(value)) + " Eastern" : "Not verified";
}

export default function StaffingDashboard({ rolloutEnabled, initialState, initialFresh, initialEventId, requestedDate, window }: {
  rolloutEnabled: boolean;
  initialState: StaffingState | null;
  initialFresh: boolean;
  initialEventId: string;
  requestedDate?: string;
  window: { startDate: string; endDate: string };
}) {
  const [state, setState] = useState(initialState);
  const [fresh, setFresh] = useState(initialFresh);
  const [eventId, setEventId] = useState(initialEventId);
  const [draftShiftIds, setDraftShiftIds] = useState<string[] | null>(null);
  const [earlyStart, setEarlyStart] = useState(String(initialState?.policy.earlyStartMinutes ?? 60));
  const [intermediate, setIntermediate] = useState(initialState?.policy.allowIntermediateStarts ?? false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reconciled = state?.reconciliation;
  const visibleWindow = fresh && reconciled ? reconciled.window : window;
  const inWindow = (date: string) => date >= visibleWindow.startDate && date <= visibleWindow.endDate;
  const events = (state?.events ?? []).filter((event) => inWindow(event.date));
  const selected = events.find((event) => event.eventId === eventId &&
    (eventId !== initialEventId || !requestedDate || event.date === requestedDate));
  const alerts = (reconciled?.alerts ?? []).filter((alert) => !alert.resolvedAt && inWindow(alert.eventDate) &&
    reconciled?.eventStatuses[alert.eventId] === "unassigned");
  const reviews = (reconciled?.reviews ?? []).filter((review) => !review.eventIds.length || review.eventIds.includes(eventId));
  const assignments = (reconciled?.assignments ?? []).filter((row) => row.eventId === eventId && row.eventDate === selected?.date);
  const candidateShifts = selected && state?.dailyScheduleComplete ? state.shifts
    .filter((shift) => staffingShiftIsOnEventDay(shift, selected.date))
    .sort((left, right) => left.employeeName.localeCompare(right.employeeName) || Date.parse(left.startAt) - Date.parse(right.startAt)) : [];
  const keepClear = Boolean(state?.keepClearEventIds.includes(eventId) ||
    state?.manualTeams?.some((row) => row.eventId === eventId && row.eventDate === selected?.date) ||
    state?.suppressedAssignments?.some((row) => row.eventId === eventId && row.eventDate === selected?.date));
  const leadMinutes = Number(earlyStart);
  const validLead = earlyStart.trim() !== "" && Number.isInteger(leadMinutes) && leadMinutes >= 0 && leadMinutes <= MAX_STAFFING_EARLY_START_MINUTES;
  const canAssign = Boolean(rolloutEnabled && fresh && state?.dailyScheduleComplete && selected && !busy);
  const otherAssignment = (id: string) => reconciled?.assignments.find((row) => row.shiftId === id && row.eventId !== eventId);
  const overlappingAssignment = (shift: StaffingState["shifts"][number]) => selected && reconciled?.assignments.find((row) => {
    if (row.employeeId !== shift.employeeId || row.eventId === eventId || row.shiftId === shift.shiftId) return false;
    const other = events.find((event) => event.eventId === row.eventId && event.date === row.eventDate);
    return other?.startAt && other.endAt && selected.startAt && selected.endAt &&
      Date.parse(other.startAt) < Date.parse(selected.endAt) && Date.parse(other.endAt) > Date.parse(selected.startAt);
  });
  const savedShiftIds = assignments.flatMap((row) => row.shiftId ? [row.shiftId] : []);
  const shiftIds = draftShiftIds ?? savedShiftIds;
  const chosenShifts = candidateShifts.filter((shift) => shiftIds.includes(shift.shiftId));
  const chosenEmployees = new Set(chosenShifts.map((shift) => shift.employeeId));
  const chosenConflict = chosenShifts.some((shift) => overlappingAssignment(shift));
  const removesStaff = assignments.some((row) => !chosenEmployees.has(row.employeeId));
  const homeHref = requestedDate ? `/?${new URLSearchParams({ date: requestedDate })}` : "/";

  function chooseEvent(id: string) {
    setEventId(id);
    setDraftShiftIds(null);
    setMessage("");
  }

  async function submit(action: Action) {
    if (busy || !rolloutEnabled || (action.action !== "sync" && !state)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/staffing", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, expectedVersion: state?.version ?? 0 }),
      });
      const result = await response.json().catch(() => null) as { state?: StaffingState; fresh?: boolean; error?: string } | null;
      if (!response.ok || !result?.state || typeof result.fresh !== "boolean") {
        if (response.status === 409 || response.status === 503) setFresh(false);
        throw new Error(result?.error || "The staffing update could not be completed. Your selection was kept.");
      }
      setState(result.state);
      setFresh(result.fresh);
      if (action.action === "sync" && result.fresh && !initialEventId && !result.state.events.some((event) => event.eventId === eventId)) {
        setEventId(result.state.events[0]?.eventId ?? "");
      }
      setDraftShiftIds(null);
      setMessage(action.action === "sync" ? result.fresh ? "Published shifts refreshed." : "Staffing could not be verified. Saved assignments were retained." : "Staffing update saved.");
    } catch (error) {
      if (action.action === "sync") setFresh(false);
      setMessage(error instanceof Error ? error.message : "The staffing update could not be completed. Your selection was kept.");
    } finally {
      setBusy(false);
    }
  }

  return <PortalShell mainClassName="page" sectionTitle="Staffing Review" sectionSubtitle="Admin">
    <PortalPageHeader title="Staffing Review" eyebrow="Admin only" description="Review Corporate Parties matches and assign people from the day's published schedule. Changes are saved only in Event Host, not in 7shifts." aside={<a className="button-link" href={homeHref}>Back to Choose Your Event</a>} />
    {!rolloutEnabled ? <PortalCard><p>Staffing setup is not active. Enable passphrase-protected Admin access before syncing or assigning staff.</p></PortalCard> :
      <div className="admin-operations-review">
        <PortalCard>
          <h2>Schedule verification</h2>
          <p><PortalStatusBadge tone={fresh ? "success" : "warning"}>{fresh ? "Verified" : "Not verified"}</PortalStatusBadge></p>
          <p>Last successful sync: {sourceTime(reconciled?.lastSuccessfulSyncAt ?? null)}</p>
          {state?.lastAttemptAt ? <p>Last attempt: {sourceTime(state.lastAttemptAt)}</p> : null}
          {!fresh ? <p role="status">{state?.failure === "events" ? "Tripleseat events could not be verified." : state?.failure === "shifts" ? "Published 7shifts schedules could not be verified." : state?.failure === "incomplete" ? "The source returned incomplete staffing data." : "A current staffing snapshot is not available."} Saved assignments and unresolved alerts below are not proof of current coverage. Refresh before editing.</p> : null}
          {fresh && !state?.dailyScheduleComplete ? <p role="status">Refresh to load the full location schedule before assigning staff.</p> : null}
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
          <h2 id="staffing-assignment">Assignments and match review</h2>
          <label>Event <select value={selected ? eventId : ""} onChange={(event) => chooseEvent(event.target.value)}>
            <option value="">Choose an event…</option>
            {events.map((event) => <option key={event.eventId} value={event.eventId}>{event.eventName} · {formatEventDate(event.date)}</option>)}
          </select></label>
          {!selected && eventId && requestedDate ? <p role="status">The requested event isn’t in the verified staffing snapshot for this date. Sync the published schedule, or choose another event.</p> : null}
          {selected ? <>
            <p>{formatEventDate(selected.date)} · {times(selected.startAt, selected.endAt)}</p>
            {assignments.length ? <ul>{assignments.map((row) => <li key={row.employeeId}>{row.employeeName} · {row.source === "manual" ? "Admin assigned" : "Automatically matched"}</li>)}</ul> : <p>{fresh ? "No saved assignments for this event." : "Assignments are not confirmed."}</p>}
            <fieldset disabled={!canAssign || !candidateShifts.length}>
              <legend>Employees working this day</legend>
              <p>Select one shift per employee. Save to confirm this team or uncheck names to remove them. Automatic matching won’t add staff to a team you’ve saved.</p>
              {candidateShifts.map((shift) => {
                const previous = otherAssignment(shift.shiftId);
                const conflict = overlappingAssignment(shift);
                const checked = shiftIds.includes(shift.shiftId);
                return <div key={shift.shiftId}><label><input type="checkbox" value={shift.shiftId} checked={checked}
                  disabled={!checked && (Boolean(conflict) || chosenEmployees.has(shift.employeeId))}
                  onChange={() => setDraftShiftIds(checked ? shiftIds.filter((id) => id !== shift.shiftId) : [...shiftIds, shift.shiftId])} />
                  {" "}{shift.employeeName} · {times(shift.startAt, shift.endAt)}
                  {shift.corporate === false ? " · Other station or role" : ""}
                  {!staffingShiftCoversEvent(shift, selected) ? " · Does not cover full event" : ""}
                  {previous ? ` · Assigned to ${events.find((event) => event.eventId === previous.eventId)?.eventName ?? "another event"}` : ""}
                  {conflict ? " · Already booked during this event" : ""}
                </label></div>;
              })}
            </fieldset>
            {fresh && state?.dailyScheduleComplete && !candidateShifts.length ? <p>No employees have eligible published shifts this day.</p> : null}
            {chosenConflict ? <p role="status">A selected employee is already assigned to an overlapping event. Review that assignment first.</p> : null}
            <button className="button-link" disabled={!canAssign || (!chosenShifts.length && !assignments.length) || chosenConflict} type="button" onClick={() => {
              if ((!chosenShifts.length && !assignments.length) || chosenConflict) return;
              const choices = chosenShifts.map((shift) => ({ shiftId: shift.shiftId,
                ...(otherAssignment(shift.shiftId) ? { confirmMove: true } : {}),
                ...(!staffingShiftCoversEvent(shift, selected) ? { confirmPartialCoverage: true } : {}),
              }));
              const warnings = [
                removesStaff ? "This will remove unchecked staff from this event." : "",
                choices.some((choice) => choice.confirmMove) ? "This will move selected shifts from their current events." : "",
                choices.some((choice) => choice.confirmPartialCoverage) ? "One or more shifts do not cover the full event. The event will still need review." : "",
              ].filter(Boolean);
              if (!warnings.length || globalThis.confirm(`${warnings.join(" ")} Continue?`)) {
                void submit({ action: "replace-team", eventId, choices });
              }
            }}>Save staffing team ({chosenShifts.length})</button>{" "}
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
            <p>To match automatically, a shift must cover the whole event and clearly belong to it. By default, a shift can start at the event time, at the exact early start, or earlier as part of a regular Corporate Parties shift. Review partial or uncertain matches before assigning them.</p>
            <button className="button-link" disabled={busy || !state || !validLead} type="submit">Save matching rules</button>
          </form>
        </PortalCard>
      </div>}
  </PortalShell>;
}
