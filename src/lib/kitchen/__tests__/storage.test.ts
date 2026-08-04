import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKitchenChecklist } from "../rules";
import { quantityAwareReadinessKey } from "../readiness";
import {
  createMemoryKitchenStorage,
  getKitchenStorage,
  setKitchenStorageForTests,
  SupabaseKitchenStorage,
} from "../storage";
import type { KitchenChecklist, KitchenSourceEvent } from "../types";

afterEach(() => {
  vi.useRealTimers();
});

function headerCapturingFetch(captured: Headers[]) {
  const fetchImpl: typeof fetch = async (_input, init) => {
    captured.push(new Headers(init?.headers));
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return fetchImpl;
}

function sourceEvent(eventId: string): KitchenSourceEvent {
  return {
    eventId,
    bookingId: null,
    eventName: `Redacted event ${eventId}`,
    localDate: "2026-07-29",
    localDateVerified: true,
    startTime: "17:00",
    endTime: "19:00",
    guestCount: 24,
    status: "DEFINITE",
    statusVerified: true,
    room: "Event Room",
    selections: [
      { name: "The Full Course", isFood: true },
      { name: "Taco Bar", isFood: true },
    ],
    specialNotes: [],
    sourceUpdatedAt: "2026-07-29T12:00:00Z",
    sourceState: "fresh",
  };
}

function checklist(eventId: string): KitchenChecklist {
  return generateKitchenChecklist(sourceEvent(eventId));
}

describe("Supabase kitchen storage authentication", () => {
  it("sends a new sb_secret key only through the apikey header", async () => {
    const captured: Headers[] = [];
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: headerCapturingFetch(captured),
    });

    await storage.getEncryptedTokenState();

    expect(captured).toHaveLength(1);
    expect(captured[0].get("apikey")).toBe("sb_secret_test-value");
    expect(captured[0].has("authorization")).toBe(false);
  });

  it("keeps the Bearer header for a legacy JWT service-role key", async () => {
    const captured: Headers[] = [];
    const legacyJwt = "eyJheader.payload.signature";
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: legacyJwt,
      },
      fetchImpl: headerCapturingFetch(captured),
    });

    await storage.getEncryptedTokenState();

    expect(captured[0].get("apikey")).toBe(legacyJwt);
    expect(captured[0].get("authorization")).toBe(`Bearer ${legacyJwt}`);
  });

  it("reclaims failed, stale-processing, or expired duplicate webhook receipts", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return requests.length === 1
          ? new Response("{}", {
              status: 409,
              headers: { "content-type": "application/json" },
            })
          : new Response(
              JSON.stringify([{ receipt_id: "payload-hash" }]),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
      },
    });

    await expect(
      storage.claimWebhook({
        receiptId: "payload-hash",
        triggerType: "UPDATE_EVENT",
        sourceEventId: "123",
        sourceEventDate: "2026-07-28",
        signatureTimestamp: "1785258000",
        payloadHash: "payload-hash",
        receivedAt: "2026-07-28T18:11:00.000Z",
      }),
    ).resolves.toBe(true);

    const retryUrl = new URL(requests[1].url);
    const reclaimFilter = retryUrl.searchParams.get("or") ?? "";
    expect(requests[1].init?.method).toBe("PATCH");
    expect(reclaimFilter).toContain("status.eq.failed");
    expect(reclaimFilter).toContain("status.eq.processing");
    expect(reclaimFilter).toContain("status.in.(processed,ignored)");
  });

  it("writes item readiness through a service-role-only upsert", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(null, { status: 204 });
      },
    });

    await storage.saveItemReadiness("12345", "addon:wings", true);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    const url = new URL(request.url);
    const headers = new Headers(request.init?.headers);
    expect(url.pathname).toBe("/rest/v1/kitchen_item_readiness");
    expect(url.searchParams.get("on_conflict")).toBe("event_id,item_key");
    expect(request.init?.method).toBe("POST");
    expect(headers.get("apikey")).toBe("sb_secret_test-value");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("prefer")).toBe(
      "resolution=merge-duplicates,return=minimal",
    );
    expect(JSON.parse(String(request.init?.body))).toMatchObject({
      event_id: "12345",
      item_key: "addon:wings",
      ready: true,
    });
  });

  it("writes final completion without changing Ready state or its alert timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T15:05:00.000Z"));
    const requests: { url: string; init?: RequestInit }[] = [];
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(null, { status: 204 });
      },
    });

    await storage.saveItemCompletion("12345", "addon:wings", true);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    const body = JSON.parse(String(request.init?.body)) as Record<
      string,
      unknown
    >;
    expect(new URL(request.url).pathname).toBe(
      "/rest/v1/kitchen_item_readiness",
    );
    expect(request.init?.method).toBe("POST");
    expect(body).toEqual({
      event_id: "12345",
      item_key: "addon:wings",
      completed: true,
      completed_updated_at: "2026-07-30T15:05:00.000Z",
    });
    expect(body).not.toHaveProperty("ready");
    expect(body).not.toHaveProperty("updated_at");
  });

  it("joins readiness and dedicated add-ons by exact visible event ID", async () => {
    const requests: { url: string; headers: Headers }[] = [];
    const wingsReadinessKey = quantityAwareReadinessKey({
      itemKey: "addon:wings",
      quantity: 128,
      numberOfPans: 6,
      panSize: "1/3",
      unit: "each",
      ruleVersion: checklist("12345").ruleVersion,
      sourceUpdatedAt: "2026-07-29T13:30:00Z",
    });
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        requests.push({
          url: url.toString(),
          headers: new Headers(init?.headers),
        });

        const table = url.pathname.split("/").at(-1);
        const payload =
          table === "kitchen_checklists"
            ? [
                { event_id: "12345", checklist: checklist("12345") },
                {
                  event_id: "preview-alpha",
                  checklist: checklist("preview-alpha"),
                },
              ]
            : table === "kitchen_event_snapshots"
              ? [
                  {
                    event_id: "12345",
                    source_snapshot: sourceEvent("12345"),
                  },
                  {
                    event_id: "preview-alpha",
                    source_snapshot: sourceEvent("preview-alpha"),
                  },
                ]
            : table === "kitchen_item_readiness"
              ? [
                  {
                    event_id: "12345",
                    item_key: wingsReadinessKey,
                    ready: true,
                    updated_at: "2026-07-29T13:45:00Z",
                    completed: true,
                    completed_updated_at: "2026-07-29T14:15:00Z",
                  },
                  {
                    event_id: "preview-alpha",
                    item_key: "taco-beef",
                    ready: true,
                    updated_at: "2026-07-29T13:46:00Z",
                    completed: false,
                    completed_updated_at: null,
                  },
                ]
              : table === "kitchen_event_add_ons"
                ? [
                    {
                      event_id: "12345",
                      food: {
                        wings: { quantity: 2 },
                      },
                      updated_at: "2026-07-29T13:30:00Z",
                      revision: 3,
                    },
                    {
                      event_id: "preview-alpha",
                      food: {
                        ranch: { quantity: 1 },
                      },
                      updated_at: "2026-07-29T13:31:00Z",
                      revision: 2,
                    },
                  ]
                : [];
        return Response.json(payload);
      },
    });

    const day = await storage.getDay("2026-07-29");

    expect(day.events).toHaveLength(2);
    const numericEvent = day.events.find(
      (event) => String(event.event.eventId) === "12345",
    );
    const previewEvent = day.events.find(
      (event) => String(event.event.eventId) === "preview-alpha",
    );
    expect(numericEvent?.completedItemKeys).toEqual([
      wingsReadinessKey,
    ]);
    expect(numericEvent?.finalCompletedItemKeys).toEqual([
      wingsReadinessKey,
    ]);
    expect(numericEvent?.chafingDishes).toEqual({
      bars: 1,
      hotPlatters: 1,
      total: 2,
    });
    expect(
      numericEvent?.sections
        .flatMap((section) => section.rows)
        .find((item) => item.key === "sauce-ranch"),
    ).toMatchObject({
      quantity: 2,
      unit: "bowls",
    });
    expect(numericEvent?.liveFoodAddOns).toEqual([
      expect.objectContaining({
        itemKey: "addon:wings",
        quantity: 128,
        numberOfPans: 6,
        panSize: "1/3",
        sourceUpdatedAt: "2026-07-29T13:30:00Z",
      }),
    ]);
    expect(previewEvent?.completedItemKeys).toEqual(["taco-beef"]);
    expect(previewEvent?.finalCompletedItemKeys).toEqual([]);
    expect(previewEvent?.chafingDishes).toEqual({
      bars: 1,
      hotPlatters: 0,
      total: 1,
    });
    expect(
      previewEvent?.sections
        .flatMap((section) => section.rows)
        .find((item) => item.key === "sauce-ranch"),
    ).toMatchObject({
      quantity: 1,
      unit: "bowl",
    });
    expect(previewEvent?.liveFoodAddOns).toEqual([
      expect.objectContaining({
        itemKey: "addon:ranch",
        quantity: 1,
        sourceUpdatedAt: "2026-07-29T13:31:00Z",
      }),
    ]);
    expect(day.addOnActivity).toEqual([
      {
        eventId: "12345",
        eventName: "Redacted event 12345",
        revision: 3,
        updatedAt: "2026-07-29T13:30:00Z",
        itemNames: ["Wings"],
      },
      {
        eventId: "preview-alpha",
        eventName: "Redacted event preview-alpha",
        revision: 2,
        updatedAt: "2026-07-29T13:31:00Z",
        itemNames: ["Ranch"],
      },
    ]);
    expect(day.addOnCompletions).toEqual([
      {
        eventId: "12345",
        eventName: "Redacted event 12345",
        itemKey: "addon:wings",
        foodName: "Wings",
        readinessUpdatedAt: "2026-07-29T13:45:00Z",
      },
    ]);

    const readinessRequest = requests.find((request) =>
      request.url.includes("/kitchen_item_readiness?"),
    );
    const addOnRequest = requests.find((request) =>
      request.url.includes("/kitchen_event_add_ons?"),
    );
    expect(
      new URL(readinessRequest?.url ?? "").searchParams.get("event_id"),
    ).toBe("in.(12345,preview-alpha)");
    expect(
      new URL(readinessRequest?.url ?? "").searchParams.get("select"),
    ).toBe(
      "event_id,item_key,ready,updated_at,completed,completed_updated_at",
    );
    expect(
      new URL(readinessRequest?.url ?? "").searchParams.get("or"),
    ).toBe("(ready.eq.true,completed.eq.true)");
    expect(
      new URL(addOnRequest?.url ?? "").searchParams.get("event_id"),
    ).toBe("in.(12345,preview-alpha)");
    expect(addOnRequest?.headers.get("apikey")).toBe(
      "sb_secret_test-value",
    );
    expect(
      requests.some((request) =>
        request.url.includes("/event_host_checklists"),
      ),
    ).toBe(false);
  });

  it("recalculates memory-backed checklists from current live add-ons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T13:00:00.000Z"));
    const storage = createMemoryKitchenStorage();
    const event = sourceEvent("preview-alpha");
    await storage.replaceDay("2026-07-29", [
      {
        sourceEvent: event,
        checklist: generateKitchenChecklist(event),
      },
    ]);
    await storage.saveFoodAddOns("preview-alpha", {
      wings: { quantity: 2 },
    }, null);

    const day = await storage.getDay("2026-07-29");

    expect(day.events[0].liveFoodAddOns).toEqual([
      expect.objectContaining({
        itemKey: "addon:wings",
        quantity: 128,
      }),
    ]);
    expect(day.events[0].chafingDishes).toEqual({
      bars: 1,
      hotPlatters: 1,
      total: 2,
    });
    expect(
      day.events[0].sections
        .flatMap((section) => section.rows)
        .find((item) => item.key === "sauce-ranch"),
    ).toMatchObject({
      quantity: 2,
      unit: "bowls",
    });
    expect(day.addOnActivity).toEqual([
      expect.objectContaining({
        eventId: "preview-alpha",
        eventName: "Redacted event preview-alpha",
        revision: 1,
        itemNames: ["Wings"],
      }),
    ]);

    const liveItem = day.events[0].liveFoodAddOns[0];
    const readinessKey = quantityAwareReadinessKey({
      ...liveItem,
      ruleVersion: day.events[0].ruleVersion,
    });
    vi.setSystemTime(new Date("2026-07-29T13:05:00.000Z"));
    await storage.saveItemReadiness(
      "preview-alpha",
      readinessKey,
      true,
    );
    const completedDay = await storage.getDay("2026-07-29");
    expect(completedDay.addOnCompletions).toEqual([
      expect.objectContaining({
        eventId: "preview-alpha",
        eventName: "Redacted event preview-alpha",
        itemKey: "addon:wings",
        foodName: "Wings",
        readinessUpdatedAt: "2026-07-29T13:05:00.000Z",
      }),
    ]);

    vi.setSystemTime(new Date("2026-07-29T13:06:00.000Z"));
    await storage.saveItemReadiness(
      "preview-alpha",
      readinessKey,
      false,
    );
    expect(
      (await storage.getDay("2026-07-29")).addOnCompletions,
    ).toEqual([]);

    vi.setSystemTime(new Date("2026-07-29T13:07:00.000Z"));
    await storage.saveItemReadiness(
      "preview-alpha",
      readinessKey,
      true,
    );
    expect(
      (await storage.getDay("2026-07-29")).addOnCompletions,
    ).toEqual([
      expect.objectContaining({
        readinessUpdatedAt: "2026-07-29T13:07:00.000Z",
      }),
    ]);
  });

  it("keeps Ready alerts and final completion independent across a checklist resync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T13:00:00.000Z"));
    const storage = createMemoryKitchenStorage();
    const event = sourceEvent("preview-alpha");
    await storage.replaceDay("2026-07-29", [
      {
        sourceEvent: event,
        checklist: generateKitchenChecklist(event),
      },
    ]);
    await storage.saveFoodAddOns(
      "preview-alpha",
      { wings: { quantity: 2 } },
      null,
    );
    const initialDay = await storage.getDay("2026-07-29");
    const liveItem = initialDay.events[0].liveFoodAddOns[0];
    const itemKey = quantityAwareReadinessKey({
      ...liveItem,
      ruleVersion: initialDay.events[0].ruleVersion,
    });

    vi.setSystemTime(new Date("2026-07-29T13:05:00.000Z"));
    await storage.saveItemReadiness("preview-alpha", itemKey, true);
    vi.setSystemTime(new Date("2026-07-29T13:06:00.000Z"));
    await storage.saveItemCompletion("preview-alpha", itemKey, true);
    await storage.replaceDay("2026-07-29", [
      {
        sourceEvent: event,
        checklist: generateKitchenChecklist(event),
      },
    ]);

    const completedDay = await storage.getDay("2026-07-29");
    expect(completedDay.events[0].completedItemKeys).toEqual([itemKey]);
    expect(completedDay.events[0].finalCompletedItemKeys).toEqual([
      itemKey,
    ]);
    expect(completedDay.addOnCompletions).toEqual([
      expect.objectContaining({
        itemKey: "addon:wings",
        readinessUpdatedAt: "2026-07-29T13:05:00.000Z",
      }),
    ]);

    vi.setSystemTime(new Date("2026-07-29T13:07:00.000Z"));
    await storage.saveItemCompletion("preview-alpha", itemKey, false);
    const sentBackDay = await storage.getDay("2026-07-29");
    expect(sentBackDay.events[0].completedItemKeys).toEqual([itemKey]);
    expect(sentBackDay.events[0].finalCompletedItemKeys).toEqual([]);
    expect(sentBackDay.addOnCompletions[0].readinessUpdatedAt).toBe(
      "2026-07-29T13:05:00.000Z",
    );
  });

  it("recalculates a stored checklist when the kitchen rule version changes", async () => {
    const storage = createMemoryKitchenStorage();
    const event = sourceEvent("preview-alpha");
    const staleChecklist = generateKitchenChecklist(event);
    staleChecklist.ruleVersion = "ope-kitchen-2026-07-29.3";
    const tacoChicken = staleChecklist.sections
      .flatMap((section) => section.rows)
      .find((item) => item.key === "taco-chicken");
    expect(tacoChicken).toBeDefined();
    tacoChicken!.numberOfPans = 1;

    await storage.replaceDay("2026-07-29", [
      {
        sourceEvent: event,
        checklist: staleChecklist,
      },
    ]);

    const day = await storage.getDay("2026-07-29");
    const currentChicken = day.events[0].sections
      .flatMap((section) => section.rows)
      .find((item) => item.key === "taco-chicken");

    expect(day.events[0].ruleVersion).toBe("ope-kitchen-2026-08-04.3");
    expect(currentChicken).toMatchObject({
      quantity: 5,
      numberOfPans: 2,
      panSize: "1/3",
    });
  });

  it("reads and writes dedicated food add-ons with exact IDs and the service role", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        const requestFood =
          init?.body == null
            ? { wings: { quantity: 1 } }
            : (JSON.parse(String(init.body)) as { food: unknown }).food;
        const requestRevision =
          init?.body == null
            ? 1
            : (JSON.parse(String(init.body)) as { revision: number })
                .revision;
        return Response.json([
          {
            event_id: "preview-alpha",
            food: requestFood,
            updated_at: "2026-07-29T14:00:00Z",
            revision: requestRevision,
          },
        ]);
      },
    });

    await expect(storage.getFoodAddOns("preview-alpha")).resolves.toEqual({
      eventId: "preview-alpha",
      food: { wings: { quantity: 1 } },
      updatedAt: "2026-07-29T14:00:00Z",
      revision: 1,
    });
    await expect(
      storage.saveFoodAddOns("preview-alpha", {
        wings: { quantity: 2 },
        ranch: { quantity: 1 },
      }, null),
    ).resolves.toEqual({
      eventId: "preview-alpha",
      food: {
        wings: { quantity: 2 },
        ranch: { quantity: 1 },
      },
      updatedAt: "2026-07-29T14:00:00Z",
      revision: 1,
    });
    await expect(
      storage.saveFoodAddOns(
        "preview-alpha",
        { wings: { quantity: 3 } },
        1,
      ),
    ).resolves.toMatchObject({
      eventId: "preview-alpha",
      food: { wings: { quantity: 3 } },
      revision: 2,
    });

    const readUrl = new URL(requests[0].url);
    const writeUrl = new URL(requests[1].url);
    const updateUrl = new URL(requests[2].url);
    const writeHeaders = new Headers(requests[1].init?.headers);
    expect(readUrl.pathname).toBe("/rest/v1/kitchen_event_add_ons");
    expect(readUrl.searchParams.get("event_id")).toBe("eq.preview-alpha");
    expect(writeUrl.pathname).toBe("/rest/v1/kitchen_event_add_ons");
    expect(writeUrl.searchParams.get("on_conflict")).toBe("event_id");
    expect(requests[1].init?.method).toBe("POST");
    expect(writeHeaders.get("apikey")).toBe("sb_secret_test-value");
    expect(writeHeaders.has("authorization")).toBe(false);
    expect(writeHeaders.get("prefer")).toBe(
      "resolution=ignore-duplicates,return=representation",
    );
    expect(requests[2].init?.method).toBe("PATCH");
    expect(updateUrl.searchParams.get("event_id")).toBe(
      "eq.preview-alpha",
    );
    expect(updateUrl.searchParams.get("revision")).toBe("eq.1");
  });

  it("rejects stale add-on revisions in memory", async () => {
    const storage = createMemoryKitchenStorage();
    const event = sourceEvent("preview-alpha");
    await storage.replaceDay("2026-07-29", [
      {
        sourceEvent: event,
        checklist: generateKitchenChecklist(event),
      },
    ]);

    await storage.saveFoodAddOns(
      "preview-alpha",
      { wings: { quantity: 1 } },
      null,
    );
    await expect(
      storage.saveFoodAddOns(
        "preview-alpha",
        { wings: { quantity: 2 } },
        null,
      ),
    ).rejects.toThrow(
      "Kitchen food add-ons changed in another session.",
    );
    await expect(
      storage.saveFoodAddOns(
        "preview-alpha",
        { wings: { quantity: 2 } },
        1,
      ),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      storage.saveFoodAddOns(
        "preview-alpha",
        { wings: { quantity: 3 } },
        1,
      ),
    ).rejects.toThrow(
      "Kitchen food add-ons changed in another session.",
    );
  });

  it("surfaces a missing-event foreign-key response on add-on writes", async () => {
    const storage = new SupabaseKitchenStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test-value",
      },
      fetchImpl: async () =>
        new Response("foreign key violation", { status: 409 }),
    });

    await expect(
      storage.saveFoodAddOns("missing-event", {
        wings: { quantity: 1 },
      }, null),
    ).rejects.toThrow("Kitchen database request failed (409).");
  });
});

describe("default kitchen storage selection", () => {
  afterEach(() => {
    setKitchenStorageForTests(null);
    vi.unstubAllEnvs();
  });

  it("uses memory storage for an explicit production mock", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRIPLESEAT_MOCK", "true");
    vi.stubEnv("TRIPLESEAT_MOCK_MODE", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEYS", "");

    expect(getKitchenStorage().persistence).toBe("memory");
  });
});
