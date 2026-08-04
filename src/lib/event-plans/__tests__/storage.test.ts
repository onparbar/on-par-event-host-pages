import { describe, expect, it, vi } from "vitest";
import {
  createMemoryEventPlanStorage,
  SupabaseEventPlanStorage,
  type EventPlanWrite,
  type EventPlanWindow,
} from "../storage";

const WINDOW: EventPlanWindow = {
  startDate: "2026-07-30",
  endDate: "2026-08-30",
};

function plan(
  eventId: string,
  eventDate: string,
  label = eventId,
): EventPlanWrite {
  return {
    eventId,
    eventDate,
    plan: { label },
    sourceSnapshot: { id: eventId },
    sourceUpdatedAt: "2026-07-30T14:00:00.000Z",
  };
}

function advancingClock(...values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

describe("in-memory event-plan storage", () => {
  it("deactivates stale plans only inside the replaced window", async () => {
    const storage = createMemoryEventPlanStorage({
      now: advancingClock(
        "2026-07-30T14:00:00.000Z",
        "2026-07-30T15:00:00.000Z",
        "2026-07-30T16:00:00.000Z",
      ),
    });
    const outsideWindow = {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    };

    await storage.replaceWindow(WINDOW, [
      plan("event-a", "2026-07-30"),
      plan("event-b", "2026-08-15"),
    ]);
    await storage.replaceWindow(outsideWindow, [
      plan("event-outside", "2026-09-10"),
    ]);
    await storage.replaceWindow(WINDOW, [
      plan("event-b", "2026-08-15", "updated"),
      plan("event-c", "2026-08-30"),
    ]);

    expect(
      (await storage.plansForWindow(WINDOW)).map((item) => item.eventId),
    ).toEqual(["event-b", "event-c"]);
    expect(await storage.findById("event-a")).toMatchObject({
      active: false,
      syncedAt: "2026-07-30T16:00:00.000Z",
    });
    expect(await storage.findById("event-b")).toMatchObject({
      active: true,
      plan: { label: "updated" },
    });
    expect(await storage.findById("event-outside")).toMatchObject({
      active: true,
    });
  });

  it("deactivates every active plan in an empty replacement window", async () => {
    const storage = createMemoryEventPlanStorage();
    await storage.replaceWindow(WINDOW, [
      plan("event-a", "2026-07-30"),
      plan("event-b", "2026-08-30"),
    ]);

    await storage.replaceWindow(WINDOW, []);

    expect(await storage.plansForWindow(WINDOW)).toEqual([]);
    expect(await storage.findById("event-a")).toMatchObject({ active: false });
    expect(await storage.findById("event-b")).toMatchObject({ active: false });
  });

  it("tracks successful and failed singleton sync runs", async () => {
    const storage = createMemoryEventPlanStorage({
      now: advancingClock(
        "2026-07-30T14:00:00.000Z",
        "2026-07-30T14:01:00.000Z",
        "2026-07-31T14:00:00.000Z",
        "2026-07-31T14:01:00.000Z",
      ),
    });

    await storage.start(WINDOW);
    await storage.finish(2);
    const successful = await storage.getSyncState();
    expect(successful).toMatchObject({
      windowStart: WINDOW.startDate,
      windowEnd: WINDOW.endDate,
      status: "success",
      eventCount: 2,
      lastSuccessfulSyncAt: "2026-07-30T14:01:00.000Z",
      errorMessage: null,
    });

    await storage.start({
      startDate: "2026-07-31",
      endDate: "2026-08-31",
    });
    await storage.fail("Tripleseat temporarily unavailable.");
    expect(await storage.getSyncState()).toMatchObject({
      windowStart: "2026-07-31",
      windowEnd: "2026-08-31",
      status: "error",
      eventCount: 2,
      lastSuccessfulSyncAt: "2026-07-30T14:01:00.000Z",
      errorMessage: "Tripleseat temporarily unavailable.",
    });
  });

  it("rejects invalid windows, out-of-window plans, and duplicate IDs", async () => {
    const storage = createMemoryEventPlanStorage();

    await expect(
      storage.replaceWindow(
        { startDate: "2026-08-30", endDate: "2026-07-30" },
        [],
      ),
    ).rejects.toThrow("on or before");
    await expect(
      storage.replaceWindow(WINDOW, [plan("event-a", "2026-08-31")]),
    ).rejects.toThrow("inside the replacement window");
    await expect(
      storage.replaceWindow(WINDOW, [
        plan("event-a", "2026-07-30"),
        plan("event-a", "2026-07-31"),
      ]),
    ).rejects.toThrow("duplicate event ID");
    await expect(storage.finish(-1)).rejects.toThrow("non-negative integer");
  });
});

describe("Supabase event-plan storage", () => {
  it("upserts current plans before deactivating stale rows in the window", async () => {
    const requests: Array<{
      url: URL;
      init?: RequestInit;
    }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        ),
        init,
      });
      return new Response(null, { status: 204 });
    });
    const storage = new SupabaseEventPlanStorage({
      env: {
        NODE_ENV: "test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      },
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date("2026-07-30T14:00:00.000Z"),
    });

    await storage.replaceWindow(WINDOW, [
      plan("event-a", "2026-07-30"),
      plan("event-b", "2026-08-30"),
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0].init?.method).toBe("POST");
    expect(requests[0].url.searchParams.get("on_conflict")).toBe("event_id");
    expect(requests[1].init?.method).toBe("PATCH");
    expect(requests[1].url.searchParams.get("active")).toBe("eq.true");
    expect(requests[1].url.searchParams.getAll("event_date")).toEqual([
      "gte.2026-07-30",
      "lte.2026-08-30",
    ]);
    expect(requests[1].url.searchParams.get("event_id")).toBe(
      "not.in.(event-a,event-b)",
    );
    expect(new Headers(requests[0].init?.headers).get("apikey")).toBe(
      "sb_secret_test",
    );
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      active: false,
      synced_at: "2026-07-30T14:00:00.000Z",
    });
  });
});
