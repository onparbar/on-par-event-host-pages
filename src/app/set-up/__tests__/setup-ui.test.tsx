import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import SetupClient from "../SetupClient";
import { contractSetup } from "@/lib/operations/setup";

const context = vi.hoisted(() => ({ ready: true, requestedEventId: null as string | null, preferredEventId: null as string | null, selectEvent: vi.fn(), clearEvent: vi.fn(), bridge: vi.fn() }));
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
beforeEach(() => { context.ready = true; context.requestedEventId = null; context.preferredEventId = null; vi.clearAllMocks(); });

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
    context.requestedEventId = "missing-event";
    const html = render([event], "", "2026-12-18");
    expect(html).toContain('value="2026-12-18"');
    expect(html).toContain("The selected event is unavailable");
    expect(html).not.toContain("Purchased food &amp; prep quantities");
    expect(context.bridge).not.toHaveBeenCalled();
  });
  it("keeps the selected date and party when opened through an event workspace link", () => {
    context.requestedEventId = String(appetizerEvent.id);
    const html = render([appetizerEvent], "", appetizerEvent.date);
    expect(html).toContain('type="date" required="" name="date" value="2026-11-04"');
    expect(context.bridge).toHaveBeenCalledOnce();
  });
  it("shows the current day's first party without replacing a remembered workspace selection", () => {
    context.preferredEventId = String(appetizerEvent.id);
    const html = render();
    expect(html).toContain(event.name);
    expect(html).not.toContain("The selected event is unavailable");
    expect(context.bridge).not.toHaveBeenCalled();
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
  it("shows the whole-table mockup and exact existing prep quantities without applying the image count", () => {
    const html = render();
    expect(html).not.toContain('aria-label="Layout draft limitations"');
    expect(html).not.toContain("Furniture dimensions confirmed · Equipment placement is a draft");
    expect(html).toContain('src="/setup/empty-buffet-table-v1.png"');
    expect(html).not.toContain("staff-photo-v1.webp");
    expect(html).not.toMatch(/<img\b[^>]*\bsrc="\/setup\/(?:taco-bar|appetizer-wings-dessert|appetizer-wing-bar)-reference-v1\.png"/);
    expect(html).toContain("data-equipment-sprite");
    expect(html).toContain('aria-label="Event serving layout"');
    expect(html).not.toContain("Food needing setup review");
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
    expect(html).toContain("21.5 × 15.5 in");
    expect(html).toContain("21.5 × 31 in");
    expect(html).toContain("two marble serving carts per serving line, side by side");
  });
  it("shows mirrored equipment as a draft without doubling purchased food", () => {
    const html = render([{ ...event, guest_count: 101 }]);
    expect(html).toContain("Two food tables are indicated by the current guest-count rule");
    expect(html).toContain("do not double the purchased food quantities");
    expect(html).toContain("Listed once · quantities unchanged");
  });
  it("generates taco contents, contracted stands and event-wide plates instead of picture-derived quantities", () => {
    const html = render([{ ...event, guest_count: 25, food: ["15 × The Full Course + Taco Bar"] }]);
    const serving = html.split('aria-label="Event serving layout"')[1].split("</section>")[0];
    expect(serving).toContain("50 plates · event total");
    expect(serving).toContain("30 taco stands · event total");
    expect(serving).toContain('data-serving-object="taco-chafer"');
    expect(serving).toContain("Black Beans · Chicken · Beef");
    expect(serving).toContain("Contents: Lettuce; Cheese");
    expect(serving).toContain("Contents: Onion; Tomato");
    expect(serving).toContain("Contents: Salsa; Sour Cream");
    expect(serving).toContain('src="/setup/empty-buffet-table-v1.png"');
    expect(serving).toContain('value="taco-stands"');
    expect(serving).toContain('method="dialog"');
    expect(serving).not.toContain("<dialog open");
  });
  it("builds platter-only service with the required model targets and item picker", () => {
    const html = render([{ ...event, food: ["3 × Wing Platter", "2 × Chicken Tender Platter", "1 × Veggie Tray", "1 × Dessert Platter"] }]);
    const serving = html.split('aria-label="Event serving layout"')[1].split("</section>")[0];
    expect(serving).toContain('value="platter-chafer-1"');
    expect(serving).toContain('value="platter-chafer-2"');
    expect(serving).toContain('data-serving-object="platter-chafer-1"');
    expect(serving).toContain('data-serving-object="platter-chafer-2"');
    expect(serving).toContain('value="platter-chafer-1-pan-3"');
    expect(serving).toContain("1/3 pan");
    expect(serving).toContain("1/2 pan");
    expect(serving).toContain('value="cold-platter-dessert"');
    expect(serving).toContain('value="cold-platter-veggie"');
    expect(html).not.toContain("Food needing setup review");
    expect(html).not.toContain("Reference examples — not this event’s quantities");
    expect(serving).not.toContain('data-serving-object="taco-chafer"');
    expect(serving).not.toContain('data-serving-object="taco-tier"');
  });
  it("does not substitute an available event when an explicit event is missing", () => {
    context.requestedEventId = "999";
    const html = render();
    expect(html).toContain("The selected event is unavailable");
    expect(html).toContain("No different party has been substituted");
    expect(html).not.toContain(event.name);
    expect(context.bridge).not.toHaveBeenCalled();
  });
  it("retains the exact VIP source identity instead of using a different numeric party", () => {
    context.requestedEventId = "vip-sample-a";
    const vip = { ...event, id: 808, source_event_id: "vip-sample-a", name: "Redacted VIP event" };
    const html = render([event, vip]);
    expect(html).toContain('value="vip-sample-a" selected=""');
    expect(context.bridge).toHaveBeenCalledWith({ event: expect.objectContaining({ eventId: "vip-sample-a", eventName: vip.name, date: event.date }) });
    expect(html).toContain("Event source: vip-sample-a");
    expect(html).toContain("Nov 3, 2026, 10:00 AM Eastern");
  });
  it("flags unsupported food without adding unrelated reference examples", () => {
    const html = render([{ ...event, food: ["1 × Unmapped Buffet"] }]);
    expect(html).toContain("Food needing setup review");
    expect(html).not.toContain("reference library");
    expect(html).not.toMatch(/<img\b[^>]*\bsrc="\/setup\/(?:taco-bar|appetizer-wings-dessert|appetizer-wing-bar)-reference-v1\.png"/);
  });
  it("retains review for an unknown item alongside a known menu instead of using the mockup as a menu source", () => {
    const html = render([{ ...appetizerEvent, food: [...appetizerEvent.food, "1 × Unmapped Buffet"] }]);
    expect(html).toContain("Food needing setup review");
    expect(html).toContain("1 × Unmapped Buffet");
    expect(html).not.toContain("reference library");
  });
  it("prints only the selected event’s food and tools", () => {
    const html = render([{ ...event, food: ["2 × Wing Platter"] }]);
    const printed = html.split(">Build the serving line</h3>")[1].split("</div>")[0];
    expect(printed).toContain("Contents: Wings");
    expect(printed).toContain("1/2 serving pan");
    expect(printed).toContain("Left long black plate: 2 tongs");
    expect(printed).toContain("Right long black plate: 2 tongs");
    expect(printed).toContain("2 BBQ containers with 2 spoons");
    expect(printed).toContain("2 Ranch containers with 2 spoons");
    expect(printed).not.toContain("Black Beans");
    expect(printed).not.toContain("Taco stands");
    expect(printed).not.toContain("Tortilla warmers");
  });
  it("builds the event’s Appetizer Bar layout and preserves all purchased food and deterministic prep quantities", () => {
    const before = structuredClone(appetizerEvent);
    const setup = contractSetup(appetizerEvent);
    const html = render([appetizerEvent]);
    expect(html).toContain('aria-label="Event serving layout"');
    expect(html).toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(setup.servingSetup).toBeNull();
    const prep = html.split('aria-label="Purchased food and prep quantities"')[1].split("</section>")[0];
    for (const food of setup.purchasedFood) expect(prep).toContain(food);
    for (const food of setup.food) {
      expect(prep).toContain(food.quantity === null ? "Needs review" : `${food.quantity} ${food.unit}`);
      if (food.pans !== null) expect(prep).toContain(`${food.pans}${food.panSize ? ` × ${food.panSize} pans` : " pans"}`);
    }
    expect(html).toContain("all purchased food and kitchen prep quantities remain unchanged");
    expect(html).toContain("Food-service standard: use two marble serving carts");
    expect(html).not.toContain("Additional food · Placement needs review");
    expect(appetizerEvent).toEqual(before);
  });
  it.each(basicBarEvents)("builds the whole-table mockup for $name without changing purchased or prepared amounts", (plan) => {
    const before = structuredClone(plan);
    const setup = contractSetup(plan);
    const html = render([plan]);
    expect(html).toContain('src="/setup/empty-buffet-table-v1.png"');
    expect(html).toContain('aria-label="Event serving layout"');
    expect(html).toContain(`data-serving-object="${plan.id === 82 ? "wing-chafer" : "appetizer-chafer"}"`);
    expect(html).not.toContain('data-serving-object="taco-chafer"');
    expect(html).not.toContain("Reference examples — not this event’s quantities");
    expect(html).not.toContain('aria-label="Contract setup requirements"');
    expect(html).not.toContain('aria-label="Layout draft limitations"');
    const prep = html.split('aria-label="Purchased food and prep quantities"')[1].split("</section>")[0];
    for (const food of setup.purchasedFood) expect(prep).toContain(food);
    for (const food of setup.food) {
      expect(prep).toContain(food.quantity === null ? "Needs review" : `${food.quantity} ${food.unit}`);
      if (food.pans !== null) expect(prep).toContain(`${food.pans}${food.panSize ? ` × ${food.panSize} pans` : " pans"}`);
    }
    expect(plan).toEqual(before);
  });
  it("keeps the whole serving layout visible across continuation views without changing the purchased quantities", () => {
    const html = render([{ ...event, food: ["10 × Wing Platter"] }]);
    expect(html).toContain('aria-label="Whole table mockup"');
    expect(html).toContain('aria-label="Whole table mockup 2"');
    expect(html).toContain("Layout continuation 2");
    expect(html).toContain('data-serving-object="platter-chafer-5"');
    expect(html).toContain('value="platter-chafer-5"');
    expect(html).toContain("10 × Wing Platter");
    expect(html).toContain("these views do not change the event’s food-table reservation or purchased quantities");
    expect(html).not.toContain("20 × Wing Platter");
  });
  it("places extra platters without doubling purchased quantities for mirrored service", () => {
    const plan = { ...basicBarEvents[0], guest_count: 101, food: [...basicBarEvents[0].food, "2 × Wing Platter", "2 × Desert Platter"] };
    const html = render([plan]);
    expect(html).toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(html).toContain('aria-label="Event serving layout"');
    expect(html).not.toContain("Food needing setup review");
    expect(html).toContain("do not double the purchased food quantities");
    expect(html).toContain("2 × Wing Platter");
    expect(html).toContain("2 × Desert Platter");
    expect(html).not.toContain("4 × Wing Platter");
  });
  it("keeps the selected two-chafer event on one serving line with one sauce and one dessert station", () => {
    context.requestedEventId = String(appetizerEvent.id);
    const html = render([appetizerEvent], "", appetizerEvent.date);
    const serving = html.split('aria-label="Event serving layout"')[1].split("</section>")[0];
    const figure = serving.match(/<figure\b[\s\S]*?<\/figure>/)?.[0] ?? "";
    expect(serving.match(/<figure\b/g)).toHaveLength(1);
    expect(figure).toContain('src="/setup/appetizer-wings-dessert-reference-v1.png"');
    expect(figure.match(/data-serving-object="sauce-station"/g)).toHaveLength(1);
    expect(figure.match(/data-serving-object="cold-platter-dessert"/g)).toHaveLength(1);
    expect(figure).toContain('data-serving-object="sauce-marinara"');
    expect(figure).toContain('data-serving-object="sauce-ranch"');
    expect(figure).toContain('data-serving-object="sauce-bbq"');
    expect(figure).toContain('data-serving-object="dessert-tongs"');
    expect(serving).not.toContain("Layout continuation");
    expect(serving).not.toContain("Tortilla warmers");
    expect(serving).not.toContain("Black Beans");
    expect(serving).toContain("one long black sauce plate with 3 spoons — one per sauce type");
    expect(serving).toContain("one dessert platter on a clear riser with two tongs");
    expect(serving).toContain("hold extra prepared food for refills");
    expect(html).toContain("2 × Desert Platter");
    expect(html).toContain("2 × Wing Platter");
    expect(context.bridge).toHaveBeenCalledWith({ event: expect.objectContaining({ eventId: String(appetizerEvent.id), eventName: appetizerEvent.name }) });
  });
  it("does not invent a buffet layout for events with no food", () => {
    const html = render([{ ...event, food: [] }]);
    expect(html).toContain("No buffet layout has been applied");
    expect(html).not.toContain('aria-label="Event serving layout"');
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
