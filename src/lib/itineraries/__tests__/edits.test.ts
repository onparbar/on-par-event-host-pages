import { describe, expect, it } from "vitest";
import type { ItineraryAsset } from "@/lib/event-plans/types";
import { applyItineraryEdit, buildItineraryEdit, normalizeItineraryEdits } from "../edits";
import { itineraryDrinkLines, itineraryEntertainmentGroups } from "../presentation";

const plan: ItineraryAsset = { id: 123, name: "Training event", date: "2026-10-21", day: "Wednesday", time: "6:00 PM - 8:00 PM", guest_count: 20, rooms: ["VIP 1"], color: "#297025", food: ["Chicken Tender Platter: 1"], drink_options: [], entertainment: [{ name: "Mini Golf", quantity: "20", time: "", duration: "" }], verification_status: "Needs review", source_updated_at: "2026-10-21T13:00:00Z" };
const now = "2026-10-21T15:00:00Z";
const edit = { updatedAt: now, sourceUpdatedAt: plan.source_updated_at!, fields: { food: ["Chicken Tender Platter: 1", "Dessert Platter: 1"] } };
const fullFields = () => ({ name: plan.name, time: plan.time, guest_count: plan.guest_count, rooms: plan.rooms, food: plan.food, drinkLines: itineraryDrinkLines(plan), entertainment: plan.entertainment, special_instructions: [] });

describe("Admin itinerary display edits", () => {
  it("keeps the source record unchanged and applies only the edited fields", () => {
    const original = structuredClone(plan);
    const current = applyItineraryEdit(plan, edit);
    expect(current.food).toContain("Dessert Platter: 1");
    expect(current.id).toBe(plan.id);
    expect(current.date).toBe(plan.date);
    expect(current.source_updated_at).toBe(plan.source_updated_at);
    expect(plan).toEqual(original);
  });

  it("keeps future source updates for fields that were not overridden", () => {
    const updated = applyItineraryEdit({ ...plan, guest_count: 30, rooms: ["VIP 2"] }, edit);
    expect(updated.guest_count).toBe(30);
    expect(updated.rooms).toEqual(["VIP 2"]);
    expect(updated.food).toEqual(edit.fields.food);
  });

  it("stores only differences and removes the edit when restored to the source", () => {
    expect(buildItineraryEdit(plan, fullFields(), now)).toBeNull();
    expect(buildItineraryEdit(plan, { ...fullFields(), food: edit.fields.food }, now)).toEqual(edit);
    expect(applyItineraryEdit(plan).itinerary_edit).toBeUndefined();
  });

  it("displays saved drink lines exactly without injecting source defaults", () => {
    const current = applyItineraryEdit(plan, { ...edit, fields: { drinkLines: ["Water station", "Drink cards: 20"] } });
    expect(itineraryDrinkLines(current)).toEqual(["Water station", "Drink cards: 20"]);
    expect(itineraryDrinkLines(applyItineraryEdit(plan, { ...edit, fields: { drinkLines: [] } }))).toEqual([]);
  });

  it("does not pin automatically derived drink cards when the displayed guest count changes", () => {
    const fullCourse = { ...plan, food: ["The Full Course"], entertainment: [] };
    const fields = { ...fullFields(), food: fullCourse.food, entertainment: [], guest_count: 30, drinkLines: ["Free soda and juice for all guests", "$20 prepaid drink cards for 30 guests"] };
    const edit = buildItineraryEdit(fullCourse, fields, now)!;
    expect(edit.fields).toEqual({ guest_count: 30 });
    expect(itineraryDrinkLines(applyItineraryEdit(fullCourse, edit))).toContain("$20 prepaid drink cards for 30 guests");
    const manual = buildItineraryEdit(fullCourse, { ...fields, drinkLines: ["Water station only"] }, now)!;
    expect(manual.fields.drinkLines).toEqual(["Water station only"]);
  });

  it("retains only the contract Mini Golf count and never adds a time", () => {
    const current = applyItineraryEdit(plan, { ...edit, fields: { entertainment: [{ name: "Mini Golf", quantity: "999", time: "4 PM", duration: "2 hours" }, { name: "Bowling", quantity: "2 lanes", time: "6:00 PM - 7:00 PM", duration: "1 hour" }] } });
    expect(itineraryEntertainmentGroups(current)).toContainEqual({ title: "Mini Golf", detail: "20" });
    expect(current.entertainment.find((item) => item.name === "Mini Golf")).toEqual({ name: "Mini Golf", quantity: "20", time: "", duration: "" });
    expect(applyItineraryEdit({ ...plan, entertainment: [] }, { ...edit, fields: { entertainment: [{ name: "Mini Golf", quantity: "999", time: "", duration: "" }] } }).entertainment).toEqual([]);
    expect(() => buildItineraryEdit(plan, { ...fullFields(), entertainment: [] }, now)).toThrow("contract quantity");
  });

  it("does not accept identity fields from an Admin edit", () => {
    const value = normalizeItineraryEdits({ 123: { ...edit, fields: { ...edit.fields, id: 999, date: "2099-01-01", source_updated_at: "fake" } } });
    expect(value["123"].fields).toEqual(edit.fields);
  });

  it.each([
    { "-1": edit }, { "not-an-event": edit },
    { 123: { ...edit, fields: { guest_count: 1.5 } } },
    { 123: { ...edit, fields: { food: ["a".repeat(1001)] } } },
    { 123: { ...edit, updatedAt: "not-a-time" } },
    { 123: { ...edit, fields: { entertainment: [{ name: "", quantity: "1", time: "", duration: "" }] } } },
  ])("rejects malformed or unbounded display data", (value) => {
    expect(() => normalizeItineraryEdits(value)).toThrow();
  });
});
