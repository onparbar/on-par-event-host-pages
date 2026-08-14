import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/entertainment-schedules",
}));

import EntertainmentScheduleDashboard from "../EntertainmentScheduleDashboard";

describe("entertainment schedule dashboard controls", () => {
  it("starts locked with explicit Edit and Save controls", () => {
    const html = renderToStaticMarkup(
      createElement(EntertainmentScheduleDashboard, {
        initialDate: "2026-08-14",
      }),
    );

    expect(html).toContain("entertainment-schedule-card is-locked");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Edit</button>");
    expect(html).toContain(">Save</button>");
    expect(html).toContain('aria-label="Entertainment schedule zoom"');
    expect(html).toContain("80%");
  });

  it("uses a collapsed Tripleseat event dropdown and removes the filter strip", () => {
    const html = renderToStaticMarkup(
      createElement(EntertainmentScheduleDashboard, {
        initialDate: "2026-08-14",
      }),
    );

    expect(html).toContain(
      '<details class="entertainment-event-panel">',
    );
    expect(html).toContain("Tripleseat events");
    expect(html).not.toContain("Search event name");
    expect(html).not.toContain("All Resources");
    expect(html).not.toContain("Review Conflicts");
  });
});
