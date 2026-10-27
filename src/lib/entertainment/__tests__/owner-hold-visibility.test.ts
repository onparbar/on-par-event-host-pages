import { describe, expect, it } from "vitest";
import { vipPrepEntertainmentEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { buildEntertainmentSchedule, detectEntertainmentConflicts } from "../domain";
import { projectDecemberOwnerHoldEntertainmentVisibility } from "../owner-holds";
import type { EntertainmentSourceEvent } from "../types";

const DATE = "2026-12-02";
function source(date = DATE, eventName = "Owner hold VIP"): EntertainmentSourceEvent {
  return { ...vipPrepEntertainmentEvents([{ ...structuredClone(vipPrepPayload.reservations[0]), eventName: "Redacted VIP",
    operatingDate: date, foodPrep: [], extras: [], linkedTripleseatEventIds: [], resource: { code: "VIPS", name: "VIP 1" },
    startAt: `${date}T22:00:00Z`, endAt: `${date}T23:00:00Z` }])[0], eventName };
}
function day(sources = [source()]) {
  const built = buildEntertainmentSchedule({ sourceEvents: sources, localEvents: [], now: "2026-10-27T12:00:00Z" });
  return { ...built, reservations: built.reservations.map((row) => ({ ...row, manualOverride: true })) };
}

describe("December internal-hold display projection", () => {
  it.each(["Owner hold VIP", "VIP unavailable", "VIP unavailable VIP", "  VIP   unavailable VIP  "])("hides exact cached manual %s without changing source history", (name) => {
    const stored = day([source(DATE, name)]); const before = structuredClone(stored);
    const visible = projectDecemberOwnerHoldEntertainmentVisibility(stored);
    expect(visible.events).toEqual([]); expect(visible.reservations).toEqual([]);
    expect(stored).toEqual(before);
  });

  it.each(["2026-11-30", "2027-01-01", "2027-12-02"])("leaves dates outside December 2026 unchanged: %s", (date) => {
    const stored = day([source(date)]);
    expect(projectDecemberOwnerHoldEntertainmentVisibility(stored)).toEqual(stored);
  });

  it.each(["2026-12-01", "2026-12-31"])("covers the December boundary %s", (date) => {
    expect(projectDecemberOwnerHoldEntertainmentVisibility(day([source(date)])).reservations).toEqual([]);
  });

  it("preserves purchased food/extras, corporate links, real names and noncanonical VIP identities", () => {
    const base = source();
    for (const genuine of [
      { ...base, vipFoodCount: 1 }, { ...base, vipExtraCount: 1 },
      { ...base, linkedTripleseatEventIds: ["redacted-corporate"] },
      { ...base, eventName: "VIP unavailable birthday" },
      { ...base, eventName: "Redacted real customer VIP" },
      { ...base, tripleseatEventId: "corporate-source", sourceSystem: "tripleseat" as const },
      { ...base, tripleseatEventId: "vip_uncertain_source" },
    ]) {
      const stored = day([genuine]);
      expect(projectDecemberOwnerHoldEntertainmentVisibility(stored)).toEqual(stored);
    }
  });

  it("uses the newest genuine source evidence rather than an older cached hold label on the reservation", () => {
    const old = day(); const current = day([{ ...source(DATE, "Redacted real customer VIP"), sourceUpdatedAt: "2026-10-27T15:00:00Z", sourceObservedAt: "2026-10-27T11:00:00-04:00" }]);
    old.events[0].sourceSnapshot.sourceObservedAt = "2026-10-27T14:00:00Z";
    const stored = { ...old, events: [...old.events, ...current.events] }; const before = structuredClone(stored);
    const visible = projectDecemberOwnerHoldEntertainmentVisibility(stored);
    expect(visible.events.map((event) => event.eventName)).toEqual(["Redacted real customer VIP"]);
    expect(visible.reservations).toEqual(old.reservations);
    expect(stored).toEqual(before);
  });

  it("removes only placeholder conflicts while keeping genuine customer overlaps", () => {
    const corporate = { ...source(DATE, "Redacted corporate event"), tripleseatEventId: "redacted-corporate", sourceSystem: "tripleseat" as const };
    const customer = { ...source(DATE, "Redacted customer VIP"), tripleseatEventId: "vip-redacted-customer" };
    const stored = day([source(), corporate, customer]);
    expect(detectEntertainmentConflicts(stored.reservations)).toHaveLength(3);
    const visible = projectDecemberOwnerHoldEntertainmentVisibility(stored);
    expect(visible.reservations).toHaveLength(2);
    expect(detectEntertainmentConflicts(visible.reservations)).toHaveLength(1);
    expect(visible.events.map((event) => event.eventName)).toEqual(["Redacted corporate event", "Redacted customer VIP"]);
  });
});
