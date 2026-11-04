import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import SetupClient, { ReferenceIllustration, StationGuide } from "../SetupClient";
import { APPETIZER_WING_BAR_SETUP_TEMPLATE, APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE, TACO_BAR_SETUP_TEMPLATE } from "@/lib/operations/setup-layout";
import { contractSetup } from "@/lib/operations/setup";
import { APPETIZER_WING_BAR_SETUP_OBJECTS, APPETIZER_WINGS_DESSERT_SETUP_OBJECTS, TACO_BAR_SETUP_OBJECTS } from "../setup-objects";

const context = vi.hoisted(() => ({ ready: true, preferredEventId: null as string | null, selectEvent: vi.fn(), clearEvent: vi.fn(), bridge: vi.fn() }));
vi.mock("@/app/_components/EventContext", () => ({
  useEventContext: () => context,
  EventSelectionBridge: (props: unknown) => { context.bridge(props); return null; },
}));
vi.mock("@/app/_components/PortalShell", () => ({
  PortalShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
  PortalPageHeader: ({ title, description, aside }: { title: string; description: string; aside: ReactNode }) => createElement("header", null, createElement("h1", null, title), description, aside),
  PortalStatusBadge: ({ children }: { children: ReactNode }) => createElement("span", null, children),
}));

const event: EventPlan = {
  id: 77, name: "Redacted Taco Bar event", date: "2026-11-03", day: "Tuesday", time: "5:30 PM - 8:30 PM", guest_count: 17,
  rooms: ["VIP 1"], color: "#18332F", food: ["17 × The Full Course", "Taco Bar", "1 × Chicken Tender Platter", "1 × Wing Platter", "1 × Veggie Tray"],
  drink_options: [], entertainment: [], verification_status: "Verified", source_updated_at: "2026-11-03T15:00:00Z",
};
const appetizerEvent: EventPlan = {
  ...event, id: 78, name: "Redacted Appetizer Bar event", date: "2026-11-04", day: "Wednesday", guest_count: 55,
  food: ["55 × The Front Nine + Appetizer Bar", "2 × Wing Platter", "2 × Desert Platter"],
};
const basicBarEvents: EventPlan[] = [
  { ...event, id: 81, name: "Redacted basic Appetizer Bar", food: ["17 × The Front Nine + Appetizer Bar"] },
  { ...event, id: 82, name: "Redacted basic Wing Bar", food: ["17 × The Full Course + Wing Bar"] },
];

function render(events = [event], sourceWarning = "", date = event.date) { return renderToStaticMarkup(createElement(SetupClient, { events, sourceWarning, date })); }
beforeEach(() => { context.ready = true; context.preferredEventId = null; vi.clearAllMocks(); });

