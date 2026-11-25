"use client";

import { useEffect, useRef, useState } from "react";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import { readableOverlayText } from "@/lib/floor-plans/configuration/colors";
import { validateFloorPlanHighlights } from "@/lib/floor-plans/day-highlights";
import type { FloorPlanArea } from "@/lib/floor-plans/types";

type HighlightStatus = "loading" | "idle" | "saving" | "saved" | "error" | "conflict";
type HighlightState = {
  date: string;
  highlights: AdminAssetOverlay[];
  saved: AdminAssetOverlay[];
  updatedAt: string | null;
  loaded: boolean;
  status: HighlightStatus;
  message: string;
  selectedId: string | null;
  past: AdminAssetOverlay[][];
  future: AdminAssetOverlay[][];
};

const copy = (items: readonly AdminAssetOverlay[]) => items.map((item) => ({ ...item }));
const equal = (left: AdminAssetOverlay[], right: AdminAssetOverlay[]) => JSON.stringify(left) === JSON.stringify(right);
const noteTextColor = (fill: string, opacity: number) => opacity <= 0.5 ? "#000000" : readableOverlayText(fill);
const editable = (state: HighlightState) => state.loaded && !["loading", "saving", "conflict"].includes(state.status);
const initial = (date: string): HighlightState => ({ date, highlights: [], saved: [], updatedAt: null, loaded: false,
  status: "loading", message: "Loading special event highlights…", selectedId: null, past: [], future: [] });

function checkedPayload(value: unknown, date: string, saved = false) {
  const body = value as { date?: unknown; highlights?: unknown; updatedAt?: unknown } | null;
  if (!body || body.date !== date || !(body.updatedAt === null && !saved || typeof body.updatedAt === "string" && Number.isFinite(Date.parse(body.updatedAt)))) {
    throw new Error("The saved special event highlights could not be verified.");
  }
  return { highlights: validateFloorPlanHighlights(body.highlights), updatedAt: body.updatedAt as string | null };
}

