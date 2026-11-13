import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEntertainmentStorage, getEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { getFloorPlanDay } from "@/lib/floor-plans/service";
import { MemoryFloorPlanStorage } from "@/lib/floor-plans/storage";
import { getKitchenDay } from "@/lib/kitchen/sync";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";
import { setTripleseatAdapterForTests, type TripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";
import { listVipCheckins } from "@/lib/vip-checkin/service";
import { loadVipSyncHealth } from "../sync-health";
import { novemberVipPayload } from "./prearrival-fixtures";

vi.mock("server-only", () => ({}));

const DATE = "2026-11-14";
const ID = "redacted-november-vip";

function setup() {
  const plans = createMemoryEventPlanStorage();
  const entertainment = createMemoryEntertainmentStorage();
  const kitchenStorage = createMemoryKitchenStorage();
  const floorStorage = new MemoryFloorPlanStorage();
  setEventPlanStorageForTests(plans);
  setEntertainmentStorageForTests(entertainment);
  setKitchenStorageForTests(kitchenStorage);
  const adapter: TripleseatAdapter = {
    sourceMode: "live", fetchEventsForDate: async () => [],
    fetchEntertainmentEventsForDate: async () => { throw new Error("Unrelated Tripleseat outage"); },
    fetchEventDateById: async () => null,
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
  };
  setTripleseatAdapterForTests(adapter);
  const arrivalStorage = { listVipCheckinsForDate: vi.fn(async () => []) };
  const saves = [vi.spyOn(floorStorage, "save"), vi.spyOn(kitchenStorage, "saveEvent"),
    vi.spyOn(kitchenStorage, "replaceDay"), vi.spyOn(entertainment, "saveContractEvidence"),
    vi.spyOn(GoTabIntegrationStorage.prototype, "confirmVipCheckin"),
    vi.spyOn(GoTabIntegrationStorage.prototype, "enqueueRequest"),
    vi.spyOn(GoTabIntegrationStorage.prototype, "claimDueDispatches")];
  const payload = novemberVipPayload();
  const client = { configured: true, fetchRange: vi.fn(async () => payload) };
  const floorPlan = vi.fn<typeof getFloorPlanDay>(async (date, _storage, options) => getFloorPlanDay(date, floorStorage, options));
  const kitchen = vi.fn<typeof getKitchenDay>(async (date, options) => getKitchenDay(date, { ...options,
    storage: kitchenStorage, adapter, floorPlanStorage: floorStorage, now: new Date("2026-10-26T18:00:00Z") }));
  const checkIn = vi.fn<typeof listVipCheckins>(async (date, options) => listVipCheckins(date, { ...options,
    storage: arrivalStorage as never, kitchenStorage }));
  return { payload, client, floorPlan, kitchen, checkIn, saves, kitchenStorage };
}

afterEach(() => {
  vi.restoreAllMocks();
  setEventPlanStorageForTests(null);
  setEntertainmentStorageForTests(null);
  setKitchenStorageForTests(null);
  setTripleseatAdapterForTests(null);
});

describe("read-only VIP cross-view health", () => {
  it("verifies the source-backed November example through all four real read models with no writes or KDS release", async () => {
    const deps = setup();
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health).toMatchObject({ sourceEventId: `vip-${ID}`, sourceFound: true,
      lastSuccessfulRefreshAt: deps.payload.generatedAt, sourceError: null,
      floorPlan: { represented: true }, entertainment: { represented: true }, kitchen: { represented: true }, checkIn: { represented: true },
      arrival: "not-checked-in", foodRelease: "NOT_CHECKED_IN" });
    expect(deps.client.fetchRange).toHaveBeenCalledExactlyOnceWith(DATE, DATE);
    expect(deps.floorPlan).toHaveBeenCalledWith(DATE, undefined, expect.objectContaining({ readOnly: true }));
    expect(deps.kitchen).toHaveBeenCalledWith(DATE, expect.objectContaining({ persistSourceChanges: false }));
    for (const save of deps.saves) expect(save).not.toHaveBeenCalled();
    const kitchenDay: Awaited<ReturnType<typeof getKitchenDay>> = await deps.kitchen.mock.results[0].value;
    const checklist = kitchenDay.events[0];
    expect(checklist.event.vipBooking?.foodPrep.map(({ quantity }) => quantity)).toEqual([2, 1, 1]);
    const card = (await deps.checkIn.mock.results[0].value)[0];
    expect(card).toMatchObject({ vipArea: "VIP 2", duration: "2 hours", partySize: 16,
      foodItems: [{ code: "chicken-tenders", label: "Chicken Tenders", quantity: 2 },
        { code: "fry-platters", label: "Fry Platters", quantity: 1 },
        { code: "mozzarella-sticks", label: "Mozzarella Sticks", quantity: 1 }], extras: [{ code: "mini-golf", label: "Mini Golf", quantity: 16 }] });
    for (const view of [health.floorPlan, health.entertainment, health.kitchen, health.checkIn]) {
      expect(view.href).toContain(`eventId=vip-${ID}`);
      expect(view.href).toContain(`date=${DATE}`);
    }
  });

  it("represents a no-food VIP without an empty food order", async () => {
    const deps = setup();
    deps.payload.reservations[0].foodPrep = [];
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health.kitchen.represented).toBe(true);
    expect(health.kitchen.detail).toContain("No-food VIP");
    expect(health.checkIn.represented).toBe(true);
    expect(health.foodRelease).toBe("NOT_CHECKED_IN");
    for (const save of deps.saves) expect(save).not.toHaveBeenCalled();
  });

  it("keeps an unmapped purchase represented and visible as a specific issue, not sending", async () => {
    const deps = setup();
    deps.payload.reservations[0].foodPrep = [{ code: "unmapped", label: "Unmapped purchased food", quantity: 2, unitPriceCents: 0, totalCents: 0 }];
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health.kitchen.represented).toBe(true);
    expect(health.checkIn.represented).toBe(true);
    expect((await deps.checkIn.mock.results[0].value)[0].itemIssues.join(" ")).toContain("unmapped");
    expect(health.foodRelease).toBe("NOT_CHECKED_IN");
    for (const save of deps.saves) expect(save).not.toHaveBeenCalled();
  });

  it("distinguishes source outage from a valid empty or cancelled response", async () => {
    const deps = setup();
    deps.client.fetchRange.mockRejectedValueOnce(new Error("Private diagnostic must not escape"));
    const unavailable = await loadVipSyncHealth(DATE, ID, { ...deps,
      cachedBookings: async () => [{ id: ID, lastRefreshedAt: "2026-10-26T17:00:00Z" }] });
    expect(unavailable).toMatchObject({ sourceFound: null, lastSuccessfulRefreshAt: "2026-10-26T17:00:00Z", arrival: "unverified" });
    expect(unavailable.sourceError).toContain("unavailable");
    expect(JSON.stringify(unavailable)).not.toContain("Private diagnostic");
    expect(deps.floorPlan).not.toHaveBeenCalled();
    deps.payload.reservations = [];
    deps.payload.reservationCount = 0;
    const absent = await loadVipSyncHealth(DATE, ID, deps);
    expect(absent.sourceFound).toBe(false);
    expect(absent.lastSuccessfulRefreshAt).toBe(deps.payload.generatedAt);
    expect(absent.sourceError).toContain("cancelled or moved");
    expect(deps.kitchen).not.toHaveBeenCalled();
  });

  it("does not report stale time or purchased quantities as synchronized", async () => {
    const deps = setup();
    const readKitchen = deps.kitchen.getMockImplementation()!;
    deps.kitchen.mockImplementation(async (...args) => {
      const day = await readKitchen(...args);
      day.events[0].event.vipBooking!.foodPrep[0].quantity = 99;
      return day;
    });
    const readCheckIn = deps.checkIn.getMockImplementation()!;
    deps.checkIn.mockImplementation(async (...args) => (await readCheckIn(...args)).map((row) => ({ ...row, endAt: "2026-11-15T01:00:00Z" })));
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health.kitchen.represented).toBe(false);
    expect(health.checkIn.represented).toBe(false);
    expect(health.floorPlan.represented).toBe(true);
  });

  it("reports failed view reads as unverified rather than missing or synchronized", async () => {
    const deps = setup();
    deps.floorPlan.mockRejectedValue(new Error("Unavailable"));
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health.floorPlan.represented).toBeNull();
    expect(health.entertainment.represented).toBeNull();
    expect(health.kitchen.represented).toBe(true);
    expect(health.checkIn.represented).toBe(true);
    for (const save of deps.saves) expect(save).not.toHaveBeenCalled();
  });

  it("does not call an unavailable schedule missing when the real floor-plan read model retains its map", async () => {
    const deps = setup();
    vi.spyOn(getEntertainmentStorage(), "getDay").mockRejectedValue(new Error("Private database read failure"));
    const health = await loadVipSyncHealth(DATE, ID, deps);
    expect(health.floorPlan.represented).toBe(true);
    expect(health.entertainment.represented).toBeNull();
    expect(health.entertainment.detail).toContain("could not be read");
    expect(JSON.stringify(health)).not.toContain("Private database");
    for (const save of deps.saves) expect(save).not.toHaveBeenCalled();
  });
});
