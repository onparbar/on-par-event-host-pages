import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GoTabIntegrationStorage } from "../storage";

vi.mock("server-only", () => ({}));

const kitchenMocks = vi.hoisted(() => ({
  getKitchenEventChecklist: vi.fn(),
  getKitchenEventFoodAddOns: vi.fn(),
  updateKitchenEventFoodAddOns: vi.fn(),
}));
const gotabMocks = vi.hoisted(() => ({
  synchronizeKitchenLiveAddOnsToEventFood: vi.fn(),
  processGoTabDispatches: vi.fn(),
}));

vi.mock("@/lib/kitchen/sync", () => kitchenMocks);
vi.mock("../sync-event-food", () => ({
  synchronizeKitchenLiveAddOnsToEventFood:
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood,
}));
vi.mock("../worker", () => ({
  processGoTabDispatches: gotabMocks.processGoTabDispatches,
}));

let synchronizeChecklistFoodAddOns: typeof import("../sync-checklist-addons").synchronizeChecklistFoodAddOns;

beforeAll(async () => {
  ({ synchronizeChecklistFoodAddOns } = await import("../sync-checklist-addons"));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(GoTabIntegrationStorage.prototype, "listEventFoodDelivery").mockResolvedValue([{
    requestId: "request-1", eventId: "event-1", sourceKey: "addon:wing-refill-wings", foodName: "Wings",
    quantity: 1, panSize: "TRAY", status: "SENT", orderReference: "order-1", acceptedAt: "2026-08-12T17:00:00.000Z",
    updatedAt: "2026-08-12T17:00:00.000Z", error: null,
  }]);
});

