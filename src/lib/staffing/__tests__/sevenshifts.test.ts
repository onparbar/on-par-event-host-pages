import { describe, expect, it, vi } from "vitest";
import { staffingWindow } from "../domain";
import { readPublishedStaffingShifts } from "../sevenshifts";

vi.mock("server-only", () => ({}));
const env = { SEVENSHIFTS_ACCESS_TOKEN: "fixture-token", SEVENSHIFTS_COMPANY_ID: "11", SEVENSHIFTS_LOCATION_ID: "22", SEVENSHIFTS_CORPORATE_ROLE_ID: "33" };
const window = staffingWindow(new Date("2026-11-10T15:00:00Z"));
const published = { id: 1, company_id: 11, location_id: 22, role_id: 33, user_id: 44, publish_status: "published", draft: false,
  deleted: false, open: false, unassigned: false, soft_deleted: null, start: "2026-11-10T22:00:00Z", end: "2026-11-11T01:00:00Z", notes: "Event ID: 123" };
const page = (data: object[], next: string | null) => Response.json({ data, meta: { cursor: { next } } });

describe("published staffing schedule provider", () => {
  it("paginates the venue schedule and only keeps active names, corporate markers and corporate notes", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.7shifts.com");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      if (url.pathname.endsWith("/shifts")) {
        expect(url.searchParams.get("location_id")).toBe("22");
        expect(url.searchParams.get("start[gte]")).toBe("2026-11-09T05:00:00.000Z");
        expect(url.searchParams.get("start[lte]")).toBe("2026-11-17T04:59:59.999Z");
        expect(url.searchParams.has("draft") || url.searchParams.has("include_draft")).toBe(false);
        return url.searchParams.get("cursor") ? page([{ ...published, id: 5, user_id: 55 }, { ...published, id: 6, deleted: true }], null)
          : page([published, { ...published, id: 2, location_id: 99 }, { ...published, id: 3, role_id: 99, user_id: 66, notes: "Other station note" },
            { ...published, id: 4, open: true }], "second-page");
      }
      const id = Number(url.pathname.split("/").at(-1));
      return Response.json({ data: { id, company_id: 11, active: id !== 55, first_name: "Staff", preferred_first_name: id === 44 ? "Preferred" : "",
        last_name: "Person", punch_id: "0000", email: "private@example.test" } });
    });
    const shifts = await readPublishedStaffingShifts(window, { env, fetchImpl: request });
    expect(shifts).toEqual([{ shiftId: "1", employeeId: "44", employeeName: "Preferred Person", startAt: published.start,
      endAt: published.end, corporate: true, notes: published.notes },
      { shiftId: "3", employeeId: "66", employeeName: "Staff Person", startAt: published.start,
        endAt: published.end, corporate: false }]);
    expect(request).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(shifts)).not.toMatch(/punch|private@example|Other station note/);
  });

  it("rejects an unconfigured marker without attempting any request", async () => {
    const request = vi.fn();
    await expect(readPublishedStaffingShifts(window, { env: {}, fetchImpl: request })).rejects.toMatchObject({ reason: "unconfigured" });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails the entire import if a later page is throttled or leaks unpublished edits", async () => {
    for (const [response, reason] of [[new Response("", { status: 429 }), "rate-limited"], [page([{ ...published, id: 2, draft: true }], null), "incomplete"]] as const) {
      const request = vi.fn().mockResolvedValueOnce(page([published], "another")).mockResolvedValueOnce(response);
      await expect(readPublishedStaffingShifts(window, { env, fetchImpl: request })).rejects.toMatchObject({ reason });
      expect(request).toHaveBeenCalledTimes(2);
    }
  });

  it("distinguishes a confirmed empty schedule from malformed pagination", async () => {
    await expect(readPublishedStaffingShifts(window, { env, fetchImpl: vi.fn().mockResolvedValue(page([], null)) })).resolves.toEqual([]);
    await expect(readPublishedStaffingShifts(window, { env, fetchImpl: vi.fn().mockResolvedValue(Response.json({ data: [] })) })).rejects.toMatchObject({ reason: "incomplete" });
  });
});
