import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { operationalEventHref } from "@/lib/operations/event-context";
import { buildOperationalEventSummaries } from "@/lib/operations/command-center";
import type { EventPlan } from "@/lib/event-plans/types";

const mocks = vi.hoisted(() => ({
  pathname: "/checklists",
  staffName: "Carlos",
  requestedDate: "2026-10-23",
  requestedEventId: "123" as string | null,
  event: { eventId: "123", eventName: "Staff training", date: "2026-10-23", area: "VIP 1", time: "2:00 PM – 4:00 PM", guestCount: 20 },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../EventContext", () => ({
  useEventContext: () => ({ selectedEvent: mocks.event, requestedEventId: mocks.requestedEventId, preferredEventId: "123", requestedDate: mocks.requestedDate, ready: true, staffName: mocks.staffName, setStaffName: vi.fn(), openStaffEvent: vi.fn(), switchEvent: vi.fn(), clearEvent: vi.fn(), eventHref: (path: string) => operationalEventHref(path, mocks.event) }),
  EventSelectionBridge: () => null,
}));
vi.mock("../EventWorkspace", () => ({ EventWorkspaceReminders: () => createElement("section", { "aria-label": "Event reminders" }, "Reminders") }));

import { PortalHeader, PortalShell } from "../PortalShell";
import { EventCommandCenter } from "../EventCommandCenter";

const plan: EventPlan = { id: 123, name: "Staff training", date: "2026-10-23", rooms: ["VIP 1"], time: "2:00 PM – 4:00 PM", day: "Friday", guest_count: 20, color: "#18332F", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };

describe("staff event workspace shell", () => {
  beforeEach(() => { mocks.pathname = "/checklists"; mocks.staffName = "Carlos"; mocks.requestedDate = "2026-10-23"; mocks.requestedEventId = "123"; });
  it("renders the five left navigation tabs in order with the same event identity", () => {
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Checklists", sectionSubtitle: "Event workspace", children: createElement("p", null, "Checklist tasks") }));
    expect(html).toContain("staff-event-workspace");
    const navigation = html.match(/<nav aria-label="My event workspace"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect([...navigation.matchAll(/>(Checklists|Floor Plans|Entertainment|Add-ons &amp; Refills|Itineraries)<\/a>/g)].map((match) => match[1])).toEqual(["Checklists", "Floor Plans", "Entertainment", "Add-ons &amp; Refills", "Itineraries"]);
    expect(navigation.match(/eventId=123/g)).toHaveLength(5);
    expect(navigation.match(/date=2026-10-23/g)).toHaveLength(5);
    expect(navigation).not.toContain("vip-check-in");
    expect(html).toContain('aria-label="Event reminders"');
    expect(html).toContain("All operations");
  });
  it("keeps the event name, full time range, guests, area, and employee in the header", () => {
    const html = renderToStaticMarkup(createElement(PortalHeader, { sectionTitle: "Checklists", sectionSubtitle: "Event workspace" }));
    for (const text of ["Staff training", "2:00 PM – 4:00 PM", "20 guests", "VIP 1", "Employee: Carlos", "Change Staff", "Switch Event"]) expect(html).toContain(text);
  });
  it("opens the main Floor Plans tab with only the date while keeping the selected-event sidebar link exact", () => {
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Checklists", sectionSubtitle: "Event workspace", children: "Tasks" }));
    const global = html.match(/<nav aria-label="Portal navigation"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const workspace = html.match(/<nav aria-label="My event workspace"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(global).toContain('href="/floor-plans?date=2026-10-23"');
    expect(global).not.toContain('/floor-plans?date=2026-10-23&amp;eventId=123');
    expect(workspace).toContain('href="/floor-plans?date=2026-10-23&amp;eventId=123"');
  });
  it("does not wrap the all-party floor plan in a remembered event's workspace", () => {
    mocks.pathname = "/floor-plans";
    mocks.requestedEventId = null;
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Floor Plans", sectionSubtitle: "Operations", children: "All parties" }));
    expect(html).not.toContain("staff-event-workspace");
    expect(html).not.toContain('aria-label="Selected event workspace"');
    expect(html).not.toContain('aria-label="My event workspace"');
    expect(html).not.toContain('aria-label="Event reminders"');
    expect(html).toContain("All parties");
  });
  it("retains the workspace when Floor Plans is opened from a selected event's checklist", () => {
    mocks.pathname = "/floor-plans";
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Floor Plan", sectionSubtitle: "Event workspace", children: "Selected party only" }));
    expect(html).toContain("staff-event-workspace");
    expect(html).toContain('aria-label="Selected event workspace"');
    expect(html).toContain('aria-label="My event workspace"');
  });
  it("allows name selection on a direct event link without asking for a code", () => {
    mocks.staffName = "";
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Checklists", sectionSubtitle: "Event workspace", children: "Tasks" }));
    expect(html).toContain('id="workspace-employee"');
    expect(html).toContain("Select your name");
    expect(html).not.toContain('aria-label="My event workspace"');
    expect(html).not.toContain('type="password"');
  });
  it("leaves management and the kitchen outside the focused staff sidebar", () => {
    mocks.pathname = "/kitchen";
    const html = renderToStaticMarkup(createElement(PortalShell, { sectionTitle: "Kitchen", sectionSubtitle: "Operations", children: "Prep sheets" }));
    expect(html).not.toContain('aria-label="My event workspace"');
    expect(html).toContain("VIP CHECK-IN");
    expect(html).toContain("Admin");
  });
  it("shows only the selected date's cards, known staff, and an Open Event action", () => {
    mocks.pathname = "/";
    const events = buildOperationalEventSummaries([plan, { ...plan, id: 124, date: "2026-10-24", name: "Tomorrow's party" }], [], null);
    const html = renderToStaticMarkup(createElement(EventCommandCenter, { events, initialNow: "2026-10-24T02:00:00Z", assignedStaffByEvent: { "2026-10-23:123": "Tina" } }));
    expect(html).toContain('value="2026-10-23"');
    expect(html).toContain('aria-label="Previous day"');
    expect(html).toContain('aria-label="Next day"');
    expect(html).toContain('type="search"');
    expect(html).toContain("Open Event");
    expect(html).toContain("Tina");
    expect(html).not.toContain("Tomorrow&#x27;s party");
    expect(html).not.toContain("/vip-check-in");
  });
});
