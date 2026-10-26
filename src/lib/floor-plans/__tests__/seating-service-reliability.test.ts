import { afterEach, describe, expect, it } from "vitest";
import { createMemoryEntertainmentStorage, setEntertainmentStorageForTests } from "@/lib/entertainment/storage";
import { createMemoryEventPlanStorage, setEventPlanStorageForTests } from "@/lib/event-plans/storage";
import { syncEventPlanWindow } from "@/lib/event-plans/sync";
import type { TripleseatEventPlanSource } from "@/lib/event-plans/types";
import { setTripleseatAdapterForTests } from "@/lib/kitchen/tripleseat";
import { generateFloorPlan, getFloorPlanDay, refreshFloorPlanSources, saveFloorPlanEdits } from "../service";
import { MemoryFloorPlanStorage, SupabaseFloorPlanStorage } from "../storage";
import type { FloorPlanDocument } from "../types";

const DATE = "2026-10-26";
function source(id = "90000001", overrides: Partial<TripleseatEventPlanSource> = {}): TripleseatEventPlanSource {
  return { eventId: id, bookingId: `${id}-booking`, eventName: `Redacted seating event ${id}`, localDate: DATE,
    eventStartAt: `${DATE}T17:00:00-04:00`, eventEndAt: `${DATE}T19:00:00-04:00`, guestCount: 30,
    status: "DEFINITE", rooms: ["Main Dining"], selections: [], documentItems: [], operationalNotes: [],
    sourceUpdatedAt: `${DATE}T12:00:00Z`, ...overrides };
}
function setup(initial = [source()]) {
  let sources = initial;
  setEventPlanStorageForTests(createMemoryEventPlanStorage());
  setEntertainmentStorageForTests(createMemoryEntertainmentStorage());
  setTripleseatAdapterForTests({ sourceMode: "live", fetchEventsForDate: async () => [],
    fetchEventPlansForRange: async () => sources, fetchEntertainmentEventsForDate: async () => [],
    fetchEventDateById: async () => DATE,
    getDiagnostics: () => ({ sourceMode: "live", missingEnvironmentVariables: [], warnings: [], locationId: "26059" }),
  });
  return { storage: new MemoryFloorPlanStorage(), update: (next: TripleseatEventPlanSource[]) => { sources = next; } };
}
afterEach(() => { setEventPlanStorageForTests(null); setEntertainmentStorageForTests(null); setTripleseatAdapterForTests(null); });

