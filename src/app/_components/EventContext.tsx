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

type EventContextValue = {
  selectedEvent: SelectedOperationalEvent | null;
  preferredEventId: string | null;
  requestedDate: string | null;
  ready: boolean;
  selectEvent: (event: SelectedOperationalEvent) => void;
  clearEvent: () => void;
  eventHref: (path: string) => string;
  publishEvent: (event: SelectedOperationalEvent) => void;
};

const EventContext = createContext<EventContextValue>({
  selectedEvent: null,
  preferredEventId: null,
  requestedDate: null,
  ready: false,
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
  const selectionCleared = useRef(false);

  useEffect(() => {
    try {
      setStored(readPersistedEventContext(sessionStorage.getItem(EVENT_CONTEXT_STORAGE_KEY)));
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
    preferredEventId: requestedId || (selectedEvent?.eventId ?? null),
    requestedDate,
    ready,
    selectEvent,
    clearEvent,
    publishEvent,
    eventHref: (path) => selectedEvent ? operationalEventHref(path, selectedEvent) : operationalEventRequestHref(path, requestedId, requestedDate),
  }), [selectedEvent, requestedId, requestedDate, ready, selectEvent, clearEvent, publishEvent]);

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
