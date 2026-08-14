import { describe, expect, it } from "vitest";

import {
  confirmedContractEntertainmentSourcesForDate,
  confirmedContractEventPlanSourcesForDate,
  confirmedContractKitchenSourcesForDate,
  mergeConfirmedContractEventPlans,
} from "../confirmed-contract-events";

describe("confirmed contract event evidence", () => {
  it("projects the August 21 Manager Outing contract into every dashboard source", () => {
    const [eventPlan] = mergeConfirmedContractEventPlans(
      [],
      "2026-08-21",
      "2026-08-21",
    );
    const [eventPlanSource] =
      confirmedContractEventPlanSourcesForDate("2026-08-21");
    const [kitchen] =
      confirmedContractKitchenSourcesForDate("2026-08-21");
    const [entertainment] =
      confirmedContractEntertainmentSourcesForDate("2026-08-21");

    expect(eventPlan).toMatchObject({
      id: 2026082101,
      name: "Manager Outing",
      date: "2026-08-21",
      time: "4:00 PM - 7:00 PM",
      guest_count: 50,
      rooms: ["VIP 1"],
      food: [
        "The Full Course - Food + $20 Drink Cards",
        "Jumbo Wing Bar",
        "5 Dessert Platters",
      ],
      entertainment: [
        expect.objectContaining({
          name: "Duckpin Bowling",
          quantity: "5 lanes",
          time: "4:30 PM - 6:30 PM",
        }),
        expect.objectContaining({
          name: "Darts",
          quantity: "4 lanes",
          time: "4:30 PM - 6:30 PM",
        }),
      ],
    });
    expect(eventPlanSource.source.status).toBe("MANUAL CONFIRMED");
    expect(kitchen.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Wing Bar", quantity: 50 }),
        expect.objectContaining({ name: "Dessert Platter", quantity: 5 }),
      ]),
    );
    expect(entertainment.items).toEqual([
      expect.objectContaining({
        description:
          "5 Duckpin Bowling lanes for 2 hours, 4:30 PM - 6:30 PM",
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      }),
      expect.objectContaining({
        description: "4 dart lanes for 2 hours, 4:30 PM - 6:30 PM",
        startAt: "2026-08-21T20:30:00.000Z",
        endAt: "2026-08-21T22:30:00.000Z",
      }),
    ]);
  });

  it("lets live data win by date and normalized event name", () => {
    const livePlan = {
      ...mergeConfirmedContractEventPlans(
        [],
        "2026-08-21",
        "2026-08-21",
      )[0],
      id: 12345678,
      name: "  MANAGER   OUTING ",
      verification_status: "Live Tripleseat record",
    };

    const merged = mergeConfirmedContractEventPlans(
      [livePlan],
      "2026-08-21",
      "2026-08-21",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(12345678);
  });

  it("retires evidence after a newer successful sync covers its date", () => {
    expect(
      mergeConfirmedContractEventPlans(
        [],
        "2026-08-21",
        "2026-08-21",
        "2026-08-14T21:30:00.000Z",
        {
          startDate: "2026-08-21",
          endDate: "2026-08-21",
        },
      ),
    ).toEqual([]);
    expect(
      confirmedContractKitchenSourcesForDate(
        "2026-08-21",
        "2026-08-14T21:30:00.000Z",
      ),
    ).toEqual([]);
    expect(
      confirmedContractEntertainmentSourcesForDate(
        "2026-08-21",
        "2026-08-14T21:30:00.000Z",
      ),
    ).toEqual([]);
  });

  it("does not expire evidence when a newer sync did not cover its date", () => {
    expect(
      mergeConfirmedContractEventPlans(
        [],
        "2026-08-21",
        "2026-08-21",
        "2026-08-14T21:30:00.000Z",
        {
          startDate: "2026-08-14",
          endDate: "2026-08-14",
        },
      ),
    ).toHaveLength(1);
  });
});
