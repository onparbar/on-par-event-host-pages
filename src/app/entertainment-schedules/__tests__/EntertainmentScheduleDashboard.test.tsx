import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  EntertainmentDayPayload,
  EntertainmentReservation,
} from "@/lib/entertainment/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/entertainment-schedules",
}));

import EntertainmentScheduleDashboard, {
  calculateEntertainmentColumnSlotUnits,
  calculateEntertainmentFitRowHeight,
  calculateEntertainmentFitZoom,
} from "../EntertainmentScheduleDashboard";

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

function reservation(
  overrides: Partial<EntertainmentReservation> = {},
): EntertainmentReservation {
  return {
    id: "reservation-1",
    syncKey: null,
    localEventId: "77",
    tripleseatEventId: "77",
    tripleseatBookingId: null,
    eventName: "Current Event",
    operatingDate: "2026-08-14",
    resourceId: "bowling-1",
    resourceCategory: "bowling",
    resourceName: "Bowling Lane 1",
    startAt: "2026-08-14T16:00:00.000Z",
    endAt: "2026-08-14T18:00:00.000Z",
    sourceStartAt: null,
    sourceEndAt: null,
    sourceResourceId: null,
    eventColor: "#0F766E",
    colorSource: "manual",
    source: "manual",
    sourceReference: null,
    manualOverride: true,
    hasSourceUpdate: false,
    needsReview: false,
    reviewIssues: [],
    autoAssigned: false,
    notes: "",
    sourceUpdatedAt: null,
    lastTripleseatSyncAt: null,
    active: true,
    createdAt: "2026-08-14T12:00:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
    updatedBy: "test",
    ...overrides,
  };
}

describe("entertainment schedule kiosk fit", () => {
  it.each([
    [1912, 79],
    [1358, 50],
    [1341, 50],
    [1255, 45],
    [1180, 41],
    [1123, 38],
    [1024, 33],
    [960, 30],
    [900, 27],
    [892, 27],
    [4000, 120],
  ])("fits a %ipx schedule container at %i%%", (width, zoom) => {
    expect(calculateEntertainmentFitZoom(width)).toBe(zoom);
  });

  it.each([
    [580, 20, 10, 22],
    [448, 20, 10, 17],
    [448, 23, 10, 15],
    [300, 20, 10, 14],
    [4000, 20, 10, 22],
  ])(
    "fits resource rows inside %ipx with %i main and %i compact slots at %ipx",
    (height, mainSlots, compactSlots, rowHeight) => {
      expect(
        calculateEntertainmentFitRowHeight(
          height,
          mainSlots,
          compactSlots,
        ),
      ).toBe(rowHeight);
    },
  );

  it("counts overlapping reservations as extra vertical slots", () => {
    const reservations = [
      reservation(),
      reservation({
        id: "reservation-2",
        startAt: "2026-08-14T17:00:00.000Z",
        endAt: "2026-08-14T19:00:00.000Z",
      }),
    ];

    expect(
      calculateEntertainmentColumnSlotUnits(reservations, ["bowling"]),
    ).toBe(13);
    expect(
      calculateEntertainmentColumnSlotUnits(reservations, ["darts"]),
    ).toBe(5);
  });
});

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
    expect(html).toContain('class="entertainment-event-panel-body"');
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

  it("uses compact time labels without reservation icons", () => {
    const html = renderToStaticMarkup(
      createElement(EntertainmentScheduleDashboard, {
        initialDate: "2026-08-14",
        initialPayload: {
          ...loadedPayload,
          reservations: [reservation()],
        },
      }),
    );

    expect(html).toContain("12–2p");
    expect(html).not.toContain("entertainment-source-icon");
    expect(html).not.toContain("entertainment-conflict-icon");
  });
});
