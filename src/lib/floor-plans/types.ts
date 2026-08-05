import type {
  EntertainmentConflict,
  EntertainmentReservation,
} from "@/lib/entertainment/types";

export const FLOOR_PLAN_RULE_VERSION = "floor-plan-v1.3.0" as const;
export const FLOOR_PLAN_BASE_WIDTH = 1920;
export const FLOOR_PLAN_BASE_HEIGHT = 1080;

export type FloorPlanStatus =
  | "Draft"
  | "Needs Review"
  | "Conflict"
  | "Approved"
  | "Updated After Approval"
  | "Completed"
  | "Archived";

export type FloorPlanAreaType =
  | "rectangle-table"
  | "square-table"
  | "room"
  | "seating-section"
  | "bowling"
  | "darts"
  | "pool"
  | "shuffleboard"
  | "mini-golf"
  | "walkway"
  | "service-area";

export type FloorPlanArea = {
  id: string;
  name: string;
  shortLabel: string;
  type: FloorPlanAreaType;
  capacity: number;
  parentAreaId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isAda: boolean;
  canBeFoodTable: boolean;
  isReservable: boolean;
  isMovable: boolean;
  entertainmentResourceId?: string;
};

export type FloorPlanEventSource = {
  rooms: string[];
  food: string[];
  entertainment: Array<{
    name: string;
    quantity: string;
    time: string;
    duration: string;
  }>;
  operationalNotes: Array<{
    sourceId: string | null;
    sourceUpdatedAt: string | null;
    text: string;
  }>;
  reviewReasons: string[];
};

export type FloorPlanEvent = {
  id: string;
  floorPlanId: string;
  tripleseatEventId: string;
  name: string;
  status: string;
  guestCount: number;
  startAt: string | null;
  endAt: string | null;
  contractedAreaIds: string[];
  unresolvedAreaNames: string[];
  color: string;
  beoLastModifiedAt: string | null;
  fullBuyout: boolean;
  source: FloorPlanEventSource;
};

export type FloorPlanReservationType =
  | "seating"
  | "food-table"
  | "room"
  | "custom";

export type FloorPlanReservation = {
  id: string;
  floorPlanEventId: string;
  areaId: string;
  reservationType: FloorPlanReservationType;
  startAt: string | null;
  endAt: string | null;
  label: string;
  source: "generated" | "manual";
  lockedByUser: boolean;
  customGeometry?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type FloorPlanDocument = {
  id: string;
  eventDate: string;
  status: FloorPlanStatus;
  version: number;
  ruleVersion: string;
  lastTripleseatSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  events: FloorPlanEvent[];
  reservations: FloorPlanReservation[];
};

export type FloorPlanRevision = {
  id: string;
  floorPlanId: string;
  version: number;
  changedAt: string;
  changedBy: string;
  description: string;
  previousValue: FloorPlanDocument | null;
  newValue: FloorPlanDocument;
};

export type FloorPlanValidationStatus =
  | "Passed"
  | "Warning"
  | "Failed"
  | "Not Applicable";

export type FloorPlanValidationCode =
  | "DATE_MATCH"
  | "EVENT_DETAILS"
  | "CONTRACTED_AREA"
  | "SEATING_CAPACITY"
  | "SEATING_LOCATION"
  | "FOOD_TABLE"
  | "FOOD_TABLE_ADA"
  | "ENTERTAINMENT_QUANTITY"
  | "ENTERTAINMENT_TIME"
  | "ENTERTAINMENT_CONFLICT"
  | "ENTERTAINMENT_PLACEMENT"
  | "DISTINCT_COLOR"
  | "RESOURCE_CONFLICT"
  | "FULL_BUYOUT"
  | "PROTECTED_PATHS"
  | "OVERLAY_STYLE"
  | "TRIPLESEAT_SAFE"
  | "BEO_CURRENT"
  | "SAVED_IN_EVENT_HOST"
  | "SCHEDULE_SYNCHRONIZED";

export type FloorPlanValidationItem = {
  code: FloorPlanValidationCode;
  eventId: string | null;
  label: string;
  status: FloorPlanValidationStatus;
  message: string;
  blocking: boolean;
};

export type FloorPlanConflict = {
  id: string;
  areaId: string;
  eventIds: [string, string];
  eventNames: [string, string];
  startAt: string;
  endAt: string;
  blocking: true;
};

export type FloorPlanDayPayload = {
  date: string;
  plan: FloorPlanDocument;
  entertainmentReservations: EntertainmentReservation[];
  floorPlanConflicts: FloorPlanConflict[];
  entertainmentConflicts: EntertainmentConflict[];
  validation: FloorPlanValidationItem[];
  revisions: FloorPlanRevision[];
  persistence: "database" | "memory";
  sourceMode: "live" | "mock";
  warnings: string[];
};

export type FloorPlanGenerationMode =
  | "fill-missing"
  | "replace-generated"
  | "reset-event";
