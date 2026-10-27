import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminState } from "@/lib/admin-types";
import type { FloorPlanDayPayload, FloorPlanEvent } from "@/lib/floor-plans/types";

const context = vi.hoisted(() => ({
  requestedEventId: null as string | null,
  preferredEventId: "source-one",
  requestedDate: "2026-10-23",
  selectedEvent: { eventId: "source-one", eventName: "First party", date: "2026-10-23", area: "VIP 1", guestCount: 20 },
  clearEvent: vi.fn(),
  selectEvent: vi.fn(),
}));
const localState = vi.hoisted(() => ({ enabled: false, eventId: null as string | null }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => localState.enabled ? [localState.eventId, (eventId: string | null) => { localState.eventId = eventId; }] : actual.useState(initial) };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/floor-plans", useRouter: () => router }));
vi.mock("@/app/_components/EventContext", () => ({
  useEventContext: () => ({ ...context, ready: true, staffName: "Carlos", eventHref: (path: string) => path, switchEvent: vi.fn() }),
  EventSelectionBridge: () => null,
}));
vi.mock("@/app/_components/EventWorkspace", () => ({ EventWorkspaceReminders: () => null }));

import FloorPlansClient from "../FloorPlansClient";
import PublishedFloorPlanMap, { PublishedFloorPlanMapView } from "../PublishedFloorPlanMap";

function event(id: string, area: string): FloorPlanEvent {
  return { id, floorPlanId: "day-plan", tripleseatEventId: `source-${id}`, name: id === "one" ? "First party" : "Second party", status: "DEFINITE", guestCount: 20, startAt: "2026-10-23T17:00:00-04:00", endAt: "2026-10-23T19:00:00-04:00", contractedAreaIds: [area], unresolvedAreaNames: [], color: id === "one" ? "#297025" : "#1D4ED8", beoLastModifiedAt: null, fullBuyout: false, source: { rooms: [area], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } };
}
const events = [event("one", "vip-1"), event("two", "vip-2")];
const payload: FloorPlanDayPayload = {
  date: "2026-10-23",
  plan: { id: "day-plan", eventDate: "2026-10-23", status: "Approved", version: 1, ruleVersion: "test", lastTripleseatSyncAt: null, createdAt: "2026-10-23T12:00:00Z", updatedAt: "2026-10-23T12:00:00Z", approvedAt: null, approvedBy: null, events, reservations: events.map((item) => ({ id: `${item.id}-room`, floorPlanEventId: item.id, areaId: item.contractedAreaIds[0], reservationType: "room", startAt: item.startAt, endAt: item.endAt, label: item.name, source: "manual", lockedByUser: true })) },
  entertainmentReservations: [], floorPlanConflicts: [], entertainmentConflicts: [], validation: [], revisions: [], persistence: "database", sourceMode: "live", warnings: [],
};
const props = { initialState: { archivedAssetKeys: [], overlaysByAsset: {} } as unknown as AdminState, plans: [], publications: [{ plan: payload.plan, payload }], specialPages: [], today: payload.date };

function decemberPublication(status: FloorPlanDayPayload["plan"]["status"] = "Draft", includePayload = true) {
  const date = "2026-12-05";
  const plan = { ...payload.plan, id: `floor-plan-${date}`, eventDate: date, status,
    events: payload.plan.events.map((item, index) => ({ ...item, floorPlanId: `floor-plan-${date}`, name: index ? "December VIP party" : "December corporate party" })) };
  return { plan, payload: includePayload ? { ...payload, date, plan } : null };
}

describe("main floor-plan view versus selected checklist workspace", () => {
  beforeEach(() => { context.requestedEventId = null; context.preferredEventId = "source-one"; context.requestedDate = payload.date; localState.enabled = false; localState.eventId = null; vi.clearAllMocks(); });

  it("starts with all parties even when the browser remembers a selected checklist event", () => {
    const html = renderToStaticMarkup(createElement(FloorPlansClient, props));
    expect(html).toContain("Upcoming floor plans");
    expect(html).toContain("Showing all events");
    expect(html).toContain('aria-label="VIP 1 assigned to First party"');
    expect(html).toContain('aria-label="VIP 2 assigned to Second party"');
    expect(html).toContain('aria-label="Show only First party on the floor plan"');
    expect(html).toContain('aria-label="Show only Second party on the floor plan"');
    expect(html).not.toContain("My event workspace");
    expect(context.clearEvent).not.toHaveBeenCalled();
    expect(context.selectEvent).not.toHaveBeenCalled();
  });

  it("keeps the empty December folder below Upcoming and above Archive", () => {
    const html = renderToStaticMarkup(createElement(FloorPlansClient, props));
    const upcoming = html.indexOf('id="upcoming-floor-plans"');
    const december = html.indexOf("December 2026 floor plans");
    const archive = html.indexOf("Floor-plan archive");
    expect(upcoming).toBeLessThan(december);
    expect(december).toBeLessThan(archive);
    expect(html).toContain("No December 2026 floor plans have been prepared yet.");
    expect(html).toContain('<details class="floor-plan-archive floor-plan-planning-month">');
  });

  it("keeps December maps and pending drafts in one folder without duplicate static images or approval entries", () => {
    const draft = decemberPublication();
    const pending = decemberPublication("Needs Review", false);
    pending.plan = { ...pending.plan, id: "floor-plan-2026-12-06", eventDate: "2026-12-06", events: [{ ...pending.plan.events[0], name: "December pending review" }] };
    const html = renderToStaticMarkup(createElement(FloorPlansClient, { ...props,
      plans: [{ date: draft.plan.eventDate, label: "Static December duplicate", image: "/floor-plans/december-duplicate.png", events: ["Static December duplicate"] }],
      publications: [...props.publications, draft, pending] }));
    const folderStart = html.indexOf('class="floor-plan-archive floor-plan-planning-month"');
    const archiveStart = html.indexOf("Floor-plan archive");
    const folder = html.slice(folderStart, archiveStart);
    expect(html.slice(0, folderStart)).not.toContain("December corporate party");
    expect(folder).toContain("December corporate party");
    expect(folder).toContain("December pending review");
    expect(folder).toContain("Draft");
    expect(folder).toContain("Needs Review");
    expect(folder).toContain("Edit and approve");
    expect(folder).toContain("2 plans");
    expect(html).not.toContain("Static December duplicate");
    expect(html.slice(archiveStart)).not.toContain("December corporate party");
    expect(html.slice(archiveStart)).not.toContain("December pending review");
  });

  it("opens the December folder and exact date card for a date-only deep link, showing both parties", () => {
    context.requestedDate = "2026-12-05";
    const december = decemberPublication();
    const html = renderToStaticMarkup(createElement(FloorPlansClient, { ...props, publications: [...props.publications, december] }));
    expect(html).toContain('<details class="floor-plan-archive floor-plan-planning-month" open="">');
    expect(html).toContain("Showing all events");
    expect(html).toContain('aria-label="VIP 1 assigned to December corporate party"');
    expect(html).toContain('aria-label="VIP 2 assigned to December VIP party"');
    expect(html).not.toContain('aria-label="VIP 1 assigned to First party"');
  });

  it("keeps a December checklist workspace focused on its exact event without the planning folder", () => {
    context.requestedDate = "2026-12-05";
    context.requestedEventId = "source-one";
    const html = renderToStaticMarkup(createElement(FloorPlansClient, { ...props, publications: [decemberPublication()] }));
    expect(html).toContain('aria-label="VIP 1 assigned to December corporate party"');
    expect(html).not.toContain("December VIP party");
    expect(html).not.toContain("December 2026 floor plans");
    expect(html).not.toContain("Show all events");
  });

  it("keeps exact event-only highlights for a selected checklist's explicit floor-plan link", () => {
    context.requestedEventId = "source-one";
    const html = renderToStaticMarkup(createElement(FloorPlansClient, props));
    expect(html).toContain("Reserved seating and entertainment for your selected event only");
    expect(html).toContain('aria-label="VIP 1 assigned to First party"');
    expect(html).not.toContain("Second party");
    expect(html).not.toContain("Show all events");
    expect(html).not.toContain("Show only");
  });

  it("does not substitute the full day for an explicit event with no match on the requested date", () => {
    for (const requested of [{ id: "missing-event", date: payload.date }, { id: "source-one", date: "2026-10-24" }]) {
      context.requestedEventId = requested.id;
      context.requestedDate = requested.date;
      const html = renderToStaticMarkup(createElement(FloorPlansClient, props));
      expect(html).toContain("No floor plan assigned");
      expect(html).not.toContain('aria-label="VIP 1 assigned to First party"');
      expect(html).not.toContain('aria-label="VIP 2 assigned to Second party"');
    }
  });

  it("returns to the all-party view when the selected-event URL is removed without clearing the shared checklist selection", () => {
    context.requestedEventId = "source-one";
    expect(renderToStaticMarkup(createElement(FloorPlansClient, props))).not.toContain("Second party");
    context.requestedEventId = null;
    const html = renderToStaticMarkup(createElement(FloorPlansClient, props));
    expect(html).toContain("Showing all events");
    expect(html).toContain('aria-label="VIP 2 assigned to Second party"');
    expect(context.selectedEvent.eventId).toBe("source-one");
    expect(context.clearEvent).not.toHaveBeenCalled();
  });

  it("starts each mounted date with all of its parties and ignores a remembered event from another date", () => {
    const nextDay = { ...payload, date: "2026-10-24", plan: { ...payload.plan, id: "next-day-plan", eventDate: "2026-10-24" } };
    for (const day of [payload, nextDay, payload]) {
      const html = renderToStaticMarkup(createElement(PublishedFloorPlanMap, { payload: day }));
      expect(html).toContain("Showing all events");
      expect(html).toContain('aria-label="VIP 1 assigned to First party"');
      expect(html).toContain('aria-label="VIP 2 assigned to Second party"');
      expect(html).not.toContain("No floor plan assigned");
    }
    expect(context.clearEvent).not.toHaveBeenCalled();
    expect(context.selectEvent).not.toHaveBeenCalled();
  });

  it("filters only this map on a legend click and restores both parties without changing the checklist or URL", () => {
    function mapView() {
      localState.enabled = true;
      try {
        const tree = PublishedFloorPlanMap({ payload }) as ReactElement<{ children: ReactElement[] }>;
        return tree.props.children[1] as ReactElement<Parameters<typeof PublishedFloorPlanMapView>[0]>;
      } finally { localState.enabled = false; }
    }
    expect(renderToStaticMarkup(mapView())).toContain("Showing all events");
    mapView().props.onSelectEvent("two");
    const filtered = renderToStaticMarkup(mapView());
    expect(filtered).toContain('aria-label="VIP 2 assigned to Second party"');
    expect(filtered).not.toContain('aria-label="VIP 1 assigned to First party"');
    expect(filtered).toContain("Showing one event");
    mapView().props.onSelectEvent(null);
    const all = renderToStaticMarkup(mapView());
    expect(all).toContain('aria-label="VIP 1 assigned to First party"');
    expect(all).toContain('aria-label="VIP 2 assigned to Second party"');
    expect(all).toContain("Showing all events");
    expect(context.selectedEvent.eventId).toBe("source-one");
    expect(context.clearEvent).not.toHaveBeenCalled();
    expect(context.selectEvent).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    mapView().props.onSelectEvent("two");
    expect(localState.eventId).toBe("two");
    const remounted = renderToStaticMarkup(createElement(PublishedFloorPlanMap, { payload }));
    expect(remounted).toContain("Showing all events");
    expect(remounted).toContain('aria-label="VIP 1 assigned to First party"');
    expect(remounted).toContain('aria-label="VIP 2 assigned to Second party"');
  });
});
