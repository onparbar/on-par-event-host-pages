import type { EventPlan, EventPlanEntertainmentItem, ItineraryAsset } from "@/lib/event-plans/types";
import { itineraryDrinkLines } from "./presentation";
import { normalizeEntertainmentDurationHours } from "@/lib/entertainment/duration";

export type ItineraryEditFields = Partial<Pick<EventPlan, "name" | "time" | "guest_count" | "rooms" | "food" | "entertainment" | "special_instructions">> & { drinkLines?: string[] };
export type ItineraryEdit = { updatedAt: string; sourceUpdatedAt: string | null; fields: ItineraryEditFields };

const editableKeys = ["name", "time", "guest_count", "rooms", "food", "entertainment", "special_instructions", "drinkLines"] as const;
const isMiniGolf = (name: string) => /mini\s*golf/i.test(name);

function text(value: unknown, maximum = 500) {
  if (typeof value !== "string" || value.length > maximum) throw new Error("Itinerary text is invalid or too long.");
  return value.trim();
}

function lines(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Itinerary lists may contain up to 100 lines.");
  return value.map((item) => text(item, 1000)).filter(Boolean);
}

function entertainment(value: unknown): EventPlanEntertainmentItem[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Itinerary entertainment may contain up to 50 items.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid itinerary entertainment item.");
    const row = item as Record<string, unknown>;
    const name = text(row.name, 120);
    if (!name) throw new Error("Entertainment items need a name.");
    return { name, quantity: text(row.quantity, 120), time: isMiniGolf(name) ? "" : text(row.time, 120), duration: isMiniGolf(name) ? "" : normalizeEntertainmentDurationHours(text(row.duration, 120)) };
  });
}

export function normalizeItineraryEdits(value: unknown): Record<string, ItineraryEdit> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 1000) throw new Error("Invalid itinerary edits.");
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => {
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)) || !raw || typeof raw !== "object") throw new Error("Invalid itinerary event.");
    const edit = raw as ItineraryEdit;
    if (typeof edit.updatedAt !== "string" || !Number.isFinite(Date.parse(edit.updatedAt)) || (edit.sourceUpdatedAt !== null && (typeof edit.sourceUpdatedAt !== "string" || !Number.isFinite(Date.parse(edit.sourceUpdatedAt))))) throw new Error("Invalid itinerary edit revision.");
    if (!edit.fields || typeof edit.fields !== "object" || Array.isArray(edit.fields)) throw new Error("Invalid itinerary fields.");
    const fields: ItineraryEditFields = {};
    for (const field of editableKeys) {
      if (edit.fields[field] === undefined) continue;
      if (field === "name" || field === "time") {
        const value = text(edit.fields[field], 180);
        if (!value) throw new Error("Event name and time cannot be blank.");
        fields[field] = value;
      } else if (field === "guest_count") {
        const count = edit.fields[field];
        if (!Number.isSafeInteger(count) || count! < 0 || count! > 10000) throw new Error("Guest count must be a whole number from 0 to 10,000.");
        fields.guest_count = count;
      } else if (field === "entertainment") fields.entertainment = entertainment(edit.fields.entertainment);
      else fields[field] = lines(edit.fields[field]);
    }
    return [key, { updatedAt: edit.updatedAt, sourceUpdatedAt: edit.sourceUpdatedAt, fields }];
  }));
}

export function applyItineraryEdit<T extends EventPlan>(plan: T, edit?: ItineraryEdit): T & Pick<ItineraryAsset, "itinerary_edit"> {
  if (!edit) return plan;
  const { drinkLines: _drinkLines, ...fields } = edit.fields;
  const result = { ...plan, ...fields, itinerary_edit: edit };
  if (fields.entertainment) {
    // Mini Golf is contract-counted, never scheduled or invented in an itinerary edit.
    result.entertainment = [
      ...fields.entertainment.filter((item) => !isMiniGolf(item.name)).map((item) => ({ ...item, duration: normalizeEntertainmentDurationHours(item.duration) })),
      ...plan.entertainment.filter((item) => isMiniGolf(item.name)).map((item) => ({ ...item, time: "", duration: "" })),
    ];
  }
  return result;
}

export function buildItineraryEdit(base: ItineraryAsset, fields: Required<ItineraryEditFields>, now: string): ItineraryEdit | null {
  const normalized = normalizeItineraryEdits({ [base.id]: { fields, sourceUpdatedAt: base.source_updated_at ?? null, updatedAt: now } })[String(base.id)].fields;
  const golfCounts = (items: readonly EventPlanEntertainmentItem[]) => items.filter((item) => isMiniGolf(item.name)).map(({ name, quantity }) => ({ name, quantity }));
  if (JSON.stringify(golfCounts(base.entertainment)) !== JSON.stringify(golfCounts(normalized.entertainment ?? []))) throw new Error("Mini Golf must keep its contract quantity. Change the source booking rather than the itinerary.");
  const changes: ItineraryEditFields = {};
  for (const key of editableKeys) {
    const source = key === "drinkLines" ? itineraryDrinkLines({ ...base, ...normalized, itinerary_edit: undefined }) : base[key];
    const comparableSource = key === "entertainment" ? entertainment(base.entertainment) : source;
    if (JSON.stringify(comparableSource ?? []) !== JSON.stringify(normalized[key])) Object.assign(changes, { [key]: normalized[key] });
  }
  if (!Object.keys(changes).length) return null;
  return normalizeItineraryEdits({ [base.id]: { fields: changes, sourceUpdatedAt: base.source_updated_at ?? null, updatedAt: now } })[String(base.id)];
}
