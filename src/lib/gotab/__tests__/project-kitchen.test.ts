import { describe, expect, it } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { translateEventHostFoodAddOns } from "@/lib/kitchen/addons";
import { projectKitchenChecklist } from "../project-kitchen";

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
