import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { focusedKitchenChecklist, KitchenChecklistSheet, KitchenEventAccordion, printableEventChecklists, VipKitchenPreorder } from "@/app/kitchen/KitchenDashboard";
import { vipPrepKitchenEvents } from "@/lib/vip-prep/client";
import type { VipPrepPayload, VipPrepReservation } from "@/lib/vip-prep/types";
import type { TripleseatAdapter } from "../tripleseat";
import { createMemoryKitchenStorage, SupabaseKitchenStorage } from "../storage";
import { generateKitchenChecklist } from "../rules";
import { getKitchenDay, normalizeKitchenEventAddOnFood, syncKitchenDay, syncVipBookingDay } from "../sync";

const DATE = "2026-11-14";
const BEFORE_ARRIVAL = new Date("2026-11-14T17:00:00Z");
const item = (code: string, label: string, quantity: number) => ({ code, label, quantity, unitPriceCents: 0, totalCents: 0 });
function reservation(overrides: Partial<VipPrepReservation> = {}): VipPrepReservation {
  return {
    id: "redacted-november-vip", confirmationCode: "VIPL-REDACTED", operatingDate: DATE,
    resource: { code: "VIPL", name: "VIP 2" }, eventName: "Redacted VIP", guestName: "Redacted Customer", partySize: 16,
    startAt: "2026-11-14T22:00:00Z", endAt: "2026-11-15T00:00:00Z", status: "confirmed",
    foodPrep: [item("chicken-tenders", "Chicken Tender selections", 2), item("fry-platters", "Fry Platter", 1), item("mozzarella-sticks", "Mozzarella Stick selection", 1)],
    extras: [{ code: "MINIGOLF", label: "Mini Golf", quantity: 16 }], updatedAt: "2026-10-26T16:00:00Z", lastRefreshedAt: "2026-10-26T17:00:00Z", ...overrides,
  };
}
function payload(reservations = [reservation()]): VipPrepPayload {
  return { from: DATE, to: DATE, timeZone: "America/New_York", generatedAt: "2026-10-26T17:00:00Z", reservationCount: reservations.length, reservations };
}
function adapter(): TripleseatAdapter {
  return { sourceMode: "live", fetchEventsForDate: vi.fn(async () => []), fetchEntertainmentEventsForDate: vi.fn(async () => []), fetchEventDateById: vi.fn(async () => null),
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }) };
}
const floorPlanStorage = { get: async () => null };

