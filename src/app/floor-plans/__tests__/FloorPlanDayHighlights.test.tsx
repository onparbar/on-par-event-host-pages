import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import type { StaffFloorPlanPayload } from "@/lib/floor-plans/staff-publication";

vi.mock("@/app/_components/EventContext", () => ({ EventSelectionBridge: () => null, useEventContext: () => ({ ready: true }) }));

import FloorPlanDayHighlights, { FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE } from "../FloorPlanDayHighlights";
import { FloorPlanCard, FloorPlanDayNotesCard, SelectedEventFloorPlan, buildUpcomingFloorPlanEntries, type FloorPlanDisplayAsset } from "../FloorPlansClient";
import { PublishedFloorPlanMapView } from "../PublishedFloorPlanMap";

const highlight: AdminAssetOverlay = { id: "trivia", kind: "highlight", x: 10, y: 25, width: 30, height: 15, fill: "#297025", opacity: 0.5, text: "Trivia", textColor: "#FFFFFF", fontSize: 18 };
const payload: StaffFloorPlanPayload = {
  date: "2026-12-01",
  plan: {
    id: "day", eventDate: "2026-12-01", version: 1, status: "Approved", ruleVersion: "test", lastTripleseatSyncAt: null,
    createdAt: "", updatedAt: "", approvedAt: null, approvedBy: null,
    events: ["first", "second"].map((id) => ({ id, floorPlanId: "day", tripleseatEventId: id, name: `${id} party`, status: "", guestCount: 10,
      startAt: "2026-12-01T17:00:00-05:00", endAt: "2026-12-01T19:00:00-05:00", contractedAreaIds: [id === "first" ? "vip-1" : "vip-2"],
      unresolvedAreaNames: [], color: id === "first" ? "#297025" : "#0033FF", beoLastModifiedAt: null, fullBuyout: false,
      source: { rooms: [], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } })),
    reservations: [{ id: "seat", floorPlanEventId: "first", areaId: "vip-1", reservationType: "room", startAt: null, endAt: null, label: "", source: "manual", lockedByUser: true }],
  }, entertainmentReservations: [],
};

