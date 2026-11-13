"use client";

import { useEffect, useState, type FormEvent } from "react";

export default function WorkspaceSettings() {
  const [minutes, setMinutes] = useState("5");
  const [revision, setRevision] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading reminder settings…");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/workspace-settings", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!active) return;
      if (!response.ok) throw new Error(body.error || "Unable to load settings.");
      setMinutes(String(body.settings.reminderLeadMinutes)); setRevision(body.updatedAt); setReady(true); setStatus("");
    }).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Unable to load settings."); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch("/api/admin/workspace-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: { reminderLeadMinutes: Number(minutes) }, expectedUpdatedAt: revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "Settings changed on another screen. Reload Admin before saving again." : body.error || "Unable to save settings.");
      setRevision(body.updatedAt); setStatus("Reminder settings saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Unable to save settings."); }
    finally { setSaving(false); }
  }
  return <section className="event-workspace-panel workspace-settings"><h2>Staff workspace reminders</h2><form onSubmit={(event) => void save(event)}><label>Entertainment reminder lead time (minutes)<input disabled={!ready || saving} max={60} min={1} onChange={(event) => setMinutes(event.target.value)} required step={1} type="number" value={minutes} /></label><button disabled={!ready || saving} type="submit">{saving ? "Saving…" : "Save reminder settings"}</button></form><p>A separate reminder still appears at the scheduled start time. Food reminders remain 15 minutes before event start. These settings do not change reservations, kitchen prep times, or food release.</p>{status ? <p role="status">{status}</p> : null}</section>;
}