describe("server-baseline seating save and source updates", () => {
  it("A/B: unchanged and color-only saves preserve all generated source, placement and timing evidence", async () => {
    const { storage } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const before = structuredClone(initial.plan.reservations);
    const unchanged = await saveFloorPlanEdits(DATE, initial.plan, storage);
    expect(unchanged.plan.reservations).toEqual(before);
    const changed = { ...unchanged.plan, events: unchanged.plan.events.map((event) => ({ ...event, color: "#445566" })) };
    const colored = await saveFloorPlanEdits(DATE, changed, storage);
    expect(colored.plan.reservations).toEqual(before);
    expect(colored.plan.reservations.every((row) => row.source === "generated" && !row.lockedByUser)).toBe(true);
    expect((await storage.revisions(initial.plan.id))[0].description).toContain("color");
  });

  it("records only the edited label/lock fields without making other rows manual", async () => {
    const { storage } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const target = initial.plan.reservations.find((row) => row.reservationType === "seating")!;
    const requested = { ...initial.plan, reservations: initial.plan.reservations.map((row) => row.id === target.id
      ? { ...row, label: "Staff selected label", lockedByUser: true, source: "manual" as const } : row) };
    const saved = await saveFloorPlanEdits(DATE, requested, storage);
    const edited = saved.plan.reservations.find((row) => row.id === target.id)!;
    expect(edited.source).toBe("generated");
    expect(edited.timingSource).toBe("event-default");
    expect(edited.changeDetails?.fields).toEqual(["label", "lockedByUser"]);
    expect(saved.plan.reservations.filter((row) => row.id !== target.id)).toEqual(initial.plan.reservations.filter((row) => row.id !== target.id));
  });

  it("C/M: selected locked tables follow a 5–7 to 6–8 event change and remain stable on repeated refresh", async () => {
    const { storage, update } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const target = initial.plan.reservations.find((row) => row.reservationType === "seating")!;
    const requested = { ...initial.plan, reservations: initial.plan.reservations.map((row) => row.id === target.id
      ? { ...row, areaId: "main-rect-center-1", lockedByUser: true } : row) };
    await saveFloorPlanEdits(DATE, requested, storage);
    update([source(undefined, { eventStartAt: `${DATE}T18:00:00-04:00`, eventEndAt: `${DATE}T20:00:00-04:00` })]);
    const first = await refreshFloorPlanSources(DATE, storage);
    const selected = first.plan.reservations.find((row) => row.id === target.id)!;
    expect(selected).toMatchObject({ areaId: "main-rect-center-1", source: "manual", lockedByUser: true,
      placementOverride: true, timingSource: "event-default", startAt: `${DATE}T18:00:00-04:00`, endAt: `${DATE}T20:00:00-04:00` });
    expect(first.sourceChanges).toContainEqual(expect.objectContaining({ field: "eventTime" }));
    const second = await refreshFloorPlanSources(DATE, storage);
    expect(second.plan.reservations).toEqual(first.plan.reservations);
  });

  it("D/E: explicit seating times remain fixed and uncovered event time blocks validation", async () => {
    const { storage, update } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const target = initial.plan.reservations.find((row) => row.reservationType === "seating")!;
    await saveFloorPlanEdits(DATE, { ...initial.plan, reservations: initial.plan.reservations.map((row) => row.id === target.id
      ? { ...row, timingSource: "staff-override" as const } : row) }, storage);
    update([source(undefined, { eventEndAt: `${DATE}T20:00:00-04:00` })]);
    const refreshed = await refreshFloorPlanSources(DATE, storage);
    expect(refreshed.plan.reservations.find((row) => row.id === target.id)).toMatchObject({ timingSource: "staff-override", endAt: `${DATE}T19:00:00-04:00` });
    expect(refreshed.validation).toContainEqual(expect.objectContaining({ code: "SEATING_CAPACITY", status: "Failed", blocking: true, message: expect.stringContaining("8:00 PM") }));
  });

  it("pins the currently displayed refreshed interval, not an older saved clock, when staff switch to a time override", async () => {
    const { storage, update } = setup();
    await generateFloorPlan(DATE, "fill-missing", storage);
    update([source(undefined, { eventStartAt: `${DATE}T18:00:00-04:00`, eventEndAt: `${DATE}T20:00:00-04:00` })]);
    await syncEventPlanWindow({ startDate: DATE, endDate: DATE }, { legacyPlans: [] });
    const current = await getFloorPlanDay(DATE, storage);
    const target = current.plan.reservations.find((row) => row.reservationType === "seating")!;
    const saved = await saveFloorPlanEdits(DATE, { ...current.plan, reservations: current.plan.reservations.map((row) => row.id === target.id
      ? { ...row, timingSource: "staff-override" as const } : row) }, storage);
    expect(saved.plan.reservations.find((row) => row.id === target.id)).toMatchObject({ timingSource: "staff-override", startAt: `${DATE}T18:00:00-04:00`, endAt: `${DATE}T20:00:00-04:00` });
  });

  it("F/H: fills increased demand for one event without refreshing another party's assignments", async () => {
    const { storage, update } = setup([source(), source("90000002", { rooms: ["VIP 2"], guestCount: 16 })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const target = initial.plan.events.find((event) => event.tripleseatEventId === "90000001")!;
    const other = initial.plan.events.find((event) => event.tripleseatEventId === "90000002")!;
    const originalOther = initial.plan.reservations.filter((row) => row.floorPlanEventId === other.id);
    update([source(undefined, { guestCount: 38 }), source("90000002", { rooms: ["VIP 2"], guestCount: 16, eventStartAt: `${DATE}T18:00:00-04:00`, eventEndAt: `${DATE}T20:00:00-04:00` })]);
    await syncEventPlanWindow({ startDate: DATE, endDate: DATE }, { legacyPlans: [] });
    const repaired = await generateFloorPlan(DATE, "fill-missing", storage, initial.plan.version, target.id);
    expect(repaired.plan.reservations.filter((row) => row.floorPlanEventId === other.id)).toEqual(originalOther);
    expect((await storage.get(DATE))?.events.find((event) => event.id === other.id)).toEqual(other);
    expect(repaired.plan.events.find((event) => event.id === target.id)?.guestCount).toBe(38);
    expect(repaired.validation).toContainEqual(expect.objectContaining({ eventId: target.id, code: "SEATING_CAPACITY", status: "Passed" }));
    expect(initial.plan.reservations.filter((row) => row.floorPlanEventId === target.id).every((row) => repaired.plan.reservations.some((next) => next.id === row.id))).toBe(true);
  });

  it("does not save a failed selected-event replacement or lose the existing reservation", async () => {
    const { storage, update } = setup([source(undefined, { rooms: ["GEG Tables"], guestCount: 10 })]);
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    update([source(undefined, { rooms: ["GEG Tables"], guestCount: 80 })]);
    await syncEventPlanWindow({ startDate: DATE, endDate: DATE }, { legacyPlans: [] });
    await expect(generateFloorPlan(DATE, "replace-generated", storage, initial.plan.version, initial.plan.events[0].id)).rejects.toThrow("retained");
    expect(await storage.get(DATE)).toEqual(initial.plan);
  });

  it("K: a second tablet keeps its rejected draft when the first tablet saves", async () => {
    const { storage } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", storage);
    const draft = structuredClone(initial.plan);
    draft.reservations[0].label = "Retained unsaved tablet label";
    const unchangedDraft = structuredClone(draft);
    await saveFloorPlanEdits(DATE, initial.plan, storage);
    await expect(saveFloorPlanEdits(DATE, draft, storage)).rejects.toMatchObject({ status: 409 });
    expect(draft).toEqual(unchangedDraft);
    expect((await storage.get(DATE))?.reservations[0].label).not.toBe("Retained unsaved tablet label");
  });
});

describe("existing checked RPC metadata round-trip", () => {
  it("A/B: a legacy SQL-shaped null-geometry row stays generated after a color-only server save", async () => {
    const { storage: memory } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", memory);
    let document = { ...structuredClone(initial.plan), reservations: initial.plan.reservations.map(({ timingSource: _time, placementOverride: _placement, changeDetails: _details, ...row }) => ({ ...row, customGeometry: null })) };
    const storage = new SupabaseFloorPlanStorage({ env: { NODE_ENV: "test", SUPABASE_SECRET_KEY: "sb_secret_test" }, fetchImpl: async (url, options) => {
      if (String(url).endsWith("save_event_host_floor_plan_checked")) {
        document = JSON.parse(String(options?.body)).p_document;
        document.version += 1;
      }
      return Response.json(document);
    } });
    const current = await getFloorPlanDay(DATE, storage);
    const before = structuredClone(current.plan.reservations);
    const saved = await saveFloorPlanEdits(DATE, { ...current.plan, events: current.plan.events.map((event) => ({ ...event, color: "#445566" })) }, storage);
    expect(saved.plan.reservations).toEqual(before);
    expect(saved.plan.reservations.every((row) => row.source === "generated" && !row.placementOverride && !row.changeDetails)).toBe(true);
  });

  it("persists independent timing/placement/audit state through event.source JSONB despite the old fixed row projection", async () => {
    const { storage: memory } = setup();
    const initial = await generateFloorPlan(DATE, "fill-missing", memory);
    let databaseDocument: FloorPlanDocument = structuredClone(initial.plan);
    const paths: string[] = [];
    const storage = new SupabaseFloorPlanStorage({ env: { NODE_ENV: "test", SUPABASE_SECRET_KEY: "sb_secret_test" }, fetchImpl: async (url, options) => {
      paths.push(String(url));
      if (String(url).endsWith("save_event_host_floor_plan_checked")) {
        const body = JSON.parse(String(options?.body));
        databaseDocument = structuredClone(body.p_document);
        databaseDocument.reservations = databaseDocument.reservations.map(({ timingSource: _time, placementOverride: _placement, changeDetails: _details, ...row }) => ({ ...row, customGeometry: row.customGeometry ?? null })) as FloorPlanDocument["reservations"];
      }
      return Response.json(databaseDocument);
    } });
    const requested = structuredClone(initial.plan);
    requested.reservations[0] = { ...requested.reservations[0], timingSource: "staff-override", placementOverride: true, changeDetails: { fields: ["timingSource"], reason: "Staff explicitly kept this interval fixed." } };
    expect((await storage.save(requested, "Timing evidence")).reservations).toEqual(requested.reservations);
    const reopened = await storage.get(DATE);
    expect(reopened?.reservations).toEqual(requested.reservations);
    expect(reopened?.events[0].source).toEqual(requested.events[0].source);
    expect(paths[0]).toMatch(/save_event_host_floor_plan_checked$/);
    expect(paths).toHaveLength(2);
  });
});
