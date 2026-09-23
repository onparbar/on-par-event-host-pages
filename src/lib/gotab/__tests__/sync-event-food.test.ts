import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";

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

describe("Event Food synchronization", () => {
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

  it("enqueues a verified mapped product with a sanitized dry-run preview", async () => {
    const assignedChecklist = { ...checklist, pocs: ["Ryan", "Diana"] };
    const storage = {
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
        requesterName: "Ryan",
      }),
      expect.objectContaining({
        requesterName: "Ryan",
        warnings: expect.arrayContaining(["GoTab dispatch is disabled."]),
      }),
      "SYSTEM",
    );
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
});
