"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/entertainment/time";

type Shift = {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  startAt: string;
  endAt: string;
  coversEvent: boolean;
  needsMove: boolean;
  conflict: boolean;
};
type Roster = { version: number; selectedShiftIds: string[]; shifts: Shift[]; reviewToken: string };

export function EventStaffingPicker({ id, eventId, date, onClose, onSaved }: {
  id: string;
  eventId: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    panel.current?.focus();
    const request = new AbortController();
    controller.current = request;
    void loadRoster(request.signal);
    return () => request.abort();
  }, [eventId, date]);

  async function loadRoster(signal = controller.current?.signal) {
    setRoster(null);
    setSelected([]);
    setStale(false);
    setSaved(false);
    setMessage("");
    const query = new URLSearchParams({ eventId, date });
    try {
      const response = await fetch(`/api/staffing?${query}`, { cache: "no-store", signal });
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (!response.ok || !result) throw new Error(result?.error || "The shift list couldn’t be loaded.");
      setRoster(result);
      setSelected(result.selectedShiftIds);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "The shift list couldn’t be loaded.");
    }
  }

  const choices = roster?.shifts.filter((shift) => selected.includes(shift.shiftId)) ?? [];
  const employees = new Set(choices.map((shift) => shift.employeeId));
  const blocked = choices.some((shift) => shift.conflict);
  const canSave = roster && !busy && !stale && !saved && !blocked && (choices.length > 0 || roster.selectedShiftIds.length > 0);

  async function save() {
    if (!roster || !canSave) return;
    const warnings = [
      roster.selectedShiftIds.some((shiftId) => !selected.includes(shiftId)) ? "Unchecked shifts will be removed from this event." : "",
      choices.some((shift) => shift.needsMove) ? "Selected shifts assigned elsewhere will move to this event." : "",
      choices.some((shift) => !shift.coversEvent) ? "Some shifts don’t cover the full event. The event will still need review." : "",
    ].filter(Boolean);
    if (warnings.length && !globalThis.confirm(`${warnings.join(" ")} Continue?`)) return;
    setBusy(true);
    setMessage("");
    const signal = controller.current?.signal;
    try {
      const response = await fetch("/api/staffing", {
        method: "POST", headers: { "content-type": "application/json" }, signal,
        body: JSON.stringify({ action: "replace-team", eventId, eventDate: date, expectedVersion: roster.version, reviewToken: roster.reviewToken,
          choices: choices.map((shift) => ({ shiftId: shift.shiftId,
            ...(shift.needsMove ? { confirmMove: true } : {}),
            ...(!shift.coversEvent ? { confirmPartialCoverage: true } : {}),
          })),
        }),
      });
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (!response.ok || !Number.isSafeInteger(result?.version)) {
        if ([401, 403, 409, 422, 503].includes(response.status)) setStale(true);
        throw new Error(result?.error || "The team couldn’t be saved.");
      }
      setSaved(true);
      setMessage("Staffing team saved.");
      onSaved();
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "The team couldn’t be saved.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  return <section id={id} aria-label="Event staffing picker" tabIndex={-1} ref={panel} className="event-command-staffing-picker"
    onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
    {!roster && !message ? <p role="status">Loading published shifts…</p> : null}
    {roster && !saved ? <>
      {roster.shifts.length ? <details open>
        <summary>Employees working this day ({choices.length} selected)</summary>
        <p>Select one or more employees, then save the staffing team.</p>
        <fieldset disabled={busy || stale} aria-label="Select employees from published shifts">
          {roster.shifts.map((shift) => {
            const checked = selected.includes(shift.shiftId);
            return <label key={shift.shiftId}>
              <input type="checkbox" checked={checked} disabled={!checked && (shift.conflict || employees.has(shift.employeeId))}
                onChange={() => setSelected((current) => checked ? current.filter((value) => value !== shift.shiftId) : [...current, shift.shiftId])} />
              <span>{shift.employeeName}<small>{formatClock(shift.startAt)} – {formatClock(shift.endAt)}
                {shift.conflict ? " · Existing assignment needs review" : shift.needsMove ? " · Assigned to another event" : ""}
                {!shift.coversEvent ? " · Partial coverage" : ""}</small></span>
            </label>;
          })}
        </fieldset>
      </details> : <p>No published employee shifts for this day.</p>}
      {blocked ? <p role="status">Remove the conflicting shift before saving.</p> : null}
      <button className="button" type="button" disabled={!canSave} onClick={() => void save()}>{busy ? "Saving…" : `Save staffing team (${choices.length})`}</button>
    </> : null}
    {message ? <p role={saved ? "status" : "alert"}>{message}</p> : null}
    {(stale || (!roster && message)) ? <button className="secondary" type="button" disabled={busy} onClick={() => void loadRoster()}>Reload employees</button> : null}
    <button className="secondary" disabled={busy} type="button" onClick={onClose}>{saved ? "Done" : "Close staffing picker"}</button>
  </section>;
}