describe("Event Add-Ons Kitchen and KDS synchronization", () => {
  it("updates Kitchen, queues changed food, and dispatches it to KDS", async () => {
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({
      food: {},
    });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "event-1",
      food: { "wing-refill-wings": { quantity: 1 } },
      revision: 2,
      updatedAt: "2026-08-12T17:00:00.000Z",
    });
    kitchenMocks.getKitchenEventChecklist.mockResolvedValue({ event: {} });
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood.mockResolvedValue({
      requestCount: 1,
      exceptionCount: 0,
      requestIds: ["request-1"],
    });
    gotabMocks.processGoTabDispatches.mockResolvedValue({ sent: 1, lastError: null });

    await expect(
      synchronizeChecklistFoodAddOns("event-1", {
        "wing-refill-wings": { quantity: 1 },
      }),
    ).resolves.toMatchObject({ queued: 1, exceptions: 0, sent: 1 });
    expect(
      gotabMocks.synchronizeKitchenLiveAddOnsToEventFood,
    ).toHaveBeenCalledWith(
      { event: {} },
      {
        sourceVersion: 2,
        changedSourceKeys: ["wing-refill-wings"],
        dispatchImmediately: true,
      },
    );
    expect(gotabMocks.processGoTabDispatches).toHaveBeenCalledOnce();
    expect(gotabMocks.processGoTabDispatches).toHaveBeenCalledWith({ requestIds: ["request-1"] });
  });

  it("retries an explicitly submitted item even when its saved quantity is unchanged", async () => {
    const food = { "wing-refill-wings": { quantity: 1 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({
      eventId: "event-1",
      food,
      revision: 3,
      updatedAt: "2026-08-12T17:05:00.000Z",
    });
    kitchenMocks.getKitchenEventChecklist.mockResolvedValue({ event: {} });
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood.mockResolvedValue({
      requestCount: 1,
      exceptionCount: 0,
      requestIds: ["request-1"],
    });
    gotabMocks.processGoTabDispatches.mockResolvedValue({ sent: 1, lastError: null });

    await expect(
      synchronizeChecklistFoodAddOns("event-1", food, ["wing-refill-wings"]),
    ).resolves.toMatchObject({ queued: 1, exceptions: 0, sent: 1 });
    expect(
      gotabMocks.synchronizeKitchenLiveAddOnsToEventFood,
    ).toHaveBeenCalledWith(
      { event: {} },
      {
        sourceVersion: 3,
        changedSourceKeys: ["wing-refill-wings"],
        dispatchImmediately: true,
      },
    );
  });

  it("keeps a known pending refill separate from errors without another send", async () => {
    const food = { "appetizer-refill-tater-kegs": { quantity: 1 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 3 });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([{
      requestId: "pending-refill", eventId: "event-1", sourceKey: "addon:appetizer-refill-tater-kegs",
      foodName: "Tater Kegs", quantity: 1, panSize: "NOT_APPLICABLE", status: "SENDING",
      orderReference: null, acceptedAt: null, updatedAt: "2026-10-23T16:30:00Z", error: null,
    }]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    expect(result).toMatchObject({ deliveryVerified: false, deliveryPending: true, exceptions: 0, error: null, requestIds: ["pending-refill"] });
    expect(gotabMocks.processGoTabDispatches).not.toHaveBeenCalled();
  });

  it("never counts another event's successful worker send as this item's acceptance", async () => {
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food: {} });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ food: { wings: { quantity: 1 } }, revision: 4 });
    kitchenMocks.getKitchenEventChecklist.mockResolvedValue({ event: {} });
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood.mockResolvedValue({ requestCount: 1, exceptionCount: 0, requestIds: ["our-request"] });
    gotabMocks.processGoTabDispatches.mockResolvedValue({ sent: 17, lastError: null });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([{
      requestId: "another-request", eventId: "other-event", sourceKey: "addon:wings", foodName: "Wings", quantity: 1,
      panSize: "TRAY", status: "SENT", orderReference: "other-order", acceptedAt: null, updatedAt: "", error: null,
    }]);
    const result = await synchronizeChecklistFoodAddOns("event-1", { wings: { quantity: 1 } }, ["wings"]);
    expect(result.sent).toBe(0);
    expect(result.deliveries).toEqual([]);
    expect(result.error).toContain("unavailable");
    expect(GoTabIntegrationStorage.prototype.listEventFoodDelivery).toHaveBeenCalledWith(["event-1"], ["our-request"]);
  });

  it.each(["FAILED", "HELD", "SENDING", "QUEUED", "UNKNOWN"])("does not call unchanged food accepted when its prior dispatch is %s", async (status) => {
    const food = { "wing-refill-wings": { quantity: 1 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 5, updatedAt: "2026-10-21T17:00:00Z" });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([{ requestId: "prior-failed", eventId: "event-1", sourceKey: "addon:wing-refill-wings", foodName: "Wings", quantity: 1, panSize: "TRAY", status, orderReference: null, acceptedAt: null, updatedAt: "2026-10-21T17:00:00Z", error: null }]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    const pending = ["SENDING", "QUEUED"].includes(status);
    expect(result).toMatchObject({ queued: 0, sent: 0, acceptedDeliveryCount: 0, deliveryVerified: false, noFoodRequired: false, deliveryPending: pending, exceptions: pending ? 0 : 1 });
    expect(result.deliveries).toHaveLength(1);
    expect(gotabMocks.processGoTabDispatches).not.toHaveBeenCalled();
    expect(gotabMocks.synchronizeKitchenLiveAddOnsToEventFood).not.toHaveBeenCalled();
  });

  it("requires delivery evidence for every positive saved item, not an empty zero-equals-zero result", async () => {
    const food = { wings: { quantity: 1 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 5 });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    expect(result).toMatchObject({ deliveryVerified: false, exceptions: 1, sent: 0 });
    expect(result.error).toContain("missing");
  });

  it("accepts a verified later correction when the earlier failed attempt was explicitly cancelled", async () => {
    const food = { wings: { quantity: 2 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 6 });
    const current = { requestId: "current", eventId: "event-1", sourceKey: "addon:wings", foodName: "Wings", quantity: 2, panSize: "TRAY", status: "SENT", orderReference: "order-current", acceptedAt: "2026-10-21T18:00:00Z", updatedAt: "2026-10-21T18:00:00Z", error: null };
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([current, { ...current, requestId: "old-cancelled", status: "CANCELLED", quantity: 1 }]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    expect(result).toMatchObject({ queued: 0, sent: 1, deliveryVerified: true, exceptions: 0 });
    expect(result.deliveries).toEqual([current]);
  });

  it("retains an older unsettled attempt even when a newer request was accepted", async () => {
    const food = { wings: { quantity: 2 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 6 });
    const current = { requestId: "current", eventId: "event-1", sourceKey: "addon:wings", foodName: "Wings", quantity: 2, panSize: "TRAY", status: "SENT", orderReference: "order-current", acceptedAt: "2026-10-21T18:00:00Z", updatedAt: "2026-10-21T18:00:00Z", error: null };
    const held = { ...current, requestId: "older-held", status: "HELD", quantity: 1 };
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([current, held]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    expect(result.deliveryVerified).toBe(false);
    expect(result.deliveries).toEqual([current, held]);
  });

  it("does not call an event accepted when a new item succeeded but an unchanged item is still held", async () => {
    const food = { wings: { quantity: 1 }, "dessert-platter": { quantity: 1 } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food: { wings: food.wings } });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 7 });
    kitchenMocks.getKitchenEventChecklist.mockResolvedValue({ event: {} });
    gotabMocks.synchronizeKitchenLiveAddOnsToEventFood.mockResolvedValue({ requestCount: 1, exceptionCount: 0, requestIds: ["new-dessert"] });
    const dessert = { requestId: "new-dessert", eventId: "event-1", sourceKey: "addon:dessert-platter", foodName: "Dessert Platter", quantity: 1, panSize: "TRAY", status: "SENT", orderReference: "order-dessert", acceptedAt: "2026-10-21T18:00:00Z", updatedAt: "2026-10-21T18:00:00Z", error: null };
    const held = { ...dessert, requestId: "held-wing", sourceKey: "addon:wings", foodName: "Wings", status: "HELD", orderReference: null };
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockImplementation(async (_eventIds, requestIds) => requestIds ? [dessert] : [dessert, held]);
    const result = await synchronizeChecklistFoodAddOns("event-1", food);
    expect(result).toMatchObject({ queued: 1, sent: 1, acceptedDeliveryCount: 1, deliveryVerified: false, noFoodRequired: false, exceptions: 1 });
    expect(result.deliveries).toEqual([dessert, held]);
  });

  it("distinguishes no food required from GoTab acceptance", async () => {
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food: {} });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food: {}, revision: 7 });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([]);
    expect(await synchronizeChecklistFoodAddOns("event-1", {})).toMatchObject({ deliveryVerified: false, noFoodRequired: true, sent: 0, acceptedDeliveryCount: 0 });
  });

  it.each([
    ["1/2", "THIRD_PAN", false],
    ["1/3", "HALF_PAN", false],
    ["1/2", "HALF_PAN", true],
    ["1/3", "THIRD_PAN", true],
    ["", "TRAY", true],
  ] as const)("checks explicit pan choice %s against saved delivery %s", async (panSize, deliveredPanSize, accepted) => {
    const food = { wings: { quantity: 1, panSize } };
    kitchenMocks.getKitchenEventFoodAddOns.mockResolvedValue({ food });
    kitchenMocks.updateKitchenEventFoodAddOns.mockResolvedValue({ eventId: "event-1", food, revision: 8 });
    vi.mocked(GoTabIntegrationStorage.prototype.listEventFoodDelivery).mockResolvedValue([{ requestId: "prior-sent", eventId: "event-1", sourceKey: "addon:wings", foodName: "Wings", quantity: 1, panSize: deliveredPanSize, status: "SENT", orderReference: "order-prior", acceptedAt: "2026-10-21T18:00:00Z", updatedAt: "2026-10-21T18:00:00Z", error: null }]);
    expect(await synchronizeChecklistFoodAddOns("event-1", food)).toMatchObject({ deliveryVerified: accepted, acceptedDeliveryCount: accepted ? 1 : 0, exceptions: accepted ? 0 : 1 });
    expect(gotabMocks.processGoTabDispatches).not.toHaveBeenCalled();
  });
});
