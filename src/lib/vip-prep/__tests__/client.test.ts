import { describe, expect, it } from "vitest";
import {
  VipPrepApiError,
  VipPrepClient,
  numericVipEventId,
  vipPrepEventPlan,
  vipPrepExternalId,
  vipPrepEntertainmentEvents,
  vipPrepKitchenEvents,
} from "../client";
import { vipPrepPayload } from "./fixtures";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { KITCHEN_ROW_KEY_BY_VIP_CODE } from "../client";

describe("VIP Prep API client", () => {
  it("keeps the bearer token server-side and requests an exact date range", async () => {
    let authorization = "";
    let requestedUrl = "";
    const client = new VipPrepClient({
      env: { VIP_PREP_API_TOKEN: "test-token" },
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json(vipPrepPayload);
      },
    });

    const result = await client.fetchRange("2026-08-15", "2026-08-15");

    expect(requestedUrl.startsWith("https://onparbookings.com/api/vip-prep?")).toBe(true);
    expect(requestedUrl).toContain("from=2026-08-15&to=2026-08-15");
    expect(authorization).toBe("Bearer test-token");
    expect(JSON.stringify(result)).not.toContain("test-token");
  });

  it("fails closed on an invalid response", async () => {
    const client = new VipPrepClient({
      env: { VIP_PREP_API_TOKEN: "test-token" },
      fetchImpl: async () => Response.json({ reservations: [] }),
    });
    await expect(client.fetchRange("2026-08-15", "2026-08-15"))
      .rejects.toBeInstanceOf(VipPrepApiError);
  });

  it("maps food quantities and VIP 2 to stable EventHost source records", () => {
    const kitchen = vipPrepKitchenEvents(vipPrepPayload.reservations);
    const entertainment = vipPrepEntertainmentEvents(vipPrepPayload.reservations);

    expect(kitchen[0]).toMatchObject({
      eventId: "vip-reservation-uuid",
      room: "VIP 2",
      selections: [{ name: "Wing Platter", quantity: 2, isFood: true }],
    });
    expect(entertainment[0]).toMatchObject({
      tripleseatEventId: "vip-reservation-uuid",
      sourceSystem: "vip-prep",
      rooms: [{ id: "VIPL", name: "VIP 2" }],
    });
  });

  it.each(Object.entries(KITCHEN_ROW_KEY_BY_VIP_CODE))(
    "maps booked %s to a kitchen prep row",
    (code, rowKey) => {
      const reservation = {
        ...vipPrepPayload.reservations[0],
        foodPrep: [{ ...vipPrepPayload.reservations[0].foodPrep[0], code, quantity: 1 }],
      };
      const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
      expect(checklist.sections.flatMap((section) => section.rows)
        .some((row) => row.key === rowKey)).toBe(true);
    },
  );

  it("prepares the redacted September 23 VIP booking's three ordered platters", () => {
    const reservation = structuredClone(vipPrepPayload.reservations[0]);
    reservation.id = "redacted-september-vip";
    reservation.eventName = "Redacted VIP";
    reservation.operatingDate = "2026-09-23";
    reservation.startAt = "2026-09-23T22:00:00.000Z";
    reservation.endAt = "2026-09-24T00:00:00.000Z";
    reservation.foodPrep = [
      { code: "chicken-tenders", label: "Chicken Tenders", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { code: "mozzarella-sticks", label: "Mozzarella Sticks", quantity: 1, unitPriceCents: 0, totalCents: 0 },
      { code: "tater-kegs", label: "Tater Kegs", quantity: 1, unitPriceCents: 0, totalCents: 0 },
    ];
    const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
    const rows = new Map(checklist.sections.flatMap((section) => section.rows)
      .map((row) => [row.key, row]));

    expect(rows.get("platter-chicken-tenders")).toMatchObject({ quantity: 64, panSize: "1/3" });
    expect(rows.get("platter-mozzarella-sticks")).toMatchObject({ quantity: 4, panSize: "1/3" });
    expect(rows.get("platter-tater-kegs")).toMatchObject({ quantity: 64, panSize: "1/3" });
    expect(checklist.warnings.map((warning) => warning.code)).not.toContain("UNKNOWN_FOOD_ITEM");
  });

  it("keeps paid VIP reservations visible when they have no advance food", () => {
    const kitchen = vipPrepKitchenEvents([
      {
        ...vipPrepPayload.reservations[0],
        id: "reservation-without-food",
        foodPrep: [],
      },
    ]);

    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]).toMatchObject({
      eventId: "vip-reservation-without-food",
      selections: [],
    });
  });

  it("creates a stable add-on sheet event for the booked VIP section only", () => {
    const reservation = vipPrepPayload.reservations[0];
    const event = vipPrepEventPlan(reservation);

    expect(event).toMatchObject({
      id: numericVipEventId(vipPrepExternalId(reservation)),
      name: "Redacted VIP · VIP 2",
      date: "2026-08-15",
      rooms: ["VIP 2"],
      guest_count: 16,
    });
    expect(event.rooms).not.toContain("Main Dining Room");
  });
});
