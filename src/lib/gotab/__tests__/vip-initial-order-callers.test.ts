import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncKitchenDay: vi.fn(), getKitchenDay: vi.fn(), synchronizeVipBookingFoodToEventFood: vi.fn(),
  synchronizeKitchenChecklistToEventFood: vi.fn().mockResolvedValue({ exceptionCount: 0 }),
  getVipCheckin: vi.fn(), processGoTabDispatches: vi.fn().mockResolvedValue({ claimed: 0, sent: 0 }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/kitchen/sync", () => ({ ...mocks, assertKitchenDate: vi.fn(), KitchenSyncError: class extends Error {} }));
vi.mock("@/lib/operational-access", () => ({ isSameOriginOperationalRequest: () => true, operationalAccessDenied: vi.fn() }));
vi.mock("@/lib/gotab/config", () => ({ getGoTabConfigurationStatus: () => ({ configured: true }) }));
vi.mock("@/lib/gotab/sync-event-food", () => ({ ...mocks, eventFoodSourceVersion: () => 1 }));
vi.mock("@/lib/gotab/worker", () => ({ processGoTabDispatches: mocks.processGoTabDispatches }));
vi.mock("@/lib/gotab/storage", () => ({ GoTabIntegrationStorage: class { getVipCheckin = mocks.getVipCheckin; } }));

const { POST: syncKitchen } = await import("@/app/api/kitchen/sync/route");
const { GET: reconcile } = await import("@/app/api/gotab/reconcile/route");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EVENT_KDS_DRY_RUN", "false");
  vi.stubEnv("CRON_SECRET", "sanitized-test-cron");
});
afterEach(() => vi.unstubAllEnvs());

describe("only explicit Event Host arrival creates VIP initial food", () => {
  it.each([false, true])("kitchen sync does not create initial food for a VIP with saved arrival=%s", async (checkedIn) => {
    mocks.getVipCheckin.mockResolvedValue(checkedIn ? { employee_name: "Tina" } : null);
    const vip = { event: { eventId: "vip-test-booking", name: "Sanitized VIP" },
      normalizedSelections: [{ originalName: "Amended preorder", quantity: 2 }] };
    const corporate = { event: { eventId: "corporate-test", name: "Sanitized Corporate" } };
    mocks.syncKitchenDay.mockResolvedValue({ events: [vip, corporate], warnings: [] });
    const response = await syncKitchen(new Request("https://event-host.test/api/kitchen/sync", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-11-14" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.synchronizeVipBookingFoodToEventFood).not.toHaveBeenCalled();
    expect(mocks.getVipCheckin).not.toHaveBeenCalled();
    expect(mocks.synchronizeKitchenChecklistToEventFood).toHaveBeenCalledExactlyOnceWith(corporate,
      expect.objectContaining({ sourceVersion: 1, actor: "TRIPLESEAT_SYNC" }));
  });

  it("cron processes existing due requests without staging a changed or unchecked-in VIP source order", async () => {
    mocks.getKitchenDay.mockResolvedValue({ events: [{ event: { eventId: "vip-test-booking", name: "Amended VIP" } }], warnings: [], missingEnvironmentVariables: [] });
    const response = await reconcile(new Request("https://event-host.test/api/gotab/reconcile", {
      headers: { authorization: "Bearer sanitized-test-cron" },
    }));
    expect(response.status).toBe(200);
    expect(mocks.getKitchenDay).not.toHaveBeenCalled();
    expect(mocks.synchronizeVipBookingFoodToEventFood).not.toHaveBeenCalled();
    expect(mocks.processGoTabDispatches).toHaveBeenCalledExactlyOnceWith();
    expect((await response.json()).vipBookingFood).toEqual({ queued: 0, exceptions: 0, warning: null });
  });

  it("retains the cron secret requirement", async () => {
    const response = await reconcile(new Request("https://event-host.test/api/gotab/reconcile"));
    expect(response.status).toBe(401);
    expect(mocks.processGoTabDispatches).not.toHaveBeenCalled();
  });
});