/** Date-only notes have their own explicit save and never alter party reservations. */
export function useFloorPlanSpecialHighlights(date: string) {
  const [snapshot, setSnapshot] = useState(() => initial(date));
  const current = snapshot.date === date ? snapshot : initial(date);
  const state = useRef(current);
  state.current = current;
  const activeDate = useRef(date);
  activeDate.current = date;
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);

  function update(next: HighlightState) {
    if (activeDate.current !== date) return;
    state.current = next;
    setSnapshot(next);
  }

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const attempt = ++sequence.current;
    update({ ...state.current, date, loaded: false, status: "loading", message: "Loading special event highlights…" });
    try {
      const response = await fetch(`/api/admin/floor-plan-highlights?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || activeDate.current !== date || attempt !== sequence.current) return;
      if (!response.ok) throw new Error("Unable to load saved special event highlights. Reload before adding or saving notes.");
      const checked = checkedPayload(body, date);
      update({ ...initial(date), ...checked, saved: copy(checked.highlights), loaded: true, status: "idle", message: "Special event highlights loaded." });
    } catch (error) {
      if (!controller.signal.aborted && activeDate.current === date && attempt === sequence.current) {
        update({ ...state.current, loaded: false, status: "error", message: error instanceof Error ? error.message : "Unable to load special event highlights." });
      }
    }
  }

  useEffect(() => {
    void load();
    return () => { sequence.current++; request.current?.abort(); };
  }, [date]);

  function replaceHighlights(highlights: AdminAssetOverlay[]) {
    const before = state.current;
    if (activeDate.current !== date || !editable(before) || highlights.length > 50 || equal(before.highlights, highlights)) return;
    update({ ...before, highlights: copy(highlights), past: [...before.past.slice(-49), copy(before.highlights)], future: [],
      selectedId: highlights.some((item) => item.id === before.selectedId) ? before.selectedId : null,
      status: "idle", message: "Unsaved special event highlights. Save them separately from the floor plan." });
  }

  function select(id: string | null) {
    if (activeDate.current === date) update({ ...state.current, selectedId: state.current.highlights.some((item) => item.id === id) ? id : null });
  }

  function undo() {
    const before = state.current;
    if (!editable(before) || !before.past.length) return;
    const highlights = copy(before.past[before.past.length - 1]);
    update({ ...before, highlights, past: before.past.slice(0, -1), future: [copy(before.highlights), ...before.future],
      selectedId: highlights.some((item) => item.id === before.selectedId) ? before.selectedId : null,
      status: "idle", message: "Special event highlight change undone locally. Save to publish." });
  }

  function redo() {
    const before = state.current;
    if (!editable(before) || !before.future.length) return;
    const highlights = copy(before.future[0]);
    update({ ...before, highlights, past: [...before.past, copy(before.highlights)], future: before.future.slice(1),
      selectedId: highlights.some((item) => item.id === before.selectedId) ? before.selectedId : null,
      status: "idle", message: "Special event highlight change redone locally. Save to publish." });
  }

  async function save() {
    const before = state.current;
    if (activeDate.current !== date || saving.current || !editable(before) || equal(before.highlights, before.saved)) return;
    let highlights: AdminAssetOverlay[];
    try { highlights = validateFloorPlanHighlights(before.highlights); }
    catch (error) { update({ ...before, status: "error", message: error instanceof Error ? error.message : "Check highlight names and bounds before saving." }); return; }
    saving.current = true;
    const attempt = ++sequence.current;
    update({ ...before, status: "saving", message: "Saving special event highlights…" });
    try {
      const response = await fetch("/api/admin/floor-plan-highlights", { method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, highlights, expectedUpdatedAt: before.updatedAt }) });
      const body = await response.json().catch(() => null);
      if (activeDate.current !== date || attempt !== sequence.current) return;
      if (response.status === 409) {
        update({ ...state.current, status: "conflict", message: "Special event highlights changed on another screen. Your draft is retained. Reload latest and review before saving again." });
        return;
      }
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Special event highlights were not confirmed saved. Your draft is retained.");
      const checked = checkedPayload(body, date, true);
      update({ ...state.current, ...checked, saved: copy(checked.highlights), past: [], future: [], status: "saved", message: "Special event highlights saved for this date." });
      try {
        if (typeof BroadcastChannel !== "undefined") {
          const channel = new BroadcastChannel("event-host-floor-plans");
          channel.postMessage({ action: "highlights-saved", date });
          channel.close();
        }
      } catch { /* Notification failure does not undo the confirmed save. */ }
    } catch (error) {
      if (activeDate.current === date && attempt === sequence.current) update({ ...state.current, status: "error", message: error instanceof Error ? error.message : "Special event highlights were not confirmed saved. Your draft is retained." });
    } finally { saving.current = false; }
  }

  async function reload() {
    if (activeDate.current !== date || saving.current || state.current.status === "loading") return;
    if (!window.confirm("Reload saved special event highlights? Any unsaved special event highlight changes will be discarded.")) return;
    await load();
  }

  const dirty = !equal(current.highlights, current.saved);
  let validation = "";
  try { validateFloorPlanHighlights(current.highlights); }
  catch (error) { validation = error instanceof Error ? error.message : "Check highlight names and bounds."; }

  return { date, highlights: current.highlights, dirty, validation, canSave: editable(current) && dirty && !validation, status: current.status, message: current.message,
    selectedId: current.selectedId, setSelectedId: select, replaceHighlights, undo, redo,
    canUndo: editable(current) && current.past.length > 0, canRedo: editable(current) && current.future.length > 0, save, reload,
    canEdit: editable(current) };
}

export type FloorPlanSpecialHighlightsState = ReturnType<typeof useFloorPlanSpecialHighlights>;

export default function FloorPlanSpecialHighlightsEditor({ state, selectedArea }: {
  state: FloorPlanSpecialHighlightsState;
  selectedArea: FloorPlanArea | null;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#7C3AED");
  useEffect(() => { setNewName(""); setNewColor("#7C3AED"); }, [state.date]);
  const selected = state.highlights.find((item) => item.id === state.selectedId);

  function add() {
    if (!state.canEdit || !newName.trim() || newName.trim().length > 80 || state.highlights.length >= 50) return;
    const x = selectedArea ? Math.max(0, Math.min(99.9, selectedArea.x / 1920 * 100)) : 40;
    const y = selectedArea ? Math.max(0, Math.min(99.9, selectedArea.y / 1080 * 100)) : 40;
    const fill = newColor;
    const note: AdminAssetOverlay = { id: crypto.randomUUID(), kind: "highlight", x, y,
      width: Math.min(100 - x, Math.max(0.1, selectedArea ? selectedArea.width / 1920 * 100 : 12)),
      height: Math.min(100 - y, Math.max(0.1, selectedArea ? selectedArea.height / 1080 * 100 : 8)),
      text: newName.trim(), fill, textColor: noteTextColor(fill, 0.5), opacity: 0.5, fontSize: 18 };
    state.replaceHighlights([...state.highlights, note]);
    state.setSelectedId(note.id);
    setNewName("");
  }

  function change(value: Partial<AdminAssetOverlay>) {
    if (state.canEdit && selected) state.replaceHighlights(state.highlights.map((item) => item.id === selected.id ? { ...item, ...value } : item));
  }

  function geometry(key: "x" | "y" | "width" | "height", raw: string) {
    if (!selected || !raw.trim() || !Number.isFinite(Number(raw))) return;
    const maximum = key === "x" ? 100 - selected.width : key === "y" ? 100 - selected.height : key === "width" ? 100 - selected.x : 100 - selected.y;
    const minimum = key === "x" || key === "y" ? 0 : Math.min(0.1, maximum);
    change({ [key]: Math.max(minimum, Math.min(maximum, Number(raw))) });
  }

  return <section className="floor-plan-special-highlights" aria-label="Special event highlights">
    <h3>Special event highlights</h3>
    <p>Date-only map notes, not reservations or plan approval. They remain visible for the whole day even when a party is filtered.</p>
    <p>Enter a name and color, click Add special event highlight to create a draft, then use Save highlights in the top toolbar or Save special event highlights below to publish it. Typing a name alone does not add a highlight.</p>
    <p>Select a map object before adding a note to use its bounds. With no object selected, the note starts near the middle. Use the percentage fields to adjust its position and size.</p>
    <fieldset disabled={!state.canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="floor-plan-field-group">
        <label>New highlight name<input maxLength={80} placeholder="Trivia or Bingo" value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <label>New highlight color<input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} /></label>
      </div>
      <div className="floor-plan-inspector-actions"><button disabled={!state.canEdit || !newName.trim() || state.highlights.length >= 50} onClick={add} type="button">Add special event highlight</button></div>
      {state.highlights.length >= 50 ? <p>Limit reached: 50 special event highlights per date.</p> : null}
      <label>Highlights for this date<select value={state.selectedId ?? ""} onChange={(event) => state.setSelectedId(event.target.value || null)}>
        <option value="">Select a highlight…</option>{state.highlights.map((item) => <option key={item.id} value={item.id}>{item.text || "Name required"}</option>)}
      </select></label>
      {selected ? <>
        <div className="floor-plan-field-group">
          <label>Name<input maxLength={80} placeholder="Trivia or Bingo" value={selected.text} onChange={(event) => change({ text: event.target.value })} /></label>
          <label>Color<input type="color" value={selected.fill} onChange={(event) => change({ fill: event.target.value, textColor: noteTextColor(event.target.value, selected.opacity) })} /></label>
        </div>
        <div className="floor-plan-geometry-grid">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{key} (%)<input type="number" min={key === "x" || key === "y" ? 0 : 0.1} max={100} step={0.1} value={selected[key]} onChange={(event) => geometry(key, event.target.value)} /></label>)}</div>
        <div className="floor-plan-inspector-actions"><button type="button" onClick={() => state.replaceHighlights(state.highlights.filter((item) => item.id !== selected.id))}>Delete selected special event highlight</button></div>
      </> : null}
    </fieldset>
    {state.validation ? <p role="alert">{state.validation}</p> : null}
    <p role={state.status === "error" || state.status === "conflict" ? "alert" : "status"}>{state.message}</p>
    <div className="floor-plan-inspector-actions">
      <button disabled={!state.canUndo} onClick={state.undo} type="button">Undo special event highlight</button>
      <button disabled={!state.canRedo} onClick={state.redo} type="button">Redo special event highlight</button>
      <button disabled={!state.canSave} onClick={() => void state.save()} type="button">{state.status === "saving" ? "Saving special event highlights…" : "Save special event highlights"}</button>
      <button disabled={state.status === "loading" || state.status === "saving"} onClick={() => void state.reload()} type="button">Reload special event highlights</button>
    </div>
  </section>;
}
