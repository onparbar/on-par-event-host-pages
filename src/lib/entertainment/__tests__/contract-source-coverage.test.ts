import { describe, expect, it } from "vitest";
import { createMemoryKitchenStorage } from "@/lib/kitchen/storage";
import { LiveTripleseatAdapter } from "@/lib/kitchen/tripleseat";
import { buildEntertainmentSchedule } from "../domain";
import { buildEventPlan, entertainmentEvidenceForSource } from "@/lib/event-plans/domain";
import { applyEntertainmentDayToItinerary } from "@/lib/itineraries/entertainment";

const DATE = "2026-11-17";

function fixture(options: {
  eventLines?: Record<string, unknown>[];
  menu?: Record<string, unknown>[];
  bookingLines?: Record<string, unknown>[];
  bookingEventIds?: number[];
  advertisedCategories?: string[];
} = {}) {
  const requests: string[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const adapter = new LiveTripleseatAdapter({
    env: { NODE_ENV: "test", TRIPLESEAT_CLIENT_ID: "test-client", TRIPLESEAT_CLIENT_SECRET: "test-secret",
      TRIPLESEAT_ACCESS_TOKEN: "test-access", TRIPLESEAT_REFRESH_TOKEN: "test-refresh", TRIPLESEAT_LOCATION_ID: "26059" },
    storage: createMemoryKitchenStorage(),
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      expect(init?.method ?? "GET").toBe("GET");
      requests.push(url.pathname);
      if (url.pathname.endsWith("/events/search")) return json({ results: [{ id: 9001 }], total_pages: 1 });
      if (url.pathname.endsWith("/events/9001")) return json({ event: {
        id: 9001, ...(options.bookingLines ? { booking_id: 7001 } : {}), name: "Redacted contract coverage",
        event_date_iso8601: DATE, event_start_iso8601: `${DATE}T17:00:00-05:00`, event_end_iso8601: `${DATE}T20:00:00-05:00`,
        status: "DEFINITE", location_id: 26059, category_totals: (options.advertisedCategories ?? []).map((name) => ({ name })),
        guest_count: 50, rooms: [{ id: 8, name: "Main Dining Room" }], updated_at: "2026-10-26T20:00:00Z",
        documents: [{ id: 44, line_items: options.eventLines ?? [] }],
      } });
      if (url.pathname.endsWith("/menu_item_selections")) return json({ menu_item_selections: options.menu ?? [] });
      if (url.pathname.endsWith("/notes")) return json({ notes: [] });
      if (url.pathname.endsWith("/bookings/7001")) return json({ booking: {
        event_ids: options.bookingEventIds ?? [9001], documents: [{ id: 55, line_items: options.bookingLines ?? [] }],
      } });
      throw new Error(`Unexpected mocked read: ${url.pathname}`);
    },
  });
  return { adapter, requests };
}

const foodLine = { id: 1, description: "Desert Platter", category: { name: "Food Platters" }, quantity: 1 };
const bowlingMenu = { id: 2, display_name: "Duckpin Bowling Lanes", category: { name: "Bowling" }, quantity: 1,
  menu_modifier_selections: [{ id: 3, display_name: "1 Hour Bowling Lane Rental - Sunday-Thursday", quantity: null }] };

