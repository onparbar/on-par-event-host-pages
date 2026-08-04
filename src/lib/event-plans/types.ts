import type { EntertainmentSourceItem } from "@/lib/entertainment/types";
import type { KitchenSourceSelection } from "@/lib/kitchen/types";

export const EVENT_PLAN_TIME_ZONE = "America/New_York" as const;
export const EVENT_PLAN_RULE_VERSION = "event-plan-v1.0.1" as const;

export type EventPlanOperationalNote = {
  source: "event-note";
  sourceId: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  text: string;
};

export type EventPlanEntertainmentItem = {
  name: string;
  quantity: string;
  time: string;
  duration: string;
};

export type EventPlan = {
  id: number;
  name: string;
  date: string;
  day: string;
  time: string;
  guest_count: number;
  rooms: string[];
  color: string;
  food: string[];
  drink_options: string[];
  entertainment: EventPlanEntertainmentItem[];
  special_instructions?: string[];
  operational_notes?: EventPlanOperationalNote[];
  verification_status: string;
  needs_review?: boolean;
  review_reasons?: string[];
  tripleseat_booking_id?: string | null;
  source_updated_at?: string | null;
  synced_at?: string | null;
  rule_version?: string;
};

export type ItineraryAsset = EventPlan & {
  pdf?: string;
};

export type TripleseatEventPlanSource = {
  eventId: string;
  bookingId: string | null;
  eventName: string;
  localDate: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  guestCount: number | null;
  status: string | null;
  rooms: string[];
  selections: KitchenSourceSelection[];
  documentItems: EntertainmentSourceItem[];
  operationalNotes: EventPlanOperationalNote[];
  operationalNotesAvailable?: boolean;
  operationalNotesTruncated?: boolean;
  omittedOperationalNoteFragmentCount?: number;
  shortenedOperationalNoteFragmentCount?: number;
  sourceUpdatedAt: string | null;
};

export type EventPlanSyncState = {
  windowStart: string;
  windowEnd: string;
  status: "running" | "success" | "error";
  eventCount: number;
  startedAt: string;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  errorMessage: string | null;
};

export type StoredEventPlanWindow = {
  plans: EventPlan[];
  sync: EventPlanSyncState | null;
};
