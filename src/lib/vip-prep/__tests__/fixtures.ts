import type { VipPrepPayload } from "../client";

export const vipPrepPayload: VipPrepPayload = {
  from: "2026-08-15",
  to: "2026-08-15",
  timeZone: "America/New_York",
  generatedAt: "2026-08-11T18:00:00.000Z",
  reservationCount: 1,
  reservations: [
    {
      id: "reservation-uuid",
      confirmationCode: "VIPL-1234567",
      operatingDate: "2026-08-15",
      resource: { code: "VIPL", name: "VIP 2" },
      eventName: "Redacted VIP",
      guestName: "Redacted Guest",
      partySize: 16,
      startAt: "2026-08-15T22:00:00.000Z",
      endAt: "2026-08-16T00:00:00.000Z",
      status: "confirmed",
      foodPrep: [
        {
          code: "wings",
          label: "Wings",
          quantity: 2,
          unitPriceCents: 12000,
          totalCents: 24000,
        },
      ],
      extras: [],
      updatedAt: "2026-08-11T17:55:00.000Z",
    },
  ],
};
