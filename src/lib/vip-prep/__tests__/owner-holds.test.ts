import { describe, expect, it } from "vitest";
import { isDecemberOwnerHoldVip } from "../owner-holds";
import { isActiveVipPrepReservation, vipPrepEntertainmentEvents, vipPrepKitchenEvents } from "../client";
import { vipPrepPayload } from "./fixtures";

const evidence = { operatingDate: "2026-12-02", eventName: "Owner hold VIP", sourceEventId: "vip-redacted-reservation",
  sourceSystem: "vip-prep", linkedTripleseatEventIds: [], foodCount: 0, extraCount: 0 };

describe("December internal VIP planning holds", () => {
  it.each(["Owner hold VIP", " VIP   unavailable ", "VIP Unavailable VIP", "\tOWNER HOLD VIP\n"])("accepts only the authorized exact label %s", (eventName) => {
    expect(isDecemberOwnerHoldVip({ ...evidence, eventName })).toBe(true);
  });

  it.each(["2026-12-01", "2026-12-31"])("includes the December boundary %s", (operatingDate) => {
    expect(isDecemberOwnerHoldVip({ ...evidence, operatingDate })).toBe(true);
  });

  it.each(["2026-11-30", "2027-01-01", "2027-12-02", "2026-12-00", "2026-12-32", "2026-12-2", "2026-12-02T00:00:00Z"])("does not apply on %s", (operatingDate) => {
    expect(isDecemberOwnerHoldVip({ ...evidence, operatingDate })).toBe(false);
  });

  it.each(["Owner hold", "Owner hold VIP party", "VIP unavailable guest party", "Owner-hold VIP", "Redacted VIP", "VIP"])("keeps unrelated/similar name %s", (eventName) => {
    expect(isDecemberOwnerHoldVip({ ...evidence, eventName })).toBe(false);
  });

  it("preserves purchased food/extras, linked corporate sources, and non-VIP identities", () => {
    for (const protectedEvidence of [
      { foodCount: 1 }, { extraCount: 1 }, { foodCount: -1 }, { extraCount: Number.NaN },
      { linkedTripleseatEventIds: ["corporate-source"] }, { sourceEventId: "corporate-source" },
      { sourceEventId: null }, { sourceEventId: "vip-" }, { sourceSystem: "tripleseat" },
    ]) expect(isDecemberOwnerHoldVip({ ...evidence, ...protectedEvidence })).toBe(false);
  });

  it("changes only entertainment planning, not active VIP or Kitchen conversion", () => {
    const booking = { ...structuredClone(vipPrepPayload.reservations[0]), operatingDate: evidence.operatingDate,
      eventName: evidence.eventName, foodPrep: [], extras: [], linkedTripleseatEventIds: [],
      startAt: "2026-12-02T22:00:00Z", endAt: "2026-12-03T00:00:00Z" };
    expect(isActiveVipPrepReservation(booking)).toBe(true);
    expect(vipPrepKitchenEvents([booking])).toHaveLength(1);
    expect(vipPrepEntertainmentEvents([booking])).toEqual([]);
    expect(vipPrepEntertainmentEvents([{ ...booking, eventName: "Redacted customer VIP", partySize: 1 }])).toHaveLength(1);
    expect(vipPrepEntertainmentEvents([{ ...booking, foodPrep: vipPrepPayload.reservations[0].foodPrep }])).toHaveLength(1);
    expect(vipPrepEntertainmentEvents([{ ...booking, extras: ["Purchased extra"] }])).toHaveLength(1);
    expect(vipPrepEntertainmentEvents([{ ...booking, linkedTripleseatEventIds: ["corporate-source"] }])).toHaveLength(1);
    expect(vipPrepEntertainmentEvents([{ ...booking, operatingDate: "2026-11-30" }])).toHaveLength(1);
  });
});
