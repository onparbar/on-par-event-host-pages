import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ItineraryAsset } from "@/lib/event-plans/types";
import { operationalEventFromPlan } from "@/lib/operations/event-context";
import ItinerariesClient, { ItineraryDashboard } from "../ItinerariesClient";

const event: ItineraryAsset = { id: 123, name: "Training event", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 8:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: ["Dessert Platter: 1"], drink_options: [], entertainment: [], verification_status: "Needs review" };
const anotherEvent: ItineraryAsset = { ...event, id: 124, name: "Another training event", date: "2026-10-22" };
const context = vi.hoisted(() => ({ requestedEventId: "123" as string | null, preferredEventId: "123", ready: true }));

vi.mock("next/navigation", () => ({ usePathname: () => "/itineraries", useRouter: () => ({}) }));
vi.mock("@/app/_components/EventContext", () => ({
  useEventContext: () => ({ ...context, selectedEvent: context.ready ? operationalEventFromPlan(context.preferredEventId === "123" ? event : anotherEvent) : null, staffName: "Training staff", eventHref: (path: string) => path }),
  EventSelectionBridge: () => null,
}));
vi.mock("@/app/_components/EventWorkspace", () => ({
  EventWorkspaceTimeline: () => createElement("section", { "aria-label": "Event operating itinerary" }, "Event operating timeline"),
  EventWorkspaceReminders: () => createElement("section", { "aria-label": "Event reminders" }),
}));

it("keeps the printable itinerary and staff reminders without the operating timeline card", () => {
  const html = renderToStaticMarkup(createElement(ItinerariesClient, { items: [event, anotherEvent], selectedItinerary: event }));
  expect(html).toContain("Guest Experience Plan");
  expect(html).toContain("Dessert Platter: 1");
  expect(html).toContain(anotherEvent.name);
  expect(html).toContain("Print review copy");
  expect(html).toContain('aria-label="Event reminders"');
  expect(html).not.toContain('aria-label="Event operating itinerary"');
});

it("shows a loading state for a remembered event until its own details load, with no wrong-event print control", () => {
  context.requestedEventId = null;
  context.preferredEventId = "124";
  try {
    const html = renderToStaticMarkup(createElement(ItinerariesClient, { items: [event, anotherEvent], selectedItinerary: event }));
    expect(html).toContain("Loading your selected itinerary…");
    expect(html).toContain(anotherEvent.name);
    expect(html).not.toContain("Guest Experience Plan");
    expect(html).not.toContain("Print review copy");
  } finally {
    context.requestedEventId = "123";
    context.preferredEventId = "123";
  }
});

it("renders the explicit loaded itinerary before browser session preferences resolve", () => {
  context.ready = false;
  try {
    const html = renderToStaticMarkup(createElement(ItinerariesClient, { items: [event, anotherEvent], selectedItinerary: event }));
    expect(html).toContain("Guest Experience Plan");
    expect(html).toContain("Print review copy");
    expect(html).not.toContain("Loading your selected itinerary…");
  } finally {
    context.ready = true;
  }
});

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
