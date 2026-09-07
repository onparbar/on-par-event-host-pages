import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PortalZoomControls } from "@/app/_components/PortalShell";
import type { EntertainmentReservation } from "@/lib/entertainment/types";
import type { DateAsset } from "@/lib/events";
import {
  AwaitingApprovalSection,
  buildUpcomingFloorPlanEntries,
  FloorPlanCard,
  PendingFloorPlanCard,
  PublishedFloorPlanCard,
  organizeFloorPlanAssets,
  syncFloorPlanFromTripleseat,
  syncFloorPlanWindowFromTripleseat,
} from "../FloorPlansClient";
import PublishedFloorPlanMap from "../PublishedFloorPlanMap";
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

function sharedVipReservation(
  id: string,
  event: FloorPlanDocument["events"][number],
): EntertainmentReservation {
  return {
    id,
    syncKey: null,
    localEventId: event.id,
    tripleseatEventId: event.tripleseatEventId,
    tripleseatBookingId: null,
    eventName: event.name,
    operatingDate: "2026-08-15",
    resourceId: "private-room-vip-1",
    resourceCategory: "private-rooms",
    resourceName: "VIP 1",
    startAt: event.startAt!,
    endAt: event.endAt!,
    sourceStartAt: event.startAt,
    sourceEndAt: event.endAt,
    sourceResourceId: "private-room-vip-1",
    eventColor: event.color,
    colorSource: "floor-plan-assignment",
    source: event.tripleseatEventId.startsWith("vip-") ? "vip-prep" : "tripleseat",
    sourceReference: null,
    manualOverride: false,
    hasSourceUpdate: false,
    needsReview: false,
    reviewIssues: [],
    autoAssigned: false,
    notes: "",
    sourceUpdatedAt: null,
    lastTripleseatSyncAt: null,
    active: true,
    createdAt: event.startAt!,
    updatedAt: event.startAt!,
    updatedBy: "test",
  };
}

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

  it("applies floor-plan zoom without exposing editing controls", () => {
    const plan = organizeFloorPlanAssets(
      [nextPlan],
      [],
      "2026-08-04",
    ).upcoming[0];
    const staticHtml = renderToStaticMarkup(
      createElement(FloorPlanCard, {
        asset: plan,
        isOpen: true,
        onOpenChange: () => {},
        onSync: () => {},
        overlays: [],
        zoom: 70,
      }),
    );
    const interactiveHtml = renderToStaticMarkup(
      createElement(PublishedFloorPlanCard, {
        publication: { plan: interactivePlan, payload: interactivePayload },
        isOpen: true,
        onOpenChange: () => {},
        onSync: () => {},
        zoom: 70,
      }),
    );

    expect(staticHtml).toContain(
      'class="floor-plan-zoom-stage" style="width:70%"',
    );
    expect(interactiveHtml).toContain(
      'class="floor-plan-map-canvas" style="min-width:686px;width:70%"',
    );
    expect(staticHtml).not.toContain("Add Highlight");
    expect(interactiveHtml).not.toContain("Add Highlight");
  });

  it("renders accessible zoom controls with a reset value", () => {
    const html = renderToStaticMarkup(
      createElement(PortalZoomControls, {
        label: "Floor plan zoom",
        maximum: 200,
        minimum: 50,
        onChange: () => {},
        resetValue: 100,
        step: 10,
        value: 80,
      }),
    );

    expect(html).toContain('aria-label="Floor plan zoom"');
    expect(html).toContain('aria-label="Floor plan zoom: zoom out"');
    expect(html).toContain("80%");
    expect(html).toContain('aria-label="Floor plan zoom: zoom in"');
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

  it("discovers new floor-plan dates through the rolling Tripleseat sync", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          eventCount: 3,
          floorPlans: {
            startDate: "2026-08-14",
            endDate: "2026-08-28",
            results: [
              {
                status: "generated",
                eventCount: 1,
                date: "2026-08-21",
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await syncFloorPlanWindowFromTripleseat(
      fetchImpl as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith("/api/event-plans/sync", {
      method: "POST",
    });
    expect(result.floorPlans.results).toContainEqual(
      expect.objectContaining({
        date: "2026-08-21",
        status: "generated",
        eventCount: 1,
      }),
    );
  });

  it("surfaces a rolling Tripleseat sync error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: "Tripleseat connection needs attention." }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      syncFloorPlanWindowFromTripleseat(fetchImpl as typeof fetch),
    ).rejects.toThrow("Tripleseat connection needs attention.");
  });

  it("shows live Tripleseat sync on saved and approved floor plans", () => {
    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanCard, {
        publication: { plan: interactivePlan, payload: interactivePayload },
        isOpen: true,
        onOpenChange: () => {},
        onSync: () => {},
      }),
    );

    expect(html).toContain("Sync live from Tripleseat");
    expect(html).toContain("Approved Event Host floor plan");
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
        onSync: () => {},
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
        onSync: () => {},
      }),
    );

    expect(html).toContain("Approved");
    expect(html).toContain("Redacted August 5 Event");
    expect(html).toContain("VIP 1 assigned to Redacted August 5 Event");
  });

  it("renders ADF as the orange VIP 1 fill and Cassie's 9–11 PM reservation as the blue border", () => {
    const adfEvent = {
      ...interactivePlan.events[0],
      id: "event-adf",
      tripleseatEventId: "adf",
      name: "ADF",
      startAt: "2026-08-15T17:00:00.000Z",
      endAt: "2026-08-15T19:00:00.000Z",
      color: "#B45309",
    };
    const cassieEvent = {
      ...interactivePlan.events[0],
      id: "event-cassie",
      tripleseatEventId: "vip-cassie",
      name: "Cassie Perks VIP",
      startAt: "2026-08-16T01:00:00.000Z",
      endAt: "2026-08-16T03:00:00.000Z",
      color: "#1D4ED8",
    };
    const plan: FloorPlanDocument = {
      ...interactivePlan,
      id: "floor-plan-2026-08-15",
      eventDate: "2026-08-15",
      events: [adfEvent, cassieEvent],
      reservations: [
        {
          ...interactivePlan.reservations[0],
          id: "cassie-vip-1",
          floorPlanEventId: cassieEvent.id,
          startAt: cassieEvent.startAt,
          endAt: cassieEvent.endAt,
        },
        {
          ...interactivePlan.reservations[0],
          id: "adf-vip-1",
          floorPlanEventId: adfEvent.id,
          startAt: adfEvent.startAt,
          endAt: adfEvent.endAt,
        },
      ],
    };
    const payload: FloorPlanDayPayload = {
      ...interactivePayload,
      date: plan.eventDate,
      plan,
      entertainmentReservations: [
        sharedVipReservation("cassie-shared-vip-1", cassieEvent),
        sharedVipReservation("adf-shared-vip-1", adfEvent),
      ],
    };

    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanMap, { payload }),
    );

    expect(html).toMatch(
      /aria-label="VIP 1 assigned to ADF"[^>]+--event-color:#B45309/,
    );
    expect(html).toMatch(
      /aria-label="VIP 1 also reserved by Cassie Perks VIP, 9:00 PM – 11:00 PM"[^>]+--event-color:#1D4ED8/,
    );
    expect(html).toContain(">9:00 PM – 11:00 PM</small>");
  });
});
