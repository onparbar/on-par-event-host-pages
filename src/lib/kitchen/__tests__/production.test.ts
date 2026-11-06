import { describe, expect, it } from "vitest";
import { MOCK_KITCHEN_EVENTS } from "../fixtures";
import { generateKitchenChecklist } from "../rules";
import { kitchenProductionTotals } from "../production";
import { quantityAwareReadinessKey } from "../readiness";
import type { KitchenChecklist } from "../types";

function sheet(id: string, readyBy = "2026-10-21T17:45:00"): KitchenChecklist {
  const base = generateKitchenChecklist(MOCK_KITCHEN_EVENTS[0]);
  return { ...base, event: { ...base.event, eventId: id, name: `Training ${id}`, localDate: "2026-10-21" }, needsReview: false,
    timing: { ...base.timing, foodReadyBy: readyBy },
    sections: [{ category: "platters" as const, label: "Platters", rows: [{ key: "platter-wings" as const, category: "platters" as const, foodName: "Wings", description: "", quantity: 64, unit: "each", numberOfPans: 1, panSize: "1/2" as const, prepTiming: { kind: "not-applicable" as const } }] }],
    completedItemKeys: [],
  };
}

describe("kitchen production totals", () => {
  it("combines identical definitions while keeping party portions", () => {
    const result = kitchenProductionTotals([sheet("a"), sheet("b")]);
    expect(result.totals).toHaveLength(1);
    expect(result.totals[0]).toMatchObject({ quantity: 128, pans: 2, remainingQuantity: 128 });
    expect(result.totals[0].events).toHaveLength(2);
    expect(result.totals[0].readyBy).toBe("2026-10-21T21:45:00.000Z");
  });
  it("never combines different service windows or pan sizes", () => {
    const other = sheet("b", "2026-10-21T19:45:00");
    expect(kitchenProductionTotals([sheet("a"), other]).totals).toHaveLength(2);
    const third = sheet("c"); third.sections[0].rows[0].panSize = "1/3";
    expect(kitchenProductionTotals([sheet("a"), third]).totals).toHaveLength(2);
  });
  it("deducts ready portions using the same quantity fingerprint as the event sheet", () => {
    const ready = sheet("a");
    ready.completedItemKeys = [quantityAwareReadinessKey({ ...ready.sections[0].rows[0], itemKey: "platter-wings", ruleVersion: ready.ruleVersion })];
    expect(kitchenProductionTotals([ready, sheet("b")]).totals[0].remainingQuantity).toBe(64);
  });
  it("does not add live-addon lines a second time to calculated prep rows", () => {
    const event = sheet("a");
    event.liveFoodAddOns = [{ itemKey: "addon:wings", foodName: "Wings", description: "", quantity: 64, unit: "each", numberOfPans: 1, panSize: "1/2", sourceUpdatedAt: null }];
    expect(kitchenProductionTotals([event]).totals[0].quantity).toBe(64);
  });
  it("excludes unknown quantities rather than displaying an estimated production total", () => {
    const event = sheet("unknown"); event.sections[0].rows[0].quantity = null;
    const result = kitchenProductionTotals([event, sheet("verified")]);
    expect(result.unresolvedRows).toBe(1);
    expect(result.totals[0].quantity).toBe(64);
  });
  it("keeps units and missing service times distinct and flags review", () => {
    const differentUnit = sheet("b"); differentUnit.sections[0].rows[0].unit = "pounds";
    expect(kitchenProductionTotals([sheet("a"), differentUnit]).totals).toHaveLength(2);
    const missingTime = sheet("c"); missingTime.timing.foodReadyBy = null;
    expect(kitchenProductionTotals([missingTime]).totals[0]).toMatchObject({ readyBy: null, needsReview: true });
  });
});
