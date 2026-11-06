import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPlan } from "@/lib/event-plans/types";
import { emptyAdminState } from "@/lib/admin-types";
import { loadAdminState } from "@/lib/admin-state";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import { findEventPlanById } from "@/lib/event-plans/sync";
import { readSavedEntertainmentDay } from "@/lib/entertainment/saved-day";
import ItinerariesPage from "../page";

const floor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/admin-state", () => ({ loadAdminState: vi.fn() }));
vi.mock("@/lib/operations/staff-events", () => ({ loadStaffEventPlans: vi.fn() }));
vi.mock("@/lib/event-plans/sync", () => ({ findEventPlanById: vi.fn() }));
vi.mock("@/lib/entertainment/saved-day", () => ({ readSavedEntertainmentDay: vi.fn() }));
vi.mock("@/lib/floor-plans/storage", () => ({ getFloorPlanStorage: () => ({ get: floor.get, persistence: "database" }) }));
vi.mock("@/lib/events", () => ({ itineraries: [{ id: 12, pdf: "/itinerary-pdfs/training.pdf" }] }));
vi.mock("../ItinerariesClient", () => ({ default: () => null }));

const first: EventPlan = { id: 11, name: "Redacted first event", date: "2026-11-06", day: "Friday", time: "6:00 PM - 8:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: ["Dessert Platter: 1"], drink_options: [], entertainment: [], verification_status: "Verified" };
const later = { ...first, id: 12, name: "Redacted later event", date: "2026-11-09", day: "Monday" };
const vip = { ...later, id: 13, source_event_id: "vip-redacted-booking", name: "Redacted VIP" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime("2026-11-06T16:00:00Z");
  vi.mocked(loadAdminState).mockResolvedValue(emptyAdminState());
  vi.mocked(loadStaffEventPlans).mockResolvedValue({ plans: [later, first, vip], sync: null, unfinishedEventIds: [], sourceWarning: "" });
  vi.mocked(findEventPlanById).mockResolvedValue(null);
  vi.mocked(readSavedEntertainmentDay).mockRejectedValue(new Error("Schedule unavailable"));
  floor.get.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); });

describe("Itineraries selected-date detail loading", () => {
  it("loads only the default candidate's operational date and retains all event choices", async () => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({}) });
    expect(floor.get).toHaveBeenCalledExactlyOnceWith(first.date);
    expect(readSavedEntertainmentDay).toHaveBeenCalledExactlyOnceWith(first.date);
    expect(page.props.items.map((item: EventPlan) => item.id)).toEqual([first.id, later.id, vip.id]);
    expect(page.props.items[0]).not.toHaveProperty("food");
    expect(page.props.selectedItinerary).toMatchObject({ id: first.id, food: first.food, revision: { ready: false } });
  });

  it("hydrates another selected date without reading any other dates and preserves the saved PDF", async () => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: String(later.id), date: later.date }) });
    expect(floor.get).toHaveBeenCalledExactlyOnceWith(later.date);
    expect(readSavedEntertainmentDay).toHaveBeenCalledExactlyOnceWith(later.date);
    expect(page.props.selectedItinerary).toMatchObject({ id: later.id, date: later.date, pdf: "/itinerary-pdfs/training.pdf", revision: { ready: false, savedPdfStatus: "unverified" } });
    expect(page.props.selectedItinerary.revision.reasons).toContain("The shared Entertainment Schedule could not be read; listed activities may be outdated.");
  });

  it("chooses an event from the date-only view instead of the earliest different day", async () => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ date: later.date }) });
    expect(floor.get).toHaveBeenCalledExactlyOnceWith(later.date);
    expect(readSavedEntertainmentDay).toHaveBeenCalledExactlyOnceWith(later.date);
    expect(page.props.selectedItinerary.id).toBe(later.id);
  });

  it("keeps nearby events selectable when the explicitly requested day is empty", async () => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ date: "2026-11-07" }) });
    expect(page.props.items.map((item: EventPlan) => item.id)).toEqual([first.id, later.id, vip.id]);
    expect(page.props.selectedItinerary).toBeNull();
    expect(floor.get).not.toHaveBeenCalled();
    expect(readSavedEntertainmentDay).not.toHaveBeenCalled();
  });

  it.each(["", "2026-02-30", [first.date, later.date]])("keeps event choices without building details for malformed dates: %j", async (date) => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: String(later.id), date }) });
    expect(page.props.items.map((item: EventPlan) => item.id)).toContain(later.id);
    expect(page.props.selectedItinerary).toBeNull();
    expect(findEventPlanById).not.toHaveBeenCalled();
    expect(floor.get).not.toHaveBeenCalled();
    expect(readSavedEntertainmentDay).not.toHaveBeenCalled();
  });

  it("resolves a qualified VIP event ID and loads only its date", async () => {
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: vip.source_event_id, date: vip.date }) });
    expect(findEventPlanById).not.toHaveBeenCalled();
    expect(floor.get).toHaveBeenCalledExactlyOnceWith(vip.date);
    expect(readSavedEntertainmentDay).toHaveBeenCalledExactlyOnceWith(vip.date);
    expect(page.props.selectedItinerary).toMatchObject({ id: vip.id, source_event_id: vip.source_event_id });
  });

  it("honors an explicit non-archived past event requested by its legacy numeric URL", async () => {
    const past = { ...first, id: 14, date: "2026-10-21" };
    vi.mocked(findEventPlanById).mockResolvedValue(past);
    const page = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: String(past.id) }) });
    expect(floor.get).toHaveBeenCalledExactlyOnceWith(past.date);
    expect(readSavedEntertainmentDay).toHaveBeenCalledExactlyOnceWith(past.date);
    expect(page.props.items[0]).toMatchObject({ id: past.id, date: past.date });
    expect(page.props.selectedItinerary).toMatchObject({ id: past.id, date: past.date });
  });

  it("does not build an itinerary for the wrong date or an archived event", async () => {
    vi.mocked(findEventPlanById).mockResolvedValue(later);
    const mismatched = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: String(later.id), date: first.date }) });
    expect(mismatched.props.selectedItinerary).toBeNull();
    vi.mocked(loadAdminState).mockResolvedValue({ ...emptyAdminState(), archivedEventIds: [later.id] });
    const archived = await ItinerariesPage({ searchParams: Promise.resolve({ eventId: String(later.id), date: later.date }) });
    expect(archived.props.selectedItinerary).toBeNull();
    expect(archived.props.items.map((item: EventPlan) => item.id)).not.toContain(later.id);
    expect(floor.get).not.toHaveBeenCalled();
    expect(readSavedEntertainmentDay).not.toHaveBeenCalled();
  });
});
