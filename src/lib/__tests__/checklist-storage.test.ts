import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getChecklistRecord,
  getChecklistRecordUpdatedAt,
  listChecklistRecords,
  resetLocalChecklistStorageForTests,
  saveChecklist,
} from "../checklist-storage";

afterEach(() => {
  resetLocalChecklistStorageForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("local legacy checklist preview", () => {
  it("uses process-local storage when the Supabase secret is unavailable outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEYS", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveChecklist({
      action: "save",
      eventId: 1001,
      eventName: "Preview Event",
      eventDate: "2026-08-06",
      checklist: {
        bwa: "",
        extrasAdded: "",
        remainingDrinkCardBalance: "",
        tasks: {},
        entertainment: {},
        food: {},
      },
    });

    await expect(listChecklistRecords()).resolves.toEqual([saved]);
    await expect(getChecklistRecord(1001)).resolves.toEqual(saved);
    await expect(getChecklistRecordUpdatedAt(1001)).resolves.toBe(saved.updatedAt);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function databaseResponse() {
  return new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("legacy Event Host checklist database authentication", () => {
  it("uses an opaque Supabase secret as apikey without an invalid Bearer header", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        databaseResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChecklistRecords();

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test_value");
    expect(headers.get("authorization")).toBeNull();
  });

  it("retains Bearer authorization for legacy service-role JWTs", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "eyJtest.payload.signature");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        databaseResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listChecklistRecords();

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe(
      "Bearer eyJtest.payload.signature",
    );
  });
});

describe("targeted Event Host checklist reads", () => {
  it("loads only the requested admin-state row", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        {
          event_id: 99990001,
          tasks: { adminState: { archivedAssetKeys: [] } },
          updated_at: "2026-07-30T17:00:00.000Z",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const record = await getChecklistRecord(99990001);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("event_id")).toBe(
      "eq.99990001",
    );
    expect(requestUrl.searchParams.get("limit")).toBe("1");
    expect(requestUrl.searchParams.get("select")).toContain("tasks");
    expect(record).toMatchObject({
      eventId: 99990001,
      updatedAt: "2026-07-30T17:00:00.000Z",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
    });
  });

  it("fetches only updated_at for the live-sync revision check", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([
        { updated_at: "2026-07-30T17:00:01.000Z" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getChecklistRecordUpdatedAt(99990001),
    ).resolves.toBe("2026-07-30T17:00:01.000Z");

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("event_id")).toBe(
      "eq.99990001",
    );
    expect(requestUrl.searchParams.get("select")).toBe("updated_at");
    expect(requestUrl.searchParams.get("limit")).toBe("1");
  });
});
