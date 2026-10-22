import { describe, expect, it } from "vitest";
import { eventFoodDeliveryState, summarizeEventFoodDelivery, type EventFoodDelivery } from "../delivery";

const delivery: EventFoodDelivery = { requestId: "request-1", eventId: "event-1", sourceKey: "addon:wings", foodName: "Wings", quantity: 1, panSize: "TRAY", status: "SENT", orderReference: "order-1", acceptedAt: null, updatedAt: "", error: null };

describe("order-specific delivery evidence", () => {
  it("calls a successful API order accepted, not a physical KDS acknowledgment", () => {
    expect(eventFoodDeliveryState(delivery).label).toBe("GoTab accepted");
    expect(eventFoodDeliveryState(delivery).label).not.toContain("acknowledged");
  });
  it.each(["UNKNOWN", "CONFIRMED_BY_GOTAB", "SENDING", "SCHEDULED", "DRY_RUN", "FAILED", "HELD"])("does not count unproven status %s as accepted", (status) => {
    expect(summarizeEventFoodDelivery([{ ...delivery, status }], ["request-1"]).complete).toBe(false);
  });
  it("requires every submitted request and deduplicates repeated IDs", () => {
    expect(summarizeEventFoodDelivery([delivery], ["request-1", "request-1"]).sent).toBe(1);
    expect(summarizeEventFoodDelivery([delivery], ["request-1", "missing"]).complete).toBe(false);
    expect(summarizeEventFoodDelivery([delivery], []).complete).toBe(false);
  });
});
