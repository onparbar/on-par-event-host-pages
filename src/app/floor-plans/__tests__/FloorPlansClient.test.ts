import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DateAsset } from "@/lib/events";
import {
  AwaitingApprovalSection,
  buildUpcomingFloorPlanEntries,
  FloorPlanCard,
  PendingFloorPlanCard,
  PublishedFloorPlanCard,
  organizeFloorPlanAssets,
  syncFloorPlanFromTripleseat,
} from "../FloorPlansClient";
import type {
  FloorPlanDayPayload,
  FloorPlanDocument,
} from "@/lib/floor-plans/types";

const pastPlan: DateAsset = {
  date: "2026-08-03",
  label: "Monday, August 3, 2026",
  image: "/floor-plans/past.png",
  events: ["Past Event"],
};

const nextPlan: DateAsset = {
  date: "2026-08-06",
  label: "Thursday, August 6, 2026",
  image: "/floor-plans/next.png",
  events: ["Next Event"],
};

const laterPlan: DateAsset = {
  date: "2026-08-08",
  label: "Saturday, August 8, 2026",
  image: "/floor-plans/later.png",
  events: ["Later Event"],
};

const interactivePlan: FloorPlanDocument = {
  id: "floor-plan-2026-08-05",
  eventDate: "2026-08-05",
  status: "Approved",
  version: 4,
  ruleVersion: "floor-plan-v1.2.0",
  lastTripleseatSyncAt: "2026-08-04T16:00:00.000Z",
  createdAt: "2026-08-04T16:00:00.000Z",
  updatedAt: "2026-08-04T17:00:00.000Z",
  approvedAt: "2026-08-04T17:00:00.000Z",
  approvedBy: "authenticated-event-host-staff",
  events: [
    {
      id: "event-august-5",
      floorPlanId: "floor-plan-2026-08-05",
      tripleseatEventId: "redacted-august-5",
      name: "Redacted August 5 Event",
      status: "DEFINITE",
      guestCount: 24,
      startAt: "2026-08-05T15:30:00-04:00",
      endAt: "2026-08-05T17:30:00-04:00",
      contractedAreaIds: ["vip-1"],
      unresolvedAreaNames: [],
      color: "#297025",
      beoLastModifiedAt: null,
      fullBuyout: false,
      source: {
        rooms: ["VIP 1"],
        food: [],
        entertainment: [],
        operationalNotes: [],
        reviewReasons: [],
      },
    },
  ],
  reservations: [
    {
      id: "room-highlight",
      floorPlanEventId: "event-august-5",
      areaId: "vip-1",
      reservationType: "room",
      startAt: "2026-08-05T15:30:00-04:00",
      endAt: "2026-08-05T17:30:00-04:00",
      label: "VIP 1",
      source: "manual",
      lockedByUser: true,
    },
  ],
};

const interactivePayload: FloorPlanDayPayload = {
  date: interactivePlan.eventDate,
  plan: interactivePlan,
  entertainmentReservations: [],
  floorPlanConflicts: [],
  entertainmentConflicts: [],
  validation: [],
  revisions: [],
  persistence: "database",
  sourceMode: "live",
  warnings: [],
};