describe("date-wide floor-plan highlights", () => {
  it("renders inert percentage-positioned highlights with translucent fill but fully opaque text", () => {
    const html = renderToStaticMarkup(createElement(FloorPlanDayHighlights, { highlights: [highlight, { ...highlight, id: "cover", kind: "cover", text: "Not a public highlight" }] }));
    expect(html).toContain('aria-label="Special event highlight: Trivia"');
    expect(html).toContain("position:absolute;left:10%;top:25%;width:30%;height:15%");
    expect(html).toContain("background-color:#29702580");
    expect(html).toContain("pointer-events:none");
    expect(html).toContain('class="floor-plan-day-highlight-label"');
    expect(html).not.toContain("opacity:");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Not a public highlight");
  });

  it("selects exactly the annotation ID only when the editor supplies a selection handler", () => {
    const onSelect = vi.fn();
    const [button] = FloorPlanDayHighlights({ highlights: [highlight], selectedId: highlight.id, onSelect });
    expect(button.type).toBe("button");
    expect(button.props["aria-pressed"]).toBe(true);
    expect(button.props.style.pointerEvents).toBe("auto");
    button.props.onClick();
    expect(onSelect).toHaveBeenCalledWith("trivia");
  });

  it("keeps notes date-wide in both full-day and filtered-party maps without changing source records", () => {
    const before = JSON.stringify(payload);
    const request = vi.spyOn(globalThis, "fetch");
    try {
      for (const selectedEventId of [null, "first", "second"]) {
        const html = renderToStaticMarkup(createElement(PublishedFloorPlanMapView, { payload, selectedEventId, onSelectEvent: () => undefined, highlights: [highlight] }));
        expect(html).toContain("Special event highlight: Trivia");
        expect(html).toContain(FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE);
        if (selectedEventId === "second") expect(html).not.toContain("VIP 1 assigned to first party");
      }
      expect(JSON.stringify(payload)).toBe(before);
      expect(request).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
  });

  it("shows an exact-date notes-only base map without fabricating a booking, reservation or approval", () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      const html = renderToStaticMarkup(createElement(FloorPlanDayNotesCard, { date: "2026-12-01", highlights: [highlight], isOpen: true, onOpenChange: () => undefined }));
      expect(html).toContain("Tuesday, December 1, 2026");
      expect(html).toContain("blank-floor-map.png");
      expect(html).toContain("Special event highlight: Trivia");
      expect(html).toContain("No party seating or entertainment assignments are shown");
      expect(html).toContain(FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE);
      expect(html).not.toContain("assigned to");
      expect(html).not.toContain(">Approved<");
      expect(html).not.toContain("Sync On Par");
      expect(request).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
  });

  it("does not let date-wide notes stand in for a missing exact event assignment", () => {
    const html = renderToStaticMarkup(createElement(SelectedEventFloorPlan, { payload, date: "2026-12-02", eventId: "first", highlights: [highlight] }));
    expect(html).toContain("No floor plan assigned");
    expect(html).not.toContain("Trivia");
    expect(html).not.toContain("blank-floor-map.png");
  });

  it("adds note-only dates in order without duplicating existing map dates or inventing events", () => {
    const entries = buildUpcomingFloorPlanEntries([], [{ plan: payload.plan, payload }], {
      "2026-12-03": [{ ...highlight, id: "bingo", text: "Bingo" }],
      "2026-12-01": [highlight], "2026-12-02": [],
    });
    expect(entries.map(({ date, kind }) => ({ date, kind }))).toEqual([{ date: "2026-12-01", kind: "saved" }, { date: "2026-12-03", kind: "notes" }]);
    expect(entries[1]).not.toHaveProperty("publication");
    expect(entries[1]).not.toHaveProperty("events");
  });

  it("keeps highlights off differently aligned special-page artwork and offers a separate canonical notes map", () => {
    const asset: FloorPlanDisplayAsset = { date: "2026-12-01", label: "Special program", image: "/floor-plans/special-program.png", events: ["Special program"], source: "Test artwork", archiveReason: null, specialPage: true };
    const entries = buildUpcomingFloorPlanEntries([asset], [], { [asset.date]: [highlight] });
    expect(entries.map(({ kind }) => kind)).toEqual(["static", "notes"]);
    const html = renderToStaticMarkup(createElement(FloorPlanCard, { asset, isOpen: true, onOpenChange: () => undefined, onSync: () => undefined, overlays: [], highlights: [highlight] }));
    expect(html).toContain("special-program.png");
    expect(html).not.toContain("Special event highlight: Trivia");
    expect(html).not.toContain(FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE);
    const canonical = renderToStaticMarkup(createElement(FloorPlanDayNotesCard, { date: asset.date, highlights: [highlight], isOpen: true, onOpenChange: () => undefined }));
    expect(canonical).toContain("blank-floor-map.png");
    expect(canonical).toContain("Special event highlight: Trivia");
  });

  it("keeps canonical regular static maps as the sole map for their date and displays notes in place", () => {
    const asset: FloorPlanDisplayAsset = { date: "2026-12-01", label: "Regular map", image: "/floor-plans/regular-map.png", events: [], source: "Test canonical map", archiveReason: null, specialPage: false };
    expect(buildUpcomingFloorPlanEntries([asset], [], { [asset.date]: [highlight] }).map(({ kind }) => kind)).toEqual(["static"]);
    const html = renderToStaticMarkup(createElement(FloorPlanCard, { asset, isOpen: true, onOpenChange: () => undefined, onSync: () => undefined, overlays: [], highlights: [highlight] }));
    expect(html).toContain("Special event highlight: Trivia");
    expect(html).toContain(FLOOR_PLAN_DAY_HIGHLIGHT_NOTICE);
  });
});
