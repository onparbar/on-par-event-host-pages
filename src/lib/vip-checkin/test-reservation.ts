import type { VipPrepReservation } from "@/lib/vip-prep/client";

const TEST_DATE = "2026-09-23";
const TEST_EXPIRES_AT = Date.parse("2026-09-24T04:00:00Z");

export function vipKdsTestReservation(date: string, now = Date.now()): VipPrepReservation | null {
  if (date !== TEST_DATE || now >= TEST_EXPIRES_AT) return null;
  return {
    id: "event-host-kds-test-20260923",
    confirmationCode: "TEST-NO-PAYMENT",
    operatingDate: TEST_DATE,
    resource: { code: "VIPS", name: "VIP 1 (test only)" },
    eventName: "VIP KDS TEST — DO NOT PREPARE",
    guestName: "VIP KDS TEST",
    partySize: 2,
    startAt: "2026-09-23T13:45:00-04:00",
    endAt: "2026-09-23T15:45:00-04:00",
    status: "confirmed",
    foodPrep: [
      { code: "chicken-tenders", label: "Chicken Tender Platter", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { code: "dessert-platter", label: "Dessert Platter", quantity: 1, unitPriceCents: 0, totalCents: 0 },
    ],
    extras: [],
    updatedAt: "2026-09-23T17:45:00Z",
  };
}
