import { describe, expect, it, vi } from "vitest";
import { createMemoryKitchenStorage } from "@/lib/kitchen/storage";
import { LiveTripleseatAdapter } from "@/lib/kitchen/tripleseat";

function adapter(fetchImpl: typeof fetch) {
  return new LiveTripleseatAdapter({ fetchImpl, storage: createMemoryKitchenStorage(), env: {
    NODE_ENV: "test", TRIPLESEAT_CLIENT_ID: "test-client", TRIPLESEAT_CLIENT_SECRET: "test-secret",
    TRIPLESEAT_ACCESS_TOKEN: "test-access", TRIPLESEAT_REFRESH_TOKEN: "test-refresh", TRIPLESEAT_LOCATION_ID: "26059",
  } });
}
const start = "2026-11-10", end = "2026-11-16";
const detail = { id: 91, name: "Redacted party", status: "DEFINITE", location_id: 26059, event_date_iso8601: start,
  event_start_iso8601: "2026-11-10T17:00:00-05:00", event_end_iso8601: "2026-11-10T20:00:00-05:00" };

describe("strict Tripleseat staffing reads", () => {
  it("completes venue/date pagination, reads only scoped metadata, and skips lost bookings", async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/events/search")) {
        expect(url.searchParams.get("event_start_date")).toBe("11/10/2026");
        expect(url.searchParams.get("event_end_date")).toBe("11/16/2026");
        expect(url.searchParams.get("location_ids")).toBe("26059");
        expect(url.searchParams.has("status")).toBe(false);
        return Response.json({ total_pages: 2, results: url.searchParams.get("page") === "1" ? [{ id: 91 }, { id: 92, status: "LOST" }] : [{ id: 93 }, { id: 94, location_id: 999 }] });
      }
      expect(url.search).toBe("");
      if (url.pathname.endsWith("/events/91")) return Response.json({ event: { ...detail, confidential_contact: "private fixture" } });
      if (url.pathname.endsWith("/events/93")) return Response.json({ event: { ...detail, id: 93, status: "LOST" } });
      throw new Error("Unexpected Tripleseat staffing request");
    });
    expect(await adapter(request).fetchStaffingEventsForRange(start, end)).toEqual([{ eventId: "91", eventName: "Redacted party", localDate: start,
      eventStartAt: detail.event_start_iso8601, eventEndAt: detail.event_end_iso8601 }]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([{ results: [], total_pages: 2 }, { results: [{ id: 91 }], total_pages: 2 }, { error: "malformed" }])("fails rather than treating a partial page as authoritative (%o)", async (secondPage) => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ id: 91 }], total_pages: 2 })).mockResolvedValueOnce(Response.json(secondPage));
    await expect(adapter(request).fetchStaffingEventsForRange(start, end)).rejects.toThrow(/staffing search/);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("accepts an explicit empty result without an unverified status fallback", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ results: [], total_pages: 0 }));
    await expect(adapter(request).fetchStaffingEventsForRange(start, end)).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
