"use client";

import Link from "next/link";
import { useState } from "react";
import { PortalPageHeader, PortalShell } from "@/app/_components/PortalShell";
import type { AdminState } from "@/lib/admin-types";
import type { ItineraryAsset } from "@/lib/event-plans/types";
import { applyItineraryEdit, buildItineraryEdit, type ItineraryEditFields } from "@/lib/itineraries/edits";
import { itineraryDrinkLines } from "@/lib/itineraries/presentation";

function draftFor(event: ItineraryAsset): Required<ItineraryEditFields> {
  return { name: event.name, time: event.time, guest_count: event.guest_count, rooms: event.rooms, food: event.food, drinkLines: itineraryDrinkLines(event), entertainment: event.entertainment, special_instructions: event.special_instructions ?? [] };
}

function lineValues(value: string) { return value.split("\n"); }

export default function ItineraryEditor({ base, events, initialState, initialUpdatedAt }: {
  base: ItineraryAsset | null;
  events: Array<{ id: number; name: string; date: string }>;
  initialState: AdminState;
  initialUpdatedAt: string | null;
}) {
  const initialEvent = base ? applyItineraryEdit(base, initialState.itineraryEditsByEvent?.[String(base.id)]) : null;
  const [draft, setDraft] = useState(() => initialEvent ? draftFor(initialEvent) : null);
  const [savedDraft, setSavedDraft] = useState(draft);
  const [state, setState] = useState(initialState);
  const [version, setVersion] = useState(initialUpdatedAt);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  async function save(reset = false) {
    if (!base || !draft) return;
    setStatus("saving"); setMessage("");
    try {
      const edit = reset ? null : buildItineraryEdit(base, draft, new Date().toISOString());
      const edits = { ...state.itineraryEditsByEvent };
      if (edit) edits[String(base.id)] = edit;
      else delete edits[String(base.id)];
      const nextState = { ...state, itineraryEditsByEvent: edits };
      const response = await fetch("/api/admin-state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: nextState, expectedUpdatedAt: version }) });
      const payload = await response.json() as { error?: string; record?: { updatedAt: string } };
      if (!response.ok || !payload.record) {
        if (response.status === 409) setConflict(true);
        throw new Error(payload.error ?? "Unable to save itinerary edits.");
      }
      const saved = reset ? draftFor(base) : draft;
      setState(nextState); setVersion(payload.record.updatedAt); setDraft(saved); setSavedDraft(saved); setStatus("saved");
      setMessage(reset ? "Source itinerary restored. Refresh an open itinerary to see the change." : "Itinerary saved. Refresh an open itinerary to see the edits.");
    } catch (error) {
      setStatus("error"); setMessage(error instanceof Error ? error.message : "Save failed. Your edits remain on this page.");
    }
  }

  function update<K extends keyof Required<ItineraryEditFields>>(key: K, value: Required<ItineraryEditFields>[K]) {
    setDraft((current) => {
      if (!current || !base) return current;
      const next = { ...current, [key]: value };
      if ((key === "guest_count" || key === "food") && JSON.stringify(current.drinkLines) === JSON.stringify(itineraryDrinkLines({ ...base, ...current, itinerary_edit: undefined }))) next.drinkLines = itineraryDrinkLines({ ...base, ...next, itinerary_edit: undefined });
      return next;
    });
    setStatus("idle");
  }

  return <PortalShell mainClassName="page admin-page" sectionSubtitle="Protected operations" sectionTitle="Admin">
    <PortalPageHeader title="Edit Itineraries" eyebrow="Admin only" description="Edit the displayed itinerary without changing its source event." aside={<Link className="button-link" href="/admin">Back to Admin</Link>} />
    <section className="asset-section admin-itinerary-editor">
      <form className="admin-itinerary-selector" onSubmit={(event) => { if (dirty && !window.confirm("Leave without saving these itinerary edits?")) event.preventDefault(); }}>
        <label>Event<select defaultValue={base?.id ?? ""} disabled={status === "saving"} name="eventId" required><option value="" disabled>Select an event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.date} · {event.name}</option>)}</select></label>
        <button className="button-link" disabled={status === "saving"} type="submit">Open event</button>
      </form>
      {!base || !draft ? <p role="status">Select an available event. No different party is substituted for an unavailable event.</p> : <>
        <p className="admin-local-preview-notice">Display edits do not change Tripleseat, seating reservations, kitchen quantities, or KDS orders. Date and source identity stay unchanged. Mini Golf keeps its contract quantity with no time.</p>
        <p className="meta">{base.date} · Source event {base.id} · {dirty ? "Unsaved changes" : "No unsaved changes"}</p>
        <fieldset className="admin-itinerary-edit-controls" disabled={status === "saving"} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="admin-itinerary-fields">
          <label>Event name<input maxLength={180} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
          <label>Event time<input maxLength={180} value={draft.time} onChange={(event) => update("time", event.target.value)} /></label>
          <label>Guest count<input type="number" min={0} max={10000} step={1} value={draft.guest_count} onChange={(event) => update("guest_count", Number(event.target.value))} /></label>
          <label>Reserved rooms / areas — one per line<textarea rows={3} value={draft.rooms.join("\n")} onChange={(event) => update("rooms", lineValues(event.target.value))} /></label>
          <label>Food — one item and quantity per line<textarea rows={6} value={draft.food.join("\n")} onChange={(event) => update("food", lineValues(event.target.value))} /></label>
          <label>Drinks — one item per line<textarea rows={6} value={draft.drinkLines.join("\n")} onChange={(event) => update("drinkLines", lineValues(event.target.value))} /></label>
          <label>Event instructions — one per line<textarea rows={4} value={draft.special_instructions.join("\n")} onChange={(event) => update("special_instructions", lineValues(event.target.value))} /></label>
        </div>
        <fieldset className="admin-itinerary-entertainment"><legend>Displayed entertainment</legend>
          {draft.entertainment.map((item, index) => {
            const miniGolf = /mini\s*golf/i.test(item.name);
            const updateItem = (key: keyof typeof item, value: string) => {
              if (key === "name" && /mini\s*golf/i.test(value) && !miniGolf) { setMessage("Mini Golf is supplied by the contract and cannot be added manually here."); return; }
              update("entertainment", draft.entertainment.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
            };
            return <div className="admin-itinerary-activity" key={index}>
              <label>Activity<input aria-label={`Activity ${index + 1}`} readOnly={miniGolf} value={item.name} maxLength={120} onChange={(event) => updateItem("name", event.target.value)} /></label>
              <label>Quantity<input aria-label={`Quantity ${index + 1}`} readOnly={miniGolf} value={item.quantity} maxLength={120} onChange={(event) => updateItem("quantity", event.target.value)} /></label>
              {miniGolf ? <span className="meta">Contract quantity · Untimed</span> : <><label>Time<input aria-label={`Time ${index + 1}`} value={item.time} maxLength={120} onChange={(event) => updateItem("time", event.target.value)} /></label><label>Duration<input aria-label={`Duration ${index + 1}`} value={item.duration} maxLength={120} onChange={(event) => updateItem("duration", event.target.value)} /></label><button className="button-link" type="button" onClick={() => update("entertainment", draft.entertainment.filter((_, rowIndex) => rowIndex !== index))}>Remove activity {index + 1}</button></>}
            </div>;
          })}
          <button className="button-link" type="button" onClick={() => update("entertainment", [...draft.entertainment, { name: "", quantity: "", time: "", duration: "" }])}>Add activity</button>
        </fieldset>
        <div className="itinerary-toolbar-actions">
          <button className="button-link" disabled={status === "saving" || conflict || !dirty} onClick={() => void save()} type="button">{status === "saving" ? "Saving…" : "Save itinerary"}</button>
          <button className="button-link" disabled={status === "saving" || !dirty} onClick={() => { setDraft(savedDraft); setStatus("idle"); setMessage(""); }} type="button">Cancel edits</button>
          <button className="button-link" disabled={status === "saving" || conflict || !state.itineraryEditsByEvent?.[String(base.id)]} onClick={() => { if (window.confirm("Remove this event’s saved itinerary edits and use the current source information?")) void save(true); }} type="button">Reset to source</button>
          <Link className="button-link" href={`/itineraries?eventId=${base.id}`} target="_blank">Open / print itinerary</Link>
        </div>
        </fieldset>
        {message ? <p role={status === "error" ? "alert" : "status"}>{message}{status === "error" ? " Your edits remain on this page." : ""}</p> : null}
        {conflict ? <button className="button-link" type="button" onClick={() => { if (window.confirm("Discard local edits and reload the latest Admin state?")) window.location.reload(); }}>Reload latest Admin state</button> : null}
      </>}
    </section>
  </PortalShell>;
}
