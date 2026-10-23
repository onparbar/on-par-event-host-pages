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
  it.each(["QUEUED", "SCHEDULED", "SENDING"])("reports %s as pending without an approval or failure message", (status) => {
    expect(summarizeEventFoodDelivery([{ ...delivery, status }], [delivery.requestId])).toMatchObject({ complete: false, pending: true, error: null });
  });
  it("keeps a partly accepted submission pending until every exact request is accepted", () => {
    expect(summarizeEventFoodDelivery([delivery, { ...delivery, requestId: "request-2", status: "SENDING" }], ["request-1", "request-2"])).toMatchObject({ sent: 1, pending: true, complete: false, error: null });
  });
  it.each(["FAILED", "HELD", "UNKNOWN", "DRY_RUN", "CANCELLED"])("does not hide %s behind another queued item", (status) => {
    const result = summarizeEventFoodDelivery([{ ...delivery, status: "QUEUED" }, { ...delivery, requestId: "request-2", status }], ["request-1", "request-2"]);
    expect(result.pending).toBe(false);
    expect(result.error).toBeTruthy();
  });
  it("does not call missing evidence or a queued error pending", () => {
    expect(summarizeEventFoodDelivery([{ ...delivery, status: "QUEUED" }], ["request-1", "missing"])).toMatchObject({ pending: false, complete: false });
    expect(summarizeEventFoodDelivery([{ ...delivery, status: "QUEUED", error: "Send failed" }], ["request-1"])).toMatchObject({ pending: false, error: "Send failed" });
  });
});
