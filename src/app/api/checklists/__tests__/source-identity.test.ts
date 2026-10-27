import { afterEach, describe, expect, it, vi } from "vitest";
import { PUT } from "../route";
import { POST } from "../submit/route";
import { getChecklistRecord, saveChecklist } from "@/lib/checklist-storage";
import { defaultChecklistState, type ChecklistRecord } from "@/lib/checklist-model";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { findVipPrepReservationByEventId, vipPrepEventPlan, VipPrepClient } from "@/lib/vip-prep/client";
import { numericVipEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";
import { vipPrepPayload } from "@/lib/vip-prep/__tests__/fixtures";
import { synchronizeChecklistFoodAddOns } from "@/lib/gotab/sync-checklist-addons";

vi.mock("@/lib/checklist-storage", () => ({ getChecklistRecord: vi.fn(), saveChecklist: vi.fn(), listChecklistRecords: vi.fn() }));
vi.mock("@/lib/event-plans/sync", () => ({ findEventPlanById: vi.fn() }));
vi.mock("@/lib/vip-prep/client", async (original) => ({ ...await original<typeof import("@/lib/vip-prep/client")>(), findVipPrepReservationByEventId: vi.fn() }));
vi.mock("@/lib/gotab/sync-checklist-addons", () => ({ synchronizeChecklistFoodAddOns: vi.fn() }));

afterEach(() => vi.clearAllMocks());
const date = "2026-10-24";
const reservation = { ...vipPrepPayload.reservations[0], operatingDate: date, startAt: `${date}T21:00:00Z`, endAt: `${date}T23:00:00Z` };
const sourceId = vipPrepExternalId(reservation);
const id = numericVipEventId(sourceId);

function fixture() {
  vi.mocked(findEventPlanById).mockResolvedValue(null);
  vi.mocked(findVipPrepReservationByEventId).mockResolvedValue(reservation);
  vi.mocked(getChecklistRecord).mockResolvedValue(null);
  const checklist = defaultChecklistState(date); checklist.bwa = "Brooke"; checklist.food.wings.quantity = "2";
  vi.mocked(saveChecklist).mockImplementation(async (input) => ({ ...input.checklist, eventId: id, eventName: reservation.eventName, eventDate: date,
    poc: "", status: "draft", updatedAt: "2026-10-24T21:01:00Z", submittedAt: null } as ChecklistRecord));
  return { eventId: id, sourceEventId: sourceId, eventDate: date, checklist, expectedUpdatedAt: null, syncFoodAddOns: false };
}
const request = (body: unknown, method = "PUT") => new Request("https://eventhost.test/api/checklists", { method,
  headers: { origin: "https://eventhost.test", "content-type": "application/json" }, body: JSON.stringify(body) });

describe("manual recovery uses exact source and date", () => {
  it("saves an old VIP add-on draft without any KDS sync or fabricated completions", async () => {
    const body = fixture();
    const response = await PUT(request(body)); expect(response.status).toBe(200);
    expect(findVipPrepReservationByEventId).toHaveBeenNthCalledWith(1, sourceId, date, date, expect.any(VipPrepClient));
    expect(saveChecklist).toHaveBeenCalledWith(expect.objectContaining({ action: "save", eventId: id, eventDate: date,
      checklist: expect.objectContaining({ food: expect.objectContaining({ wings: expect.objectContaining({ quantity: "2" }) }) }) }));
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
    expect(vi.mocked(saveChecklist).mock.calls[0][0].checklist.tasks?.["shift-lead-checkout"]).toBe(false);
  });
  it("keeps unfinished critical work blocked for manual final submission", async () => {
    const response = await POST(request(fixture(), "POST")); expect(response.status).toBe(422);
    expect(saveChecklist).not.toHaveBeenCalled(); expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });
  it.each([PUT, POST])("does not save or order for a mismatched source selection", async (handler) => {
    const body = fixture();
    const response = await handler(request({ ...body, sourceEventId: "vip-some-other-party" }, handler === POST ? "POST" : "PUT"));
    expect(response.status).toBe(409); expect(saveChecklist).not.toHaveBeenCalled(); expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });
  it("does not replace an unavailable VIP with a same-hash corporate source", async () => {
    const body = fixture();
    vi.mocked(findEventPlanById).mockResolvedValue({ ...vipPrepEventPlan(reservation), source_event_id: undefined, name: "Other corporate source" });
    const response = await PUT(request(body)); expect(response.status).toBe(409);
    expect(saveChecklist).not.toHaveBeenCalled(); expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });
});
