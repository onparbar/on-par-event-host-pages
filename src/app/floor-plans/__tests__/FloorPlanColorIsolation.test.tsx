import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EntertainmentCategory, EntertainmentReservation } from "@/lib/entertainment/types";
import type { FloorPlanDayPayload, FloorPlanEvent, FloorPlanReservation } from "@/lib/floor-plans/types";

vi.mock("@/app/_components/EventContext", () => ({ EventSelectionBridge: () => null, useEventContext: () => ({ ready: true }) }));
import { PublishedFloorPlanMapView } from "../PublishedFloorPlanMap";

const GREEN = "#15803D";
const BLUE = "#0033FF";
const GRAY = "#334155";
const PURPLE = "#7C3AED";
const DATE = "2026-12-18";

function event(id: string, name: string, color: string, area: string, start = "17:00", end = "20:00"): FloorPlanEvent {
  return { id, floorPlanId: "redacted-plan", tripleseatEventId: `source-${id}`, name, color, status: "DEFINITE", guestCount: 20,
    startAt: `${DATE}T${start}:00Z`, endAt: `${DATE}T${end}:00Z`, contractedAreaIds: [area], unresolvedAreaNames: [],
    beoLastModifiedAt: null, fullBuyout: false, source: { rooms: [area], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } };
}

function local(owner: FloorPlanEvent, areaId: string, reservationType: FloorPlanReservation["reservationType"] = "room"): FloorPlanReservation {
  return { id: `${owner.id}-${areaId}-${reservationType}`, floorPlanEventId: owner.id, areaId, reservationType,
    startAt: owner.startAt, endAt: owner.endAt, label: reservationType === "custom" ? "VIP welcome note" : areaId,
    source: "manual", lockedByUser: true, ...(reservationType === "custom" ? { customGeometry: { x: 100, y: 100, width: 120, height: 44 } } : {}) };
}

function shared(owner: FloorPlanEvent, resourceId: string, category: EntertainmentCategory, start = owner.startAt!, end = owner.endAt!): EntertainmentReservation {
  return { id: `${owner.id}-${resourceId}`, syncKey: null, localEventId: owner.id, tripleseatEventId: owner.tripleseatEventId,
    tripleseatBookingId: null, eventName: owner.name, operatingDate: DATE, resourceId, resourceCategory: category,
    resourceName: resourceId === "pool-1" ? "Pool Table 1" : resourceId === "pool-2" ? "Pool Table 2" : resourceId === "private-room-vip-1" ? "VIP 1" : resourceId === "private-room-vip-2" ? "VIP 2" : "Bowling Lane 8",
    startAt: start, endAt: end, sourceStartAt: start, sourceEndAt: end, sourceResourceId: resourceId, eventColor: owner.color,
    colorSource: "floor-plan-assignment", source: "tripleseat", sourceReference: null, manualOverride: false,
    hasSourceUpdate: false, needsReview: false, reviewIssues: [], autoAssigned: false, notes: "", sourceUpdatedAt: null,
    lastTripleseatSyncAt: null, active: true, createdAt: start, updatedAt: start, updatedBy: "redacted-test" };
}

function fixture(): FloorPlanDayPayload {
  const first = event("main", "Main party", GREEN, "main-dining");
  const second = event("vip", "VIP party", BLUE, "vip-1", "19:00", "22:00");
  return { date: DATE, plan: { id: "redacted-plan", eventDate: DATE, version: 3, status: "Needs Review", ruleVersion: "test",
    lastTripleseatSyncAt: null, createdAt: `${DATE}T12:00:00Z`, updatedAt: `${DATE}T12:00:00Z`, approvedAt: null, approvedBy: null,
    events: [first, second], reservations: [local(first, "main-rect-left-1", "seating"), local(second, "vip-1"),
      local(second, "vip1-extra-front-1", "seating"), local(second, "vip1-food-table", "food-table"), local(second, "vip-1", "custom")] },
    entertainmentReservations: [shared(first, "pool-1", "pool", `${DATE}T17:00:00Z`, `${DATE}T19:00:00Z`),
      shared(second, "pool-1", "pool", `${DATE}T19:00:00Z`, `${DATE}T21:00:00Z`), shared(second, "pool-2", "pool"),
      shared(second, "private-room-vip-1", "private-rooms")], floorPlanConflicts: [], entertainmentConflicts: [],
    validation: [], revisions: [], persistence: "memory", sourceMode: "live", warnings: [] };
}

function render(payload: FloorPlanDayPayload, selectedEventId: string | null = null) {
  return renderToStaticMarkup(createElement(PublishedFloorPlanMapView, { payload, selectedEventId, onSelectEvent: () => undefined }));
}

function span(html: string, label: string, prefix = false) {
  const match = [...html.matchAll(/<span\b[^>]*>/g)].map((result) => result[0]).find((tag) => tag.includes(`aria-label="${label}${prefix ? "" : '"'}`));
  expect(match, label).toBeDefined();
  return match!;
}

