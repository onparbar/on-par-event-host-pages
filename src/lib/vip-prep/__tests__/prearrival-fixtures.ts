import type { VipPrepPayload } from "../types";

/** Sanitized contract shape verified read-only against the authorized source. */
export function novemberVipPayload(): VipPrepPayload {
  return {
    from: "2026-11-14", to: "2026-11-14", timeZone: "America/New_York", generatedAt: "2026-10-26T18:00:00.000Z", reservationCount: 1,
    reservations: [{ id: "redacted-november-vip", confirmationCode: "VIPL-REDACTED", operatingDate: "2026-11-14",
      resource: { code: "VIPL", name: "VIP 2" }, eventName: "Redacted November VIP", guestName: "Redacted guest", partySize: 16,
      startAt: "2026-11-14T22:00:00+00:00", endAt: "2026-11-15T00:00:00+00:00", status: "confirmed",
      foodPrep: [
        { code: "chicken-tenders", label: "Chicken Tenders", quantity: 2, unitPriceCents: 12000, totalCents: 24000 },
        { code: "fry-platters", label: "Fry Platters", quantity: 1, unitPriceCents: 7500, totalCents: 7500 },
        { code: "mozzarella-sticks", label: "Mozzarella Sticks", quantity: 1, unitPriceCents: 12000, totalCents: 12000 },
      ], extras: [{ code: "mini-golf", label: "Mini Golf", quantity: 16, unitPriceCents: 900, totalCents: 14400 }], updatedAt: "2026-10-26T17:00:00.000Z" }],
  };
}
