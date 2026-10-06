import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getEntertainmentDay = vi.fn();

vi.mock("@/lib/entertainment/sync", () => ({
  getEntertainmentDay,
}));

function request(
  query = "from=2026-08-04&to=2026-08-11",
  token = "test-entertainment-service-token",
) {
  return new Request(`https://example.test/api/entertainment-schedule?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function reservation(date: string, resourceId: string) {
  return {
    id: `${date}:${resourceId}`,
    tripleseatEventId: "tripleseat-event-1",
    localEventId: "local-event-1",
    eventName: "Redacted Event",
    operatingDate: date,
    resourceId,
    resourceName: "Bowling Lane 1",
    resourceCategory: "bowling",
    startAt: `${date}T17:00:00.000Z`,
    endAt: `${date}T19:00:00.000Z`,
    eventColor: "#297025",
    source: "tripleseat",
    manualOverride: false,
    needsReview: false,
    updatedAt: `${date}T12:00:00.000Z`,
    notes: "Must not be exposed",
    tripleseatBookingId: "booking-must-not-be-exposed",
  };
}

describe("read-only entertainment schedule service API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv(
      "ENTERTAINMENT_SCHEDULE_API_TOKEN",
      "test-entertainment-service-token",
    );
    getEntertainmentDay.mockImplementation(async (date: string) => ({
      reservations: [reservation(date, "bowling-1")],
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing, incorrect, and unconfigured bearer tokens", async () => {
    const { GET } = await import("../route");

    for (const candidate of [request(undefined, ""), request(undefined, "wrong")]) {
      const response = await GET(candidate);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }

    vi.stubEnv("ENTERTAINMENT_SCHEDULE_API_TOKEN", "");
    expect((await GET(request())).status).toBe(401);
    expect(getEntertainmentDay).not.toHaveBeenCalled();
  });

  it("requires a valid inclusive range of no more than 31 days", async () => {
    const { GET } = await import("../route");
    for (const query of [
      "from=08/04/2026&to=2026-08-11",
      "from=2026-08-12&to=2026-08-11",
      "from=2026-08-01&to=2026-09-01",
      "from=2026-08-04",
    ]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(getEntertainmentDay).not.toHaveBeenCalled();
  });

  it("returns a sanitized, sorted reservation projection for every date", async () => {
    getEntertainmentDay.mockImplementation(async (date: string) => ({
      reservations:
        date === "2026-08-04"
          ? [
              reservation(date, "bowling-2"),
              {
                ...reservation(date, "bowling-1"),
                tripleseatEventId: null,
              },
            ]
          : [reservation(date, "bowling-1")],
    }));
    const { GET } = await import("../route");
    const response = await GET(
      request("from=2026-08-04&to=2026-08-05"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getEntertainmentDay).toHaveBeenCalledTimes(2);
    expect(getEntertainmentDay).toHaveBeenNthCalledWith(1, "2026-08-04");
    expect(getEntertainmentDay).toHaveBeenNthCalledWith(2, "2026-08-05");
    const payload = await response.json();
    expect(payload).toMatchObject({
      from: "2026-08-04",
      to: "2026-08-05",
      timeZone: "America/New_York",
      reservationCount: 3,
    });
    expect(payload.reservations.map((item: { id: string }) => item.id)).toEqual([
      "2026-08-04:bowling-1",
      "2026-08-04:bowling-2",
      "2026-08-05:bowling-1",
    ]);
    expect(payload.reservations[0]).toMatchObject({
      eventId: "local-event-1",
      eventName: "Redacted Event",
      resourceId: "bowling-1",
      resourceName: "Bowling Lane 1",
      startAt: "2026-08-04T17:00:00.000Z",
      endAt: "2026-08-04T19:00:00.000Z",
    });
    expect(payload.reservations[0]).not.toHaveProperty("notes");
    expect(payload.reservations[0]).not.toHaveProperty("tripleseatBookingId");
  });

  it("returns a safe upstream error", async () => {
    getEntertainmentDay.mockRejectedValue(new Error("database detail"));
    const { GET } = await import("../route");
    const response = await GET(request());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load the saved entertainment schedule.",
    });
  });
});
