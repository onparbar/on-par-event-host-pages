export type VipPrepFoodItem = {
  code: string;
  label: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  sourceId?: string;
};

export type VipPrepMappingIssue = { code: string; label: string; quantity: number; message: string };

export type VipPrepReservation = {
  id: string;
  confirmationCode: string;
  operatingDate: string;
  resource: { code: "VIPS" | "VIPL"; name: string };
  eventName: string;
  guestName: string;
  partySize: number;
  startAt: string;
  endAt: string;
  status: "confirmed" | "checked_in" | "cancelled" | "canceled";
  foodPrep: VipPrepFoodItem[];
  extras: unknown[];
  updatedAt: string;
  lastRefreshedAt?: string;
  /** Cache membership evidence from a successful feed; not an arrival flag. */
  activeInSource?: boolean;
  linkedTripleseatEventIds?: string[];
  mappingIssues?: VipPrepMappingIssue[];
  preorderChange?: {
    sourceUpdatedAt: string;
    previous: Array<Pick<VipPrepFoodItem, "code" | "label" | "quantity">>;
    current: Array<Pick<VipPrepFoodItem, "code" | "label" | "quantity">>;
    message: string;
  };
};

export type VipPrepPayload = {
  from: string;
  to: string;
  timeZone: "America/New_York";
  generatedAt: string;
  reservationCount: number;
  reservations: VipPrepReservation[];
};

export type VipPrepExtra = { code: string | null; label: string; quantity: number | null };
