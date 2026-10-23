"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEventContext } from "./EventContext";
import { workspaceReminders, type WorkspaceAction, type WorkspacePayload } from "@/lib/operations/workspace";
import { workspaceTimeline, workspaceTimelinePosition } from "@/lib/operations/workspace-timeline";
import { eventFoodDeliveryState, type EventFoodDelivery } from "@/lib/gotab/delivery";

const WORKSPACE_PATHS = new Set(["/checklists", "/floor-plans", "/entertainment-schedules", "/event-host-addons", "/itineraries"]);
type WorkspaceContextValue = {
  payload: WorkspacePayload | null;
  now: Date;
  state: "loading" | "saved" | "saving" | "error";
  error: string;
  refresh: () => void;
  act: (action: Omit<WorkspaceAction, "expectedUpdatedAt" | "expectedSourceFingerprint" | "employeeName">) => Promise<void>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function workspaceClock(value: string | null, includeDate = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time needs review";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...(includeDate ? { month: "short", day: "numeric" } as const : {}), hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function EventWorkspaceProvider({ children }: { children: ReactNode }) {
  const { selectedEvent, requestedEventId, staffName, ready } = useEventContext();
  const pathname = usePathname();
  const scope = ready && selectedEvent && WORKSPACE_PATHS.has(pathname) && (pathname !== "/floor-plans" || requestedEventId) ? `${selectedEvent.eventId}|${selectedEvent.date}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: string; payload: WorkspacePayload } | null>(null);
  const [state, setState] = useState<WorkspaceContextValue["state"]>("loading");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const actionInFlight = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const payload = snapshot?.scope === scope ? snapshot.payload : null;
  const endpoint = scope && selectedEvent ? `/api/events/${encodeURIComponent(selectedEvent.eventId)}/workspace?date=${encodeURIComponent(selectedEvent.date)}` : null;

  const refresh = useCallback(async () => {
    if (!endpoint || !scope || actionInFlight.current === scope || !navigator.onLine) return;
    const sequence = ++requestSequence.current;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (scopeRef.current !== scope || sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(body.error || "Unable to load saved event progress.");
      setSnapshot({ scope, payload: body }); setState("saved"); setError((current) => current.startsWith("Another staff") ? current : "");
    } catch (cause) {
      if (scopeRef.current === scope && sequence === requestSequence.current) { setError(cause instanceof Error ? cause.message : "Event progress is unavailable."); setState("error"); }
    }
  }, [endpoint, scope]);

  useEffect(() => {
    setState("loading"); setError(""); void refresh();
    const onRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onRefresh, 15_000);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    const onChecklist = () => void refresh();
    window.addEventListener("event-host:checklist-updated", onChecklist);
    window.addEventListener("focus", onRefresh); window.addEventListener("online", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => { window.clearInterval(timer); window.clearInterval(clock); window.removeEventListener("event-host:checklist-updated", onChecklist); window.removeEventListener("focus", onRefresh); window.removeEventListener("online", onRefresh); document.removeEventListener("visibilitychange", onRefresh); };
  }, [refresh]);

  const act = useCallback(async (action: Omit<WorkspaceAction, "expectedUpdatedAt" | "expectedSourceFingerprint" | "employeeName">) => {
    if (!endpoint || !scope || !payload || actionInFlight.current === scope) return;
    if (!staffName.trim()) { setError("Select your staff name before recording an action."); return; }
    actionInFlight.current = scope; ++requestSequence.current; setState("saving"); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...action, employeeName: staffName, expectedUpdatedAt: payload.record?.updatedAt ?? null, expectedSourceFingerprint: payload.sourceFingerprint }) });
      const body = await response.json();
      if (scopeRef.current !== scope) return;
      if (!response.ok) throw new Error(response.status === 409 ? "Another staff member saved an update. Progress has been refreshed; check it and try your action again." : body.error || "Unable to save this action.");
      setSnapshot({ scope, payload: body }); setState("saved");
      window.dispatchEvent(new CustomEvent("event-host:workspace-updated", { detail: { eventId: body.event.id, record: body.record } }));
    } catch (cause) {
      if (scopeRef.current === scope) { setState("error"); setError(cause instanceof Error ? cause.message : "Unable to save this action."); }
    } finally { if (actionInFlight.current === scope) actionInFlight.current = null; }
  }, [endpoint, scope, payload, staffName]);

  // Reload stale revisions without silently replaying a staff action.
  useEffect(() => { if (state === "error" && error.startsWith("Another staff")) void refresh(); }, [state, error, refresh]);
  return <WorkspaceContext.Provider value={{ payload, now, state, error, refresh: () => void refresh(), act }}>{children}</WorkspaceContext.Provider>;
}

export function useEventWorkspace() { return useContext(WorkspaceContext); }

export function EventWorkspaceReminders() {
  const workspace = useEventWorkspace();
  const { staffName } = useEventContext();
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const sounded = useRef(new Set<string>());
  const due = workspace?.payload ? workspaceReminders(workspace.payload, workspace.now).filter((item) => item.state !== "upcoming") : [];
  const dueKey = due.filter((item) => !item.acknowledged).map((item) => `${workspace?.payload?.event.id}:${item.id}`).join("|");
  useEffect(() => {
    if (!sound || !audio.current || !dueKey || sounded.current.has(dueKey)) return;
    sounded.current.add(dueKey);
    const oscillator = audio.current.createOscillator(); const gain = audio.current.createGain();
    oscillator.frequency.value = 660; gain.gain.value = 0.06; oscillator.connect(gain); gain.connect(audio.current.destination);
    oscillator.start(); oscillator.stop(audio.current.currentTime + 0.18);
  }, [sound, dueKey]);
  if (!workspace?.payload) return workspace?.error ? <p role="alert">{workspace.error} <button onClick={workspace.refresh} type="button">Retry progress</button></p> : null;
  const { payload, state, error } = workspace;
  const disabled = state === "saving" || !staffName.trim() || payload.record?.status === "submitted";
  return <section className="event-workspace-reminders" aria-label="Event reminders">
    <div className="workspace-section-heading"><strong>{due.length ? `${due.length} event reminder${due.length === 1 ? "" : "s"}` : "Event reminders"}</strong><span role="status">{state === "saving" ? "Saving…" : state === "error" ? "Not saved" : "Shared progress saved"}</span></div>
    <button type="button" aria-pressed={sound} onClick={() => { if (!sound) { audio.current ??= new AudioContext(); void audio.current.resume(); } setSound(!sound); }}>{sound ? "Mute sound" : "Enable sound"}</button>
    <small>In-app alerts while this event is open. All times Eastern.</small>
    {error ? <p role="alert">{error} <button onClick={workspace.refresh} type="button">Refresh</button></p> : null}
    {due.map((reminder) => {
      const activity = payload.activities.find((item) => item.id === reminder.activityId);
      const evidence = payload.record?.taskEvidence?.[reminder.id];
      return <article className="workspace-reminder" data-attention={!reminder.acknowledged} key={reminder.id}>
        <strong>{reminder.stage === "food" ? `Food Reminder — ${payload.event.name}` : `${activity?.label} — ${reminder.stage === "before" ? "starts soon" : "due now"}`}</strong>
        <p>{reminder.stage === "food" ? `This party starts at ${workspaceClock(payload.eventStartAt)}. Please get the food out and ready for the event.` : `${payload.event.name} · ${activity?.resourceNames.join(", ") || payload.event.rooms.join(", ")} · starts ${workspaceClock(activity?.startAt ?? null, true)}`}</p>
        <small>{reminder.acknowledged ? `Acknowledged by ${evidence?.employeeName ?? "staff"} at ${workspaceClock(evidence?.completedAt ?? null, true)}. The task is still open.` : `Due ${workspaceClock(reminder.dueAt, true)}`}</small>
        <div className="workspace-action-row">
          {!reminder.acknowledged ? <button disabled={disabled} onClick={() => void workspace.act({ action: "ACK_REMINDER", reminderId: reminder.id })} type="button">Acknowledge</button> : null}
          <button disabled={disabled} onClick={() => void workspace.act(reminder.stage === "food" ? { action: "FOOD_OUT" } : { action: "START_ACTIVITY", activityId: reminder.activityId! })} type="button">{reminder.stage === "food" ? "Food Is Out" : "Mark Started"}</button>
        </div>
      </article>;
    })}
    {!due.length ? <p>No reminders due. Acknowledging a reminder does not complete its task.</p> : null}
  </section>;
}

export function EventWorkspaceTimeline() {
  const workspace = useEventWorkspace();
  const entries = useMemo(() => workspace?.payload ? workspaceTimeline(workspace.payload) : [], [workspace?.payload]);
  if (!workspace?.payload) return null;
  const position = workspaceTimelinePosition(entries, workspace.now);
  return <section className="event-workspace-panel workspace-timeline" aria-label="Event operating itinerary"><h2>Event operating timeline</h2><p>Assigned BWA: {workspace.payload.record?.bwa || "Not assigned"} · POC: {workspace.payload.record?.poc || "Not assigned"}</p>
    <ol>{entries.map((item) => <li key={item.id} data-position={item.id === position.current ? "current" : item.id === position.next ? "next" : ""}><time>{item.at ? workspaceClock(item.at, true) : "Untimed"}</time><div><strong>{item.label} {item.completed ? "✓" : ""}</strong>{item.id === position.current ? <span>Current</span> : item.id === position.next ? <span>Next</span> : null}<p>{item.location || "Location needs review"}</p><small>{item.instruction}</small></div></li>)}</ol>
  </section>;
}

export function FoodRequestsDisclosure({ foodCount, deliveries, error = "", children }: { foodCount: number; deliveries: readonly EventFoodDelivery[] | null; error?: string; children: ReactNode }) {
  const pending = deliveries?.filter((delivery) => eventFoodDeliveryState(delivery).tone === "pending").length ?? 0;
  const attention = deliveries?.filter((delivery) => delivery.status !== "CANCELLED" && (eventFoodDeliveryState(delivery).tone === "warning" || delivery.error)).length ?? 0;
  return <details className="event-workspace-panel workspace-food-disclosure" aria-label="Food inclusions and request history">
    <summary>
      <h2>Contract food — already included</h2>
      <span className="workspace-food-disclosure-counts">{foodCount} contract food item{foodCount === 1 ? "" : "s"} · {deliveries === null ? "Loading saved requests…" : `${deliveries.length} saved request${deliveries.length === 1 ? "" : "s"}`}</span>
      <span className="workspace-food-disclosure-statuses">
        {pending ? <span className="workspace-food-disclosure-badge" role="status">{pending} pending</span> : null}
        {attention ? <span className="workspace-food-disclosure-badge" role="status">{attention} need attention</span> : null}
        {error ? <span className="workspace-food-disclosure-badge" role="alert">Request history unavailable</span> : null}
      </span>
    </summary>
    <div className="workspace-food-disclosure-content">{children}</div>
  </details>;
}

export function EventWorkspaceRequests() {
  const workspace = useEventWorkspace();
  const { staffName } = useEventContext();
  const [history, setHistory] = useState<{ eventId: number; deliveries: EventFoodDelivery[] } | null>(null);
  const [error, setError] = useState("");
  const historySequence = useRef(0);
  const id = workspace?.payload?.event.id;
  const kitchenId = workspace?.payload?.kitchenEventId;
  useEffect(() => {
    if (!id || !kitchenId) return;
    let active = true;
    setError("");
    const load = async () => { const sequence = ++historySequence.current; try {
      const response = await fetch(`/api/kitchen/events/${encodeURIComponent(kitchenId)}/food-delivery`, { cache: "no-store" });
      const body = await response.json(); if (!active || sequence !== historySequence.current) return;
      if (!response.ok) throw new Error(body.error || "Request history unavailable.");
      setHistory({ eventId: id, deliveries: body.deliveries }); setError("");
    } catch (cause) { if (active && sequence === historySequence.current) setError(cause instanceof Error ? cause.message : "Request history unavailable."); } };
    void load(); const timer = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, kitchenId]);
  if (!workspace?.payload) return null;
  return <FoodRequestsDisclosure foodCount={workspace.payload.event.food.length} deliveries={history && history.eventId === id ? history.deliveries : null} error={error}><ul>{workspace.payload.event.food.map((item) => <li key={item}>{item}</li>)}</ul><p>Opening this tab does not order the included food. VIP booked food awaits explicit customer arrival confirmation.</p>
    <h3>Saved food requests & delivery</h3>{error ? <p role="alert">{error}</p> : null}
    {history && history.eventId === id ? history.deliveries.length ? <div className="workspace-activity-grid">{history.deliveries.map((delivery) => {
      const key = `workspace:request:${delivery.requestId}:fulfilled`;
      const fulfilled = workspace.payload?.record?.taskEvidence?.[key];
      return <article className="workspace-activity" key={delivery.requestId}><strong>{delivery.quantity} × {delivery.foodName} {delivery.panSize}</strong><p>{eventFoodDeliveryState(delivery).label}</p><small>{delivery.requesterName || "Requester not recorded"} · {delivery.requestedAt ? workspaceClock(delivery.requestedAt, true) : "Request time not recorded"}</small>{delivery.notes ? <p>{delivery.notes}</p> : null}{delivery.error ? <p role="alert">{delivery.error}</p> : null}{fulfilled ? <p>Fulfilled by {fulfilled.employeeName} · {workspaceClock(fulfilled.completedAt, true)}</p> : delivery.status === "SENT" ? <button disabled={workspace.state === "saving" || !staffName || workspace.payload?.cancelled || workspace.payload?.record?.status === "submitted"} onClick={() => void workspace.act({ action: "FULFILL_REQUEST", requestId: delivery.requestId })} type="button">Mark Fulfilled</button> : null}</article>;
    })}</div> : <p>No saved food requests for this event.</p> : <p>Loading saved requests…</p>}
  </FoodRequestsDisclosure>;
}
