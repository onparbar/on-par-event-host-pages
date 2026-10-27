import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventFoodDelivery } from "@/lib/gotab/delivery";

vi.mock("next/navigation", () => ({ usePathname: () => "/event-host-addons" }));

import { FoodRequestsDisclosure } from "../EventWorkspace";

function delivery(status: string, error: string | null = null): EventFoodDelivery {
  return { requestId: status, eventId: "sample-event", sourceKey: "sample", foodName: "Tater Kegs", quantity: 1, panSize: "HALF_PAN", status, orderReference: null, acceptedAt: null, updatedAt: "2026-10-23T14:00:00Z", error };
}

function render(deliveries: EventFoodDelivery[] | null, error = "") {
  return renderToStaticMarkup(createElement(FoodRequestsDisclosure, { foodCount: 3, deliveries, error, children: createElement("div", null, "Included food, saved requests and fulfillment controls") }));
}

describe("contract food and saved request disclosure", () => {
  it("starts collapsed with a native keyboard-operable summary and keeps all contents", () => {
    const html = render([delivery("SENT")]);
    expect(html).toContain('<details class="event-workspace-panel workspace-food-disclosure"');
    expect(html).not.toContain(" open");
    const summary = html.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain("Contract food — already included");
    expect(summary).toContain("3 contract food items · 1 saved request");
    expect(html).toContain("Included food, saved requests and fulfillment controls");
    expect(summary).not.toContain("need attention");
  });

  it("keeps pending, failed and uncertain delivery counts visible while collapsed", () => {
    const html = render([delivery("SENT"), delivery("QUEUED"), delivery("SENDING"), delivery("FAILED"), delivery("HELD"), delivery("UNKNOWN"), delivery("CANCELLED")]);
    const summary = html.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain('role="status">2 pending');
    expect(summary).toContain('role="status">3 need attention');
    expect(summary).toContain("7 saved requests");
  });

  it("shows history errors in the summary and does not imply unloaded requests were sent", () => {
    const summary = render(null, "Unable to load history").match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(summary).toContain("Loading saved requests…");
    expect(summary).toContain('role="alert">Request history unavailable');
    expect(summary).not.toContain("0 saved requests");
  });

  it("keeps the disclosure contents printable with black-and-white status badges", () => {
    const css = readFileSync(new URL("../../workspace.css", import.meta.url), "utf8");
    expect(css).toContain(".workspace-food-disclosure::details-content { content-visibility: visible; }");
    expect(css).toContain(".workspace-food-disclosure > .workspace-food-disclosure-content { display: block !important; }");
    expect(css).toContain(".workspace-food-disclosure-badge { color: black; background: white; border-color: black; }");
  });
});
