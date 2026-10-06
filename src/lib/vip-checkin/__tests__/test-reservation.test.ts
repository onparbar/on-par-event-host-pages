import { describe, expect, it } from "vitest";
import { vipKdsTestReservation } from "../test-reservation";

describe("temporary VIP KDS test reservation", () => {
  const testTime = Date.parse("2026-09-23T18:00:00Z");

  it("contains only one chicken tender and one dessert platter at 1:45 PM", () => {
    const reservation = vipKdsTestReservation("2026-09-23", testTime);
    expect(reservation).toMatchObject({
      id: "event-host-kds-retest-20260923",
      status: "confirmed",
      startAt: "2026-09-23T13:45:00-04:00",
      foodPrep: [
        { code: "chicken-tenders", quantity: 1 },
        { code: "dessert-platter", quantity: 1 },
      ],
    });
    expect(reservation?.foodPrep.every((item) => item.totalCents === 0)).toBe(true);
  });

  it("is limited to the test date and expires after that operating day", () => {
    expect(vipKdsTestReservation("2026-09-24", testTime)).toBeNull();
    expect(vipKdsTestReservation("2026-09-23", Date.parse("2026-09-24T04:00:00Z"))).toBeNull();
  });
});
