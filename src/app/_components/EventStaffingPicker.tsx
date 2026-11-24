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
type Roster = { version: number; selectedShiftIds: string[]; shifts: Shift[] };

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
  const [needsAdmin, setNeedsAdmin] = useState(false);
  const [needsSchedule, setNeedsSchedule] = useState(false);
  const [verificationVersion, setVerificationVersion] = useState<number | null>(null);
  const [passphrase, setPassphrase] = useState("");

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
    setNeedsAdmin(false);
    setNeedsSchedule(false);
    setVerificationVersion(null);
    setStale(false);
    setSaved(false);
    setMessage("");
    const query = new URLSearchParams({ eventId, date });
    try {
      const response = await fetch(`/api/admin/staffing?${query}`, { cache: "no-store", signal });
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.status === 401) setNeedsAdmin(true);
      if ([404, 422].includes(response.status) && result?.canVerify === true && Number.isSafeInteger(result.version) && result.version >= 0) {
        setNeedsSchedule(true);
        setVerificationVersion(result.version);
      }
      if (!response.ok || !result) throw new Error(result?.error || "The shift list couldn’t be loaded.");
      setRoster(result);
      setSelected(result.selectedShiftIds);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "The shift list couldn’t be loaded.");
    }
  }

  async function unlock() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const signal = controller.current?.signal;
    try {
      const response = await fetch("/api/admin-session", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }), signal });
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || "Staff assignment could not be unlocked.");
      await loadRoster(signal);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Staff assignment could not be unlocked.");
    } finally {
      setPassphrase("");
      if (!signal?.aborted) setBusy(false);
    }
  }

  async function verifySchedule() {
    if (busy || verificationVersion === null) return;
    setBusy(true);
    setMessage("");
    const signal = controller.current?.signal;
    try {
      const response = await fetch("/api/admin/staffing", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", date, expectedVersion: verificationVersion }), signal });
      const result = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.status === 401) {
        setNeedsAdmin(true);
        setNeedsSchedule(false);
        setVerificationVersion(null);
      }
      if (response.status === 409) {
        setNeedsSchedule(false);
        setStale(true);
      }
      if (Number.isSafeInteger(result?.state?.version) && result.state.version >= 0) setVerificationVersion(result.state.version);
      if (!response.ok) throw new Error(result?.error || "Published employees could not be loaded.");
      if (result?.fresh !== true) throw new Error("Published employees could not be verified. Saved assignments were retained. Try loading again.");
      await loadRoster(signal);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Published employees could not be loaded.");
    } finally {
      if (!signal?.aborted) setBusy(false);
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
    try {
      const response = await fetch("/api/admin/staffing", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "replace-team", eventId, eventDate: date, expectedVersion: roster.version,
          choices: choices.map((shift) => ({ shiftId: shift.shiftId,
            ...(shift.needsMove ? { confirmMove: true } : {}),
            ...(!shift.coversEvent ? { confirmPartialCoverage: true } : {}),
          })),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !Number.isSafeInteger(result?.version)) {
        if ([401, 403, 409, 422, 503].includes(response.status)) setStale(true);
        if (response.status === 401) {
          setNeedsAdmin(true);
          setRoster(null);
          setSelected([]);
        }
        throw new Error(result?.error || "The team couldn’t be saved.");
      }
      setSaved(true);
      setMessage("Staffing team saved.");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The team couldn’t be saved.");
    } finally {
      setBusy(false);
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
    {needsAdmin ? <form className="event-command-staffing-unlock" onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
      <p>Unlock staff assignment here. You do not need to open the Admin page.</p>
      <label htmlFor={`${id}-passphrase`}>Admin passphrase</label>
      <input id={`${id}-passphrase`} type="password" autoComplete="current-password" minLength={4} maxLength={256}
        value={passphrase} disabled={busy} onChange={(event) => setPassphrase(event.target.value)} />
      <button className="button" type="submit" disabled={busy || (!/^\d{4}$/.test(passphrase) && passphrase.length < 16)}>{busy ? "Unlocking…" : "Unlock staff assignment"}</button>
    </form> : null}
    {needsSchedule && !needsAdmin ? <div>
      <p>Load the published employees for this event’s week here. This also updates automatic matches; your manual choices are saved only when you save the staffing team.</p>
      <button className="button" type="button" disabled={busy || verificationVersion === null} onClick={() => void verifySchedule()}>{busy ? "Loading employees…" : "Load employees for this day"}</button>
    </div> : null}
    {stale && !needsAdmin ? <button className="secondary" type="button" disabled={busy} onClick={() => void loadRoster()}>Reload employees</button> : null}
    <button className="secondary" disabled={busy} type="button" onClick={onClose}>{saved ? "Done" : "Close staffing picker"}</button>
  </section>;
}
