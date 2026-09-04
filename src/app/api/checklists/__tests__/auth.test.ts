import { afterEach, describe, expect, it, vi } from "vitest";
import { checklistEvents } from "@/lib/checklist-events";
import {
  defaultChecklistState,
  type ChecklistRecord,
} from "@/lib/checklist-model";
import {
  listChecklistRecords,
  saveChecklist,
} from "@/lib/checklist-storage";
import { synchronizeChecklistFoodAddOns } from "@/lib/gotab/sync-checklist-addons";
import { GET, PUT } from "../route";
import { POST } from "../submit/route";

vi.mock("@/lib/checklist-storage", () => ({
  listChecklistRecords: vi.fn(),
  saveChecklist: vi.fn(),
}));

vi.mock("@/lib/gotab/sync-checklist-addons", () => ({
  synchronizeChecklistFoodAddOns: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function checklistFixture() {
  const event = checklistEvents[0];
  const checklist = defaultChecklistState(event.date);
  checklist.food.wings.quantity = "2";
  const record: ChecklistRecord = {
    ...checklist,
    eventId: event.id,
    status: "draft",
    updatedAt: "2026-07-30T15:00:00.000Z",
    submittedAt: null,
  };
  return { checklist, event, record };
}

describe("Event Host checklist operational access", () => {
  it("allows anonymous operational reads", async () => {
    const { record } = checklistFixture();
    vi.mocked(listChecklistRecords).mockResolvedValue([record]);

    const response = await GET();

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
      exceptions: 0,
      sent: 1,
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
});
