import { Children, createElement, isValidElement, type ReactNode } from "react";
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
  SelectedEventFloorPlan,
} from "../FloorPlansClient";
import PublishedFloorPlanMap, { PublishedFloorPlanMapView } from "../PublishedFloorPlanMap";
import FloorPlanEventLegend from "../FloorPlanEventLegend";
import { floorPlanEventView, floorPlanLocalReservationOutlines } from "@/lib/floor-plans/event-view";
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

describe("selected staff event floor plan", () => {
  it("does not substitute a static image, another date, or another party when no exact plan is assigned", () => {
    for (const props of [
      { payload: null, date: interactivePlan.eventDate, eventId: interactivePlan.events[0].tripleseatEventId },
      { payload: interactivePayload, date: "2026-08-06", eventId: interactivePlan.events[0].tripleseatEventId },
      { payload: interactivePayload, date: interactivePlan.eventDate, eventId: "not-this-party" },
      { payload: { ...interactivePayload, plan: { ...interactivePlan, reservations: [] } }, date: interactivePlan.eventDate, eventId: interactivePlan.events[0].tripleseatEventId },
    ]) {
      const html = renderToStaticMarkup(createElement(SelectedEventFloorPlan, props));
      expect(html).toContain("No floor plan assigned");
      expect(html).not.toContain("blank-floor-map.png");
      expect(html).not.toContain(interactivePlan.events[0].name);
    }
  });
  it("shows only the selected party's highlights and title, retaining zoom without event-switching controls", () => {
    const other = { ...interactivePlan.events[0], id: "other-event", tripleseatEventId: "other-source", name: "Other private party", contractedAreaIds: ["vip-2"] };
    const payload = { ...interactivePayload, plan: { ...interactivePlan, events: [...interactivePlan.events, other], reservations: [...interactivePlan.reservations, { ...interactivePlan.reservations[0], id: "other-highlight", floorPlanEventId: other.id, areaId: "vip-2" }] } };
    const html = renderToStaticMarkup(createElement(SelectedEventFloorPlan, { payload, date: interactivePlan.eventDate, eventId: interactivePlan.events[0].tripleseatEventId, zoom: 120 }));
    expect(html).toContain(interactivePlan.events[0].name);
    expect(html).toContain("width:120%");
    expect(html).toContain('aria-label="VIP 1 assigned to Redacted August 5 Event"');
    expect(html).not.toContain(other.name);
    expect(html).not.toContain("Show all events");
    expect(html).not.toContain("Show only");
  });
});

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
    expect(html).toContain(
      'href="/admin/floor-plans?date=2026-08-05"',
    );
    expect(html).toContain("Edit in Admin");
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

  it("highlights the entire map for a full facility buyout", () => {
    const buyoutEvent = {
      ...interactivePlan.events[0],
      fullBuyout: true,
      contractedAreaIds: ["facility"],
      name: "Redacted Full Buyout",
      color: "#B45309",
    };
    const buyoutPlan: FloorPlanDocument = {
      ...interactivePlan,
      events: [buyoutEvent],
      reservations: [],
    };
    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanMap, {
        payload: { ...interactivePayload, plan: buyoutPlan },
      }),
    );

    expect(html).toContain('class="floor-plan-full-buyout-overlay"');
    expect(html).toContain('aria-label="Full facility buyout: Redacted Full Buyout"');
    expect(html).toContain("--event-color:#B45309");
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

  it("renders one title and one color for a Tripleseat event joined to both OnPar VIP rooms", () => {
    const event = {
      ...interactivePlan.events[0],
      id: "event-no-host-social",
      tripleseatEventId: "vip-primary",
      name: "No Host Social VIP",
      guestCount: 60,
      startAt: "2026-09-14T18:00:00-04:00",
      endAt: "2026-09-14T22:00:00-04:00",
      contractedAreaIds: ["main-dining", "vip-1", "vip-2"],
      color: "#7C3AED",
      source: {
        ...interactivePlan.events[0].source,
        rooms: ["Main Dining Room", "VIP 1", "VIP 2"],
        sourceEventIds: ["60526047", "vip-primary", "vip-secondary"],
        onParBookingAreaIds: ["vip-1", "vip-2"],
      },
    };
    const plan: FloorPlanDocument = {
      ...interactivePlan,
      id: "floor-plan-2026-09-14",
      eventDate: "2026-09-14",
      events: [event],
      reservations: [
        {
          ...interactivePlan.reservations[0],
          id: "main-table",
          floorPlanEventId: event.id,
          areaId: "main-rect-left-1",
          reservationType: "seating",
        },
        {
          ...interactivePlan.reservations[0],
          id: "vip-1",
          floorPlanEventId: event.id,
          areaId: "vip-1",
        },
        {
          ...interactivePlan.reservations[0],
          id: "vip-2",
          floorPlanEventId: event.id,
          areaId: "vip-2",
        },
      ],
    };
    const vip1 = {
      ...sharedVipReservation("shared-vip-1", event),
      localEventId: null,
      tripleseatEventId: "vip-primary",
      eventColor: "#BE123C",
    };
    const vip2 = {
      ...vip1,
      id: "shared-vip-2",
      tripleseatEventId: "vip-secondary",
      resourceId: "private-room-vip-2",
      resourceName: "VIP 2",
      eventColor: "#1D4ED8",
    };
    const payload: FloorPlanDayPayload = {
      ...interactivePayload,
      date: plan.eventDate,
      plan,
      entertainmentReservations: [vip1, vip2],
    };

    const html = renderToStaticMarkup(
      createElement(PublishedFloorPlanMap, { payload }),
    );

    expect(html.match(/<b>No Host Social VIP \(60\)<\/b>/g)).toHaveLength(1);
    expect(html).toMatch(
      /aria-label="VIP 1 assigned to No Host Social VIP"[^>]+--event-color:#7C3AED/,
    );
    expect(html).toMatch(
      /aria-label="VIP 2 assigned to No Host Social VIP"[^>]+--event-color:#7C3AED/,
    );
    expect(html).not.toContain("also reserved by No Host Social VIP");
  });
});