describe("floor-plan dashboard organization", () => {
  it("opens the nearest upcoming plan and archives past plans", () => {
    const result = organizeFloorPlanAssets(
      [laterPlan, pastPlan, nextPlan],
      [],
      "2026-08-04",
    );

    expect(result.upcoming.map((plan) => plan.image)).toEqual([
      nextPlan.image,
      laterPlan.image,
    ]);
    expect(result.archived.map((plan) => plan.image)).toEqual([
      pastPlan.image,
    ]);
    expect(result.defaultAssetKey).toBe(nextPlan.image);
  });

  it("keeps manually archived future plans in the archive", () => {
    const result = organizeFloorPlanAssets(
      [nextPlan, laterPlan],
      [],
      "2026-08-04",
      [nextPlan.image],
    );

    expect(result.upcoming.map((plan) => plan.image)).toEqual([
      laterPlan.image,
    ]);
    expect(result.archived.map((plan) => plan.image)).toEqual([
      nextPlan.image,
    ]);
  });

  it("renders each plan as a read-only dropdown without editing controls", () => {
    const plan = organizeFloorPlanAssets(
      [nextPlan],
      [],
      "2026-08-04",
    ).upcoming[0];
    const html = renderToStaticMarkup(
      createElement(FloorPlanCard, {
        asset: plan,
        isOpen: true,
        onOpenChange: () => {},
        onSync: () => {},
        overlays: [],
      }),
    );

    expect(html).toContain("<details open=\"\"");
    expect(html).toContain("Next Event");
    expect(html).toContain("Sync live from Tripleseat");
    for (const editorCopy of [
      "Add Highlight",
      "Add Cover",
      "Reset Edits",
      "Editor controls",
      "Highlight editing",
      "Tripleseat synchronization",
      "how to edit",
    ]) {
      expect(html).not.toContain(editorCopy);
    }
  });

  it("runs the real Tripleseat floor-plan refresh action for the selected date", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          date: nextPlan.date,
          plan: {
            eventDate: nextPlan.date,
            events: [],
            lastTripleseatSyncAt: "2026-08-04T16:00:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await syncFloorPlanFromTripleseat(
      nextPlan.date,
      fetchImpl as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith("/api/floor-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: nextPlan.date, action: "refresh" }),
    });
    expect(result.plan.lastTripleseatSyncAt).toBe(
      "2026-08-04T16:00:00.000Z",
    );
  });

  it("shows saved unapproved plans as awaiting Admin approval", () => {
    const html = renderToStaticMarkup(
      createElement(PendingFloorPlanCard, {
        plan: { ...interactivePlan, status: "Needs Review" },
      }),
    );

    expect(html).toContain("Redacted August 5 Event");
    expect(html).toContain("Needs Review");
    expect(html).toContain(
      "/admin/floor-plans?date=2026-08-05",
    );
    expect(html).toContain("Edit and approve");
  });

  it("keeps the approval queue collapsed until staff open it", () => {
    const html = renderToStaticMarkup(
      createElement(AwaitingApprovalSection, {
        plans: [
          { ...interactivePlan, status: "Needs Review" },
          {
            ...interactivePlan,
            id: "floor-plan-2026-08-06",
            eventDate: "2026-08-06",
            status: "Draft",
          },
        ],
      }),
    );

    expect(html).toContain(
      '<details class="floor-plan-archive floor-plan-awaiting-approval">',
    );
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("2 plans");
    expect(html).toContain("Edit and approve");
  });

  it("replaces the original floor-plan image as soon as edits are saved", () => {
    const staticPlan = organizeFloorPlanAssets(
      [{ ...nextPlan, date: interactivePlan.eventDate }],
      [],
      "2026-08-04",
    ).upcoming;
    const savedPlan = {
      plan: {
        ...interactivePlan,
        status: "Needs Review" as const,
        approvedAt: null,
        approvedBy: null,
      },
      payload: {
        ...interactivePayload,
        plan: {
          ...interactivePlan,
          status: "Needs Review" as const,
          approvedAt: null,
          approvedBy: null,
        },
      },
    };

    const result = buildUpcomingFloorPlanEntries(staticPlan, [savedPlan]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: interactivePlan.eventDate,
      kind: "saved",
    });
  });

  it("labels an unapproved replacement as saved edits", () => {
    const savedPlan = {
      ...interactivePlan,
      status: "Needs Review" as const,
      approvedAt: null,
      approvedBy: null,
    };
    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanCard, {
        publication: {
          plan: savedPlan,
          payload: { ...interactivePayload, plan: savedPlan },
        },
        isOpen: true,
        onOpenChange: () => {},
      }),
    );

    expect(html).toContain("Saved edits");
    expect(html).toContain("Saved Event Host floor plan");
  });

  it("renders the approved interactive highlights on the main page", () => {
    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanCard, {
        publication: {
          plan: interactivePlan,
          payload: interactivePayload,
        },
        isOpen: true,
        onOpenChange: () => {},
      }),
    );

    expect(html).toContain("Approved");
    expect(html).toContain("Redacted August 5 Event");
    expect(html).toContain("VIP 1 assigned to Redacted August 5 Event");
  });
});
