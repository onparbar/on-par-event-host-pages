import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ItineraryAsset } from "@/lib/event-plans/types";
import { ItineraryDashboard } from "../ItinerariesClient";

const event: ItineraryAsset = { id: 123, name: "Training event", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 8:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: ["Dessert Platter: 1"], drink_options: [], entertainment: [], verification_status: "Needs review" };

describe("printable itinerary card", () => {
  it("places saved Admin instructions in the printable card, retaining source-only notes separately", () => {
    const html = renderToStaticMarkup(createElement(ItineraryDashboard, { event: { ...event, special_instructions: ["Source-only instruction"], itinerary_edit: { updatedAt: "2026-10-21T15:00:00Z", sourceUpdatedAt: null, fields: { special_instructions: ["Food ready at 5:45 PM", "Meet guests in VIP 1"] } } }, online: true }));
    expect(html).toContain("itinerary-admin-instructions");
    expect(html).toContain("Event Instructions");
    expect(html).toContain("Food ready at 5:45 PM");
    expect(html).toContain("Meet guests in VIP 1");
    expect(html).not.toContain("Source-only instruction");
    expect(html).not.toContain("REVIEW COPY — NOT READY FOR STAFF");
  });

  it("does not add an empty instructions section to existing itineraries", () => {
    expect(renderToStaticMarkup(createElement(ItineraryDashboard, { event, online: true }))).not.toContain("itinerary-admin-instructions");
  });

  it("keeps neutral revision evidence without a readiness banner or changing unverified status", () => {
    const revision: NonNullable<ItineraryAsset["revision"]> = { fingerprint: "training-fingerprint", label: "IT-TRAINING", generatedAt: "2026-10-21T15:00:00Z", sourceUpdatedAt: null, lastSourceSyncAt: null, lastEntertainmentSyncAt: null, floorPlanVersion: 4, floorPlanStatus: "Draft", ready: false, reasons: ["Source needs review"], sections: { event: "event", food: "food", entertainment: "entertainment", seating: "seating", notes: "notes" }, savedPdfStatus: "none" };
    const html = renderToStaticMarkup(createElement(ItineraryDashboard, { event: { ...event, revision }, online: true }));
    expect(html).toContain('class="itinerary-revision-stamp" data-ready="false"');
    expect(html).toContain("IT-TRAINING");
    expect(html).toContain("Snapshot");
    expect(html).toContain("Floor plan v4");
    expect(html).not.toContain("REVIEW COPY");
    expect(html).not.toContain("Readiness checks passed");
    expect(revision.ready).toBe(false);
    expect(revision.reasons).toEqual(["Source needs review"]);
  });
});
