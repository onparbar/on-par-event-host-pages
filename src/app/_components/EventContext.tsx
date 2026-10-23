"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EVENT_CONTEXT_STORAGE_KEY,
  eventMatchesNavigation,
  operationalEventHref,
  operationalEventRequestHref,
  persistedEventContext,
  readPersistedEventContext,
  validatedOperationalEvent,
  type SelectedOperationalEvent,
} from "@/lib/operations/event-context";
import { STAFF_CONTEXT_STORAGE_KEY, eventSelectionHref, persistedStaffContext, readPersistedStaffContext, validatedStaffName } from "@/lib/operations/staff-workspace";

type EventContextValue = {
  selectedEvent: SelectedOperationalEvent | null;
  requestedEventId: string | null;
  preferredEventId: string | null;
  requestedDate: string | null;
  ready: boolean;
  staffName: string;
  setStaffName: (name: string) => void;
  openStaffEvent: (event: SelectedOperationalEvent, name: string) => void;
  switchEvent: () => void;
  selectEvent: (event: SelectedOperationalEvent) => void;
  clearEvent: () => void;
  eventHref: (path: string) => string;
  publishEvent: (event: SelectedOperationalEvent) => void;
};

const EventContext = createContext<EventContextValue>({
  selectedEvent: null,
  requestedEventId: null,
  preferredEventId: null,
  requestedDate: null,
  ready: false,
  staffName: "",
  setStaffName: () => {},
  openStaffEvent: () => {},
  switchEvent: () => {},
  selectEvent: () => {},
  clearEvent: () => {},
  eventHref: (path) => path,
  publishEvent: () => {},
});

export function EventContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedId = searchParams.get("eventId");
  const requestedDate = searchParams.get("date");
  const [stored, setStored] = useState<SelectedOperationalEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [staffName, setStoredStaffName] = useState("");
  const selectionCleared = useRef(false);

  useEffect(() => {
    try {
      setStored(readPersistedEventContext(sessionStorage.getItem(EVENT_CONTEXT_STORAGE_KEY)));
      setStoredStaffName(readPersistedStaffContext(sessionStorage.getItem(STAFF_CONTEXT_STORAGE_KEY)));
    } catch {
      // A restricted browser can still use explicit event links for this session.
    }
    setReady(true);
  }, []);

  const persist = useCallback((event: SelectedOperationalEvent | null) => {
    setStored(event);
    try {
      if (event) sessionStorage.setItem(EVENT_CONTEXT_STORAGE_KEY, persistedEventContext(event));
      else sessionStorage.removeItem(EVENT_CONTEXT_STORAGE_KEY);
    } catch {
      // Navigation continues even when the browser disallows storage.
    }
  }, []);

  const selectedEvent = stored && eventMatchesNavigation(stored, requestedId, requestedDate) ? stored : null;
  const setStaffName = useCallback((name: string) => {
    const safe = validatedStaffName(name);
    setStoredStaffName(safe);
    try {
      if (safe) sessionStorage.setItem(STAFF_CONTEXT_STORAGE_KEY, persistedStaffContext(safe));
      else sessionStorage.removeItem(STAFF_CONTEXT_STORAGE_KEY);
    } catch {
      // Staff can continue with explicit event links when storage is unavailable.
    }
  }, []);
  const openStaffEvent = useCallback((event: SelectedOperationalEvent, name: string) => {
    const safe = validatedOperationalEvent(event);
    const staff = validatedStaffName(name);
    if (!safe || !staff) return;
    selectionCleared.current = false;
    persist(safe);
    setStaffName(staff);
    router.push(operationalEventHref("/checklists", safe));
  }, [persist, router, setStaffName]);
  const switchEvent = useCallback(() => {
    selectionCleared.current = true;
    persist(null);
    router.push(eventSelectionHref(selectedEvent?.date ?? requestedDate ?? ""));
  }, [persist, requestedDate, router, selectedEvent?.date]);
  const selectEvent = useCallback((event: SelectedOperationalEvent) => {
    const safe = validatedOperationalEvent(event);
    if (!safe) return;
    selectionCleared.current = false;
    persist(safe);
    router.replace(operationalEventHref(`${pathname}${searchParams.size ? `?${searchParams}` : ""}`, safe), { scroll: false });
  }, [pathname, persist, router, searchParams]);

  const publishEvent = useCallback((event: SelectedOperationalEvent) => {
    const safe = validatedOperationalEvent(event);
    if (!safe || !eventMatchesNavigation(safe, requestedId, requestedDate)) return;
    if (selectionCleared.current && !requestedId) return;
    if (requestedId) selectionCleared.current = false;
    persist(safe);
  }, [persist, requestedDate, requestedId]);

  const clearEvent = useCallback(() => {
    selectionCleared.current = true;
    persist(null);
    const query = new URLSearchParams(searchParams.toString());
    query.delete("eventId");
    query.delete("date");
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  }, [pathname, persist, router, searchParams]);

  const value = useMemo<EventContextValue>(() => ({
    selectedEvent,
    requestedEventId: requestedId,
    preferredEventId: requestedId || (selectedEvent?.eventId ?? null),
    requestedDate,
    ready,
    staffName,
    setStaffName,
    openStaffEvent,
    switchEvent,
    selectEvent,
    clearEvent,
    publishEvent,
    eventHref: (path) => selectedEvent ? operationalEventHref(path, selectedEvent) : operationalEventRequestHref(path, requestedId, requestedDate),
  }), [selectedEvent, requestedId, requestedDate, ready, staffName, setStaffName, openStaffEvent, switchEvent, selectEvent, clearEvent, publishEvent]);

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

/** Use before choosing a page's default event. Explicit URL IDs take precedence. */
export function usePreferredOperationalEventId() {
  return useEventContext().preferredEventId;
}

export function useEventContext() {
  return useContext(EventContext);
}

/** Publish verified page data; this never replaces an explicitly requested different event. */
export function EventSelectionBridge({ event }: { event: SelectedOperationalEvent | null }) {
  const { publishEvent, ready } = useEventContext();
  const serialized = event ? JSON.stringify(event) : "";
  useEffect(() => {
    if (ready && serialized) publishEvent(JSON.parse(serialized) as SelectedOperationalEvent);
  }, [publishEvent, ready, serialized]);
  return null;
}
