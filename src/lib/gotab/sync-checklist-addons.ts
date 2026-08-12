import "server-only";

import {
  getKitchenEventChecklist,
  getKitchenEventFoodAddOns,
  updateKitchenEventFoodAddOns,
} from "@/lib/kitchen/sync";
import { synchronizeKitchenLiveAddOnsToEventFood } from "./sync-event-food";
import { processGoTabDispatches } from "./worker";

export async function synchronizeChecklistFoodAddOns(
  kitchenEventId: string,
  food: unknown,
  submittedSourceKeys?: readonly string[],
) {
  const previous = await getKitchenEventFoodAddOns(kitchenEventId);
  const previousFood = previous.food as Record<string, unknown>;
  const submittedFood =
    food && typeof food === "object" && !Array.isArray(food)
      ? food as Record<string, unknown>
      : {};
  const nextFood = submittedSourceKeys?.length
    ? { ...previousFood }
    : submittedFood;
  for (const key of submittedSourceKeys ?? []) {
    const value = submittedFood[key];
    const quantity =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).quantity
        : null;
    if (quantity === "" || quantity === 0 || quantity === "0" || value == null) {
      delete nextFood[key];
    } else {
      nextFood[key] = value;
    }
  }
  const saved = await updateKitchenEventFoodAddOns(kitchenEventId, nextFood);
  const savedFood = saved.food as Record<string, unknown>;
  const candidateKeys = submittedSourceKeys?.length
    ? [...submittedSourceKeys]
    : [...new Set([...Object.keys(previousFood), ...Object.keys(savedFood)])];
  const changedSourceKeys = candidateKeys.filter(
    (key) =>
      JSON.stringify(previousFood[key] ?? null) !==
      JSON.stringify(savedFood[key] ?? null),
  );

  if (changedSourceKeys.length === 0) {
    return { saved, queued: 0, exceptions: 0, sent: 0 };
  }

  const checklist = await getKitchenEventChecklist(kitchenEventId);
  const synchronization = await synchronizeKitchenLiveAddOnsToEventFood(
    checklist,
    {
      sourceVersion: saved.revision,
      changedSourceKeys,
      dispatchImmediately: true,
    },
  );
  const dispatch = await processGoTabDispatches();

  return {
    saved,
    queued: synchronization.requestCount,
    exceptions: synchronization.exceptionCount,
    sent: dispatch.sent,
  };
}
