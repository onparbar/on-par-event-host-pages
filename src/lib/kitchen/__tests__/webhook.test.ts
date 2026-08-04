import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateKitchenChecklist } from "../rules";
import { createMemoryKitchenStorage } from "../storage";
import type { KitchenSourceEvent } from "../types";
import {
  processTripleseatWebhook,
  TripleseatWebhookError,
  verifyTripleseatWebhookSignature,
} from "../webhook";

const SIGNING_KEY = "unit-test-webhook-signing-key";

function signRawBody(rawBody: Buffer, timestamp: string) {
  const signature = createHmac("sha256", SIGNING_KEY)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");
  return {
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
  };
}

function signedPayload(timestamp = "1785258000") {
  const rawBody = Buffer.from(
    JSON.stringify({
      webhook_trigger_type: "UPDATE_EVENT",
      event: {
        id: 12345,
        event_date_iso8601: "2026-07-28",
      },
    }),
  );
  return signRawBody(rawBody, timestamp);
}

function signedDateMovePayload(timestamp = "1785258000") {
  const rawBody = Buffer.from(
    JSON.stringify({
      webhook_trigger_type: "CHANGE_EVENT_DATETIME",
      event: {
        id: 12345,
        event_date_iso8601: "2026-07-28",
      },
    }),
  );
  return signRawBody(rawBody, timestamp);
}

