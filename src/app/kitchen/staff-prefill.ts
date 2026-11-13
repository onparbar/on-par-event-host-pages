import type { KitchenChecklist } from "@/lib/kitchen/types";

export type KitchenSheetChecklist = KitchenChecklist & { staffingFoodRunners?: string[] };

export function canPrefillKitchenFoodRunner(checklist: KitchenChecklist) {
  return !checklist.event.vipBooking && !String(checklist.event.eventId).startsWith("vip-") &&
    checklist.assignmentUpdatedAt == null && !checklist.foodRunners?.length && !checklist.foodRunnerOrBwa;
}

/** An event-assignment default is displayed but never sent to the kitchen Save action. */
export function kitchenFoodRunnerPrefill(checklist: KitchenSheetChecklist) {
  return canPrefillKitchenFoodRunner(checklist) && checklist.staffingFoodRunners?.length
    ? `${checklist.staffingFoodRunners.join(", ")} (from event staffing; not saved here)`
    : undefined;
}
