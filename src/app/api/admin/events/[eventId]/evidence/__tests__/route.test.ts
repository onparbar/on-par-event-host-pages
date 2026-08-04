import { beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.fn();
const hasAdminSession = vi.fn();
const loadAdminContractEvidence = vi.fn();

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/admin-auth", () => ({ hasAdminSession }));
vi.mock("@/lib/admin-operations-loader", () => ({
  loadAdminContractEvidence,
}));

describe("admin contract evidence route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cookies.mockResolvedValue({ get: vi.fn() });
    loadAdminContractEvidence.mockResolvedValue({
      eventId: 123,
      eventName: "Example Event",
      eventDate: "2026-08-06",
      sourceEventId: "123",
      sourceBookingId: null,
      sourceUpdatedAt: "2026-08-03T12:00:00Z",
      rows: [],
    });
  });

  it("rejects anonymous evidence requests", async () => {
    hasAdminSession.mockReturnValue(false);
    const { GET } = await import("../route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ eventId: "123" }),
    });

    expect(response.status).toBe(401);
    expect(loadAdminContractEvidence).not.toHaveBeenCalled();
  });

  it("rejects invalid event identifiers before storage access", async () => {
    hasAdminSession.mockReturnValue(true);
    const { GET } = await import("../route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ eventId: "123.json" }),
    });

    expect(response.status).toBe(400);
    expect(loadAdminContractEvidence).not.toHaveBeenCalled();
  });

  it("returns only the curated evidence DTO with private caching", async () => {
    hasAdminSession.mockReturnValue(true);
    const { GET } = await import("../route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ eventId: "123" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toMatchObject({
      eventId: 123,
      eventName: "Example Event",
      rows: [],
    });
    expect(loadAdminContractEvidence).toHaveBeenCalledWith(123);
  });
});