describe("contract entertainment source coverage", () => {
  it("replays the redacted November parent/modifier contract through schedule, event plan and itinerary", async () => {
    const test = fixture({ menu: [
      { id: 100, display_name: "Duckpin Bowling Lanes", quantity: 1,
        menu_modifier_selections: [{ id: 101, display_name: "1 Hour Bowling Lane Rental - Sunday-Thursday (6 players/lane)", quantity: null }] },
      { id: 200, display_name: "Pool Tables", quantity: 1,
        menu_modifier_selections: [{ id: 201, display_name: "1 Hour Pool Table Rental - Sunday-Thursday", quantity: null }] },
      { id: 300, display_name: "Dartsee-Darts", quantity: 1,
        menu_modifier_selections: [{ id: 301, display_name: "1 Hour Dart Lane Rental - Sunday-Thursday (8 players/lane)", quantity: null }] },
      { id: 400, display_name: "Mini Golf", quantity: 1,
        menu_modifier_selections: [{ id: 401, display_name: "Mini Golf-1 Course", quantity: null }] },
    ] });
    const [source] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    const originalSource = structuredClone(source);
    expect(source.items.every((item) => item.categoryName == null)).toBe(true);
    const schedule = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
    expect(schedule.reservations.map((item) => item.resourceCategory).sort()).toEqual(["bowling", "darts", "pool"]);
    for (const reservation of schedule.reservations) {
      expect(Date.parse(reservation.startAt)).toBe(Date.parse(`${DATE}T17:00:00-05:00`));
      expect(Date.parse(reservation.endAt)).toBe(Date.parse(`${DATE}T18:00:00-05:00`));
      expect(reservation.contractedDurationMinutes).toBe(60);
      expect(reservation.startTimeSource).toBe("event-start-default");
    }
    expect(schedule.events[0].reviewIssues.filter((issue) => issue.code === "SOURCE_DETAILS_UNAVAILABLE" || issue.code === "TIME_NEEDS_REVIEW")).toEqual([]);
    expect(schedule.reservations.map((item) => item.sourceReference).sort()).toEqual(["menu:100", "menu:200", "menu:300"]);
    expect(schedule.events[0].sourceSnapshot).toEqual(originalSource);
    expect(source).toEqual(originalSource);
    const [planSource] = await test.adapter.fetchEventPlansForRange(DATE, DATE);
    const plan = buildEventPlan(planSource);
    expect(plan.entertainment).toHaveLength(4);
    expect(plan.entertainment.filter((item) => item.name !== "Mini Golf")).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Duckpin Bowling", quantity: "1 lane", time: "5:00 PM - 6:00 PM", duration: "1 hour" }),
      expect.objectContaining({ name: "Darts", quantity: "1 lane", time: "5:00 PM - 6:00 PM", duration: "1 hour" }),
      expect.objectContaining({ name: "Pool Tables", quantity: "1 table", time: "5:00 PM - 6:00 PM", duration: "1 hour" }),
    ]));
    expect(plan.entertainment.filter((item) => item.name === "Mini Golf")).toEqual([{ name: "Mini Golf", quantity: "1 guest", time: "", duration: "" }]);
    expect(plan.review_reasons?.some((reason) => /entertainment.*(?:quantity is missing|duration is missing|time is missing)|no usable contracted duration/i.test(reason))).toBe(false);
    const itinerary = applyEntertainmentDayToItinerary(plan, { date: DATE, ...schedule });
    expect(itinerary.entertainment).toHaveLength(4);
    expect(itinerary.entertainment.filter((item) => item.name !== "Mini Golf").every((item) => item.duration === "1 hour" && item.time === "5:00 PM – 6:00 PM")).toBe(true);
    expect(itinerary.entertainment.filter((item) => item.name === "Mini Golf")).toEqual([{ name: "Mini Golf", quantity: "1 guest", time: "", duration: "" }]);
  });

  it.each(["Reserve 2 pool tables for 1 hour", "2 pool tables for 1 hour"])("preserves explicit resource counts and flags a conflicting bare booking quantity: %s", async (description) => {
    const test = fixture({ eventLines: [{ id: 77, description: "Pool Tables", long_description: description, quantity: 1, category: { name: "Pool Tables" } }] });
    const [source] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    const originalSource = structuredClone(source);
    const schedule = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
    expect(schedule.reservations).toHaveLength(2);
    expect(schedule.reservations.every((item) => item.sourceReference === "document:44:line:77")).toBe(true);
    const quantityConflict = (message: string) => /quantity|count/i.test(message) && /conflict|contradict/i.test(message);
    expect(schedule.events[0].reviewIssues.some((issue) => quantityConflict(issue.message))).toBe(true);
    expect(source).toEqual(originalSource);
    const [planSource] = await test.adapter.fetchEventPlansForRange(DATE, DATE);
    const plan = buildEventPlan(planSource);
    expect(plan.entertainment).toEqual([expect.objectContaining({ name: "Pool Tables", quantity: "2 tables", duration: "1 hour" })]);
    expect(plan.review_reasons?.some(quantityConflict)).toBe(true);
    expect(entertainmentEvidenceForSource(planSource).map((evidence) => evidence.sourceId)).toEqual(["document:44:line:77"]);
  });

  it("uses authoritative document category values once in both builders", async () => {
    const test = fixture({ eventLines: [{ id: 10, description: "2 bowling lanes for 2 hours", category: { name: "Bowling" }, quantity: 2 }], menu: [bowlingMenu] });
    const [source] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    const schedule = buildEntertainmentSchedule({ sourceEvents: [source], localEvents: [] });
    expect(schedule.reservations).toHaveLength(2);
    expect(schedule.reservations.every((item) => item.contractedDurationMinutes === 120)).toBe(true);
    const [planSource] = await test.adapter.fetchEventPlansForRange(DATE, DATE);
    const plan = buildEventPlan(planSource);
    expect(plan.entertainment).toEqual([expect.objectContaining({ name: "Duckpin Bowling", quantity: "2 lanes", duration: "2 hours", time: "5:00 PM - 7:00 PM" })]);
  });

  it("does not let food-only document rows hide menu entertainment", async () => {
    const test = fixture({ eventLines: [foodLine], menu: [bowlingMenu] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.map((item) => item.name)).toContain("Duckpin Bowling Lanes");
    expect(event.items.map((item) => item.name)).toContain("1 Hour Bowling Lane Rental - Sunday-Thursday");
  });

  it("uses verified booking entertainment when event documents contain only food", async () => {
    const test = fixture({ eventLines: [foodLine], bookingLines: [
      { id: 10, description: "Pool Tables", category: { name: "Pool Tables" }, quantity: 1 },
      { id: 11, description: "1 Hour Pool Table Rental - Sunday-Thursday", category: { name: "Pool Tables" }, quantity: null },
    ] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.map((item) => item.name)).toContain("Pool Tables");
    const [plan] = await test.adapter.fetchEventPlansForRange(DATE, DATE);
    expect(plan.documentItems.map((item) => item.name)).toContain("Pool Tables");
    expect(plan.selections).toContainEqual(expect.objectContaining({ name: "Desert Platter", quantity: 1 }));
  });

  it("fills a missing menu category without duplicating an authoritative document category", async () => {
    const test = fixture({ eventLines: [{ id: 10, description: "2 bowling lanes for 2 hours", category: { name: "Bowling" }, quantity: 2 }],
      menu: [bowlingMenu, { id: 20, display_name: "Pool Tables", category: { name: "Pool Tables" }, quantity: 1 }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.filter((item) => item.categoryName === "Bowling")).toHaveLength(1);
    expect(event.items.map((item) => item.name)).toContain("Pool Tables");
  });

  it("does not import another event's or an ambiguous booking's entertainment", async () => {
    const test = fixture({ eventLines: [foodLine], bookingEventIds: [9001, 9002], bookingLines: [
      { id: 10, description: "2 pool tables for 2 hours", category: { name: "Pool Tables" }, quantity: 2 },
    ], menu: [bowlingMenu] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.some((item) => item.sourceId.startsWith("document:55:"))).toBe(false);
    expect(event.items.map((item) => item.name)).toContain("Duckpin Bowling Lanes");
  });

  it("checks a missing advertised category in the single-event booking, retaining event-document precedence", async () => {
    const test = fixture({ advertisedCategories: ["Bowling", "Pool Tables"],
      eventLines: [{ id: 10, description: "1 bowling lane for 1 hour", category: { name: "Bowling" }, quantity: 1 }],
      bookingLines: [{ id: 20, description: "2 bowling lanes for 2 hours", category: { name: "Bowling" }, quantity: 2 },
        { id: 21, description: "1 pool table for 1 hour", category: { name: "Pool Tables" }, quantity: 1 }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.filter((item) => item.categoryName === "Bowling")).toEqual([expect.objectContaining({ sourceId: "document:44:line:10" })]);
    expect(event.items.map((item) => item.name)).toContain("1 pool table for 1 hour");
  });

  it("does not duplicate a known Mini Golf quantity with its non-priced generic child label", async () => {
    const test = fixture({ menu: [{ id: 30, display_name: "Mini Golf", quantity: 1,
      menu_modifier_selections: [{ id: 31, display_name: "Mini Golf-1 Course", quantity: null, price: 0 }] }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.filter((item) => /Mini Golf/i.test(item.name))).toEqual([expect.objectContaining({ name: "Mini Golf", quantity: 1 })]);
    const [plan] = await test.adapter.fetchEventPlansForRange(DATE, DATE);
    expect(plan.selections.filter((item) => /Mini Golf/i.test(item.name))).toEqual([expect.objectContaining({ name: "Mini Golf", quantity: 1 })]);
  });

  it("assigns a bare extension only to its proven raw menu-parent category", async () => {
    const test = fixture({ menu: [{ id: 30, display_name: "Duckpin Bowling Lanes", quantity: 1, category: { name: "Entertainment" },
      menu_modifier_selections: [{ id: 31, display_name: "Extra Hour", quantity: null }] }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.find((item) => item.name === "Extra Hour")).toMatchObject({ categoryName: "bowling", quantity: null });
  });

  it.each([
    { id: 31, display_name: "Mini Golf-1 Course", quantity: null, price: 9 },
    { id: 31, display_name: "Mini Golf", quantity: 5, price: 0 },
    { id: 31, display_name: "Mini Golf 20 guests", quantity: null, price: 0 },
    { id: 31, display_name: "Mini Golf", quantity: null, start_at: `${DATE}T17:00:00-05:00` },
  ])("retains meaningful Mini Golf modifiers for review: %j", async (modifier) => {
    const test = fixture({ menu: [{ id: 30, display_name: "Mini Golf", quantity: 1, menu_modifier_selections: [modifier] }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.filter((item) => /Mini Golf/i.test(item.name))).toHaveLength(2);
  });

  it("retains an unknown standalone Mini Golf quantity instead of borrowing another purchase's count", async () => {
    const test = fixture({ menu: [{ id: 30, display_name: "Mini Golf", quantity: null,
      menu_modifier_selections: [{ id: 31, display_name: "Mini Golf-1 Course", quantity: null }] }] });
    const [event] = await test.adapter.fetchEntertainmentEventsForDate(DATE);
    expect(event.items.filter((item) => /Mini Golf/i.test(item.name))).toHaveLength(2);
  });
});