describe("individual event floor-plan view", () => {
  const first = {
    ...interactivePlan.events[0],
    id: "event-first",
    tripleseatEventId: "source-first",
    name: "Earlier Party",
    startAt: "2026-08-05T13:00:00-04:00",
    endAt: "2026-08-05T15:00:00-04:00",
    color: "#B45309",
    fullBuyout: true,
  };
  const second = {
    ...interactivePlan.events[0],
    id: "event-second",
    tripleseatEventId: "source-second",
    name: "Later Party",
    color: "#1D4ED8",
    source: {
      ...interactivePlan.events[0].source,
      sourceEventIds: ["source-second", "vip-second"],
    },
  };
  const payload: FloorPlanDayPayload = {
    ...interactivePayload,
    plan: {
      ...interactivePlan,
      events: [first, second],
      reservations: [first, second].flatMap((event) => [
        {
          ...interactivePlan.reservations[0],
          id: `${event.id}:vip`,
          floorPlanEventId: event.id,
          startAt: event.startAt,
          endAt: event.endAt,
        },
        {
          ...interactivePlan.reservations[0],
          id: `${event.id}:custom`,
          floorPlanEventId: event.id,
          reservationType: "custom" as const,
          label: `${event.name} note`,
          customGeometry: { x: 1200, y: 500, width: 100, height: 40 },
        },
      ]),
    },
    entertainmentReservations: [
      sharedVipReservation("first-vip", first),
      sharedVipReservation("second-vip", second),
      {
        ...sharedVipReservation("second-vip-2", second),
        tripleseatEventId: "vip-second",
        localEventId: null,
        resourceId: "private-room-vip-2",
        resourceName: "VIP 2",
      },
    ],
    floorPlanConflicts: [{
      id: "day-conflict",
      areaId: "vip-1",
      eventIds: [first.id, second.id],
      eventNames: [first.name, second.name],
      startAt: second.startAt!,
      endAt: second.endAt!,
      blocking: true,
    }],
  };

  it("shows the complete day by default and never mutates saved assignments or conflicts", () => {
    const original = structuredClone(payload);
    const all = floorPlanEventView(payload.plan, payload.entertainmentReservations, null);
    const filtered = floorPlanEventView(payload.plan, payload.entertainmentReservations, second.id);
    const stale = floorPlanEventView(payload.plan, payload.entertainmentReservations, "deleted-event");

    expect(all.plan).toBe(payload.plan);
    expect(all.entertainmentReservations).toBe(payload.entertainmentReservations);
    expect(filtered.plan.events.map((event) => event.id)).toEqual([second.id]);
    expect(filtered.plan.reservations.map((reservation) => reservation.id)).toEqual([
      `${second.id}:vip`, `${second.id}:custom`,
    ]);
    expect(filtered.entertainmentReservations.map((reservation) => reservation.id)).toEqual([
      "second-vip", "second-vip-2",
    ]);
    expect(stale.plan).toBe(payload.plan);
    expect(stale.selectedEventId).toBeNull();
    expect(payload).toEqual(original);
  });

  it("isolates the later event's own color, times, source aliases, and custom highlights", () => {
    const html = renderToStaticMarkup(createElement(PublishedFloorPlanMapView, {
      payload,
      selectedEventId: second.id,
      onSelectEvent: () => {},
    }));

    expect(html).toMatch(/aria-label="VIP 1 assigned to Later Party"[^>]+background-color:#1D4ED880/);
    expect(html).toContain('aria-label="VIP 2 assigned to Later Party"');
    expect(html).toContain('aria-label="Custom highlight: Later Party note"');
    expect(html).toContain("3:30 PM – 5:30 PM</small>");
    expect(html).not.toContain('aria-label="VIP 1 assigned to Earlier Party"');
    expect(html).not.toContain('aria-label="Custom highlight: Earlier Party note"');
    expect(html).not.toContain('class="floor-plan-full-buyout-overlay"');
    expect(html).not.toContain("also reserved by Earlier Party");
    expect(html).not.toContain("background-color:#B4530980");
    expect(html).toContain("Full-day conflicts: 1");
    expect(html).toContain("Showing one event does not remove conflicts with other parties.");
    expect(html).toContain('aria-label="Show only Earlier Party on the floor plan"');
  });

  it("restores both parties, shared-resource outlines and buyouts when the filter is cleared", () => {
    const html = renderToStaticMarkup(createElement(PublishedFloorPlanMapView, {
      payload,
      selectedEventId: null,
      onSelectEvent: () => {},
    }));
    expect(html).toContain('aria-label="VIP 1 assigned to Earlier Party"');
    expect(html).toContain("also reserved by Later Party");
    expect(html).toContain('aria-label="Full facility buyout: Earlier Party"');
    expect(html).toContain('aria-label="Custom highlight: Earlier Party note"');
    expect(html).toContain('aria-label="Custom highlight: Later Party note"');
    expect(html).toContain("Showing all events");
  });

  it("provides native keyboard/touch buttons, repeat-click deselection, and Show all", () => {
    const onSelectEvent = vi.fn();
    const buttons = (node: ReactNode): Array<Record<string, unknown>> => {
      const result: Array<Record<string, unknown>> = [];
      Children.forEach(node, (child) => {
        if (!isValidElement<{ children?: ReactNode }>(child)) return;
        if (child.type === "button") result.push(child.props);
        result.push(...buttons(child.props.children));
      });
      return result;
    };
    const allButtons = buttons(FloorPlanEventLegend({ plan: payload.plan, selectedEventId: null, onSelectEvent }));
    const eventButton = allButtons.find((button) => button["aria-label"] === `Show only ${second.name} on the floor plan`)!;
    expect(eventButton.type).toBe("button");
    expect(eventButton["aria-pressed"]).toBe(false);
    (eventButton.onClick as () => void)();
    expect(onSelectEvent).toHaveBeenLastCalledWith(second.id);

    const selectedButtons = buttons(FloorPlanEventLegend({ plan: payload.plan, selectedEventId: second.id, onSelectEvent }));
    const selectedButton = selectedButtons.find((button) => button["aria-label"] === eventButton["aria-label"])!;
    expect(selectedButton["aria-pressed"]).toBe(true);
    (selectedButton.onClick as () => void)();
    expect(onSelectEvent).toHaveBeenLastCalledWith(null);
    (selectedButtons[0].onClick as () => void)();
    expect(onSelectEvent).toHaveBeenLastCalledWith(null);
  });

  it("keeps both parties visible when a dining table is reused, without duplicate VIP outlines", () => {
    const plan: FloorPlanDocument = {
      ...payload.plan,
      reservations: [
        ...payload.plan.reservations,
        ...[first, second].map((event) => ({
          ...interactivePlan.reservations[0],
          id: `${event.id}:table`,
          floorPlanEventId: event.id,
          areaId: "main-rect-left-1",
          reservationType: "seating" as const,
          startAt: event.startAt,
          endAt: event.endAt,
        })),
      ],
    };
    const outlines = floorPlanLocalReservationOutlines(plan, "", payload.entertainmentReservations);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]).toMatchObject({
      color: second.color,
      label: "Main Dining Table L1 also assigned to Later Party, 3:30 PM – 5:30 PM",
    });
    const editorOutlines = floorPlanLocalReservationOutlines(plan, second.id, payload.entertainmentReservations);
    expect(editorOutlines[0].color).toBe(first.color);
    const filtered = floorPlanEventView(plan, payload.entertainmentReservations, second.id);
    expect(floorPlanLocalReservationOutlines(filtered.plan)).toEqual([]);
    const html = renderToStaticMarkup(createElement(PublishedFloorPlanMapView, {
      payload: { ...payload, plan },
      selectedEventId: null,
      onSelectEvent: () => {},
    }));
    expect(html).toContain('aria-label="Main Dining Table L1 assigned to Earlier Party"');
    expect(html).toContain(`aria-label="${outlines[0].label}"`);
    expect(html).toContain("border-color:#1D4ED8");
  });

  it("shows local-only VIP reuse when no shared reservation supplies an outline", () => {
    const outlines = floorPlanLocalReservationOutlines(payload.plan);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].label).toBe("VIP 1 also assigned to Later Party, 3:30 PM – 5:30 PM");
    const sharedFirstOnly = payload.entertainmentReservations.filter((reservation) => reservation.id === "first-vip");
    expect(floorPlanLocalReservationOutlines(payload.plan, "", sharedFirstOnly)).toEqual(outlines);
  });

  it("renders saved food aliases on one canonical physical surface", () => {
    const event = interactivePlan.events[0];
    const aliases = ["main-food-1", "main-food-2", "ge-food-table"];
    const plan: FloorPlanDocument = {
      ...interactivePlan,
      reservations: aliases.map((areaId, index) => ({
        ...interactivePlan.reservations[0],
        id: `legacy-food-${index}`,
        areaId,
        reservationType: "food-table",
        label: "F",
      })),
    };
    const html = renderToStaticMarkup(createElement(PublishedFloorPlanMapView, {
      payload: { ...interactivePayload, plan },
      selectedEventId: null,
      onSelectEvent: () => {},
    }));
    for (const name of ["Main Dining Table L4", "Main Dining Table R3", "GEG Table 3"]) {
      expect(html.split(`aria-label="${name} assigned to ${event.name}"`)).toHaveLength(2);
    }
    expect(html.match(/<span>F<\/span>/g)).toHaveLength(3);
    expect(html).not.toContain('aria-label="Main Dining ADA Food Table');
    expect(html).not.toContain('aria-label="GEG ADA Food Table');
  });

  it("keeps reuse outlines grouped across legacy and canonical table IDs", () => {
    const plan: FloorPlanDocument = {
      ...payload.plan,
      reservations: [
        { ...interactivePlan.reservations[0], id: "first-food", floorPlanEventId: first.id, areaId: "main-food-1", reservationType: "food-table", label: "F", startAt: first.startAt, endAt: first.endAt },
        { ...interactivePlan.reservations[0], id: "later-seat", floorPlanEventId: second.id, areaId: "main-rect-left-4", reservationType: "seating", startAt: second.startAt, endAt: second.endAt },
      ],
    };
    expect(floorPlanLocalReservationOutlines(plan)).toEqual([
      expect.objectContaining({ id: "later-seat", color: second.color, label: expect.stringContaining("Main Dining Table L4 also assigned to Later Party") }),
    ]);
  });
});
