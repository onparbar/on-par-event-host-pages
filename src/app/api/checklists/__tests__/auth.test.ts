import { afterEach, describe, expect, it, vi } from "vitest";
import { checklistEvents } from "@/lib/checklist-events";
import {
  defaultChecklistState,
  type ChecklistRecord,
} from "@/lib/checklist-model";
import {
  listChecklistRecords,
  getChecklistRecord,
  saveChecklist,
} from "@/lib/checklist-storage";
import { synchronizeChecklistFoodAddOns } from "@/lib/gotab/sync-checklist-addons";
import { checklistTaskRequirements } from "@/lib/checklist-readiness";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { StaleSaveError } from "@/lib/stale-save";
import { GET, PUT } from "../route";
import { POST } from "../submit/route";

vi.mock("@/lib/checklist-storage", () => ({
  listChecklistRecords: vi.fn(),
  getChecklistRecord: vi.fn(),
  saveChecklist: vi.fn(),
}));

vi.mock("@/lib/gotab/sync-checklist-addons", () => ({
  synchronizeChecklistFoodAddOns: vi.fn(),
}));
vi.mock("@/lib/event-plans/sync", () => ({ findEventPlanById: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function checklistFixture() {
  const event = checklistEvents[0];
  const verifiedEvent = { ...event, source_updated_at: "2026-10-21T14:00:00Z", drink_options: [] };
  vi.mocked(findEventPlanById).mockResolvedValue(verifiedEvent);
  const checklist = defaultChecklistState(event.date);
  checklist.bwa = "Staff-entered BWA";
  for (const task of checklistTaskRequirements(verifiedEvent)) {
    checklist.tasks[task.key] = true;
    checklist.taskEvidence![task.key] = { employeeName: "Staff-entered actor", completedAt: "2026-10-21T17:00:00Z" };
  }
  checklist.food.wings.quantity = "2";
  const record: ChecklistRecord = {
    ...checklist,
    eventId: event.id,
    eventName: event.name,
    eventDate: event.date,
    poc: event.poc,
    status: "draft",
    updatedAt: "2026-07-30T15:00:00.000Z",
    submittedAt: null,
  };
  return { checklist, event, record };
}

describe("Event Host checklist operational access", () => {
  it("reads only the selected event for shared-tablet polling without creating a checklist", async () => {
    const { record } = checklistFixture();
    vi.mocked(getChecklistRecord).mockResolvedValue(record);
    const response = await GET(new Request(`https://example.test/api/checklists?eventId=${record.eventId}`));
    expect(response.status).toBe(200);
    expect(getChecklistRecord).toHaveBeenCalledWith(record.eventId);
    expect(listChecklistRecords).not.toHaveBeenCalled();
    expect(saveChecklist).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ records: [record] });
  });
  it("allows anonymous operational reads", async () => {
    const { record } = checklistFixture();
    vi.mocked(listChecklistRecords).mockResolvedValue([record]);

    const response = await GET(new Request("https://example.test/api/checklists"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ records: [record] });
  });

  it("rejects cross-origin draft saves in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.example",
        },
        body: JSON.stringify({ eventId: 1, checklist: {} }),
      }),
    );

    expect(response.status).toBe(403);
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("rejects cross-origin submissions in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(
      new Request("https://example.test/api/checklists/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.example",
        },
        body: JSON.stringify({ eventId: 1, checklist: {} }),
      }),
    );

    expect(response.status).toBe(403);
    expect(saveChecklist).not.toHaveBeenCalled();
  });
});

