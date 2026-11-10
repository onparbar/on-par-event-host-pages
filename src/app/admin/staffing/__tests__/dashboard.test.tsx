import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StaffingState } from "@/lib/staffing/storage";
import StaffingDashboard from "../StaffingDashboard";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/staffing", useRouter: () => ({ push: vi.fn() }) }));

const window = { startDate: "2026-11-10", endDate: "2026-11-16", shiftStartDate: "2026-11-09" };
const event = { eventId: "111", eventName: "Redacted open staffing alert", date: "2026-11-10", startAt: "2026-11-10T22:00:00Z", endAt: "2026-11-11T01:00:00Z" };
const shift = { shiftId: "112", employeeId: "113", employeeName: "Redacted shift employee", startAt: "2026-11-10T21:00:00Z", endAt: "2026-11-11T01:00:00Z" };
const state: StaffingState = {
  version: 4, keepClearEventIds: [], policy: {}, failure: null, lastAttemptAt: null,
  events: [event], shifts: [shift, { ...shift, shiftId: "114", employeeName: "Nonmatching shift", endAt: "2026-11-10T21:15:00Z" }],
  reconciliation: {
    window, dataStatus: "verified", lastSuccessfulSyncAt: "2026-11-10T15:00:00Z",
    assignments: [], eventStatuses: { "111": "unassigned" }, reviews: [{ code: "ambiguous-event", eventIds: ["111"], shiftId: "112" }],
    alerts: [
      { key: "open-111", eventId: "111", eventName: event.eventName, eventDate: event.date, startAt: event.startAt, endAt: event.endAt, openedAt: "2026-11-10T15:00:00Z", resolvedAt: null },
      { key: "resolved-115", eventId: "115", eventName: "Resolved test alert", eventDate: event.date, startAt: event.startAt, endAt: event.endAt, openedAt: "2026-11-10T15:00:00Z", resolvedAt: "2026-11-10T15:05:00Z" },
    ],
  },
};

describe("Admin staffing controls", () => {
  it("shows official open alerts and details, and only offers shifts overlapping the selected event", () => {
    const html = renderToStaticMarkup(<StaffingDashboard rolloutEnabled initialFresh initialEventId="111" initialState={state} window={window} />);
    expect(html).toContain("Redacted open staffing alert");
    expect(html).toContain("5:00 PM – 8:00 PM");
    expect(html).toContain("More than one event could match the shift.");
    expect(html).toContain('<option value="112">Redacted shift employee');
    expect(html).not.toContain("Resolved test alert");
    expect(html).not.toContain("Nonmatching shift");
  });

  it("keeps saved evidence readable but disables shift corrections on an unverified snapshot", () => {
    const html = renderToStaticMarkup(<StaffingDashboard rolloutEnabled initialFresh={false} initialEventId="111" initialState={{ ...state, failure: "shifts" }} window={window} />);
    expect(html).toContain("Published 7shifts schedules could not be verified.");
    expect(html).toContain("Redacted open staffing alert");
    expect(html).toMatch(/<select[^>]* disabled="".*?<option value="112">/);
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Assign shift/);
  });
});
