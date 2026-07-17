import sourceData from "../../outputs/tripleseat/june-25-to-july-25-2026-definite-closed-events.json";
import juneTwoSourceData from "../../outputs/tripleseat/june-02-2026-definite-closed-events.json";
import { events, formatEventDate, type EventPlan } from "@/lib/events";

type TripleseatContact = {
  first_name?: string;
  last_name?: string;
};

type TripleseatEvent = {
  id: number;
  contact?: TripleseatContact;
  booking?: {
    contact?: TripleseatContact;
  };
};

const hostedEventPocById: Record<number, string> = {
  58984337: "Rose Lefeld",
};

export type ChecklistEvent = EventPlan & {
  dateLabel: string;
  poc: string;
};

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function contactName(contact?: TripleseatContact) {
  const fullName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  return fullName ? toTitleCase(fullName) : "";
}

const sourceById = new Map<number, TripleseatEvent>(
  [
    ...((sourceData as { events: TripleseatEvent[] }).events || []),
    ...((juneTwoSourceData as { events: TripleseatEvent[] }).events || []),
  ].map((event) => [event.id, event]),
);

export const checklistEvents: ChecklistEvent[] = events.map((event) => {
  const sourceEvent = sourceById.get(event.id);
  const poc =
    contactName(sourceEvent?.booking?.contact) ||
    contactName(sourceEvent?.contact) ||
    hostedEventPocById[event.id] ||
    "No Tripleseat contact listed";

  return {
    ...event,
    dateLabel: formatEventDate(event.date),
    poc,
  };
});
