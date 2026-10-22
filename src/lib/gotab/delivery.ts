export type EventFoodDelivery = {
  requestId: string;
  eventId: string;
  sourceKey: string;
  foodName: string;
  quantity: number;
  panSize: string;
  status: string;
  orderReference: string | null;
  acceptedAt: string | null;
  updatedAt: string;
  error: string | null;
};

export function eventFoodDeliveryState(delivery: Pick<EventFoodDelivery, "status">) {
  switch (delivery.status) {
    case "SENT": return { label: "GoTab accepted", tone: "accepted", accepted: true } as const;
    case "SENDING": return { label: "Sending — awaiting result", tone: "pending", accepted: false } as const;
    case "QUEUED": return { label: "Queued", tone: "pending", accepted: false } as const;
    case "SCHEDULED": return { label: "Scheduled", tone: "pending", accepted: false } as const;
    case "DRY_RUN": return { label: "Test only — not sent", tone: "warning", accepted: false } as const;
    case "HELD": return { label: "Held — review before retrying", tone: "warning", accepted: false } as const;
    case "FAILED": return { label: "Delivery failed", tone: "warning", accepted: false } as const;
    case "CANCELLED": return { label: "Cancelled", tone: "warning", accepted: false } as const;
    default: return { label: "Delivery not verified", tone: "warning", accepted: false } as const;
  }
}

export function summarizeEventFoodDelivery(deliveries: readonly EventFoodDelivery[], expectedRequestIds: readonly string[]) {
  const expected = [...new Set(expectedRequestIds)];
  const matched = deliveries.filter((item) => expected.includes(item.requestId));
  const accepted = new Set(matched.filter((item) => eventFoodDeliveryState(item).accepted).map((item) => item.requestId));
  const errors = matched.filter((item) => eventFoodDeliveryState(item).tone === "warning");
  return {
    deliveries: matched,
    sent: accepted.size,
    complete: expected.length > 0 && accepted.size === expected.length,
    error: errors[0]?.error ?? (errors.length ? eventFoodDeliveryState(errors[0]).label :
      matched.length < expected.length ? "Some food-order delivery results are unavailable. Review before retrying." : null),
  };
}
