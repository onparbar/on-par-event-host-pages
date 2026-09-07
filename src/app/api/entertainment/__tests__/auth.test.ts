import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEntertainmentDay, syncEntertainmentDay } = vi.hoisted(() => ({
  getEntertainmentDay: vi.fn(),
  syncEntertainmentDay: vi.fn(),
}));

vi.mock("@/lib/entertainment/sync", () => ({
  assertEntertainmentDate: vi.fn(),
  EntertainmentSyncError: class EntertainmentSyncError extends Error {},
  getEntertainmentDay,
  syncEntertainmentDay,
}));

import { GET } from "../schedule/route";
import { POST } from "../sync/route";

describe("entertainment operational access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    getEntertainmentDay.mockResolvedValue({
      date: "2026-08-06",
      reservations: [],
    });
    syncEntertainmentDay.mockResolvedValue({
      date: "2026-08-06",
      reservations: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows the schedule to load without an access-code session", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/entertainment/schedule?date=2026-08-06",
      ),
    );

    expect(response.status).toBe(200);
    expect(getEntertainmentDay).toHaveBeenCalledWith("2026-08-06");
  });

  it("allows a same-origin schedule sync without an access-code session", async () => {
    const response = await POST(
      new Request("https://example.test/api/entertainment/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.test",
        },
        body: JSON.stringify({ date: "2026-08-06" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(syncEntertainmentDay).toHaveBeenCalledWith("2026-08-06");
  });

  it("rejects a cross-origin schedule mutation", async () => {
    const response = await POST(
      new Request("https://example.test/api/entertainment/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://malicious.test",
        },
        body: JSON.stringify({ date: "2026-08-06" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(syncEntertainmentDay).not.toHaveBeenCalled();
  });
});
