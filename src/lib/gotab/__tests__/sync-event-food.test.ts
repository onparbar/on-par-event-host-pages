import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { translateEventHostFoodAddOns } from "@/lib/kitchen/addons";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import type { KitchenChecklist, KitchenSourceSelection } from "@/lib/kitchen/types";

vi.mock("server-only", () => ({}));

let synchronize: typeof import("../sync-event-food").synchronizeKitchenChecklistToEventFood;
let synchronizeLiveAddOns: typeof import("../sync-event-food").synchronizeKitchenLiveAddOnsToEventFood;
let sourceVersion: typeof import("../sync-event-food").eventFoodSourceVersion;
let synchronizeVipBookingFood: typeof import("../sync-event-food").synchronizeVipBookingFoodToEventFood;

beforeAll(async () => {
  ({
    synchronizeKitchenChecklistToEventFood: synchronize,
    synchronizeKitchenLiveAddOnsToEventFood: synchronizeLiveAddOns,
    eventFoodSourceVersion: sourceVersion,
    synchronizeVipBookingFoodToEventFood: synchronizeVipBookingFood,
  } = await import("../sync-event-food"));
});

const checklist = generateKitchenChecklist({
  eventId: 123,
  bookingId: 456,
  eventName: "OPE KDS Integration Test",
  localDate: "2026-08-15",
  startTime: "6:00 PM",
  guestCount: 18,
  status: "DEFINITE",
  room: "VIP 1",
  selections: [{ name: "Veggie Tray", quantity: 1, isFood: true }],
});

const env = {
  GOTAB_API_ACCESS_ID: "id",
  GOTAB_API_ACCESS_SECRET: "secret",
  GOTAB_LOCATION_UUID: "location",
  GOTAB_EVENT_SPOT_UUID: "spot",
  GOTAB_EVENT_CUSTOMER_PHONE: "+19377056024",
  GOTAB_WEBHOOK_SECRET: "webhook",
  EVENT_KDS_ENABLED: "false",
  EVENT_KDS_DRY_RUN: "true",
  EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES: "60",
};

function contractWithBbq(): KitchenChecklist {
  const platter = checklist.sections.flatMap((section) => section.rows)
    .find((row) => row.key === "platter-veggie-tray")!;
  return { ...checklist, sections: [
    { category: "platters", label: "Platters", rows: [platter] },
    { category: "sauces", label: "Sauces", rows: [{
      key: "sauce-bbq", category: "sauces", foodName: "BBQ Sauce",
      description: "Included BBQ sauce", quantity: 3, unit: "bowls",
      numberOfPans: null, panSize: null, prepTiming: { kind: "not-applicable" },
    }] },
  ] };
}

const contractBbqMappings = [
  {
    id: "mapping-platter", canonical_product_key: "platter-veggie-tray", display_name: "Veggie Tray",
    aliases: [], pan_size: "TRAY", preparation_station: "COLD_PREP", gotab_product_uuid: "product-veggie",
    mapping_status: "VERIFIED", verified_at: "2026-10-23T16:00:00.000Z",
  },
  {
    id: "mapping-bbq", canonical_product_key: "addon:bbq-sauce", display_name: "BBQ Sauce",
    aliases: [], pan_size: "BOWL", preparation_station: "COLD_PREP", gotab_product_uuid: "product-bbq",
    mapping_status: "VERIFIED", verified_at: "2026-10-23T16:00:00.000Z",
  },
];

function generatedBbqChecklist(
  selections: KitchenSourceSelection[],
  liveFood: Parameters<typeof translateEventHostFoodAddOns>[0],
) {
  return generateKitchenChecklist({
    eventId: 123, eventName: "Redacted event", localDate: "2026-10-23", startTime: "6:00 PM",
    guestCount: 25, status: "DEFINITE", selections,
  }, undefined, translateEventHostFoodAddOns(liveFood, "2026-10-23T16:00:00.000Z"));
}

function bbqOnlyStorage(previous: Array<{ source_record_id: string; quantity: number; pan_size: string }> = []) {
  return {
    listContractFoodRequests: vi.fn().mockImplementation(async () => previous),
    listMappings: vi.fn().mockResolvedValue([contractBbqMappings[1]]),
    saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
    enqueueRequest: vi.fn().mockImplementation(async (request) => {
      previous.push({ source_record_id: request.sourceRecordId, quantity: request.quantity, pan_size: request.panSize });
      return { duplicate: false };
    }),
  };
}

