import { describe, expect, it } from "vitest";
import {
  VipPrepApiError,
  VipPrepClient,
  vipPrepEntertainmentEvents,
  vipPrepKitchenEvents,
} from "../client";
import { vipPrepPayload } from "./fixtures";

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
});
