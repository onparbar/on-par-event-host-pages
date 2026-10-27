import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { vipInitialFoodSnapshot, vipReleaseFingerprint } from "../release-snapshot";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { vipPrepKitchenEvents, type VipPrepReservation } from "@/lib/vip-prep/client";
import { createMemoryKitchenStorage, setKitchenStorageForTests } from "@/lib/kitchen/storage";

vi.mock("server-only", () => ({}));
const { confirmVipArrival, listVipCheckinDay, vipFoodReleaseState } = await import("../service");

// Sanitized acceptance fixture, not a live customer or a real check-in.
const reservation: VipPrepReservation = {
  ...vipPrepPayload.reservations[0], id: "sanitized-vip-14", confirmationCode: "VIP2-TEST14",
  operatingDate: "2026-11-14", resource: { code: "VIPL", name: "VIP 2" },
  eventName: "Sanitized VIP Party", guestName: "Sample Guest", partySize: 16,
  startAt: "2026-11-14T22:00:00Z", endAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-01T15:00:00Z", lastRefreshedAt: "2026-11-14T15:00:00Z",
  foodPrep: [
    { code: "chicken-tenders", label: "Chicken Tender Platter", quantity: 2, unitPriceCents: 12000, totalCents: 24000 },
    { code: "fry-platters", label: "Fry Platter", quantity: 1, unitPriceCents: 12000, totalCents: 12000 },
    { code: "mozzarella-sticks", label: "Mozzarella Stick Platter", quantity: 1, unitPriceCents: 12000, totalCents: 12000 },
  ],
  extras: [{ code: "mini-golf", label: "Mini Golf", quantity: 16 }],
};
const eventId = `vip-${reservation.id}`;
const saved = { event_id: eventId, reservation_id: reservation.id, booking_date: reservation.operatingDate,
  employee_name: "Tina", checked_in_at: "2026-11-14T17:00:00Z" };
const requestIds = ["tenders-request", "fries-request", "mozz-request"];

function client(source = reservation) {
  return { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload,
    generatedAt: "2026-11-14T17:00:00Z", reservations: [source] }) };
}
function releaseStorage(status = "SCHEDULED") {
  return {
    getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 3, status: "PENDING" }),
    listVipInitialFoodDispatches: vi.fn().mockResolvedValue(requestIds.map((request_id) => ({
      request_id, status, scheduled_at: "2026-11-14T21:00:00Z", source_fingerprint: vipReleaseFingerprint(reservation),
    }))),
  };
}

beforeEach(() => { setKitchenStorageForTests(createMemoryKitchenStorage()); vi.useFakeTimers(); vi.setSystemTime("2026-11-14T17:00:00Z"); });
afterEach(() => vi.useRealTimers());

