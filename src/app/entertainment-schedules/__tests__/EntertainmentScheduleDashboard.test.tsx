import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EntertainmentDayPayload } from "@/lib/entertainment/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/entertainment-schedules",
}));

import EntertainmentScheduleDashboard from "../EntertainmentScheduleDashboard";

const loadedPayload: EntertainmentDayPayload = {
  date: "2026-08-14",
  events: [],
  reservations: [],
  conflicts: [],
  sync: null,
  sourceMode: "mock",
  warnings: [],
  missingEnvironmentVariables: [],
  canEdit: true,
};

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

  it("uses the open right side for bordered, color-coded activity groups", () => {
    const html = renderToStaticMarkup(
      createElement(EntertainmentScheduleDashboard, {
        initialDate: "2026-08-14",
        initialPayload: loadedPayload,
      }),
    );

    const compactStart = html.indexOf('data-layout-region="compact"');
    expect(compactStart).toBeGreaterThan(0);

    const mainColumn = html.slice(0, compactStart);
    const compactColumn = html.slice(compactStart);
    expect(mainColumn).toContain('data-category="bowling"');
    expect(mainColumn).toContain('data-category="private-rooms"');
    expect(mainColumn).not.toContain('data-category="darts"');
    expect(compactColumn).toContain('data-category="darts"');
    expect(compactColumn).toContain('data-category="pool"');
    expect(compactColumn).toContain('data-category="shuffleboard"');
    expect(compactColumn).not.toContain('data-category="bowling"');
    expect(compactColumn).not.toContain('data-category="private-rooms"');

    expect(
      html.match(
        /class="entertainment-resource-row" data-resource-id="bowling-/g,
      ),
    ).toHaveLength(12);
    expect(
      html.match(
        /class="entertainment-resource-row" data-resource-id="darts-/g,
      ),
    ).toHaveLength(5);
    expect(
      html.match(
        /class="entertainment-resource-row" data-resource-id="pool-/g,
      ),
    ).toHaveLength(3);
    expect(
      html.match(
        /class="entertainment-resource-row" data-resource-id="shuffleboard-/g,
      ),
    ).toHaveLength(2);
    expect(
      html.match(
        /class="entertainment-resource-row" data-resource-id="private-room-/g,
      ),
    ).toHaveLength(8);

    for (const category of ["darts", "pool", "shuffleboard"]) {
      expect(html).toContain(
        `has-category-border category-${category}`,
      );
    }
  });
});