describe("Event Food synchronization", () => {
  it("projects only contract BBQ from a generated checklist containing contract and live platters", async () => {
    const mixed = generatedBbqChecklist([{ name: "Wing Platter", quantity: 2, isFood: true }], {
      wings: { quantity: 3 }, "chicken-tenders": { quantity: 2 },
    });
    expect(mixed.sections.flatMap((section) => section.rows).find((row) => row.key === "sauce-bbq")?.quantity).toBe(7);
    const before = structuredClone(mixed);
    const storage = bbqOnlyStorage();
    await synchronize(mixed, { sourceVersion: 1, storage: storage as never, env });
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "sauce-bbq", quantity: 2, sourceType: "TRIPLESEAT_CONTRACT" });
    expect(mixed).toEqual(before);
  });

  it("does not create a contract BBQ order when all BBQ comes from live platters", async () => {
    const liveOnly = generatedBbqChecklist([], { wings: { quantity: 3 }, "chicken-tenders": { quantity: 2 } });
    expect(liveOnly.sections.flatMap((section) => section.rows).find((row) => row.key === "sauce-bbq")?.quantity).toBe(5);
    const storage = bbqOnlyStorage();
    await synchronize(liveOnly, { sourceVersion: 1, storage: storage as never, env });
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
    expect(storage.saveProjectionExceptions.mock.calls[0][0].exceptions.some((item: { itemKey: string }) => item.itemKey === "sauce-bbq")).toBe(false);
  });

  it.each(["Appetizer Bar", "Wing Bar"])("keeps the one contract %s BBQ bowl separate from live wings", async (bar) => {
    const mixed = generatedBbqChecklist([
      { name: "The Front Nine", quantity: 25, isFood: true }, { name: bar, quantity: 25, isFood: true },
    ], { wings: { quantity: 2 } });
    expect(mixed.sections.flatMap((section) => section.rows).find((row) => row.key === "sauce-bbq")?.quantity).toBe(3);
    const storage = bbqOnlyStorage();
    await synchronize(mixed, { sourceVersion: 1, storage: storage as never, env });
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "sauce-bbq", quantity: 1 });
  });

  it("does not replay or flag contract BBQ when only live platter quantities change", async () => {
    const source = [{ name: "Wing Platter", quantity: 2, isFood: true }];
    const previous = [{ source_record_id: "platter-wings", quantity: 2, pan_size: "HALF_PAN" }];
    const immutablePlatter = structuredClone(previous[0]);
    const storage = bbqOnlyStorage(previous);
    await synchronize(generatedBbqChecklist(source, { wings: { quantity: 3 }, "chicken-tenders": { quantity: 2 } }), { sourceVersion: 1, storage: storage as never, env });
    const repeat = await synchronize(generatedBbqChecklist(source, { wings: { quantity: 5 }, "chicken-tenders": { quantity: 2 } }), { sourceVersion: 2, storage: storage as never, env });
    expect(repeat.requestCount).toBe(0);
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "sauce-bbq", quantity: 2 });
    for (const [saved] of storage.saveProjectionExceptions.mock.calls) {
      expect(saved.exceptions.some((item: { itemKey: string }) => item.itemKey === "sauce-bbq")).toBe(false);
    }
    expect(previous[0]).toEqual(immutablePlatter);
  });

  it.each([null, 0, 1, 2.5])("fails safely for an invalid or negative derived contract BBQ remainder: %s", async (quantity) => {
    const mixed = generatedBbqChecklist([{ name: "Wing Platter", quantity: 2, isFood: true }], { wings: { quantity: 2 } });
    mixed.sections.flatMap((section) => section.rows).find((row) => row.key === "sauce-bbq")!.quantity = quantity;
    const storage = bbqOnlyStorage();
    await synchronize(mixed, { sourceVersion: 1, storage: storage as never, env });
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
    expect(storage.saveProjectionExceptions).toHaveBeenCalledWith(expect.objectContaining({
      exceptions: expect.arrayContaining([expect.objectContaining({ itemKey: "sauce-bbq", reason: "A positive operational quantity is required." })]),
    }));
  });

  it("does not attribute an unresolved live platter quantity to contract BBQ", async () => {
    const mixed = generatedBbqChecklist([{ name: "Wing Platter", quantity: 2, isFood: true }], { wings: { quantity: 2 } });
    mixed.liveFoodAddOns[0].quantity = 65;
    const storage = bbqOnlyStorage();
    await synchronize(mixed, { sourceVersion: 1, storage: storage as never, env });
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
    expect(storage.saveProjectionExceptions).toHaveBeenCalledWith(expect.objectContaining({
      exceptions: expect.arrayContaining([expect.objectContaining({ itemKey: "sauce-bbq", reason: "A positive operational quantity is required." })]),
    }));
  });

  it.each(["VERIFIED", "DISABLED", "MAPPED", "NEEDS_MAPPING"])("uses the BBQ bowl fallback only with VERIFIED stored mappings: %s", async (mappingStatus) => {
    const storage = {
      listContractFoodRequests: vi.fn().mockResolvedValue([]),
      listMappings: vi.fn().mockResolvedValue([
        contractBbqMappings[0], { ...contractBbqMappings[1], mapping_status: mappingStatus },
      ]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({ duplicate: false }),
    };
    const result = await synchronize(contractWithBbq(), { sourceVersion: 99, storage: storage as never, env });
    expect(result).toMatchObject({ requestCount: mappingStatus === "VERIFIED" ? 2 : 1, exceptionCount: mappingStatus === "VERIFIED" ? 0 : 1 });
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "platter-veggie-tray" });
    if (mappingStatus === "VERIFIED") {
      expect(storage.enqueueRequest.mock.calls[1][0]).toMatchObject({
        sourceRecordId: "sauce-bbq", sourceVersion: 1, sourceType: "TRIPLESEAT_CONTRACT",
        canonicalProductKey: "addon:bbq-sauce", quantity: 3, panSize: "BOWL", gotabProductUuid: "product-bbq",
      });
    } else {
      expect(storage.saveProjectionExceptions).toHaveBeenCalledWith(expect.objectContaining({
        exceptions: [expect.objectContaining({ itemKey: "sauce-bbq" })],
      }));
    }
  });

  it("queues a newly derived BBQ row once without replaying an existing contract platter", async () => {
    const previous = [{ source_record_id: "platter-veggie-tray", quantity: 1, pan_size: "TRAY" }];
    const storage = {
      listContractFoodRequests: vi.fn().mockImplementation(async () => previous),
      listMappings: vi.fn().mockResolvedValue(contractBbqMappings),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockImplementation(async (request) => {
        previous.push({ source_record_id: request.sourceRecordId, quantity: request.quantity, pan_size: request.panSize });
        return { duplicate: false };
      }),
    };
    const first = await synchronize(contractWithBbq(), { sourceVersion: 99, storage: storage as never, env });
    const repeated = await synchronize(contractWithBbq(), { sourceVersion: 100, storage: storage as never, env });
    expect(first).toMatchObject({ requestCount: 1, exceptionCount: 0 });
    expect(repeated).toMatchObject({ requestCount: 0, exceptionCount: 0 });
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "sauce-bbq", sourceVersion: 1, quantity: 3 });
  });

  it("keeps derived prep sauces out of an immediate Wing Platter add-on dispatch", async () => {
    const liveFoodAddOns = translateEventHostFoodAddOns({ wings: { quantity: 1, panSize: "1/2" } }, "2026-10-23T16:00:00.000Z");
    const withAddOn = generateKitchenChecklist({
      eventId: 123, eventName: "Redacted event", localDate: "2026-10-23", startTime: "6:00 PM",
      guestCount: 18, status: "DEFINITE", selections: [],
    }, undefined, liveFoodAddOns);
    const storage = {
      listMappings: vi.fn().mockResolvedValue([
        contractBbqMappings[1],
        { ...contractBbqMappings[0], canonical_product_key: "addon:wings", pan_size: "HALF_PAN", gotab_product_uuid: "product-wings" },
      ]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({ duplicate: false }),
    };
    const result = await synchronizeLiveAddOns(withAddOn, { sourceVersion: 4, changedSourceKeys: ["wings"], storage: storage as never, env });
    expect(result).toMatchObject({ requestCount: 1, exceptionCount: 0 });
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
    expect(storage.enqueueRequest.mock.calls[0][0]).toMatchObject({ sourceRecordId: "addon:wings", quantity: 1, gotabProductUuid: "product-wings" });
  });

  it("queues booked VIP food at prep time without payment or add-on rows", async () => {
    const vipChecklist = generateKitchenChecklist(vipPrepKitchenEvents(vipPrepPayload.reservations)[0]);
    const wing = vipChecklist.sections.flatMap((section) => section.rows)
      .find((row) => row.key === "platter-wings")!;
    const storage = {
      listVipBookingFoodRequests: vi.fn().mockResolvedValue([]),
      listMappings: vi.fn().mockResolvedValue([{
        id: "vip-wing-mapping",
        canonical_product_key: wing.key,
        display_name: "Wing Platter",
        aliases: [],
        pan_size: wing.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN",
        preparation_station: "HOT_LINE",
        gotab_product_uuid: "wing-product",
        mapping_status: "VERIFIED",
        verified_at: "2026-08-11T12:00:00.000Z",
      }]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({ duplicate: false }),
      performAdministrativeAction: vi.fn(),
    };
    const result = await synchronizeVipBookingFood(vipChecklist, { storage: storage as never, env });
    expect(result.requestCount).toBe(1);
    expect(storage.enqueueRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "VIP_ADDON", quantity: 2, sourceRecordId: "platter-wings",
        eventArea: "VIP 2", requestNotes: "Reservation time: 6:00 PM",
      }),
      expect.objectContaining({ ticketName: "[VIP FOOD] Redacted VIP" }),
      "VIP_BOOKING_SYNC",
    );
    expect(JSON.stringify(storage.enqueueRequest.mock.calls)).not.toMatch(/unitPriceCents|totalCents/);
  });

  it("does not queue the same VIP booking food twice after a repeated check-in or sync", async () => {
    const vipChecklist = generateKitchenChecklist(vipPrepKitchenEvents(vipPrepPayload.reservations)[0]);
    const wing = vipChecklist.sections.flatMap((section) => section.rows)
      .find((row) => row.key === "platter-wings")!;
    const previous: Array<{
      id: string; source_record_id: string; quantity: number; pan_size: string; dispatch_status: string;
    }> = [];
    const storage = {
      listVipBookingFoodRequests: vi.fn().mockImplementation(async () => previous),
      listMappings: vi.fn().mockResolvedValue([{
        id: "vip-wing-mapping",
        canonical_product_key: wing.key,
        display_name: "Wing Platter",
        aliases: [],
        pan_size: wing.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN",
        preparation_station: "HOT_LINE",
        gotab_product_uuid: "wing-product",
        mapping_status: "VERIFIED",
        verified_at: "2026-08-11T12:00:00.000Z",
      }]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockImplementation(async (request) => {
        previous.push({
          id: "request-1",
          source_record_id: request.sourceRecordId,
          quantity: request.quantity,
          pan_size: request.panSize,
          dispatch_status: "SCHEDULED",
        });
        return { duplicate: false };
      }),
      performAdministrativeAction: vi.fn(),
    };
    const first = await synchronizeVipBookingFood(vipChecklist, { storage: storage as never, env });
    const repeated = await synchronizeVipBookingFood(vipChecklist, { storage: storage as never, env });
    expect(first.requestCount).toBe(1);
    expect(repeated.requestCount).toBe(0);
    expect(storage.enqueueRequest).toHaveBeenCalledTimes(1);
  });

  it("holds a pending VIP order when booked food changes instead of sending a duplicate", async () => {
    const vipChecklist = generateKitchenChecklist(vipPrepKitchenEvents(vipPrepPayload.reservations)[0]);
    const wing = vipChecklist.sections.flatMap((section) => section.rows)
      .find((row) => row.key === "platter-wings")!;
    const storage = {
      listVipBookingFoodRequests: vi.fn().mockResolvedValue([{
        id: "previous-request",
        source_record_id: wing.key,
        quantity: 1,
        pan_size: wing.panSize === "1/3" ? "THIRD_PAN" : "HALF_PAN",
        dispatch_status: "SCHEDULED",
      }]),
      listMappings: vi.fn(),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn(),
      performAdministrativeAction: vi.fn().mockResolvedValue({ request_id: "previous-request", action: "HOLD" }),
    };
    const result = await synchronizeVipBookingFood(vipChecklist, { storage: storage as never, env });
    expect(result).toMatchObject({ requestCount: 0, exceptionCount: 1 });
    expect(storage.performAdministrativeAction).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "previous-request", action: "HOLD" }),
    );
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
  });

  it("uses a stable version until operational food content changes", () => {
    expect(sourceVersion(checklist)).toBe(sourceVersion(structuredClone(checklist)));
    const changed = structuredClone(checklist);
    changed.sections[0].rows[0].quantity = (changed.sections[0].rows[0].quantity ?? 0) + 1;
    expect(sourceVersion(changed)).not.toBe(sourceVersion(checklist));
  });

  it("stores unmapped rows as exceptions and does not enqueue them", async () => {
    const storage = {
      listContractFoodRequests: vi.fn().mockResolvedValue([]),
      listMappings: vi.fn().mockResolvedValue([]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn(),
    };
    const result = await synchronize(checklist, {
      sourceVersion: 1,
      storage: storage as never,
      env,
    });
    expect(result.exceptionCount).toBeGreaterThan(0);
    expect(storage.saveProjectionExceptions).toHaveBeenCalledOnce();
    expect(storage.enqueueRequest).not.toHaveBeenCalled();
  });

  it.each(["Carlos", null])("keeps the Food Runner (%s) separate from the POC in the preview", async (foodRunner) => {
    const assignedChecklist = { ...checklist, foodRunners: foodRunner ? [foodRunner] : [], pocs: ["Ryan", "Diana"] };
    const storage = {
      listContractFoodRequests: vi.fn().mockResolvedValue([]),
      listMappings: vi.fn().mockResolvedValue([{
        id: "mapping-1",
        canonical_product_key: "platter-veggie-tray",
        source_system: "EVENT_HOST",
        source_product_key: "platter-veggie-tray",
        source_product_name: "Veggie Tray",
        aliases: [],
        display_name: "Veggie Tray",
        pan_size: "TRAY",
        preparation_station: "COLD_PREP",
        gotab_product_uuid: "product-1",
        mapping_status: "VERIFIED",
        verified_at: "2026-08-11T12:00:00.000Z",
        updated_at: "2026-08-11T12:00:00.000Z",
      }]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({ request_id: "r1", dispatch_id: "d1", duplicate: false }),
    };
    const result = await synchronize(assignedChecklist, {
      sourceVersion: 1,
      storage: storage as never,
      env,
    });
    expect(result.requestCount).toBe(1);
    expect(storage.enqueueRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "OPE KDS Integration Test",
        panSize: "TRAY",
        requesterName: foodRunner,
      }),
      expect.objectContaining({
        requesterName: foodRunner,
        warnings: expect.arrayContaining(["GoTab dispatch is disabled."]),
      }),
      "SYSTEM",
    );
    await synchronize(assignedChecklist, { sourceVersion: 2, sourceType: "REFILL", requesterName: "Staff Requester", storage: storage as never, env });
    expect(storage.enqueueRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ requesterName: "Staff Requester", sourceType: "REFILL" }),
      expect.objectContaining({ requesterName: "Staff Requester" }),
      "SYSTEM",
    );
    expect(assignedChecklist.foodRunners).toEqual(foodRunner ? [foodRunner] : []);
    expect(assignedChecklist.pocs).toEqual(["Ryan", "Diana"]);
    await synchronize(assignedChecklist, { sourceVersion: 3, requesterName: "Not a contract Food Runner override", storage: storage as never, env });
    expect(storage.enqueueRequest).toHaveBeenLastCalledWith(expect.objectContaining({ requesterName: foodRunner }), expect.objectContaining({ requesterName: foodRunner }), "SYSTEM");
  });

  it("queues only the changed VIP live add-on with the VIP ticket label", async () => {
    const vipChecklist = generateKitchenChecklist({
      eventId: "vip-reservation-1",
      bookingId: null,
      eventName: "Taylor Smith VIP",
      localDate: "2026-08-15",
      startTime: "6:00 PM",
      guestCount: 16,
      status: "DEFINITE",
      room: "VIP 2",
      selections: [],
    }, undefined, [
      {
        itemKey: "addon:mozzarella-sticks",
        foodName: "Mozzarella Sticks",
        description: "Live add-on",
        quantity: 1,
        unit: "platter",
        numberOfPans: 1,
        panSize: "1/2",
        sourceUpdatedAt: "2026-08-15T16:00:00.000Z",
      },
      {
        itemKey: "addon:ranch",
        foodName: "Ranch",
        description: "Live add-on",
        quantity: 1,
        unit: "bowl",
        numberOfPans: null,
        panSize: null,
        sourceUpdatedAt: "2026-08-15T16:00:00.000Z",
      },
    ]);
    const storage = {
      listMappings: vi.fn().mockResolvedValue([{
        id: "mapping-mozzarella",
        canonical_product_key: "addon:mozzarella-sticks",
        aliases: [],
        display_name: "Mozzarella Stick Platter",
        pan_size: "HALF_PAN",
        preparation_station: "HOT_LINE",
        gotab_product_uuid: "product-mozzarella",
        mapping_status: "VERIFIED",
        verified_at: "2026-08-11T12:00:00.000Z",
      }]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({
        request_id: "r1",
        dispatch_id: "d1",
        duplicate: false,
      }),
    };

    const result = await synchronizeLiveAddOns(vipChecklist, {
      sourceVersion: 4,
      changedSourceKeys: ["mozzarella-sticks"],
      storage: storage as never,
      env,
    });

    expect(result.requestCount).toBe(1);
    expect(storage.enqueueRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "VIP_ADDON",
        eventName: "Taylor Smith VIP",
        originalSourceName: "Mozzarella Sticks",
      }),
      expect.objectContaining({
        ticketName: "[VIP FOOD] Taylor Smith VIP",
        product: "Mozzarella Stick Platter",
      }),
      "EVENT_HOST_ADDON_SAVE",
      { immediate: true },
    );
  });

  it.each(["VERIFIED", "DISABLED"])("uses only a verified BBQ mapping for Appetizer refills: %s", async (mappingStatus) => {
    const refillChecklist = {
      ...checklist,
      liveFoodAddOns: translateEventHostFoodAddOns({
        "appetizer-refill-bbq": { quantity: 10 },
      }, "2026-08-15T16:00:00.000Z"),
    };
    const storage = {
      listMappings: vi.fn().mockResolvedValue([{
        id: "mapping-bbq",
        canonical_product_key: "addon:wing-refill-bbq",
        aliases: [],
        display_name: "BBQ",
        pan_size: "NOT_APPLICABLE",
        preparation_station: "COLD_PREP",
        gotab_product_uuid: "prd_a7f6Zpe_0WsCxf_yftoeP1pA",
        mapping_status: mappingStatus,
        verified_at: "2026-08-11T12:00:00.000Z",
      }]),
      saveProjectionExceptions: vi.fn().mockResolvedValue(undefined),
      enqueueRequest: vi.fn().mockResolvedValue({ duplicate: false }),
    };
    const result = await synchronizeLiveAddOns(refillChecklist, {
      sourceVersion: 2,
      changedSourceKeys: ["appetizer-refill-bbq"],
      sourceType: "REFILL",
      storage: storage as never,
      env,
    });

    if (mappingStatus === "VERIFIED") {
      expect(result).toMatchObject({ requestCount: 1, exceptionCount: 0 });
      expect(storage.enqueueRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceRecordId: "addon:appetizer-refill-bbq",
          sourceType: "REFILL",
          quantity: 10,
          gotabProductUuid: "prd_a7f6Zpe_0WsCxf_yftoeP1pA",
        }),
        expect.anything(),
        "EVENT_HOST_ADDON_SAVE",
        { immediate: true },
      );
    } else {
      expect(result).toMatchObject({ requestCount: 0, exceptionCount: 1 });
      expect(storage.enqueueRequest).not.toHaveBeenCalled();
    }
  });
});
