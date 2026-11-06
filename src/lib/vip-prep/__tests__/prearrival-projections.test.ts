import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { VipPrepClient, isActiveVipPrepReservation, vipPrepEntertainmentEvents, vipPrepEventPlan, vipPrepKitchenEvents, vipPrepMappingIssues, vipPreorderFingerprint } from "../client";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipBookedFoodQuantities } from "@/lib/gotab/sync-event-food";
import { novemberVipPayload } from "./prearrival-fixtures";

function client(value: unknown) { return new VipPrepClient({ env: { VIP_PREP_API_TOKEN: "sanitized-test-token" }, fetchImpl: async () => Response.json(value) }); }

describe("exact pre-arrival VIP source facts", () => {
  it("K: preserves the verified November 14 food and untimed extras without turning preparation pans into purchased quantities", async () => {
    const payload = await client(novemberVipPayload()).fetchRange("2026-11-14", "2026-11-14");
    const reservation = payload.reservations[0];
    expect(reservation).toMatchObject({ resource: { code: "VIPL", name: "VIP 2" }, partySize: 16, lastRefreshedAt: payload.generatedAt });
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    expect(checklist.event.vipBooking?.foodPrep.map(({ code, quantity }) => ({ code, quantity }))).toEqual([
      { code: "chicken-tenders", quantity: 2 }, { code: "fry-platters", quantity: 1 }, { code: "mozzarella-sticks", quantity: 1 },
    ]);
    expect([...vipBookedFoodQuantities(checklist)]).toEqual([
      ["platter-chicken-tenders", 2], ["platter-fries", 1], ["platter-mozzarella-sticks", 1],
    ]);
    expect(checklist.sections.flatMap((section) => section.rows).find((row) => row.key === "platter-chicken-tenders")?.quantity).toBe(128);
    expect(vipPrepEventPlan(reservation).entertainment).toEqual([{ name: "Mini Golf", quantity: "16", time: "Open play — no reserved time", duration: "" }]);
    expect(vipPrepEntertainmentEvents([reservation])[0].items).toEqual([expect.objectContaining({ name: "Mini Golf", quantity: 16, startAt: null, endAt: null })]);
  });

  it.each(["new-food", "constructor", "toString", "__proto__", "unknown:chicken-tenders"])("H: unknown code %s remains visible and cannot map through its label or object prototype", async (code) => {
    const source = novemberVipPayload();
    source.reservations[0].foodPrep = [{ code, label: "Chicken Tender Platter", quantity: 2, unitPriceCents: 0, totalCents: 0 }];
    const reservation = (await client(source).fetchRange(source.from, source.to)).reservations[0];
    expect(vipPrepMappingIssues(reservation)).toEqual([expect.objectContaining({ code, label: "Chicken Tender Platter", quantity: 2 })]);
    const kitchen = vipPrepKitchenEvents([reservation])[0];
    expect(kitchen.selections[0].name).toBe("Unmapped VIP preorder item");
    const checklist = generateKitchenChecklist(kitchen);
    expect(checklist.sections.flatMap((section) => section.rows).some((row) => row.key === "platter-chicken-tenders")).toBe(false);
    expect(vipBookedFoodQuantities(checklist).size).toBe(0);
    expect(checklist.event.vipBooking?.foodPrep[0].label).toBe("Chicken Tender Platter");
  });

  it("retains repeated purchased codes as distinct evidence while summing their known platter quantities exactly once", () => {
    const reservation = novemberVipPayload().reservations[0];
    reservation.foodPrep = [reservation.foodPrep[0], { ...reservation.foodPrep[0], quantity: 1, totalCents: 12000 }];
    const kitchen = vipPrepKitchenEvents([reservation])[0];
    expect(new Set(kitchen.selections.map((item) => item.sourceId)).size).toBe(2);
    expect(vipBookedFoodQuantities(generateKitchenChecklist(kitchen)).get("platter-chicken-tenders")).toBe(3);
  });

  it("preserves exact source food IDs in booking evidence while using stable qualified kitchen mapping identities", () => {
    const reservation = novemberVipPayload().reservations[0];
    reservation.foodPrep[0].sourceId = "authorized-source-item-id";
    const kitchen = vipPrepKitchenEvents([reservation])[0];
    expect(kitchen.vipBooking?.foodPrep[0].sourceId).toBe("authorized-source-item-id");
    expect(kitchen.selections[0].sourceId).toBe(`vip-prep:${reservation.id}:chicken-tenders`);
  });

  it("distinguishes a valid empty response, invalid count, source failure and duplicate source identities", async () => {
    const source = novemberVipPayload();
    expect((await client({ ...source, reservations: [], reservationCount: 0 }).fetchRange(source.from, source.to)).reservations).toEqual([]);
    await expect(client({ ...source, reservations: [] }).fetchRange(source.from, source.to)).rejects.toThrow("invalid response");
    await expect(client({ ...source, reservations: [source.reservations[0], source.reservations[0]], reservationCount: 2 }).fetchRange(source.from, source.to)).rejects.toThrow("duplicate source reservation IDs");
    await expect(new VipPrepClient({ env: { VIP_PREP_API_TOKEN: "sanitized-test-token" }, fetchImpl: async () => new Response(null, { status: 503 }) }).fetchRange(source.from, source.to)).rejects.toThrow("503");
  });

  it("does not revive a known inactive cache record and does not treat external checked_in as Event Host arrival", () => {
    const reservation = novemberVipPayload().reservations[0];
    expect(isActiveVipPrepReservation({ ...reservation, activeInSource: false })).toBe(false);
    expect(isActiveVipPrepReservation({ ...reservation, status: "cancelled" })).toBe(false);
    expect(isActiveVipPrepReservation({ ...reservation, status: "checked_in" })).toBe(true);
    expect(vipPrepKitchenEvents([{ ...reservation, status: "cancelled" }])).toEqual([]);
  });

  it("uses exact semantic preorder evidence without false changes from order, source timestamps or equivalent ISO offsets", () => {
    const reservation = novemberVipPayload().reservations[0];
    const same = { ...reservation, updatedAt: "2026-10-26T18:30:00Z", startAt: "2026-11-14T22:00:00.000Z", endAt: "2026-11-15T00:00:00.000Z", foodPrep: [...reservation.foodPrep].reverse() };
    expect(vipPreorderFingerprint(same)).toBe(vipPreorderFingerprint(reservation));
    expect(vipPreorderFingerprint({ ...same, foodPrep: [{ ...same.foodPrep[0], quantity: 4 }] })).not.toBe(vipPreorderFingerprint(reservation));
  });
});