describe("VIP arrival authority and exact preorder", () => {
  it("shows all exact preordered food and extras before arrival without releasing anything", async () => {
    const storage = { listVipCheckinsForDate: vi.fn().mockResolvedValue([]), ...releaseStorage(), confirmVipCheckin: vi.fn() };
    const dispatch = vi.fn();
    const synchronizeFood = vi.fn();
    const result = await listVipCheckinDay(reservation.operatingDate, {
      client: client({ ...reservation, status: "checked_in" }), storage: storage as never,
      dispatch: dispatch as never, synchronizeFood: synchronizeFood as never,
    });
    expect(result.sourceError).toBeNull();
    expect(result.reservations[0]).toMatchObject({ reservationId: reservation.id, confirmationCode: "VIP2-TEST14",
      vipArea: "VIP 2", partySize: 16, reservationTime: reservation.startAt, endAt: reservation.endAt,
      duration: "2 hours", checkedInAt: null, checkedInBy: null, foodStatus: "NOT_CHECKED_IN",
      foodItems: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
      extras: [{ code: "mini-golf", label: "Mini Golf", quantity: 16 }],
    });
    expect(storage.getVipInitialFoodRelease).not.toHaveBeenCalled();
    expect(storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(synchronizeFood).not.toHaveBeenCalled();
    expect(result.reservations[0].foodItems[0]).not.toHaveProperty("unitPriceCents");
  });

  it("shows a pre-arrival source preorder change against saved kitchen metadata without saving or releasing it", async () => {
    const prior = { ...reservation, foodPrep: reservation.foodPrep.map((item, index) => index ? item : { ...item, quantity: 1 }) };
    const cached = generateKitchenChecklist(vipPrepKitchenEvents([prior])[0]);
    const unchangedCache = structuredClone(cached);
    const kitchenStorage = { getDay: vi.fn().mockResolvedValue({ events: [cached] }), saveEvent: vi.fn() };
    const storage = { ...releaseStorage(), listVipCheckinsForDate: vi.fn().mockResolvedValue([]), confirmVipCheckin: vi.fn() };
    const result = await listVipCheckinDay(reservation.operatingDate, { client: client(), storage: storage as never, kitchenStorage: kitchenStorage as never });
    expect(result.reservations[0]).toMatchObject({ foodStatus: "NOT_CHECKED_IN", checkedInAt: null,
      preorderChange: { sourceUpdatedAt: reservation.updatedAt,
        previous: prior.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
        current: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
      } });
    expect(result.reservations[0].preorderChange?.message).toContain("Food remains blocked");
    expect(cached).toEqual(unchangedCache);
    expect(kitchenStorage.saveEvent).not.toHaveBeenCalled();
    expect(storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(storage.getVipInitialFoodRelease).not.toHaveBeenCalled();
  });

  it("retains a matching kitchen preorder-change notice after the saved metadata catches up", async () => {
    const preorderChange = { sourceUpdatedAt: reservation.updatedAt, previous: [], current: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
      message: "The booked food changed. Use the current purchased quantities for planning." };
    const cached = generateKitchenChecklist(vipPrepKitchenEvents([{ ...reservation, preorderChange }])[0]);
    const result = await listVipCheckinDay(reservation.operatingDate, { client: client(),
      storage: { listVipCheckinsForDate: vi.fn().mockResolvedValue([]) } as never,
      kitchenStorage: { getDay: vi.fn().mockResolvedValue({ events: [cached] }) } as never,
    });
    expect(result.reservations[0].preorderChange).toEqual(preorderChange);
  });

  it("scopes early arrival work only to this VIP and saves the first employee with the exact source revision", async () => {
    const storage = { ...releaseStorage(), getVipCheckin: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(saved),
      confirmVipCheckin: vi.fn().mockResolvedValue(saved), markVipInitialFoodReleaseFailed: vi.fn() };
    const synchronizeFood = vi.fn().mockResolvedValue({ exceptionCount: 0, requestIds });
    const dispatch = vi.fn().mockResolvedValue({ sent: 0 });
    const row = await confirmVipArrival(reservation.id, reservation.operatingDate, "Lex", {
      client: client(), storage: storage as never, synchronizeFood: synchronizeFood as never, dispatch: dispatch as never,
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ storage, requestIds });
    expect(dispatch.mock.calls[0][0]).not.toHaveProperty("immediate");
    expect(synchronizeFood.mock.calls[0][1].releaseSnapshot).toMatchObject({
      reservationId: reservation.id, sourceUpdatedAt: reservation.updatedAt,
      sourceFingerprint: vipReleaseFingerprint(reservation), checkedInBy: "Tina", checkedInAt: saved.checked_in_at,
      food: reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })),
    });
    expect(row).toMatchObject({ checkedInBy: "Tina", foodStatus: "FOOD_SCHEDULED", acceptedItemCount: 0,
      expectedItemCount: 3, scheduledReleaseAt: "2026-11-14T21:00:00Z" });
  });

  it("does not turn an unknown item or an empty request scope into another event's due work", async () => {
    const source = { ...reservation, foodPrep: [{ code: "unmapped-item", label: "Unmapped platter", quantity: 1,
      unitPriceCents: 100, totalCents: 100 }] };
    const storage = { getVipCheckin: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(saved),
      confirmVipCheckin: vi.fn().mockResolvedValue(saved), markVipInitialFoodReleaseFailed: vi.fn(),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 1, status: "FAILED" }),
      listVipInitialFoodDispatches: vi.fn().mockResolvedValue([]) };
    const dispatch = vi.fn();
    const row = await confirmVipArrival(source.id, source.operatingDate, "Tina", {
      client: client(source), storage: storage as never,
      synchronizeFood: vi.fn().mockResolvedValue({ exceptionCount: 1, requestIds: [] }) as never, dispatch: dispatch as never,
    });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ storage, requestIds: [] });
    expect(row.foodStatus).toBe("FOOD_SEND_FAILED");
    expect(row.itemIssues.join(" ")).toContain("Unmapped platter");
    expect(row.itemIssues.join(" ")).toContain("no verified kitchen mapping");
  });

  it("never creates an empty order for a newly checked-in no-food VIP", async () => {
    const storage = { getVipCheckin: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(saved),
      confirmVipCheckin: vi.fn().mockResolvedValue(saved),
      getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 0, status: "NO_FOOD" }) };
    const synchronizeFood = vi.fn(); const dispatch = vi.fn();
    const row = await confirmVipArrival(reservation.id, reservation.operatingDate, "Tina", {
      client: client({ ...reservation, foodPrep: [] }), storage: storage as never,
      synchronizeFood: synchronizeFood as never, dispatch: dispatch as never,
    });
    expect(storage.confirmVipCheckin).toHaveBeenCalledWith(expect.objectContaining({ expectedItemCount: 0 }));
    expect(row.foodStatus).toBe("NO_FOOD_ITEMS");
    expect(synchronizeFood).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps arrival evidence and surfaces an amended preorder without repeating the initial order", async () => {
    const storage = { ...releaseStorage("SENT"), getVipCheckin: vi.fn().mockResolvedValue(saved), confirmVipCheckin: vi.fn() };
    const amended = { ...reservation, foodPrep: reservation.foodPrep.map((item, index) => index ? item : { ...item, quantity: 3 }) };
    const synchronizeFood = vi.fn(); const dispatch = vi.fn();
    const row = await confirmVipArrival(amended.id, amended.operatingDate, "Lex", {
      client: client(amended), storage: storage as never, synchronizeFood: synchronizeFood as never, dispatch: dispatch as never,
    });
    expect(row).toMatchObject({ checkedInBy: "Tina", checkedInAt: saved.checked_in_at, foodStatus: "FOOD_HELD" });
    expect(row.itemIssues.join(" ")).toContain("correction/additional-order");
    expect(storage.confirmVipCheckin).not.toHaveBeenCalled();
    expect(synchronizeFood).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("truthful food release status", () => {
  it("represents a historical legacy acceptance only while its complete saved purchased quantities match current source", async () => {
    const storage = { getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 1, status: "PENDING" }),
      listVipInitialFoodDispatches: vi.fn().mockResolvedValue([{ request_id: "legacy-tenders", source_record_id: "platter-chicken-tenders", source_quantity: 2, status: "SENT" }]) };
    const current = { ...reservation, foodPrep: [reservation.foodPrep[0]] };
    expect((await vipFoodReleaseState(eventId, storage as never, current)).foodStatus).toBe("FOOD_SENT");
    const changed = { ...current, foodPrep: [{ ...current.foodPrep[0], quantity: 3 }] };
    const result = await vipFoodReleaseState(eventId, storage as never, changed);
    expect(result).toMatchObject({ foodStatus: "FOOD_HELD", acceptedItemCount: 1, expectedItemCount: 1 });
    expect(result.itemIssues.join(" ")).toContain("does not verify the current purchased item quantities");
    expect(result.itemIssues.join(" ")).toContain("do not resend");
  });

  it("does not claim current food was accepted when historical delivery quantity evidence is missing", async () => {
    const storage = { getVipInitialFoodRelease: vi.fn().mockResolvedValue({ expected_item_count: 1, status: "PENDING" }),
      listVipInitialFoodDispatches: vi.fn().mockResolvedValue([{ request_id: "legacy-tenders", status: "SENT" }]) };
    const current = { ...reservation, foodPrep: [reservation.foodPrep[0]] };
    expect((await vipFoodReleaseState(eventId, storage as never, current)).foodStatus).toBe("FOOD_HELD");
  });

  it.each([
    { statuses: ["SCHEDULED", "SCHEDULED", "SCHEDULED"], expected: "FOOD_SCHEDULED" },
    { statuses: ["SENDING", "SCHEDULED", "SCHEDULED"], expected: "SENDING_FOOD" },
    { statuses: ["SENT", "SCHEDULED", "SCHEDULED"], expected: "FOOD_PARTIAL" },
    { statuses: ["SENT", "SENT", "SENT"], expected: "FOOD_SENT" },
    { statuses: ["HELD", "SCHEDULED", "SCHEDULED"], expected: "FOOD_HELD" },
    { statuses: ["FAILED", "SCHEDULED", "SCHEDULED"], expected: "FOOD_SEND_FAILED" },
    { statuses: [], expected: "FOOD_PENDING" },
  ])("reports $expected only from actual saved delivery records", async ({ statuses, expected }) => {
    const storage = releaseStorage();
    storage.listVipInitialFoodDispatches.mockResolvedValue(statuses.map((status, index) => ({
      request_id: requestIds[index], status, scheduled_at: "2026-11-14T21:00:00Z", source_fingerprint: vipReleaseFingerprint(reservation),
    })));
    expect((await vipFoodReleaseState(eventId, storage as never)).foodStatus).toBe(expected);
  });

  it("keeps an uncertain delivery distinct from failed/sent and warns against a blind retry", async () => {
    const storage = { ...releaseStorage(), listVipInitialFoodDispatches: vi.fn().mockResolvedValue([
      { request_id: "tenders-request", status: "HELD", food_name: "Chicken Tender Platter", last_error: "VIP delivery status is uncertain. Review before retrying." },
    ]) };
    const state = await vipFoodReleaseState(eventId, storage as never);
    expect(state.foodStatus).toBe("FOOD_UNCERTAIN");
    expect(state.acceptedItemCount).toBe(0);
    expect(state.itemIssues.join(" ")).toContain("Check the saved GoTab order before retrying");
  });

  it("treats vendor acceptance without a confirmed order as uncertain, not delivered", async () => {
    const storage = { ...releaseStorage(), listVipInitialFoodDispatches: vi.fn().mockResolvedValue([
      { request_id: "tenders-request", status: "HELD", last_error: "GoTab accepted the Event Food request but did not confirm an accepted order. Review before retrying." },
    ]) };
    expect((await vipFoodReleaseState(eventId, storage as never)).foodStatus).toBe("FOOD_UNCERTAIN");
  });
});

