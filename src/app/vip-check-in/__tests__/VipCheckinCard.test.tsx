import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VipCheckinCard, vipFoodStatusLabels } from "../VipCheckInClient";
import type { VipCheckinRow, VipFoodStatus } from "@/lib/vip-checkin/service";

vi.mock("next/navigation", () => ({ usePathname: () => "/vip-check-in" }));

const row: VipCheckinRow = {
  reservationId: "sanitized-vip", vipName: "Sample VIP Party", customerName: "Sample Customer",
  confirmationCode: "VIPL-TEST", vipArea: "VIP 2", reservationDate: "2026-11-14", partySize: 16,
  reservationTime: "2026-11-14T22:00:00Z", endAt: "2026-11-15T00:00:00Z", duration: "2 hours",
  sourceStatus: "confirmed", sourceUpdatedAt: "2026-10-26T16:00:00Z", lastSuccessfulBookingRefresh: "2026-10-26T17:00:00Z",
  scheduledReleaseAt: "2026-11-14T21:00:00Z", checkedInBy: null, checkedInAt: null,
  foodStatus: "NOT_CHECKED_IN", acceptedItemCount: 0, expectedItemCount: 3, itemIssues: [],
  foodItems: [{ code: "chicken-tenders", label: "Chicken Tender Platter", quantity: 2 },
    { code: "fry-platters", label: "Fry Platter", quantity: 1 }, { code: "mozzarella-sticks", label: "Mozzarella Stick Platter", quantity: 1 }],
  extras: [{ code: "MINIGOLF", label: "Mini Golf", quantity: 16 }],
};
function render(overrides: Partial<VipCheckinRow> = {}, disabled = false) {
  return renderToStaticMarkup(createElement(VipCheckinCard, { row: { ...row, ...overrides }, employeeName: "Tina", pendingId: null, disabled, onConfirm: vi.fn() }));
}

describe("VIP check-in card operator information", () => {
  it("shows the complete booking, exact purchased quantities, untimed extras and separate arrival/release status", () => {
    const html = render();
    for (const text of ["Sample VIP Party", "Sample Customer", "VIPL-TEST", "VIP 2", "November 14", "5:00 PM", "7:00 PM", "2 hours", "16 guests",
      "2 × Chicken Tender Platter", "1 × Fry Platter", "1 × Mozzarella Stick Platter", "16 × Mini Golf", "Arrival status", "Food release status",
      "Awaiting VIP check-in — food not released.", "4:00 PM EST — requires Event Host check-in", "CONFIRM CHECK-IN"]) expect(html).toContain(text);
    expect(html).not.toContain("Customer Phone");
    expect(html).not.toContain("Sent to KDS");
    expect(html).not.toContain("Minutes");
  });

  it("shows recorded staff and time, no second check-in button, and preserves partial item issues", () => {
    const html = render({ checkedInAt: "2026-11-14T21:30:00Z", checkedInBy: "Tina", foodStatus: "FOOD_PARTIAL", acceptedItemCount: 1,
      itemIssues: ["Fry Platter: held; review the saved item before retrying."] });
    expect(html).toContain("Checked in by Tina at Nov 14, 4:30 PM EST");
    expect(html).toContain("1 of 3 initial food items accepted by GoTab.");
    expect(html).toContain("Fry Platter: held");
    expect(html).not.toContain("CONFIRM CHECK-IN");
    expect(html).not.toContain("Sent to KDS");
  });

  it.each(Object.keys(vipFoodStatusLabels) as VipFoodStatus[])("never represents %s as accepted unless every expected item is confirmed", (foodStatus) => {
    const html = render({ foodStatus });
    expect(html.includes("Sent to KDS — GoTab accepted")).toBe(foodStatus === "FOOD_SENT");
  });

  it("keeps a valid no-food booking and unknown extra quantities explicit", () => {
    const html = render({ foodItems: [], expectedItemCount: 0, foodStatus: "NOT_CHECKED_IN",
      extras: [{ code: "unknown", label: "Source extra", quantity: null }], lastSuccessfulBookingRefresh: null });
    expect(html).toContain("No preordered food.");
    expect(html).toContain("Quantity not supplied · Source extra");
    expect(html).toContain("Last successful booking refresh not recorded");
  });

  it("disables an arrival action when current source verification is unavailable", () => {
    expect(render({}, true)).toMatch(/<button[^>]*disabled=""[^>]*>CONFIRM CHECK-IN<\/button>/);
  });

  it("makes a known preorder change visible before check-in without implying that food was released", () => {
    const html = render({ preorderChange: { sourceUpdatedAt: row.sourceUpdatedAt,
      previous: [{ code: "chicken-tenders", label: "Chicken Tender Platter", quantity: 1 }], current: row.foodItems,
      message: "Use current purchased quantities. Food remains blocked until Event Host staff confirm arrival." } });
    for (const text of ["VIP preorder change", "Preorder changed", "Previous: 1 × Chicken Tender Platter", "Current: 2 × Chicken Tender Platter", "Food remains blocked"]) expect(html).toContain(text);
    expect(html).toContain("Awaiting VIP check-in — food not released.");
    expect(html).not.toContain("Sent to KDS");
  });
});
