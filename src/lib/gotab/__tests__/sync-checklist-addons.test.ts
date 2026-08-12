import { beforeAll, describe, expect, it, vi } from "vitest";

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
    });
    gotabMocks.processGoTabDispatches.mockResolvedValue({ sent: 1 });

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
  });
});
