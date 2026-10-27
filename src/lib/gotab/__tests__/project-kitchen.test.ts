import { describe, expect, it } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { translateEventHostFoodAddOns } from "@/lib/kitchen/addons";
import { projectKitchenChecklist } from "../project-kitchen";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import type { EventFoodProductMapping } from "../event-food";

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

function bbqPrepChecklist(quantity = 3): KitchenChecklist {
  return {
    ...generateKitchenChecklist(sourceEvent),
    sections: [{ category: "sauces", label: "Sauces", rows: [{
      key: "sauce-bbq", category: "sauces", foodName: "BBQ Sauce",
      description: "Included BBQ sauce", quantity, unit: "bowls",
      numberOfPans: null, panSize: null, prepTiming: { kind: "not-applicable" },
    }] }],
  };
}

const bbqBowlMapping: EventFoodProductMapping = {
  id: "mapping-bbq-bowl", canonicalProductKey: "addon:bbq-sauce",
  displayName: "BBQ Sauce", aliases: [], panSize: "BOWL",
  preparationStation: "COLD_PREP", gotabProductUuid: "product-bbq-bowl",
  verifiedAt: "2026-10-23T16:00:00.000Z",
};

describe("Tripleseat kitchen projection", () => {
  it("reuses the exact standalone BBQ bowl mapping without merging source identities", () => {
    const checklist = {
      ...bbqPrepChecklist(),
      liveFoodAddOns: translateEventHostFoodAddOns({ "bbq-sauce": { quantity: 2 } }, "2026-10-23T16:00:00.000Z"),
    };
    const result = projectKitchenChecklist(checklist, [bbqBowlMapping], { sourceVersion: 1, sourceType: "TRIPLESEAT_CONTRACT" });
    expect(result.exceptions).toEqual([]);
    expect(result.requests.map((request) => ({
      sourceRecordId: request.sourceRecordId, canonicalProductKey: request.canonicalProductKey,
      quantity: request.quantity, panSize: request.panSize, product: request.gotabProductUuid,
    }))).toEqual([
      { sourceRecordId: "sauce-bbq", canonicalProductKey: "addon:bbq-sauce", quantity: 3, panSize: "BOWL", product: "product-bbq-bowl" },
      { sourceRecordId: "addon:bbq-sauce", canonicalProductKey: "addon:bbq-sauce", quantity: 2, panSize: "BOWL", product: "product-bbq-bowl" },
    ]);
    expect(result.requests[0]).toMatchObject({
      id: "123-sauce-bbq-1", sourceType: "TRIPLESEAT_CONTRACT", sourceVersion: 1,
      eventId: "123", tripleseatEventId: "123", tripleseatBookingId: "456",
      originalSourceName: "BBQ Sauce", eventName: sourceEvent.eventName,
    });
    expect(result.requests[0].idempotencyKey).not.toBe(result.requests[1].idempotencyKey);
    expect(checklist.sections[0].rows[0].key).toBe("sauce-bbq");
  });

  it("prefers a direct canonical BBQ bowl mapping over the standalone fallback", () => {
    const direct = { ...bbqBowlMapping, id: "direct-bbq", canonicalProductKey: "sauce-bbq", gotabProductUuid: "direct-product" };
    const result = projectKitchenChecklist(bbqPrepChecklist(4), [bbqBowlMapping, direct], { sourceVersion: 1 });
    expect(result.exceptions).toEqual([]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({ sourceRecordId: "sauce-bbq", canonicalProductKey: "sauce-bbq", quantity: 4, gotabProductUuid: "direct-product" });
  });

  it.each([
    { label: "wrong pan", mapping: { ...bbqBowlMapping, panSize: "NOT_APPLICABLE" as const } },
    { label: "wing refill", mapping: { ...bbqBowlMapping, canonicalProductKey: "addon:wing-refill-bbq" } },
    { label: "appetizer refill", mapping: { ...bbqBowlMapping, canonicalProductKey: "addon:appetizer-refill-bbq" } },
    { label: "similar key", mapping: { ...bbqBowlMapping, canonicalProductKey: "addon:bbq" } },
    { label: "alias only", mapping: { ...bbqBowlMapping, canonicalProductKey: "another-product", aliases: ["sauce-bbq", "BBQ Sauce"] } },
    { label: "missing product", mapping: { ...bbqBowlMapping, gotabProductUuid: null } },
  ])("does not infer a BBQ bowl mapping from $label", ({ mapping }) => {
    const result = projectKitchenChecklist(bbqPrepChecklist(), [mapping], { sourceVersion: 1 });
    expect(result.requests).toEqual([]);
    expect(result.exceptions).toEqual([expect.objectContaining({ itemKey: "sauce-bbq", reason: "A verified GoTab product mapping is required." })]);
  });

  it("does not use the bowl fallback for a BBQ row with non-bowl units", () => {
    const checklist = bbqPrepChecklist();
    checklist.sections[0].rows[0].unit = "requested units";
    const result = projectKitchenChecklist(checklist, [bbqBowlMapping], { sourceVersion: 1 });
    expect(result.requests).toEqual([]);
    expect(result.exceptions).toHaveLength(1);
  });

  it("keeps other mapped food projectable when the new BBQ bowl has no mapping", () => {
    const baseChecklist = generateKitchenChecklist(sourceEvent);
    const platter = baseChecklist.sections.flatMap((section) => section.rows).find((row) => row.key === "platter-mozzarella-sticks")!;
    const checklist = { ...bbqPrepChecklist(), sections: [{ category: "platters" as const, label: "Platters", rows: [platter] }, ...bbqPrepChecklist().sections] };
    const result = projectKitchenChecklist(checklist, [{
      ...bbqBowlMapping, id: "mapping-platter", canonicalProductKey: platter.key,
      panSize: platter.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN", gotabProductUuid: "product-platter",
    }], { sourceVersion: 1 });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].sourceRecordId).toBe(platter.key);
    expect(result.exceptions).toEqual([expect.objectContaining({ itemKey: "sauce-bbq" })]);
  });

  it("snapshots each submitted refill's own notes without changing its quantity or another item", () => {
    const submittedAt = "2026-10-23T17:00:00Z";
    const keys = ["appetizer-refill-tater-kegs", "appetizer-refill-chicken-tenders"];
    const liveFoodAddOns = translateEventHostFoodAddOns({
      [keys[0]]: { quantity: 1, notes: "Deliver to VIP 1 food table" },
      [keys[1]]: { quantity: 2, notes: "Ranch on side" },
    }, submittedAt);
    const checklist = { ...generateKitchenChecklist(sourceEvent, undefined, liveFoodAddOns), sections: [] };
    const mappings = keys.map((key) => ({ id: key, canonicalProductKey: `addon:${key}`, displayName: key, aliases: [], panSize: "NOT_APPLICABLE" as const, preparationStation: "FRYER" as const, gotabProductUuid: `product-${key}`, verifiedAt: submittedAt }));
    const projected = projectKitchenChecklist(checklist, mappings, { sourceVersion: 9, sourceType: "REFILL", submittedAt, requesterName: "Carlos" });
    expect(projected.exceptions).toEqual([]);
    expect(projected.requests.map((item) => [item.quantity, item.requestNotes])).toEqual([[1, "Deliver to VIP 1 food table"], [2, "Ranch on side"]]);
    liveFoodAddOns[0].requestNotes = "Draft edit after sending";
    expect(projected.requests[0].requestNotes).toBe("Deliver to VIP 1 food table");
  });
  it.each(["EVENT_HOST_ADDON", "REFILL", "VIP_ADDON"] as const)("approves an immediate %s independently of original contract review and timing", (sourceType) => {
    const submittedAt = "2026-10-23T16:30:00.000Z";
    const keys = ["appetizer-refill-tater-kegs", "appetizer-refill-chicken-tenders", "appetizer-refill-mozzarella-sticks"];
    const liveFoodAddOns = translateEventHostFoodAddOns(Object.fromEntries(
      keys.map((key) => [key, { quantity: 1 }]),
    ), submittedAt);
    const checklist = {
      ...generateKitchenChecklist({ ...sourceEvent, eventName: "Redacted corporate event" }, undefined, liveFoodAddOns),
      sections: [],
      needsReview: true,
      timing: { startTime: null, foodReadyBy: null, earliestPrepTime: null },
    };
    const mappings = keys.map((key) => ({
      id: key, canonicalProductKey: `addon:${key}`, displayName: key, aliases: [],
      panSize: "NOT_APPLICABLE" as const, preparationStation: "FRYER" as const,
      gotabProductUuid: `product-${key}`, verifiedAt: submittedAt,
    }));
    const result = projectKitchenChecklist(checklist, mappings, { sourceVersion: 1, sourceType, submittedAt });
    expect(result.exceptions).toEqual([]);
    expect(result.requests).toHaveLength(3);
    expect(result.requests.every((request) => request.approvalStatus === "APPROVED" &&
      request.dispatchStatus === "QUEUED_FOR_KITCHEN" && request.quantity === 1 &&
      request.foodServiceAt === submittedAt && request.prepDueAt === submittedAt)).toBe(true);
    expect(checklist.needsReview).toBe(true);
  });

  it("keeps initial contracted food dependent on verified contract timing", () => {
    const checklist = {
      ...generateKitchenChecklist(sourceEvent),
      timing: { startTime: null, foodReadyBy: null, earliestPrepTime: null },
    };
    const result = projectKitchenChecklist(checklist, [], {
      sourceVersion: 1, sourceType: "TRIPLESEAT_CONTRACT", submittedAt: "2026-10-23T16:30:00Z",
    });
    expect(result.requests).toEqual([]);
    expect(result.exceptions.some((item) => item.reason.includes("Food service time"))).toBe(true);
  });

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
    { panSize: undefined, mappedPanSize: "NOT_APPLICABLE" as const },
    { panSize: "1/3" as const, mappedPanSize: "THIRD_PAN" as const },
    { panSize: "1/2" as const, mappedPanSize: "HALF_PAN" as const },
  ])("reuses the BBQ refill product for both bars with $mappedPanSize", ({ panSize, mappedPanSize }) => {
    const liveFoodAddOns = translateEventHostFoodAddOns({
      "appetizer-refill-bbq": { quantity: 10, panSize },
      "wing-refill-bbq": { quantity: 1, panSize },
    }, "2026-08-15T16:00:00.000Z");
    const checklist = generateKitchenChecklist(
      { ...sourceEvent, selections: [] }, undefined, liveFoodAddOns,
    );
    const result = projectKitchenChecklist(checklist, [{
      id: "mapping-bbq-refill",
      canonicalProductKey: "addon:wing-refill-bbq",
      displayName: "BBQ",
      aliases: [],
      panSize: mappedPanSize,
      preparationStation: "COLD_PREP",
      gotabProductUuid: "prd_a7f6Zpe_0WsCxf_yftoeP1pA",
      verifiedAt: "2026-08-11T12:00:00.000Z",
    }], { sourceVersion: 2, sourceType: "REFILL" });

    expect(result.exceptions).toEqual([]);
    expect(result.requests).toHaveLength(2);
    expect(result.requests.map((request) => ({
      sourceRecordId: request.sourceRecordId,
      quantity: request.quantity,
      product: request.gotabProductUuid,
    }))).toEqual([
      { sourceRecordId: "addon:appetizer-refill-bbq", quantity: 10, product: "prd_a7f6Zpe_0WsCxf_yftoeP1pA" },
      { sourceRecordId: "addon:wing-refill-bbq", quantity: 1, product: "prd_a7f6Zpe_0WsCxf_yftoeP1pA" },
    ]);
    expect(result.requests[0].idempotencyKey).not.toBe(result.requests[1].idempotencyKey);
  });

  it("holds an Appetizer BBQ refill when no BBQ product mapping is available", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns({
      "appetizer-refill-bbq": { quantity: 1 },
    }, "2026-08-15T16:00:00.000Z");
    const checklist = generateKitchenChecklist(
      { ...sourceEvent, selections: [] }, undefined, liveFoodAddOns,
    );
    const result = projectKitchenChecklist(checklist, [], { sourceVersion: 2, sourceType: "REFILL" });

    expect(result.requests).toEqual([]);
    expect(result.exceptions).toEqual([expect.objectContaining({
      itemKey: "addon:appetizer-refill-bbq",
      reason: "A verified GoTab product mapping is required.",
    })]);
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

  it("prepares one tender add-on in four third pans but sends only one platter to the KDS", () => {
    const liveFoodAddOns = translateEventHostFoodAddOns({
      "chicken-tenders": { quantity: 1 },
    }, "2026-10-22T16:00:00.000Z");
    const checklist = generateKitchenChecklist(
      { ...sourceEvent, selections: [] }, undefined, liveFoodAddOns,
    );
    expect(checklist.liveFoodAddOns[0]).toMatchObject({
      itemKey: "addon:chicken-tenders",
      quantity: 64,
      numberOfPans: 4,
      panSize: "1/3",
    });
    const result = projectKitchenChecklist({ ...checklist, sections: [] }, [{
      id: "mapping-tender-add-on",
      canonicalProductKey: "addon:chicken-tenders",
      displayName: "Chicken Tender Platter",
      aliases: [],
      panSize: "THIRD_PAN",
      preparationStation: "FRYER",
      gotabProductUuid: "prd_tenders",
      verifiedAt: "2026-10-22T12:00:00.000Z",
    }], { sourceVersion: 4, sourceType: "EVENT_HOST_ADDON" });
    expect(result.exceptions).toEqual([]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      sourceRecordId: "addon:chicken-tenders",
      panSize: "THIRD_PAN",
      quantity: 1,
      selectedPanSize: null,
    });
  });
});
