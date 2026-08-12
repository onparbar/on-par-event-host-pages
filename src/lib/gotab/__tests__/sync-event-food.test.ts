import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";

vi.mock("server-only", () => ({}));

let synchronize: typeof import("../sync-event-food").synchronizeKitchenChecklistToEventFood;
let synchronizeLiveAddOns: typeof import("../sync-event-food").synchronizeKitchenLiveAddOnsToEventFood;
let sourceVersion: typeof import("../sync-event-food").eventFoodSourceVersion;

beforeAll(async () => {
  ({
    synchronizeKitchenChecklistToEventFood: synchronize,
    synchronizeKitchenLiveAddOnsToEventFood: synchronizeLiveAddOns,
    eventFoodSourceVersion: sourceVersion,
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
    const result = await synchronize(checklist, {
      sourceVersion: 1,
      storage: storage as never,
      env,
    });
    expect(result.requestCount).toBe(1);
    expect(storage.enqueueRequest).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "OPE KDS Integration Test", panSize: "TRAY" }),
      expect.objectContaining({ warnings: expect.arrayContaining(["GoTab dispatch is disabled."]) }),
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
