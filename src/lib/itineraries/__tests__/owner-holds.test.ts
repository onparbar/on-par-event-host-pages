import { afterEach, describe, expect, it, vi } from "vitest";
import { buildItineraryAsset } from "../asset";
import * as readiness from "../readiness";
import type { EventPlan } from "@/lib/event-plans/types";
import type { FloorPlanDocument } from "@/lib/floor-plans/types";
import type { EntertainmentDayPayload } from "@/lib/entertainment/types";

function inputs(date = "2026-12-02") {
  const plan: EventPlan = { id: 123, name: "Redacted corporate event", date, day: "Wednesday", time: "5:00 PM - 7:00 PM",
    guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: [], drink_options: [], entertainment: [], verification_status: "Verified" };
  const startAt = `${date}T22:00:00Z`, endAt = `${date}T23:00:00Z`;
  const event = (id: string, name: string) => ({ id, floorPlanId: "redacted-plan", tripleseatEventId: id, name, status: "DEFINITE", guestCount: 20,
    startAt, endAt, contractedAreaIds: ["vip-1"], unresolvedAreaNames: [], color: "#297025", beoLastModifiedAt: startAt, fullBuyout: false,
    source: { rooms: ["VIP 1"], food: [], entertainment: [], operationalNotes: [], reviewReasons: [] } });
  const floorPlan: FloorPlanDocument = { id: "redacted-plan", eventDate: date, version: 1, status: "Approved", ruleVersion: "test",
    lastTripleseatSyncAt: startAt, createdAt: startAt, updatedAt: startAt, approvedAt: startAt, approvedBy: "Redacted staff",
    events: [event("123", plan.name), event("vip-internal-hold", "Owner hold VIP")],
    reservations: ["123", "vip-internal-hold"].map((id) => ({ id: `${id}-room`, floorPlanEventId: id, areaId: "vip-1", reservationType: "room",
      startAt, endAt, label: "VIP 1", source: "manual", lockedByUser: true })) };
  const day: EntertainmentDayPayload = { date, events: [], reservations: [], conflicts: [], sync: null,
    sourceMode: "live", warnings: [], missingEnvironmentVariables: [], canEdit: false };
  return { plan, candidates: [plan], floorPlan, day, floorPlanPersisted: true, sourceSync: null, now: new Date(`${date}T20:00:00Z`) };
}

afterEach(() => vi.restoreAllMocks());

describe("December placeholder-free itinerary floor-plan evidence", () => {
  it("ignores a cached internal hold in itinerary validation without changing the stored document", () => {
    const input = inputs();
    const before = structuredClone(input);
    const revision = vi.spyOn(readiness, "buildItineraryRevision");
    const visiblePlan = { ...input.floorPlan, events: input.floorPlan.events.slice(0, 1), reservations: input.floorPlan.reservations.slice(0, 1) };
    expect(buildItineraryAsset(input)).toEqual(buildItineraryAsset({ ...input, floorPlan: visiblePlan }));
    expect(revision.mock.calls[0][0].floorPlan).toEqual(visiblePlan);
    expect(input).toEqual(before);
  });

  it.each(["2026-11-30", "2027-01-01", "2027-12-02"])("does not hide a room blocker outside December 2026: %s", (date) => {
    const input = inputs(date);
    const revision = vi.spyOn(readiness, "buildItineraryRevision");
    buildItineraryAsset(input);
    expect(revision.mock.calls.at(-1)?.[0].floorPlan).toEqual(input.floorPlan);
  });

  it("retains similarly named customer and linked corporate floor-plan evidence", () => {
    const revision = vi.spyOn(readiness, "buildItineraryRevision");
    for (const name of ["Owner hold VIP birthday", "VIP unavailable guest event"]) {
      const input = inputs(); input.floorPlan.events[1].name = name;
      buildItineraryAsset(input);
      expect(revision.mock.calls.at(-1)?.[0].floorPlan).toEqual(input.floorPlan);
    }
    const input = inputs(); input.floorPlan.events[1].source.verifiedSourceEventIds = ["corporate-source"];
    buildItineraryAsset(input);
    expect(revision.mock.calls.at(-1)?.[0].floorPlan).toEqual(input.floorPlan);
  });
});