describe("floor-plan colors stay with their own seating event", () => {
  it("keeps VIP, seating, food, custom note and private-room timing blue despite shared pool use", () => {
    const html = render(fixture());
    for (const label of ["VIP 1 assigned to VIP party", "VIP 1 Extra Table 1 assigned to VIP party", "VIP 1 ADA Food Table assigned to VIP party", "Custom highlight: VIP welcome note"]) {
      const overlay = span(html, label);
      expect(overlay).toContain(`background-color:${BLUE}80`);
      expect(overlay).toContain(`border-color:${BLUE}`);
      expect(overlay).not.toContain(GREEN);
    }
    expect(span(html, "VIP 1 assigned to VIP party")).toContain(`--event-fill-color:${BLUE}`);
    expect(html).toContain("3 hours · 2:00 PM – 5:00 PM");
    expect(span(html, "Main Dining Table L1 assigned to Main party")).toContain(`background-color:${GREEN}80`);
  });

  it("preserves earlier pool fill and later blue border only on the actually shared pool", () => {
    const html = render(fixture());
    expect(span(html, "Pool Table 1 assigned to Main party")).toContain(`background-color:${GREEN}80`);
    const outline = span(html, "Pool Table 1 also reserved by VIP party");
    expect(outline).toContain(`--event-color:${BLUE}`);
    expect(outline).toContain(`--event-fill-color:${GREEN}`);
    expect(span(html, "Pool Table 2 assigned to VIP party")).toContain(`background-color:${BLUE}80`);
  });

  it("uses each actual VIP room's primary color for later purple outlines, not a shared bowling color", () => {
    const payload = fixture();
    const gray = event("gray", "Later VIP party", GRAY, "vip-2", "21:00", "23:00");
    const purple = event("purple", "Evening party", PURPLE, "vip-1", "23:30", "23:59");
    payload.plan.events.push(gray, purple);
    payload.plan.reservations.push(local(gray, "vip-2"));
    payload.entertainmentReservations.push(shared(gray, "private-room-vip-2", "private-rooms"),
      shared(purple, "private-room-vip-1", "private-rooms"), shared(purple, "private-room-vip-2", "private-rooms"),
      shared(payload.plan.events[0], "bowling-8", "bowling"), shared(purple, "bowling-8", "bowling"));
    const html = render(payload);
    for (const [room, color] of [["VIP 1", BLUE], ["VIP 2", GRAY]]) {
      const outline = span(html, `${room} also reserved by Evening party,`, true);
      expect(outline).toContain(`--event-color:${PURPLE}`);
      expect(outline).toContain(`--event-fill-color:${color}`);
      expect(outline).not.toContain(GREEN);
    }
  });

  it("keeps all-party and single-event ownership stable without introducing a Main-party VIP", () => {
    const payload = fixture();
    expect(render(payload)).not.toContain('aria-label="VIP 1 assigned to Main party"');
    const own = render(payload, "vip");
    expect(span(own, "VIP 1 assigned to VIP party")).toContain(`background-color:${BLUE}80`);
    expect(own).not.toContain('aria-label="Pool Table 1 assigned to Main party"');
    const main = render(payload, "main");
    expect(main).not.toContain('aria-label="VIP 1 assigned to');
    expect(main).toContain('aria-label="Main Dining Table L1 assigned to Main party"');
  });

  it.each(["2026-12-18", "2026-12-19"])("does not leak party colors between independently loaded dates: %s", (date) => {
    const payload = JSON.parse(JSON.stringify(fixture()).replaceAll(DATE, date)) as FloorPlanDayPayload;
    const html = render(payload);
    expect(span(html, "VIP 1 assigned to VIP party")).toContain(`background-color:${BLUE}80`);
    expect(span(html, "Pool Table 2 assigned to VIP party")).toContain(`background-color:${BLUE}80`);
  });

  it("does not borrow inactive or unmatched source colors for unrelated VIP seating", () => {
    const payload = fixture();
    payload.entertainmentReservations[0].active = false;
    const unknown = event("unknown", "Unmatched source", GREEN, "main-dining");
    payload.entertainmentReservations.push(shared(unknown, "pool-1", "pool", `${DATE}T15:00:00Z`, `${DATE}T16:00:00Z`));
    const html = render(payload);
    expect(span(html, "VIP 1 assigned to VIP party")).toContain(`background-color:${BLUE}80`);
    expect(html).not.toContain('aria-label="VIP 1 assigned to Unmatched source"');
  });

  it("does not mutate reservation IDs, times, staff overrides or source records and makes no requests", () => {
    const payload = fixture();
    const before = JSON.stringify(payload);
    const request = vi.spyOn(globalThis, "fetch");
    try {
      for (const selected of [null, "main", "vip"]) render(payload, selected);
      expect(JSON.stringify(payload)).toBe(before);
      expect(request).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
  });
});