describe("read-only Set Up guide", () => {
  it("offers a date-only GET navigation without carrying the old event identity", () => {
    const html = render();
    const form = html.match(/<form[^>]*aria-label="Browse setup by date"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain('action="/set-up"');
    expect(form).toContain('method="get"');
    expect(form).toContain('type="date"');
    expect(form).toContain('name="date"');
    expect(form).toContain('value="2026-11-03"');
    expect(form).toContain("View day");
    expect(form).not.toContain('name="eventId"');
    expect(form).not.toContain("min=");
    expect(form).not.toContain("max=");
  });
  it("keeps date browsing available when the selected day has no events", () => {
    const html = render([], "Source warning retained", "2026-12-18");
    expect(html).toContain('aria-label="Browse setup by date"');
    expect(html).toContain('value="2026-12-18"');
    expect(html).toContain("No events available");
    expect(html).toContain("Source warning retained");
    expect(context.bridge).not.toHaveBeenCalled();
  });
  it("can browse away from an unavailable explicit event without substituting another party", () => {
    context.preferredEventId = "missing-event";
    const html = render([event], "", "2026-12-18");
    expect(html).toContain('value="2026-12-18"');
    expect(html).toContain("The selected event is unavailable");
    expect(html).not.toContain("Purchased food &amp; prep quantities");
    expect(context.bridge).not.toHaveBeenCalled();
  });
  it("uses the selected event date when the event dropdown crosses days", () => {
    context.preferredEventId = String(appetizerEvent.id);
    const html = render([event, appetizerEvent]);
    expect(html).toContain('type="date" required="" name="date" value="2026-11-04"');
  });
  it.each([event, appetizerEvent, ...basicBarEvents])("shows the visual reference before serving instructions without the equipment summary: $name", (plan) => {
    const html = render([plan]);
    const reference = html.indexOf("What the setup should resemble");
    const instructions = html.indexOf("Build the serving line");
    expect(html.indexOf("<select")).toBeGreaterThan(-1);
    expect(reference).toBeGreaterThan(html.indexOf("<select"));
    expect(instructions).toBeGreaterThan(reference);
    expect(html).not.toContain('aria-label="Contract setup requirements"');
    expect(html).not.toContain("Chafing dishes — prepared pans");
    expect(html).not.toContain("use the event equipment counts above");
    expect(html).toContain('aria-label="Purchased food and prep quantities"');
  });
  it("shows the reference and exact existing prep quantities without applying the image count", () => {
    const html = render();
    expect(html).not.toContain('aria-label="Layout draft limitations"');
    expect(html).not.toContain("Furniture dimensions confirmed · Equipment placement is a draft");
    expect(html).toContain("equipment placement is not to scale");
    expect(html).toContain("physical fit is not approved");
    expect(html).toContain("AI-generated reference illustration");
    expect(html).toContain('src="/setup/taco-bar-reference-v1.png"');
    expect(html).toContain("The reference depicts one central chafer");
    expect(html).toContain("Additional food · Placement needs review");
    expect(html).toContain("1 × Chicken Tender Platter");
    expect(html).toContain("64 each");
    expect(html).toContain("2 × 1/2 pans");
    expect(html).not.toContain("Submit");
    expect(html).not.toContain("Save layout");
  });
  it("uses the confirmed table and side-by-side cart dimensions without claiming equipment fits", () => {
    const html = render();
    expect(html).toContain("8 ft × 3 ft");
    expect(html).toContain("96 × 36 in");
    expect(html).toContain("Each cart: 21.5 × 15.5 in");
    expect(html).toContain("combined 21.5 × 31 in");
    expect(html).toContain("aspect-ratio:36 / 96");
    expect(html).toContain("aspect-ratio:31 / 21.5");
    expect(html).toContain("2 marble serving carts, side by side");
    expect(html).toContain("not equipment size or confirmed fit");
  });
  it("shows mirrored equipment as a draft without doubling purchased food", () => {
    const html = render([{ ...event, guest_count: 101 }]);
    expect(html).toContain("Two food tables are indicated by the current guest-count rule");
    expect(html).toContain("do not double the purchased food quantities");
    expect(html).toContain("Listed once · quantities unchanged");
  });
  it("keeps all five station instructions available and makes one station selectable", () => {
    const html = renderToStaticMarkup(createElement(StationGuide, { stations: TACO_BAR_SETUP_TEMPLATE.stations }));
    expect(html.match(/aria-controls="setup-station-details"/g)).toHaveLength(5);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("1 spoon and 2 large tongs");
    expect(html).toContain("2 small tongs on top, 2 spoons in the middle and 2 spoons on the bottom");
    expect(html).toContain("Reference equipment only");
    expect(html).toContain("grid-template-rows:repeat(4, minmax(0, 1fr))");
  });
  it("makes every reference object an accessible item target with a picker fallback", () => {
    const html = renderToStaticMarkup(createElement(ReferenceIllustration, { applied: true }));
    expect(TACO_BAR_SETUP_OBJECTS).toHaveLength(35);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(TACO_BAR_SETUP_OBJECTS.length);
    expect(html).toContain("Tap an object in the picture");
    expect(html).toContain("Find an item");
    for (const item of TACO_BAR_SETUP_OBJECTS) {
      expect(html).toContain(`data-setup-object="${item.id}"`);
      expect(html).toContain(`value="${item.id}"`);
    }
    expect(html).toContain("Close item details");
    expect(html).toContain('method="dialog"');
    expect(html).toContain("Reference placement only");
    expect(html).not.toContain("<dialog open");
  });
  it("allows identifying library objects without applying them to an unsupported event", () => {
    const html = renderToStaticMarkup(createElement(ReferenceIllustration, { applied: false }));
    expect(html).toContain("Not applied to this event");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(TACO_BAR_SETUP_OBJECTS.length);
  });
  it("does not substitute an available event when an explicit event is missing", () => {
    context.preferredEventId = "999";
    const html = render();
    expect(html).toContain("The selected event is unavailable");
    expect(html).toContain("No different party has been substituted");
    expect(html).not.toContain(event.name);
    expect(context.bridge).not.toHaveBeenCalled();
  });
  it("retains the exact VIP source identity instead of using a different numeric party", () => {
    context.preferredEventId = "vip-sample-a";
    const vip = { ...event, id: 808, source_event_id: "vip-sample-a", name: "Redacted VIP event" };
    const html = render([event, vip]);
    expect(html).toContain('value="vip-sample-a" selected=""');
    expect(context.bridge).toHaveBeenCalledWith({ event: expect.objectContaining({ eventId: "vip-sample-a", eventName: vip.name, date: event.date }) });
    expect(html).toContain("Event source: vip-sample-a");
    expect(html).toContain("Nov 3, 2026, 10:00 AM Eastern");
  });
  it("does not apply a reference to unsupported food", () => {
    const html = render([{ ...event, food: ["1 × Unmapped Buffet"] }]);
    expect(html).toContain("This menu needs a setup template");
    expect(html).toContain("Taco Bar reference library · Not applied to this event");
    expect(html).toContain("Appetizer Bar, wings &amp; dessert reference library · Not applied to this event");
    expect(html).toContain("Appetizer Bar &amp; Wing Bar reference library · Not applied to this event");
    expect(html).not.toContain('aria-label="Taco Bar station guide"');
    expect(html).not.toContain("<details open");
  });
  it("uses the matching Appetizer Bar reference and preserves all purchased food and deterministic prep quantities", () => {
    const before = structuredClone(appetizerEvent);
    const setup = contractSetup(appetizerEvent);
    const html = render([appetizerEvent]);
    expect(html).toContain('aria-label="Appetizer Bar, wings &amp; dessert station guide"');
    expect(html).toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(html).not.toContain('src="/setup/taco-bar-reference-v1.png"');
    expect(html).toContain("The reference depicts 2 serving chafing dishes, not all prepared-pan containers");
    expect(setup.servingSetup).toBeNull();
    const prep = html.split('aria-label="Purchased food and prep quantities"')[1].split("</section>")[0];
    for (const food of setup.purchasedFood) expect(prep).toContain(food);
    for (const food of setup.food) {
      expect(prep).toContain(food.quantity === null ? "Needs review" : `${food.quantity} ${food.unit}`);
      if (food.pans !== null) expect(prep).toContain(`${food.pans}${food.panSize ? ` × ${food.panSize} pans` : " pans"}`);
    }
    expect(html).toContain("Purchased dessert quantities remain unchanged");
    expect(html).toContain("Food-service standard: use two marble serving carts");
    expect(html).not.toContain("Additional food · Placement needs review");
    expect(appetizerEvent).toEqual(before);
  });
  it("keeps the two-chafers, sauces and dessert stations in the supplied order with per-side tools", () => {
    const html = renderToStaticMarkup(createElement(StationGuide, { stations: APPETIZER_WINGS_DESSERT_SETUP_TEMPLATE.stations, templateId: "appetizer-wings-dessert" }));
    const ordered = ["Plates, napkins &amp; forks", "First chafing dish", "Second chafing dish", "Sauce serving plate", "Raised dessert platter"];
    for (const title of ordered) expect(html).toContain(title);
    expect(ordered.map((title) => html.indexOf(title))).toEqual(ordered.map((title) => html.indexOf(title)).sort((a, b) => a - b));
    expect(html.match(/aria-controls="setup-station-details"/g)).toHaveLength(5);
    expect(html).toContain("Left long black plate: 3 tongs");
    expect(html).toContain("Right long black plate: 3 tongs");
    expect(html).toContain("Left long black plate: 2 tongs");
    expect(html).toContain("Right long black plate: 2 tongs");
    expect(html).toContain("3 spoons");
    expect(html).toContain("Small clear riser");
    expect(html).toContain("Dessert platter");
    expect(html).toContain("2 tongs");
    expect(html).not.toContain("Tortilla warmers");
  });
  it("provides matching object details for the new reference without replacing the Taco objects", () => {
    const html = renderToStaticMarkup(createElement(ReferenceIllustration, { applied: true, templateId: "appetizer-wings-dessert" }));
    expect(APPETIZER_WINGS_DESSERT_SETUP_OBJECTS.length).toBeGreaterThan(0);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(APPETIZER_WINGS_DESSERT_SETUP_OBJECTS.length);
    for (const item of APPETIZER_WINGS_DESSERT_SETUP_OBJECTS) {
      expect(html).toContain(`data-setup-object="${item.id}"`);
      expect(html).toContain(`value="${item.id}"`);
    }
    expect(html).toContain('method="dialog"');
    expect(html).not.toContain("<dialog open");
  });
  it("provides an accessible picture target and picker option for every one-chafer reference object", () => {
    const html = renderToStaticMarkup(createElement(ReferenceIllustration, { applied: true, templateId: "appetizer-wing-bar" }));
    expect(APPETIZER_WING_BAR_SETUP_OBJECTS).toHaveLength(24);
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(24);
    for (const item of APPETIZER_WING_BAR_SETUP_OBJECTS) {
      expect(html).toContain(`data-setup-object="${item.id}"`);
      expect(html).toContain(`value="${item.id}"`);
    }
    expect(html).toContain('method="dialog"');
    expect(html).not.toContain("<dialog open");
    expect(html).toContain("Reference placement only");
  });
  it("offers all three collapsed library references instead of applying a layout to unknown or conflicting bars", () => {
    for (const unmatched of [{ ...appetizerEvent, food: [...appetizerEvent.food, "1 × Unmapped Buffet"] }, { ...event, food: ["17 × The Front Nine + Appetizer Bar", "17 × Wing Bar"] }]) {
      const html = render([unmatched]);
      expect(html).toContain("This menu needs a setup template");
      expect(html).toContain("Taco Bar reference library · Not applied to this event");
      expect(html).toContain("Appetizer Bar, wings &amp; dessert reference library · Not applied to this event");
      expect(html).toContain("Appetizer Bar &amp; Wing Bar reference library · Not applied to this event");
      expect(html).not.toContain('aria-label="Appetizer Bar, wings &amp; dessert station guide"');
      expect(html).not.toContain("<details open");
    }
  });
  it.each(basicBarEvents)("uses the one-chafer reference for $name without changing purchased or prepared amounts", (plan) => {
    const before = structuredClone(plan);
    const setup = contractSetup(plan);
    const html = render([plan]);
    expect(html).toContain('src="/setup/appetizer-wing-bar-reference-v1.png"');
    expect(html).not.toContain('src="/setup/taco-bar-reference-v1.png"');
    expect(html).not.toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(html).toContain('aria-label="Appetizer Bar &amp; Wing Bar station guide"');
    expect(html).toContain("The reference depicts one central chafer");
    expect(html).not.toContain('aria-label="Contract setup requirements"');
    expect(html).not.toContain('aria-label="Layout draft limitations"');
    const prep = html.split('aria-label="Purchased food and prep quantities"')[1].split("</section>")[0];
    for (const food of setup.purchasedFood) expect(prep).toContain(food);
    for (const food of setup.food) {
      expect(prep).toContain(food.quantity === null ? "Needs review" : `${food.quantity} ${food.unit}`);
      if (food.pans !== null) expect(prep).toContain(`${food.pans}${food.panSize ? ` × ${food.panSize} pans` : " pans"}`);
    }
    expect(html).toContain("physical fit is not approved");
    expect(plan).toEqual(before);
  });
  it("keeps the one-chafer guide to three stations and prints each station’s exact tools", () => {
    const html = renderToStaticMarkup(createElement(StationGuide, { stations: APPETIZER_WING_BAR_SETUP_TEMPLATE.stations, templateId: "appetizer-wing-bar" }));
    expect(html.match(/aria-controls="setup-station-details"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("grid-template-rows:repeat(2, minmax(0, 1fr))");
    expect(html).toContain("Left long black plate: 3 tongs");
    expect(html).toContain("Right long black plate: 3 tongs");
    expect(html).toContain("3 sauce containers");
    expect(html).toContain("3 spoons");
    expect(html).toContain("96 × 36 in");
    expect(html).toContain("Each cart: 21.5 × 15.5 in");
    expect(html).not.toContain("Second chafing dish");
    expect(html).not.toContain("Raised dessert platter");
    expect(html).not.toContain("Tortilla warmers");
  });
  it("keeps extra platters unplaced and mirrored food quantities unchanged for the basic reference", () => {
    const plan = { ...basicBarEvents[0], guest_count: 101, food: [...basicBarEvents[0].food, "2 × Wing Platter", "2 × Desert Platter"] };
    const html = render([plan]);
    expect(html).toContain('src="/setup/appetizer-wing-bar-reference-v1.png"');
    expect(html).toContain("Additional food · Placement needs review");
    expect(html).toContain("These items have not been assigned a reference position");
    expect(html).toContain("do not double the purchased food quantities");
    expect(html).toContain("2 × Wing Platter");
    expect(html).toContain("2 × Desert Platter");
    expect(html).not.toContain("4 × Wing Platter");
  });
  it("does not invent a buffet layout for events with no food", () => {
    const html = render([{ ...event, food: [] }]);
    expect(html).toContain("No buffet layout has been applied");
    expect(html).not.toContain('aria-label="Taco Bar station guide"');
    expect(html).not.toContain("Food-service standard");
  });
  it("retains source warnings and no-quantity review labels", () => {
    const html = render([{ ...event, guest_count: 0, rooms: [], source_updated_at: null, food: ["Taco Bar", "Chicken Tender Platter"] }], "Source is temporarily unavailable.");
    expect(html).toContain('role="alert">Source is temporarily unavailable.');
    expect(html).toContain("Guest count needs review");
    expect(html).toContain("Area needs review");
    expect(html).toContain("Source update time unavailable");
    expect(html).toContain('aria-label="Setup review items"');
    expect(html).toContain("Chicken Tender Platter is missing its required platter quantity.");
  });
  it("does not publish or choose a party before navigation context is ready", () => {
    context.ready = false;
    expect(render()).toContain("Loading the selected event");
    expect(context.bridge).not.toHaveBeenCalled();
  });
});