describe("source failures preserve known staff state, not false empty success", () => {
  const cached = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
  it("returns saved booking details and arrival evidence read-only while explicitly disabling fresh actions", async () => {
    const storage = { ...releaseStorage(), listVipCheckinsForDate: vi.fn().mockResolvedValue([saved]), confirmVipCheckin: vi.fn() };
    const source = { configured: true, fetchRange: vi.fn().mockRejectedValue(new Error("Unavailable")) };
    const kitchenStorage = { getDay: vi.fn().mockResolvedValue({ events: [cached] }) };
    const result = await listVipCheckinDay(reservation.operatingDate, { client: source, storage: storage as never, kitchenStorage: kitchenStorage as never });
    expect(result.sourceError).toContain("check-in is disabled");
    expect(result.lastSuccessfulBookingRefresh).toBe(reservation.lastRefreshedAt);
    expect(result.reservations[0]).toMatchObject({ reservationId: reservation.id, checkedInBy: "Tina", checkedInAt: saved.checked_in_at });
    expect(storage.confirmVipCheckin).not.toHaveBeenCalled();
  });

  it("rejects unavailable source without cache, instead of returning a successful zero-booking day", async () => {
    await expect(listVipCheckinDay(reservation.operatingDate, {
      client: { configured: true, fetchRange: vi.fn().mockRejectedValue(new Error("Unavailable")) },
      storage: {} as never, kitchenStorage: { getDay: vi.fn().mockResolvedValue({ events: [] }) } as never,
    })).rejects.toThrow("No current reservation list could be verified");
  });

  it("treats a fresh valid empty response as empty, without reviving saved reservations", async () => {
    const kitchenStorage = { getDay: vi.fn() };
    const result = await listVipCheckinDay(reservation.operatingDate, {
      client: { configured: true, fetchRange: vi.fn().mockResolvedValue({ ...vipPrepPayload, reservations: [] }) },
      storage: { listVipCheckinsForDate: vi.fn().mockResolvedValue([]) } as never,
      kitchenStorage: kitchenStorage as never,
    });
    expect(result.sourceError).toBeNull(); expect(result.reservations).toEqual([]);
    expect(kitchenStorage.getDay).not.toHaveBeenCalled();
  });
});

describe("release snapshot data minimization", () => {
  it("records exact food, source revision and employee without customer, payment or contact details", () => {
    const snapshot = vipInitialFoodSnapshot(reservation, saved);
    expect(snapshot.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.food).toEqual(reservation.foodPrep.map(({ code, label, quantity }) => ({ code, label, quantity })));
    for (const value of [reservation.eventName, reservation.guestName, "unitPriceCents", "totalCents", "phone", "email"]) {
      expect(JSON.stringify(snapshot)).not.toContain(value);
    }
  });
});
