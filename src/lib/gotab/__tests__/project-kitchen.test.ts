import { describe, expect, it } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { translateEventHostFoodAddOns } from "@/lib/kitchen/addons";
import { projectKitchenChecklist } from "../project-kitchen";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";

const sourceEvent = {
  eventId: 123,
  bookingId: 456,
  eventName: "OPE KDS Integration Test",
  localDate: "2026-08-15",
  startTime: "6:00 PM",
  endTime: "8:00 PM",
  guestCount: 18,
  status: "DEFINITE",
  room: "VIP 1",
  selections: [{ name: "Mozzarella Stick Platter", quantity: 1, isFood: true }],
};

describe("Tripleseat kitchen projection", () => {
  it("projects the temporary VIP check-in test as exactly two single-item KDS requests", () => {
    const reservation = vipKdsTestReservation("2026-09-23", Date.parse("2026-09-23T18:00:00Z"))!;
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const keys = ["platter-chicken-tenders", "dessert-platter"];
    const mappings = keys.map((key) => {
      const row = checklist.sections.flatMap((section) => section.rows)
        .find((item) => item.key === key)!;
      return {
        id: key,
        canonicalProductKey: key,
        displayName: row.foodName,
        aliases: [],
        panSize: (row.panSize === "1/3" ? "THIRD_PAN" : row.panSize === "1/2" ? "HALF_PAN" : "TRAY") as "THIRD_PAN" | "HALF_PAN" | "TRAY",
        preparationStation: (key === "dessert-platter" ? "COLD_PREP" : "FRYER") as "COLD_PREP" | "FRYER",
        gotabProductUuid: `test-${key}`,
        verifiedAt: "2026-09-23T17:00:00Z",
      };
    });
    const projection = projectKitchenChecklist(checklist, mappings, {
      sourceType: "VIP_ADDON",
      sourceVersion: 1,
      bookedFoodQuantities: new Map(keys.map((key) => [key, 1])),
    });
    expect(projection.exceptions).toEqual([]);
    expect(projection.requests.map((request) => [request.sourceRecordId, request.quantity]).sort())
      .toEqual([["dessert-platter", 1], ["platter-chicken-tenders", 1]]);
  });

  it("sends booked VIP platter counts while retaining kitchen pan prep", () => {
    const reservation = structuredClone(vipPrepPayload.reservations[0]);
    reservation.foodPrep[0].quantity = 1;
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const row = checklist.sections.flatMap((section) => section.rows)
      .find((item) => item.key === "platter-wings")!;
    const mappedPanSize = row.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN";
    const result = projectKitchenChecklist(checklist, [{
      id: "vip-wing-mapping",
      canonicalProductKey: row.key,
      displayName: "Wing Platter",
      aliases: [],
      panSize: mappedPanSize,
      preparationStation: "FRYER",
      gotabProductUuid: "wing-product",
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }], {
      sourceType: "VIP_ADDON",
      sourceVersion: 1,
      bookedFoodQuantities: new Map([[row.key, 1]]),
    });
    expect(row.numberOfPans).toBeGreaterThan(1);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      sourceRecordId: "platter-wings",
      quantity: 1,
      panSize: mappedPanSize,
    });
    expect(result.exceptions).toHaveLength(0);
  });

  it("projects the redacted September 23 VIP's three booked platters without prep sauces", () => {
    const reservation = structuredClone(vipPrepPayload.reservations[0]);
    reservation.operatingDate = "2026-09-23";
    reservation.startAt = "2026-09-23T22:00:00.000Z";
    reservation.endAt = "2026-09-24T00:00:00.000Z";
    reservation.foodPrep = [
      { code: "chicken-tenders", label: "Chicken Tenders", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { code: "mozzarella-sticks", label: "Mozzarella Sticks", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { code: "tater-kegs", label: "Tater Kegs", quantity: 1, unitPriceCents: 0, totalCents: 0 },
    ];
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const keys = ["platter-chicken-tenders", "platter-mozzarella-sticks", "platter-tater-kegs"];
    const mappings = keys.map((key) => ({
      id: key,
      canonicalProductKey: key,
      displayName: key,
      aliases: [],
      panSize: "THIRD_PAN" as const,
      preparationStation: "FRYER" as const,
      gotabProductUuid: `product-${key}`,
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }));
    const projection = projectKitchenChecklist(checklist, mappings, {
      sourceType: "VIP_ADDON",
      sourceVersion: 1,
      bookedFoodQuantities: new Map(keys.map((key) => [key, 1])),
    });

    expect(projection.exceptions).toEqual([]);
    expect(projection.requests).toHaveLength(3);
    expect(projection.requests.map((request) => request.sourceRecordId).sort()).toEqual(keys);
    expect(projection.requests.every((request) =>
      request.quantity === 1 && request.prepDueAt === "2026-09-23T21:15:00.000Z",
    )).toBe(true);
  });

  it("holds contracted food until a verified product mapping exists", () => {
    const result = projectKitchenChecklist(generateKitchenChecklist(sourceEvent), [], { sourceVersion: 1 });
    expect(result.requests).toHaveLength(0);
    expect(result.exceptions.some((item) => item.reason.includes("verified GoTab product mapping"))).toBe(true);
  });

  it("preserves Event Host pan output and America/New_York timing", () => {
    const checklist = generateKitchenChecklist(sourceEvent);
    const row = checklist.sections.flatMap((section) => section.rows)
      .find((item) => item.key === "platter-mozzarella-sticks")!;
    const panSize = row.panSize === "1/3" ? "THIRD_PAN" as const : "HALF_PAN" as const;
    const result = projectKitchenChecklist(checklist, [{
      id: "mapping-1",
      canonicalProductKey: row.key,
      displayName: row.foodName,
      aliases: [],
      panSize,
      preparationStation: "FRYER",
      gotabProductUuid: "gotab-product-1",
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }], { sourceVersion: 1 });
    expect(result.requests[0]).toMatchObject({
      eventName: "OPE KDS Integration Test",
      quantity: row.numberOfPans,
      panSize,
      preparationStation: "FRYER",
      foodServiceAt: "2026-08-15T21:45:00.000Z",
    });
  });

  it("projects a live Event Host add-on through its addon mapping key", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      { "mozzarella-sticks": { quantity: 2, panSize: "1/2" } },
      "2026-08-15T16:00:00.000Z",
    );
    const checklist = generateKitchenChecklist(sourceEvent, undefined, liveFoodAddOns);
    const row = checklist.liveFoodAddOns
      .find((item) => item.itemKey === "addon:mozzarella-sticks")!;
    const result = projectKitchenChecklist(checklist, [{
      id: "mapping-addon",
      canonicalProductKey: "addon:mozzarella-sticks",
      displayName: "Mozzarella Sticks",
      aliases: [],
      panSize: "HALF_PAN",
      preparationStation: "FRYER",
      gotabProductUuid: "prd_mozzarella",
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }], { sourceVersion: 2, sourceType: "EVENT_HOST_ADDON" });

    expect(row).toMatchObject({ panSize: "1/2", numberOfPans: 2 });
    expect(result.requests).toContainEqual(expect.objectContaining({
      sourceType: "EVENT_HOST_ADDON",
      sourceRecordId: "addon:mozzarella-sticks",
      panSize: "HALF_PAN",
      quantity: 2,
      gotabProductUuid: "prd_mozzarella",
    }));
  });

  it.each([
    {
      label: "one platter in 1/3 pans",
      food: { "tater-kegs": { quantity: 1 } },
      expectedSourceQuantity: 1,
      expectedKitchenQuantity: 64,
      expectedPanCount: 3,
      expectedPanSize: "1/3" as const,
      expectedSelectedPanSize: null,
      mappedPanSize: "THIRD_PAN" as const,
    },
    {
      label: "two platters in 1/2 pans",
      food: { "tater-kegs": { quantity: 2, panSize: "1/2" as const } },
      expectedSourceQuantity: 2,
      expectedKitchenQuantity: 128,
      expectedPanCount: 4,
      expectedPanSize: "1/2" as const,
      expectedSelectedPanSize: "1/2" as const,
      mappedPanSize: "HALF_PAN" as const,
    },
  ])("keeps $label as platter quantity on the KDS", ({
    food,
    expectedSourceQuantity,
    expectedKitchenQuantity,
    expectedPanCount,
    expectedPanSize,
    expectedSelectedPanSize,
    mappedPanSize,
  }) => {
    const liveFoodAddOns = translateEventHostFoodAddOns(
      food,
      "2026-08-15T16:00:00.000Z",
    );
    const checklist = generateKitchenChecklist(sourceEvent, undefined, liveFoodAddOns);
    const row = checklist.liveFoodAddOns
      .find((item) => item.itemKey === "addon:tater-kegs")!;
    const result = projectKitchenChecklist(checklist, [{
      id: "mapping-tater-kegs",
      canonicalProductKey: "addon:tater-kegs",
      displayName: "Tater Kegs",
      aliases: [],
      panSize: mappedPanSize,
      preparationStation: "FRYER",
      gotabProductUuid: "prd_tater_kegs",
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }], { sourceVersion: 3, sourceType: "EVENT_HOST_ADDON" });

    expect(row).toMatchObject({
      quantity: expectedKitchenQuantity,
      numberOfPans: expectedPanCount,
      panSize: expectedPanSize,
    });
    expect(row.selectedPanSize ?? null).toBe(expectedSelectedPanSize);
    expect(result.requests).toContainEqual(expect.objectContaining({
      sourceRecordId: "addon:tater-kegs",
      quantity: expectedSourceQuantity,
      selectedPanSize: expectedSelectedPanSize,
    }));
  });
});
