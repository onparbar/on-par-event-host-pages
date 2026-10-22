import { kitchenEventInterval } from "./lifecycle";
import { quantityAwareReadinessKey } from "./readiness";
import type { KitchenChecklist } from "./types";

export type ProductionTotal = {
  id: string;
  foodName: string;
  quantity: number;
  remainingQuantity: number;
  unit: string;
  panSize: string | null;
  pans: number | null;
  readyBy: string | null;
  needsReview: boolean;
  events: Array<{ id: string; name: string; quantity: number; ready: boolean }>;
};

/** Only combine identical preparation definitions in the same service window. */
export function kitchenProductionTotals(checklists: readonly KitchenChecklist[]) {
  const totals = new Map<string, ProductionTotal>();
  let unresolvedRows = 0;
  for (const checklist of checklists) {
    const readyAt = kitchenEventInterval({
      ...checklist.event, startTime: checklist.timing.foodReadyBy, endTime: null,
    }).startAt;
    const readyBy = readyAt === null ? null : new Date(readyAt).toISOString();
    for (const section of checklist.sections) {
      for (const row of section.rows) {
        if (row.quantity === null || !Number.isFinite(row.quantity) || row.quantity < 0) {
          unresolvedRows += 1;
          continue;
        }
        const id = JSON.stringify([row.key, row.unit, row.panSize, readyBy, checklist.ruleVersion, checklist.needsReview]);
        const ready = checklist.completedItemKeys.includes(quantityAwareReadinessKey({
          itemKey: row.key, quantity: row.quantity, numberOfPans: row.numberOfPans,
          panSize: row.panSize, unit: row.unit, ruleVersion: checklist.ruleVersion,
        }));
        const total = totals.get(id) ?? {
          id, foodName: row.foodName, quantity: 0, remainingQuantity: 0, unit: row.unit,
          panSize: row.panSize, pans: 0, readyBy, needsReview: checklist.needsReview || !readyBy,
          events: [],
        };
        total.quantity += row.quantity;
        if (!ready) total.remainingQuantity += row.quantity;
        total.pans = total.pans === null || row.numberOfPans === null ? null : total.pans + row.numberOfPans;
        total.events.push({ id: String(checklist.event.eventId), name: checklist.event.name, quantity: row.quantity, ready });
        totals.set(id, total);
      }
    }
  }
  return {
    totals: [...totals.values()].sort((a, b) => (a.readyBy ?? "z").localeCompare(b.readyBy ?? "z") || a.foodName.localeCompare(b.foodName)),
    unresolvedRows,
  };
}

export function kitchenProgress(checklist: KitchenChecklist) {
  const keys = checklist.sections.flatMap((section) => section.rows.map((row) => quantityAwareReadinessKey({
    itemKey: row.key, quantity: row.quantity, numberOfPans: row.numberOfPans,
    panSize: row.panSize, unit: row.unit, ruleVersion: checklist.ruleVersion,
  })));
  return {
    total: keys.length,
    ready: keys.filter((key) => checklist.completedItemKeys.includes(key)).length,
    prepped: keys.filter((key) => checklist.preppedItemKeys?.includes(key)).length,
  };
}
