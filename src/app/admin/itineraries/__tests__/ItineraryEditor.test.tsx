import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAdminState } from "@/lib/admin-types";
import type { ItineraryAsset } from "@/lib/event-plans/types";
import ItineraryEditor from "../ItineraryEditor";

const renderState = vi.hoisted(() => ({ saving: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(renderState.saving && initial === "idle" ? "saving" : initial) };
});
vi.mock("@/app/_components/PortalShell", () => ({ PortalShell: ({ children }: { children: React.ReactNode }) => createElement("main", null, children), PortalPageHeader: () => createElement("h1", null, "Edit Itineraries") }));

const base: ItineraryAsset = { id: 123, name: "Training event", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 8:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: ["Dessert Platter: 1"], drink_options: [], entertainment: [{ name: "Bowling", quantity: "2 lanes", time: "6 PM - 7 PM", duration: "1 hour" }], verification_status: "Needs review" };

function render() { return renderToStaticMarkup(createElement(ItineraryEditor, { base, events: [{ id: base.id, name: base.name, date: base.date }], initialState: emptyAdminState(), initialUpdatedAt: null })); }

describe("itinerary save-in-flight editing lock", () => {
  beforeEach(() => { renderState.saving = false; });

  it("locks all editable fields and the event selector while a save or reset is in flight", () => {
    renderState.saving = true;
    const html = render();
    expect(html).toMatch(/<fieldset[^>]*class="admin-itinerary-edit-controls"[^>]*disabled=""/);
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*name="eventId"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit">Open event<\/button>/);
    const controls = html.slice(html.indexOf('class="admin-itinerary-edit-controls"'));
    expect(controls).toContain("Event name");
    expect(controls).toContain("Event instructions");
    expect(controls).toContain("Displayed entertainment");
    expect(controls).toContain("Add activity");
    expect(controls).toContain("Saving…");
  });

  it("allows editing again when a save is not in flight", () => {
    const html = render();
    expect(html).not.toMatch(/<fieldset[^>]*class="admin-itinerary-edit-controls"[^>]*disabled/);
    expect(html).not.toMatch(/<select[^>]*disabled=""[^>]*name="eventId"/);
    expect(html).toMatch(/<button[^>]*type="submit">Open event<\/button>/);
  });
});
