import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getFloorPlanArea } from "@/lib/floor-plans/configuration/areas";
import type { FloorPlanDocument, FloorPlanEvent, FloorPlanReservation } from "@/lib/floor-plans/types";
import {
  editFloorPlanReservation,
  floorPlanGenerationRequest,
  FloorPlanSeatingSummary,
  FloorPlanTableDetails,
} from "../FloorPlanDashboard";

const event: FloorPlanEvent = {
  id: "party", floorPlanId: "plan", tripleseatEventId: "source-party", name: "Staff training party",
  status: "Definite", guestCount: 29, startAt: "2026-10-26T21:00:00.000Z", endAt: "2026-10-27T00:00:00.000Z",
  contractedAreaIds: ["main-dining"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: null, fullBuyout: false,
  source: { rooms: ["Main Dining"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] },
};
function reservation(areaId: string, overrides: Partial<FloorPlanReservation> = {}): FloorPlanReservation {
  return { id: `reservation:${areaId}`, floorPlanEventId: event.id, areaId, reservationType: "seating",
    startAt: event.startAt, endAt: event.endAt, label: "", source: "generated", lockedByUser: false,
    timingSource: "event-default", placementOverride: false, ...overrides };
}
function plan(reservations = [reservation("main-rect-left-1"), reservation("main-rect-left-2"), reservation("main-rect-left-3")]): FloorPlanDocument {
  return { id: "plan", eventDate: "2026-10-26", status: "Draft", version: 4, ruleVersion: "test", lastTripleseatSyncAt: null,
    createdAt: "2026-10-26T12:00:00Z", updatedAt: "2026-10-26T12:00:00Z", approvedAt: null, approvedBy: null, events: [event], reservations };
}

describe("event-scoped floor-plan seating controls", () => {
  it("shows full-event coverage, held spare seats and hours-only seating buffers", () => {
    const html = renderToStaticMarkup(createElement(FloorPlanSeatingSummary, {
      plan: plan(), event, dirty: false, saveConflict: false, disabled: false, onGenerate: () => {},
    }));
    for (const text of ["Contracted guests", "Assigned seats", "Full-event seats", "Seats still needed", "Spare seats", "1 — held for this event", "Full-event coverage", "Complete", "Food tables", "Main Dining", "Saved version 4", "1 hour", "0.5 hour", "Fill remaining seats", "Rework generated seating", "Selected event only"]) expect(html).toContain(text);
    expect(html).not.toContain("minutes");
  });

  it("does not present enough early-ending seats as full-event coverage", () => {
    const draft = plan(plan().reservations.map((item) => ({ ...item, endAt: "2026-10-26T23:00:00Z", timingSource: "staff-override" })));
    const html = renderToStaticMarkup(createElement(FloorPlanSeatingSummary, {
      plan: draft, event, dirty: true, saveConflict: false, disabled: false, onGenerate: () => {},
    }));
    expect(html).toContain("Needs attention");
    expect(html).toContain("Unsaved draft");
    expect(html).toContain("Saving does not prove");
  });

  it("keeps event-only requests distinct from full-date generation and retains expected version", () => {
    expect(floorPlanGenerationRequest(plan(), "fill-missing", event.id)).toEqual({ action: "generate", expectedVersion: 4, mode: "fill-missing", selectedEventId: "party" });
    expect(floorPlanGenerationRequest(plan(), "replace-generated", event.id).selectedEventId).toBe("party");
    expect(floorPlanGenerationRequest(plan(), "replace-generated")).not.toHaveProperty("selectedEventId");
  });

  it("disables event-only repair for unsaved or stale drafts rather than discarding them", () => {
    for (const state of [{ dirty: true, saveConflict: false }, { dirty: false, saveConflict: true }]) {
      const html = renderToStaticMarkup(createElement(FloorPlanSeatingSummary, {
        plan: plan(), event, ...state, disabled: false, onGenerate: () => { throw new Error("Rendering must not generate"); },
      }));
      expect(html.match(/disabled=""/g)).toHaveLength(2);
      expect(html).toContain(state.saveConflict ? "your draft is retained" : "Unsaved draft");
    }
  });

  it("separates placement locks and labels from explicit timing changes", () => {
    const original = reservation("main-rect-left-1");
    expect(editFloorPlanReservation(original, { label: "Near food" })).toEqual({ ...original, label: "Near food" });
    expect(editFloorPlanReservation(original, { lockedByUser: true })).toEqual({ ...original, lockedByUser: true });
    expect(editFloorPlanReservation(original, { reservationType: "food-table" })).toMatchObject({ source: "manual", placementOverride: true, timingSource: "event-default" });
    expect(editFloorPlanReservation(original, { endAt: "2026-10-26T23:00:00Z" })).toMatchObject({ source: "generated", placementOverride: false, timingSource: "staff-override" });
    expect(editFloorPlanReservation({ ...original, timingSource: "staff-override" }, { timingSource: "event-default", startAt: event.startAt, endAt: event.endAt })).toMatchObject({ timingSource: "event-default" });
  });

  it("shows one canonical physical identity and zero seating for a food-use alias", () => {
    const food = reservation("main-food-1", { reservationType: "food-table", source: "manual", placementOverride: true, lockedByUser: true });
    const html = renderToStaticMarkup(createElement(FloorPlanTableDetails, {
      plan: plan([food]), event, area: getFloorPlanArea("main-food-1")!, reservation: food,
    }));
    for (const text of ["main-rect-left-4", "Main Dining Table L4", "10 seats", "food-table — 0 guest seats", "Staff-selected", "Locked", "Follows event time", "Occupied interval", "4:00 PM", "8:30 PM"]) expect(html).toContain(text);
  });

  it("explains another party's blocking reservation instead of claiming availability", () => {
    const other = { ...event, id: "second", name: "Another party" };
    const hold = reservation("main-rect-left-1", { floorPlanEventId: other.id });
    const document = { ...plan([hold]), events: [event, other] };
    const html = renderToStaticMarkup(createElement(FloorPlanTableDetails, {
      plan: document, event, area: getFloorPlanArea(hold.areaId)!, reservation: null,
    }));
    expect(html).toContain("Unavailable for this event: Another party holds");
    expect(html).toContain("plus seating setup/cleanup");
    expect(html).toContain("Unassigned for selected event");
  });

  it("shows both calendar dates for seating and occupancy crossing midnight", () => {
    const late = { ...event, startAt: "2026-10-27T03:30:00Z", endAt: "2026-10-27T05:30:00Z" };
    const hold = reservation("main-rect-left-1", { startAt: late.startAt, endAt: late.endAt, timingSource: "staff-override" });
    const document = { ...plan([hold]), events: [late] };
    const html = renderToStaticMarkup(createElement(FloorPlanTableDetails, { plan: document, event: late, area: getFloorPlanArea(hold.areaId)!, reservation: hold }));
    expect(html).toContain("Oct 26");
    expect(html).toContain("Oct 27");
    expect(html).toContain("11:30 PM");
    expect(html).toContain("1:30 AM");
    expect(html).toContain("Staff time override");
  });

  it("labels both sides of a repeated New York clock hour with EDT and EST", () => {
    const fallback = { ...event, startAt: "2026-11-01T05:30:00Z", endAt: "2026-11-01T06:30:00Z" };
    const hold = reservation("main-rect-left-1", { startAt: fallback.startAt, endAt: fallback.endAt });
    const html = renderToStaticMarkup(createElement(FloorPlanTableDetails, { plan: { ...plan([hold]), events: [fallback] }, event: fallback, area: getFloorPlanArea(hold.areaId)!, reservation: hold }));
    expect(html).toContain("1:30 AM EDT");
    expect(html).toContain("1:30 AM EST");
  });

  it("describes legacy timing consistently without inventing persisted metadata on render", () => {
    const equal = reservation("main-rect-left-1", { source: "manual", timingSource: undefined });
    const distinct = { ...equal, endAt: "2026-10-26T23:00:00Z" };
    for (const [hold, expected] of [[equal, "Follows event time by legacy inference"], [distinct, "Distinct legacy times preserved as a staff override"]] as const) {
      const html = renderToStaticMarkup(createElement(FloorPlanTableDetails, { plan: plan([hold]), event, area: getFloorPlanArea(hold.areaId)!, reservation: hold }));
      expect(html).toContain(expected);
      expect(hold.timingSource).toBeUndefined();
    }
  });
});