describe("Event Host checklist add-on routing", () => {
  it("rejects overlong order notes before saving or sending food", async () => {
    const { checklist, event } = checklistFixture();
    checklist.food.wings.notes = "a".repeat(501);
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true }) }));
    expect(response.status).toBe(400);
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });
  it("records the staff requester separately from the manually assigned BWA and POC", async () => {
    const { checklist, event, record } = checklistFixture();
    checklist.poc = "Manual POC";
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(synchronizeChecklistFoodAddOns).mockRejectedValue(new Error("No real sending in tests"));
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true, syncFoodAddOnKeys: ["wing-refill-wings"], sourceType: "REFILL", requesterName: "  Carlos  " }) }));
    expect(response.status).toBe(200);
    expect(synchronizeChecklistFoodAddOns).toHaveBeenCalledWith(String(event.id), checklist.food, ["wing-refill-wings"], "REFILL", { requesterName: "Carlos" });
    expect(vi.mocked(saveChecklist).mock.calls[0][0].checklist).toMatchObject({ bwa: checklist.bwa, poc: "Manual POC" });
  });

  it.each(["A\nB", "a".repeat(121)])("rejects an invalid requester before saving or dispatching", async (requesterName) => {
    const { checklist, event } = checklistFixture();
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true, requesterName }) }));
    expect(response.status).toBe(400);
    expect(saveChecklist).not.toHaveBeenCalled();
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });
  it("saves the explicit staff POC and never supplies a source/customer POC override", async () => {
    const { checklist, event, record } = checklistFixture();
    checklist.poc = "Lex";
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, poc: "Lex" });
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    expect(response.status).toBe(200);
    expect(vi.mocked(saveChecklist).mock.calls[0][0]).toMatchObject({ checklist: { poc: "Lex" } });
    expect(vi.mocked(saveChecklist).mock.calls[0][0]).not.toHaveProperty("poc");
  });

  it("keeps an omitted POC omitted on legacy final submissions so storage can retain it", async () => {
    const { checklist, event, record } = checklistFixture();
    delete checklist.poc;
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, status: "submitted", poc: "Previously saved staff" });
    vi.mocked(synchronizeChecklistFoodAddOns).mockRejectedValue(new Error("No test food sending"));
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: "2026-10-23T17:00:00Z" }) }));
    expect(response.status).toBe(200);
    expect(vi.mocked(saveChecklist).mock.calls[0][0].checklist).not.toHaveProperty("poc");
  });
  it("mirrors Food to Kitchen only when the live-sync flag is set", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({
      saved: {
        eventId: String(event.id),
        food: { wings: { quantity: 2 } },
        revision: 1,
        updatedAt: "2026-07-30T15:00:00.000Z",
      },
      queued: 1,
      requestIds: [],
      deliveryPending: false,
      exceptions: 0,
      sent: 1,
      acceptedDeliveryCount: 1,
      deliveryVerified: true,
      noFoodRequired: false,
      deliveries: [],
      error: null,
    });

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({
          eventId: event.id,
          expectedUpdatedAt: null,
          checklist,
          syncFoodAddOns: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(synchronizeChecklistFoodAddOns).toHaveBeenCalledWith(
      String(event.id),
      checklist.food,
    );
    await expect(response.json()).resolves.toMatchObject({
      kitchenSync: { status: "live" },
    });
  });

  it("keeps Entertainment-only draft saves out of Kitchen", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({
          eventId: event.id,
          expectedUpdatedAt: null,
          checklist,
          syncFoodAddOns: false,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("preserves the final Admin submission if Kitchen is unavailable", async () => {
    const { checklist, event, record } = checklistFixture();
    const submittedRecord = {
      ...record,
      status: "submitted" as const,
      submittedAt: "2026-07-30T15:01:00.000Z",
    };
    vi.mocked(saveChecklist).mockResolvedValue(submittedRecord);
    vi.mocked(synchronizeChecklistFoodAddOns).mockRejectedValue(
      new Error("Kitchen event was not found."),
    );

    const response = await POST(
      new Request("https://example.test/api/checklists/submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({
          eventId: event.id,
          expectedUpdatedAt: null,
          checklist,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { status: "submitted" },
      kitchenSync: { status: "error" },
    });
  });

  it("returns409 and does not dispatch food when a stale save loses", async () => {
    const { checklist, event } = checklistFixture();
    vi.mocked(saveChecklist).mockRejectedValueOnce(new StaleSaveError());
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: "2026-10-21T17:00:00Z", syncFoodAddOns: true }) }));
    expect(response.status).toBe(409);
    expect(synchronizeChecklistFoodAddOns).not.toHaveBeenCalled();
  });

  it("enforces critical completion on the server before final submission", async () => {
    const { checklist, event } = checklistFixture();
    checklist.tasks["shift-lead-checkout"] = false;
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ incompleteTasks: ["shift-lead-checkout"] });
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("does not call an incomplete final food delivery live", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, status: "submitted" });
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({ saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: "2026-10-21T17:00:00Z" }, queued: 2, requestIds: [], deliveryPending: false, sent: 1, exceptions: 1, error: "Needs mapping review", deliveries: [], acceptedDeliveryCount: 1, deliveryVerified: false, noFoodRequired: false });
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ record: { status: "submitted" }, kitchenSync: { status: "error", accepted: 1, error: "Needs mapping review" } });
  });

  it("does not infer acceptance from unchanged food with zero newly queued requests", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, status: "submitted" });
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({ saved: { eventId: String(event.id), food: { wings: { quantity: 2 } }, revision: 1, updatedAt: "2026-10-21T17:00:00Z" }, queued: 0, requestIds: [], deliveryPending: false, sent: 0, exceptions: 1, error: "Prior delivery held", deliveries: [], acceptedDeliveryCount: 0, deliveryVerified: false, noFoodRequired: false });
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    await expect(response.json()).resolves.toMatchObject({ kitchenSync: { status: "error", accepted: 0, error: "Prior delivery held" } });
  });

  it("uses a separate not-required state when no food needs a ticket", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, status: "submitted" });
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({ saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: "2026-10-21T17:00:00Z" }, queued: 0, requestIds: [], deliveryPending: false, sent: 0, exceptions: 0, error: null, deliveries: [], acceptedDeliveryCount: 0, deliveryVerified: false, noFoodRequired: true });
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    const payload = await response.json();
    expect(payload.kitchenSync).toMatchObject({ status: "not-required", accepted: 0 });
    expect(payload.kitchenSync.error).toBeUndefined();
  });

  it.each(["QUEUED", "SENDING", "SCHEDULED"])("returns pending instead of a review error for a known %s request", async (status) => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({
      saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: record.updatedAt },
      queued: 1, requestIds: ["request-1"], sent: 0, acceptedDeliveryCount: 0,
      exceptions: 0, deliveryVerified: false, deliveryPending: true, noFoodRequired: false, error: null,
      deliveries: [{ requestId: "request-1", eventId: String(event.id), sourceKey: "addon:wings", foodName: "Wings", quantity: 1, panSize: "HALF_PAN", status, orderReference: null, acceptedAt: null, updatedAt: record.updatedAt!, error: null }],
    });
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true, syncFoodAddOnKeys: ["wings"] }) }));
    const payload = await response.json();
    expect(payload.kitchenSync).toMatchObject({ status: "pending", eventId: String(event.id), requestIds: ["request-1"], accepted: 0 });
    expect(payload.kitchenSync.error).toBeUndefined();
  });

  it("does not require contract review approval to send explicitly submitted appetizer refills", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(findEventPlanById).mockResolvedValue({ ...event, needs_review: true, review_reasons: ["Redacted contract requires review"] });
    const keys = ["appetizer-refill-tater-kegs", "appetizer-refill-chicken-tenders", "appetizer-refill-mozzarella-sticks"];
    for (const key of keys) checklist.food[key].quantity = "1";
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({
      saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: record.updatedAt },
      queued: 3, requestIds: keys.map((_, index) => `request-${index}`), sent: 3, acceptedDeliveryCount: 3,
      exceptions: 0, deliveryVerified: true, deliveryPending: false, noFoodRequired: false, error: null, deliveries: [],
    });
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true, syncFoodAddOnKeys: keys, sourceType: "REFILL" }) }));
    expect(synchronizeChecklistFoodAddOns).toHaveBeenCalledExactlyOnceWith(String(event.id), checklist.food, keys, "REFILL");
    await expect(response.json()).resolves.toMatchObject({ kitchenSync: { status: "live", accepted: 3, exceptions: 0 } });
  });

  it("keeps a real send exception out of the pending state", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({ saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: record.updatedAt }, queued: 1, requestIds: ["request-1"], deliveryPending: true, sent: 0, acceptedDeliveryCount: 0, exceptions: 1, deliveryVerified: false, noFoodRequired: false, deliveries: [], error: "Unknown delivery outcome; do not resend." });
    const response = await PUT(new Request("https://example.test/api/checklists", { method: "PUT", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null, syncFoodAddOns: true }) }));
    await expect(response.json()).resolves.toMatchObject({ kitchenSync: { status: "error", error: "Unknown delivery outcome; do not resend." } });
  });

  it("keeps a final Admin record submitted while its exact food orders are pending", async () => {
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue({ ...record, status: "submitted" });
    vi.mocked(synchronizeChecklistFoodAddOns).mockResolvedValue({ saved: { eventId: String(event.id), food: {}, revision: 1, updatedAt: record.updatedAt }, queued: 1, requestIds: ["request-1"], deliveryPending: true, sent: 0, acceptedDeliveryCount: 0, exceptions: 0, deliveryVerified: false, noFoodRequired: false, deliveries: [], error: null });
    const response = await POST(new Request("https://example.test/api/checklists/submit", { method: "POST", headers: { "content-type": "application/json", origin: "https://example.test" }, body: JSON.stringify({ eventId: event.id, checklist, expectedUpdatedAt: null }) }));
    const payload = await response.json();
    expect(payload).toMatchObject({ record: { status: "submitted" }, kitchenSync: { status: "pending", eventId: String(event.id), requestIds: ["request-1"], accepted: 0 } });
    expect(payload.kitchenSync.error).toBeUndefined();
  });
});
