import { afterEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { createAdminSessionValue } from "@/lib/admin-auth";
import { checklistEvents } from "@/lib/checklist-events";
import {
  defaultChecklistState,
  type ChecklistRecord,
} from "@/lib/checklist-model";
import { saveChecklist } from "@/lib/checklist-storage";
import { updateKitchenEventFoodAddOns } from "@/lib/kitchen/sync";
import { GET, PUT } from "../route";
import { POST } from "../submit/route";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/checklist-storage", () => ({
  listChecklistRecords: vi.fn(),
  saveChecklist: vi.fn(),
}));

vi.mock("@/lib/kitchen/sync", () => ({
  updateKitchenEventFoodAddOns: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function configureForgedProductionSession() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
  vi.stubEnv(
    "EVENT_HOST_SESSION_SECRET",
    "checklist-test-session-secret-123456789",
  );
  vi.mocked(cookies).mockResolvedValue({
    get() {
      return {
        name: "event-host-admin-session",
        value: "forged-checklist-cookie",
      };
    },
  } as never);
}

function configureValidProductionSession() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("EVENT_HOST_ADMIN_PIN", "1234");
  vi.stubEnv(
    "EVENT_HOST_SESSION_SECRET",
    "checklist-test-session-secret-123456789",
  );
  const sessionValue = createAdminSessionValue();
  vi.mocked(cookies).mockResolvedValue({
    get() {
      return sessionValue
        ? {
            name: "event-host-admin-session",
            value: sessionValue,
          }
        : undefined;
    },
  } as never);
}

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

describe("Event Host checklist API authorization", () => {
  it("rejects unauthenticated reads", async () => {
    configureForgedProductionSession();

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated draft saves", async () => {
    configureForgedProductionSession();

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: 1, checklist: {} }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated submissions", async () => {
    configureForgedProductionSession();

    const response = await POST(
      new Request("https://example.test/api/checklists/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: 1, checklist: {} }),
      }),
    );

    expect(response.status).toBe(401);
  });
});

describe("Event Host checklist add-on routing", () => {
  it("mirrors Food to Kitchen only when the live-sync flag is set", async () => {
    configureValidProductionSession();
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);
    vi.mocked(updateKitchenEventFoodAddOns).mockResolvedValue({
      eventId: String(event.id),
      food: { wings: { quantity: 2 } },
      revision: 1,
      updatedAt: "2026-07-30T15:00:00.000Z",
    });

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          checklist,
          syncFoodAddOns: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateKitchenEventFoodAddOns).toHaveBeenCalledWith(
      String(event.id),
      checklist.food,
    );
    await expect(response.json()).resolves.toMatchObject({
      kitchenSync: { status: "live" },
    });
  });

  it("keeps Entertainment-only draft saves out of Kitchen", async () => {
    configureValidProductionSession();
    const { checklist, event, record } = checklistFixture();
    vi.mocked(saveChecklist).mockResolvedValue(record);

    const response = await PUT(
      new Request("https://example.test/api/checklists", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          checklist,
          syncFoodAddOns: false,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateKitchenEventFoodAddOns).not.toHaveBeenCalled();
  });

  it("preserves the final Admin submission if Kitchen is unavailable", async () => {
    configureValidProductionSession();
    const { checklist, event, record } = checklistFixture();
    const submittedRecord = {
      ...record,
      status: "submitted" as const,
      submittedAt: "2026-07-30T15:01:00.000Z",
    };
    vi.mocked(saveChecklist).mockResolvedValue(submittedRecord);
    vi.mocked(updateKitchenEventFoodAddOns).mockRejectedValue(
      new Error("Kitchen event was not found."),
    );

    const response = await POST(
      new Request("https://example.test/api/checklists/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
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
