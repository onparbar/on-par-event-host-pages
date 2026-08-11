export const ENTERTAINMENT_TIME_ZONE = "America/New_York" as const;

export type EntertainmentCategory =
  | "bowling"
  | "darts"
  | "pool"
  | "shuffleboard"
  | "mini-golf"
  | "private-rooms";

export type EntertainmentResource = {
  id: string;
  canonicalName: string;
  category: EntertainmentCategory;
  displayOrder: number;
  active: boolean;
};

export type EntertainmentReviewCode =
  | "AMBIGUOUS_RESOURCE"
  | "AUTO_ASSIGNED"
  | "DUPLICATE_ENTERTAINMENT"
  | "FLOOR_PLAN_COLOR_MISSING"
  | "INSUFFICIENT_RESOURCES"
  | "OUTSIDE_OPERATING_DAY"
  | "SOURCE_DETAILS_UNAVAILABLE"
  | "SOURCE_HAS_NEWER_INFORMATION"
  | "TIME_NEEDS_REVIEW"
  | "UNMATCHED_EVENT"
  | "UNVERIFIED_ASSIGNMENT";

export type EntertainmentReviewIssue = {
  code: EntertainmentReviewCode;
  message: string;
};

export type EntertainmentSourceItem = {
  sourceId: string;
  name: string;
  description: string | null;
  categoryName: string | null;
  quantity: number | null;
  startAt: string | null;
  endAt: string | null;
};

export type EntertainmentSourceRoom = {
  id: string | null;
  name: string;
};

export type EntertainmentSourceEvent = {
  tripleseatEventId: string;
  tripleseatBookingId: string | null;
  eventName: string;
  localDate: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  status: string | null;
  rooms: EntertainmentSourceRoom[];
  items: EntertainmentSourceItem[];
  categoryNames: string[];
  sourceUpdatedAt: string | null;
  noteCount: number;
  sourceSystem?: "tripleseat" | "vip-prep";
};

export type EntertainmentColorSource =
  | "floor-plan-assignment"
  | "event-plan"
  | "deterministic-fallback"
  | "manual";

export type EntertainmentEventSnapshot = {
  eventId: string;
  localEventId: string | null;
  tripleseatEventId: string;
  tripleseatBookingId: string | null;
  eventName: string;
  operatingDate: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  eventColor: string;
  colorSource: EntertainmentColorSource;
  floorPlanAssetKey: string | null;
  sourceUpdatedAt: string | null;
  needsReview: boolean;
  reviewIssues: EntertainmentReviewIssue[];
  sourceSnapshot: EntertainmentSourceEvent;
  active: boolean;
  syncedAt: string;
};

export type EntertainmentReservationSource =
  | "tripleseat"
  | "vip-prep"
  | "event-host-fallback"
  | "manual";

export type EntertainmentReservation = {
  id: string;
  syncKey: string | null;
  localEventId: string | null;
  tripleseatEventId: string | null;
  tripleseatBookingId: string | null;
  eventName: string;
  operatingDate: string;
  resourceId: string;
  resourceCategory: EntertainmentCategory;
  resourceName: string;
  startAt: string;
  endAt: string;
  sourceStartAt: string | null;
  sourceEndAt: string | null;
  sourceResourceId: string | null;
  eventColor: string;
  colorSource: EntertainmentColorSource;
  source: EntertainmentReservationSource;
  sourceReference: string | null;
  manualOverride: boolean;
  hasSourceUpdate: boolean;
  needsReview: boolean;
  reviewIssues: EntertainmentReviewIssue[];
  autoAssigned: boolean;
  notes: string;
  sourceUpdatedAt: string | null;
  lastTripleseatSyncAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type EntertainmentConflict = {
  id: string;
  resourceId: string;
  resourceName: string;
  startAt: string;
  endAt: string;
  reservationIds: [string, string];
  eventNames: [string, string];
};

export type EntertainmentAuditEntry = {
  id: string;
  reservationId: string;
  action:
    | "sync-create"
    | "sync-update"
    | "sync-deactivate"
    | "manual-create"
    | "manual-update"
    | "manual-remove"
    | "revert-to-tripleseat";
  previousValue: Partial<EntertainmentReservation> | null;
  newValue: Partial<EntertainmentReservation> | null;
  changedBy: string;
  changeSource: "tripleseat-sync" | "manual";
  reason: string | null;
  intentionalConflict: boolean;
  createdAt: string;
};

export type EntertainmentSyncStatus =
  | "running"
  | "success"
  | "partial"
  | "error";

export type EntertainmentSyncState = {
  operatingDate: string;
  status: EntertainmentSyncStatus;
  eventsProcessed: number;
  reservationsCreated: number;
  reservationsUpdated: number;
  warningsCreated: number;
  conflictsFound: number;
  errorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
  lastSuccessfulSyncAt: string | null;
};

export type EntertainmentDayPayload = {
  date: string;
  events: EntertainmentEventSnapshot[];
  reservations: EntertainmentReservation[];
  conflicts: EntertainmentConflict[];
  sync: EntertainmentSyncState | null;
  sourceMode: "live" | "mock";
  warnings: string[];
  missingEnvironmentVariables: string[];
  canEdit: boolean;
};

export type EntertainmentSyncResult = {
  events: EntertainmentEventSnapshot[];
  reservations: EntertainmentReservation[];
  conflicts: EntertainmentConflict[];
  stats: {
    eventsProcessed: number;
    reservationsCreated: number;
    reservationsUpdated: number;
    warningsCreated: number;
    conflictsFound: number;
  };
};
