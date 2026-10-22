import { describe, expect, it } from "vitest";
import { vipCheckinNavigationRows } from "../navigation";
import { operationalKitchenEventId, vipPrepExternalId } from "@/lib/vip-prep/identity";

const first = { reservationId: "booking-a", reservationDate: "2026-10-21", vipName: "Same party title" };
const selected = { reservationId: "booking-b", reservationDate: "2026-10-21", vipName: "Same party title" };
const otherDate = { ...selected, reservationDate: "2026-10-22" };

describe("VIP navigation identity", () => {
  it("selects only the exact VIP reservation, not another party with the same name", () => {
    expect(vipCheckinNavigationRows([first, selected], vipPrepExternalId({ id: selected.reservationId }), "2026-10-21")).toEqual([selected]);
  });
  it("matches the established numeric kitchen/checklist identity", () => {
    const identity = operationalKitchenEventId(vipPrepExternalId({ id: selected.reservationId }));
    expect(vipCheckinNavigationRows([first, selected], identity, "2026-10-21")).toEqual([selected]);
  });
  it("does not substitute a VIP for a nonmatching corporate event", () => {
    expect(vipCheckinNavigationRows([first, selected], "corporate-event-id", "2026-10-21")).toEqual([]);
  });
  it("filters the date before the identity and shows all only when the preference is cleared", () => {
    expect(vipCheckinNavigationRows([first, selected, otherDate], null, "2026-10-21")).toEqual([first, selected]);
    expect(vipCheckinNavigationRows([otherDate], vipPrepExternalId({ id: selected.reservationId }), "2026-10-21")).toEqual([]);
  });
});