describe("VIP planning visibility before Event Host arrival", () => {
  it("selects canonical VIP identities exactly and rejects ambiguous legacy numeric selectors", () => {
    const checklists = vipPrepKitchenEvents([reservation({ id: "test-h4l720-hfbtsa" }), reservation({ id: "test-1k212gj-1rfricb" })]).map((source) => generateKitchenChecklist(source));
    expect(focusedKitchenChecklist(checklists, "vip-test-h4l720-hfbtsa")).toBe(checklists[0]);
    expect(focusedKitchenChecklist(checklists, "vip-test-1k212gj-1rfricb")).toBe(checklists[1]);
    expect(focusedKitchenChecklist(checklists, "527983760")).toBeNull();
    expect(focusedKitchenChecklist([checklists[0]], "527983760")).toBe(checklists[0]);
    const corporate = { ...checklists[0], event: { ...checklists[0].event, eventId: 527983760 } };
    expect(focusedKitchenChecklist([checklists[0], corporate], "527983760")).toBeNull();
    expect(focusedKitchenChecklist([checklists[0], corporate], "vip-test-h4l720-hfbtsa")).toBe(checklists[0]);
  });
  it("shows the sanitized November booking's purchased quantities separately from recipe preparation on screen and print", async () => {
    const storage = createMemoryKitchenStorage();
    const day = await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload() } });
    expect(day.events).toHaveLength(1);
    const checklist = { ...day.events[0], vipArrival: { checkedInAt: null, checkedInBy: null, foodStatus: "NOT_CHECKED_IN", scheduledReleaseAt: null, itemIssues: [] } };
    expect(printableEventChecklists(day.events)).toEqual(day.events);
    expect(checklist.event.vipBooking?.foodPrep.map(({ quantity, label }) => ({ quantity, label }))).toEqual([
      { quantity: 2, label: "Chicken Tender selections" }, { quantity: 1, label: "Fry Platter" }, { quantity: 1, label: "Mozzarella Stick selection" },
    ]);
    expect(checklist.event.vipBooking?.extras).toEqual([{ code: "MINIGOLF", label: "Mini Golf", quantity: 16 }]);
    expect(checklist.sections.flatMap((section) => section.rows)).toContainEqual(expect.objectContaining({ key: "platter-chicken-tenders", quantity: 128, unit: "each" }));
    const sheet = renderToStaticMarkup(createElement(KitchenChecklistSheet, { checklist, bwaSaveState: "idle" }));
    const accordion = renderToStaticMarkup(createElement(KitchenEventAccordion, { checklist }));
    for (const html of [sheet, accordion]) expect(html).toContain("Awaiting VIP check-in — food not released.");
    for (const text of ["Purchased food — booking quantities", "2 × Chicken Tender selections", "1 × Fry Platter", "1 × Mozzarella Stick selection", "128 each", "not additional purchased platters"]) expect(sheet).toContain(text);
  });

  it("keeps a no-food VIP visible without inventing a kitchen order or marking it invalid", async () => {
    const day = await getKitchenDay(DATE, { storage: createMemoryKitchenStorage(), adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload([reservation({ foodPrep: [] })]) } });
    expect(day.events).toHaveLength(1);
    expect(day.events[0].sections).toEqual([]);
    expect(day.events[0].needsReview).toBe(false);
    expect(renderToStaticMarkup(createElement(VipKitchenPreorder, { checklist: day.events[0] }))).toContain("No preordered food. This remains a valid VIP booking.");
  });

  it("keeps unknown food codes and their exact quantities visible without guessing a known recipe from the label", () => {
    const source = vipPrepKitchenEvents([reservation({ foodPrep: [item("unknown-code", "Chicken Tender Platter", 2)] })])[0];
    const checklist = generateKitchenChecklist(source);
    expect(checklist.sections.flatMap((section) => section.rows)).not.toContainEqual(expect.objectContaining({ key: "platter-chicken-tenders" }));
    expect(checklist.warnings).toContainEqual(expect.objectContaining({ code: "UNKNOWN_FOOD_ITEM", requiresReview: true }));
    const html = renderToStaticMarkup(createElement(VipKitchenPreorder, { checklist }));
    expect(html).toContain("2 × Chicken Tender Platter");
    expect(html).toContain("unknown-code");
    expect(html).toContain("mapping");
  });

  it("preserves saved staff assignments as a booking changes and does not persist only a new refresh timestamp every poll", async () => {
    const storage = createMemoryKitchenStorage();
    let current = payload();
    const dependencies = { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL, vipPrepClient: { configured: true, fetchRange: async () => current } };
    await getKitchenDay(DATE, dependencies);
    await storage.saveManualAssignments("vip-redacted-november-vip", ["Lex"], ["Tina"], "Carlos", "Daniel", ["Brooke"]);
    const save = vi.spyOn(storage, "saveEvent");
    current = payload([reservation({ lastRefreshedAt: "2026-10-26T17:05:00Z" })]);
    current.generatedAt = "2026-10-26T17:05:00Z";
    const refreshed = await getKitchenDay(DATE, dependencies);
    expect(save).not.toHaveBeenCalled();
    expect(refreshed.events[0]).toMatchObject({ foodRunners: ["Lex"], pocs: ["Tina"], preppedBy: "Carlos", verifiedBy: "Daniel", setup: ["Brooke"] });
    expect(refreshed.vipBookingSync?.lastSuccessfulRefreshAt).toBe("2026-10-26T17:05:00Z");
    current = payload([reservation({ foodPrep: [item("chicken-tenders", "Chicken Tender selections", 3)], updatedAt: "2026-10-26T17:06:00Z" })]);
    const changed = await getKitchenDay(DATE, dependencies);
    expect(save).toHaveBeenCalledTimes(1);
    expect(changed.events[0].event.vipBooking?.foodPrep[0].quantity).toBe(3);
    expect(changed.events[0].foodRunners).toEqual(["Lex"]);
    expect(changed.events[0].event.eventId).toBe("vip-redacted-november-vip");
    const note = changed.events[0].event.vipBooking?.preorderChange;
    expect(note).toMatchObject({ sourceUpdatedAt: "2026-10-26T17:06:00Z", current: [{ code: "chicken-tenders", label: "Chicken Tender selections", quantity: 3 }] });
    expect(note?.previous[0]).toEqual({ code: "chicken-tenders", label: "Chicken Tender selections", quantity: 2 });
    const sheet = renderToStaticMarkup(createElement(KitchenChecklistSheet, { checklist: changed.events[0], bwaSaveState: "idle" }));
    expect(sheet).toContain("Preorder changed");
    expect(sheet).toContain("Previous: 2 × Chicken Tender selections");
    expect(sheet).toContain("Current: 3 × Chicken Tender selections");
    expect(sheet).toContain("do not resend the original order");
    const unchanged = await getKitchenDay(DATE, dependencies);
    expect(unchanged.events[0].event.vipBooking?.preorderChange).toEqual(note);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("identifies a change to no preordered food and ignores ordering-only changes to exact source items", async () => {
    const storage = createMemoryKitchenStorage();
    let current = payload();
    const dependencies = { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => current } };
    await getKitchenDay(DATE, dependencies);
    current = payload([reservation({ foodPrep: [...reservation().foodPrep].reverse() })]);
    expect((await getKitchenDay(DATE, dependencies)).events[0].event.vipBooking?.preorderChange).toBeUndefined();
    current = payload([reservation({ foodPrep: [], updatedAt: "2026-10-26T17:07:00Z" })]);
    const empty = (await syncKitchenDay(DATE, dependencies)).events[0];
    expect(empty.event.vipBooking?.preorderChange?.current).toEqual([]);
    expect(empty.event.vipBooking?.preorderChange?.previous).toHaveLength(3);
    expect(empty.needsReview).toBe(false);
    expect(renderToStaticMarkup(createElement(VipKitchenPreorder, { checklist: empty }))).toContain("Current: No preordered food");
    expect((await getKitchenDay(DATE, dependencies)).events[0].event.vipBooking?.preorderChange).toEqual(empty.event.vipBooking?.preorderChange);
  });

  it("distinguishes valid empty/cancelled results from an unavailable source while retaining saved staff data", async () => {
    const storage = createMemoryKitchenStorage();
    await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload() } });
    const failed = await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("private source detail"); } } });
    expect(failed.events).toHaveLength(1);
    expect(failed.vipBookingSync).toMatchObject({ status: "error", reservationCount: null, lastSuccessfulRefreshAt: "2026-10-26T17:00:00Z" });
    expect(JSON.stringify(failed)).not.toContain("private source detail");
    const empty = await syncVipBookingDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload([reservation({ status: "cancelled" })]) } });
    expect(empty.events).toEqual([]);
    expect(empty.vipBookingSync).toMatchObject({ status: "success", reservationCount: 0 });
    expect(empty.bookingCount).toBe(0);
    const retained = (await storage.getDay(DATE)).events;
    expect(retained).toHaveLength(1);
    expect(retained[0].event.vipBooking).toMatchObject({ activeInSource: false, status: "confirmed", foodPrep: reservation().foodPrep });
    const save = vi.spyOn(storage, "saveEvent");
    const dependencies = { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload([]) } };
    await getKitchenDay(DATE, dependencies);
    expect(save).not.toHaveBeenCalled();
    const unavailable = await getKitchenDay(DATE, { ...dependencies,
      vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("unavailable"); } } });
    expect(unavailable.events).toEqual([]);
    expect(unavailable.vipBookingSync?.status).toBe("error");
  });

  it("supports read-only cross-view health without initializing VIP or confirmed-contract snapshots", async () => {
    const storage = createMemoryKitchenStorage();
    const save = vi.spyOn(storage, "saveEvent");
    const replace = vi.spyOn(storage, "replaceDay");
    const vip = await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL, persistSourceChanges: false,
      vipPrepClient: { configured: true, fetchRange: async () => payload() } });
    const contract = await getKitchenDay("2026-08-21", { storage, adapter: adapter(), floorPlanStorage, now: new Date("2026-08-21T12:00:00Z"), persistSourceChanges: false,
      vipPrepClient: { configured: false, fetchRange: async () => payload([]) } });
    expect(vip.events).toHaveLength(1);
    expect(contract.events.length).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect((await storage.getDay(DATE)).events).toEqual([]);
  });

  it("does not persist a missing-source tombstone during read-only diagnostics", async () => {
    const storage = createMemoryKitchenStorage();
    const source = vipPrepKitchenEvents([reservation()])[0];
    await storage.saveEvent({ sourceEvent: source, checklist: generateKitchenChecklist(source) });
    const save = vi.spyOn(storage, "saveEvent");
    const day = await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      persistSourceChanges: false, vipPrepClient: { configured: true, fetchRange: async () => payload([]) } });
    expect(day.events).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect((await storage.getDay(DATE)).events[0].event.vipBooking?.activeInSource).not.toBe(false);
  });

  it("retains VIP staff prep and add-on history after a successful refresh removes it from the active day", async () => {
    const storage = createMemoryKitchenStorage();
    await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload() } });
    const eventId = "vip-redacted-november-vip";
    const itemKey = "platter-chicken-tenders";
    await storage.saveManualAssignments(eventId, ["Lex"], ["Tina"], "Carlos", "Daniel", ["Brooke"]);
    await storage.saveItemReadiness(eventId, itemKey, true);
    await storage.saveItemPrepped(eventId, itemKey, true, "Carlos", "2026-11-14T19:00:00Z");
    await storage.saveItemCompletion(eventId, itemKey, true);
    const addOns = await storage.saveFoodAddOns(eventId, normalizeKitchenEventAddOnFood({ wings: 1 }), null);
    const empty = await syncKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => payload([]) } });
    expect(empty.events).toEqual([]);
    const history = (await storage.getDay(DATE)).events[0];
    expect(history).toMatchObject({ foodRunners: ["Lex"], pocs: ["Tina"], preppedBy: "Carlos", verifiedBy: "Daniel", setup: ["Brooke"],
      completedItemKeys: [itemKey], preppedItemKeys: [itemKey], finalCompletedItemKeys: [itemKey],
      preppedItemDetails: { [itemKey]: { employeeName: "Carlos", preppedAt: "2026-11-14T19:00:00Z" } } });
    expect(await storage.getFoodAddOns(eventId)).toEqual(addOns);
    const movedSource = vipPrepKitchenEvents([reservation({ operatingDate: "2026-11-15", startAt: "2026-11-15T22:00:00Z", endAt: "2026-11-16T00:00:00Z" })])[0];
    await storage.replaceDay("2026-11-15", [{ sourceEvent: movedSource, checklist: generateKitchenChecklist(movedSource) }]);
    expect((await storage.getDay(DATE)).events).toEqual([]);
    const moved = (await storage.getDay("2026-11-15")).events;
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ foodRunners: ["Lex"], completedItemKeys: [itemKey], preppedItemKeys: [itemKey], finalCompletedItemKeys: [itemKey] });
    expect(await storage.getFoodAddOns(eventId)).toEqual(addOns);
    expect(moved[0].event.vipBooking?.activeInSource).not.toBe(false);
    const oldDate = await getKitchenDay(DATE, { storage, adapter: adapter(), floorPlanStorage, now: BEFORE_ARRIVAL,
      vipPrepClient: { configured: true, fetchRange: async () => { throw new Error("unavailable"); } } });
    expect(oldDate.events).toEqual([]);
  });

  it("does not issue database deletes that would cascade VIP operational history when a booking disappears", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (method === "GET") return Response.json([{ event_id: "vip-redacted-november-vip" }, { event_id: "corporate-old" }]);
      return new Response(null, { status: 204 });
    });
    const storage = new SupabaseKitchenStorage({ env: { NODE_ENV: "test", SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "test-only" }, fetchImpl });
    await storage.replaceDay(DATE, []);
    const deletes = requests.filter(({ method }) => method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url.searchParams.get("event_id")).toBe("eq.corporate-old");
    expect(requests.some(({ method, url }) => method === "DELETE" && url.searchParams.get("event_id")?.includes("vip-"))).toBe(false);
  });
});