describe("Tripleseat webhook processing", () => {
  it("verifies the raw timestamp-dot-payload HMAC", () => {
    const signed = signedPayload();
    expect(
      verifyTripleseatWebhookSignature(
        signed.rawBody,
        signed.signatureHeader,
        SIGNING_KEY,
      ),
    ).toMatchObject({ valid: true, timestamp: "1785258000" });

    const changed = Buffer.from(`${signed.rawBody.toString()} `);
    expect(
      verifyTripleseatWebhookSignature(
        changed,
        signed.signatureHeader,
        SIGNING_KEY,
      ),
    ).toEqual({ valid: false, reason: "invalid-signature" });
  });

  it("treats a successful webhook retry as an idempotent duplicate", async () => {
    const storage = createMemoryKitchenStorage();
    const signed = signedPayload();
    const syncedDates: string[] = [];
    const options = {
      ...signed,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async (date: string) => {
        syncedDates.push(date);
      },
      now: () => new Date("2026-07-28T18:00:00Z"),
    };

    const first = await processTripleseatWebhook(options);
    const retry = await processTripleseatWebhook(options);

    expect(first).toMatchObject({
      duplicate: false,
      ignored: false,
      syncedDates: ["2026-07-28"],
    });
    expect(retry).toMatchObject({
      duplicate: true,
      syncedDates: [],
    });
    expect(syncedDates).toEqual(["2026-07-28"]);
  });

  it("deduplicates the same payload when a retry is re-signed", async () => {
    const storage = createMemoryKitchenStorage();
    const first = signedPayload("1785258000");
    const second = signedPayload("1785258060");
    const laterUpdate = signedPayload("1785258660");
    let syncCount = 0;

    await processTripleseatWebhook({
      ...first,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async () => {
        syncCount += 1;
      },
      now: () => new Date("2026-07-28T18:00:00.000Z"),
    });
    const retry = await processTripleseatWebhook({
      ...second,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async () => {
        syncCount += 1;
      },
      now: () => new Date("2026-07-28T18:01:00.000Z"),
    });
    const later = await processTripleseatWebhook({
      ...laterUpdate,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async () => {
        syncCount += 1;
      },
      now: () => new Date("2026-07-28T18:11:00.000Z"),
    });

    expect(retry.duplicate).toBe(true);
    expect(later.duplicate).toBe(false);
    expect(syncCount).toBe(2);
  });

  it("reclaims a processing receipt after its lease expires", async () => {
    const storage = createMemoryKitchenStorage();
    const signed = signedPayload();
    const payloadHash = createHash("sha256")
      .update(signed.rawBody)
      .digest("hex");
    const receipt = {
      receiptId: payloadHash,
      triggerType: "UPDATE_EVENT",
      sourceEventId: "12345",
      sourceEventDate: "2026-07-28",
      signatureTimestamp: "1785258000",
      payloadHash,
      receivedAt: "2026-07-28T18:00:00.000Z",
    };

    await expect(storage.claimWebhook(receipt)).resolves.toBe(true);
    await expect(
      storage.claimWebhook({
        ...receipt,
        receivedAt: "2026-07-28T18:05:00.000Z",
      }),
    ).resolves.toBe(false);
    await expect(
      storage.claimWebhook({
        ...receipt,
        receivedAt: "2026-07-28T18:11:00.000Z",
      }),
    ).resolves.toBe(true);
  });

  it("resolves the current date for an incomplete event payload", async () => {
    const storage = createMemoryKitchenStorage();
    const signed = signRawBody(
      Buffer.from(
        JSON.stringify({
          webhook_trigger_type: "UPDATE_EVENT",
          event: { id: 98765 },
        }),
      ),
      "1785258000",
    );
    const syncedDates: string[] = [];

    const result = await processTripleseatWebhook({
      ...signed,
      signingKey: SIGNING_KEY,
      storage,
      resolveEventDate: async (eventId) => {
        expect(eventId).toBe("98765");
        return "2026-07-30";
      },
      syncDay: async (date) => {
        syncedDates.push(date);
      },
    });

    expect(result.syncedDates).toEqual(["2026-07-30"]);
    expect(syncedDates).toEqual(["2026-07-30"]);
  });

  it("refreshes both stored and new dates after an event moves", async () => {
    const storage = createMemoryKitchenStorage();
    storage.getEventDate = async () => "2026-07-27";
    const signed = signedPayload();
    const syncedDates: string[] = [];

    const result = await processTripleseatWebhook({
      ...signed,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async (date) => {
        syncedDates.push(date);
      },
    });

    expect(result.syncedDates).toEqual([
      "2026-07-27",
      "2026-07-28",
    ]);
    expect(syncedDates).toEqual([
      "2026-07-27",
      "2026-07-28",
    ]);
  });

  it("fresh-resolves and prioritizes the current date for a datetime change", async () => {
    const storage = createMemoryKitchenStorage();
    storage.getEventDate = async () => "2026-07-28";
    const signed = signedDateMovePayload();
    const syncedDates: string[] = [];
    const resolvedEventIds: string[] = [];

    const result = await processTripleseatWebhook({
      ...signed,
      signingKey: SIGNING_KEY,
      storage,
      resolveEventDate: async (eventId) => {
        resolvedEventIds.push(eventId);
        return "2026-07-30";
      },
      syncDay: async (date) => {
        syncedDates.push(date);
      },
    });

    expect(resolvedEventIds).toEqual(["12345"]);
    expect(result.syncedDates).toEqual([
      "2026-07-30",
      "2026-07-28",
    ]);
    expect(syncedDates).toEqual([
      "2026-07-30",
      "2026-07-28",
    ]);
  });

  it("preserves exact-event add-ons while moving the event to a new date", async () => {
    const storage = createMemoryKitchenStorage();
    const sourceEvent = (localDate: string): KitchenSourceEvent => ({
      eventId: "12345",
      bookingId: null,
      eventName: "Redacted Moved Event",
      localDate,
      localDateVerified: true,
      startTime: "17:00",
      endTime: "19:00",
      guestCount: 24,
      status: "DEFINITE",
      statusVerified: true,
      room: "Event Room",
      selections: [
        { name: "The Full Course", isFood: true },
        { name: "Taco Bar", isFood: true },
      ],
      specialNotes: [],
      sourceUpdatedAt: "2026-07-29T12:00:00Z",
      sourceState: "fresh",
    });
    const oldEvent = sourceEvent("2026-07-28");
    const movedEvent = sourceEvent("2026-07-30");

    await storage.replaceDay("2026-07-28", [
      {
        sourceEvent: oldEvent,
        checklist: generateKitchenChecklist(oldEvent),
      },
    ]);
    await storage.saveFoodAddOns("12345", {
      wings: { quantity: 2 },
    }, null);

    const result = await processTripleseatWebhook({
      ...signedDateMovePayload(),
      signingKey: SIGNING_KEY,
      storage,
      resolveEventDate: async () => "2026-07-30",
      syncDay: async (date) => {
        await storage.replaceDay(
          date,
          date === "2026-07-30"
            ? [
                {
                  sourceEvent: movedEvent,
                  checklist: generateKitchenChecklist(movedEvent),
                },
              ]
            : [],
        );
      },
    });

    expect(result.syncedDates).toEqual([
      "2026-07-30",
      "2026-07-28",
    ]);
    await expect(storage.getEventDate("12345")).resolves.toBe(
      "2026-07-30",
    );
    await expect(storage.getFoodAddOns("12345")).resolves.toEqual(
      expect.objectContaining({
        eventId: "12345",
        food: { wings: { quantity: 2 } },
      }),
    );
    const movedDay = await storage.getDay("2026-07-30");
    expect(movedDay.events[0].liveFoodAddOns).toEqual([
      expect.objectContaining({
        itemKey: "addon:wings",
        quantity: 128,
      }),
    ]);
    expect((await storage.getDay("2026-07-28")).events).toEqual([]);
  });

  it("allows a provider retry after a failed refresh", async () => {
    const storage = createMemoryKitchenStorage();
    const signed = signedPayload();
    let attempts = 0;
    const options = {
      ...signed,
      signingKey: SIGNING_KEY,
      storage,
      syncDay: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary failure");
        }
      },
    };

    await expect(processTripleseatWebhook(options)).rejects.toBeInstanceOf(
      TripleseatWebhookError,
    );
    await expect(processTripleseatWebhook(options)).resolves.toMatchObject({
      duplicate: false,
      syncedDates: ["2026-07-28"],
    });
    expect(attempts).toBe(2);
  });
});
