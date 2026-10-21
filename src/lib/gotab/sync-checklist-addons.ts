import "server-only";

import {
  getKitchenEventChecklist,
  getKitchenEventFoodAddOns,
  updateKitchenEventFoodAddOns,
} from "@/lib/kitchen/sync";
import { synchronizeKitchenLiveAddOnsToEventFood } from "./sync-event-food";
import { processGoTabDispatches } from "./worker";
import type { EventFoodSourceType } from "./event-food";
import { GoTabIntegrationStorage } from "./storage";
import { eventFoodDeliveryState, summarizeEventFoodDelivery, type EventFoodDelivery } from "./delivery";

async function verifySavedAddOnDelivery(kitchenEventId: string, food: Record<string, unknown>) {
  // A no-change save is not proof of delivery. Read this event's saved orders,
  // without retrying them or counting any other party's worker results.
  const history = await new GoTabIntegrationStorage().listEventFoodDelivery([kitchenEventId]);
  const latest = new Map<string, EventFoodDelivery>();
  // Storage returns request creation order, newest first. Match the current
  // quantity to the newest request, but do not hide older unsettled attempts.
  for (const item of history) {
    if (item.eventId === kitchenEventId && item.sourceKey.startsWith("addon:") && !latest.has(item.sourceKey)) latest.set(item.sourceKey, item);
  }
  const current = Object.entries(food).flatMap(([key, value]) => {
    const quantity = value && typeof value === "object" ? Number((value as { quantity?: unknown }).quantity) : 0;
    const selectedPan = value && typeof value === "object" ? (value as { panSize?: unknown }).panSize : null;
    const panSize = selectedPan === "1/2" ? "HALF_PAN" : selectedPan === "1/3" ? "THIRD_PAN" : null;
    return Number.isSafeInteger(quantity) && quantity > 0 ? [{ sourceKey: `addon:${key}`, quantity, panSize }] : [];
  });
  const currentKeys = new Set(current.map((item) => item.sourceKey));
  const outstanding = history.filter((item) => item.eventId === kitchenEventId && item.sourceKey.startsWith("addon:") && !["SENT", "CANCELLED"].includes(item.status));
  const missing = current.filter((item) => {
    const order = latest.get(item.sourceKey);
    return !order || order.quantity !== item.quantity || (item.panSize !== null && order.panSize !== item.panSize) || !eventFoodDeliveryState(order).accepted;
  });
  const deliveries = [...new Map([...latest.values()].filter((item) => currentKeys.has(item.sourceKey)).concat(outstanding).map((item) => [item.requestId, item])).values()];
  const exceptionKeys = new Set([...missing.map((item) => item.sourceKey), ...outstanding.map((item) => item.sourceKey)]);
  const acceptedDeliveryCount = current.filter((item) => {
    const order = latest.get(item.sourceKey);
    return order?.quantity === item.quantity && (item.panSize === null || order.panSize === item.panSize) && eventFoodDeliveryState(order).accepted;
  }).length;
  return {
    deliveries,
    acceptedDeliveryCount,
    deliveryVerified: current.length > 0 && missing.length === 0 && outstanding.length === 0,
    noFoodRequired: current.length === 0 && outstanding.length === 0,
    exceptions: exceptionKeys.size,
    error: missing.length || outstanding.length ? "Saved food has missing, pending, failed, or held GoTab delivery evidence. Review the saved orders before retrying." : null,
  };
}

export async function synchronizeChecklistFoodAddOns(
  kitchenEventId: string,
  food: unknown,
  submittedSourceKeys?: readonly string[],
  sourceType: EventFoodSourceType = "EVENT_HOST_ADDON",
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
      submittedSourceKeys?.includes(key) ||
      JSON.stringify(previousFood[key] ?? null) !==
        JSON.stringify(savedFood[key] ?? null),
  );

  if (changedSourceKeys.length === 0) {
    const verification = await verifySavedAddOnDelivery(kitchenEventId, savedFood);
    return { saved, queued: 0, sent: verification.acceptedDeliveryCount, ...verification };
  }

  const checklist = await getKitchenEventChecklist(kitchenEventId);
  const synchronization = await synchronizeKitchenLiveAddOnsToEventFood(
    checklist,
    {
      sourceVersion: saved.revision,
      changedSourceKeys,
      dispatchImmediately: true,
      ...(sourceType === "REFILL" ? { sourceType } : {}),
    },
  );
  await processGoTabDispatches();
  const requestIds = synchronization.requestIds ?? [];
  const deliveries = await new GoTabIntegrationStorage().listEventFoodDelivery([kitchenEventId], requestIds);
  const delivery = summarizeEventFoodDelivery(deliveries, requestIds);
  const verification = !submittedSourceKeys?.length
    ? await verifySavedAddOnDelivery(kitchenEventId, savedFood)
    : null;

  return {
    saved,
    queued: synchronization.requestCount,
    exceptions: Math.max(synchronization.exceptionCount, verification?.exceptions ?? 0),
    sent: delivery.sent,
    acceptedDeliveryCount: verification?.acceptedDeliveryCount ?? delivery.sent,
    deliveryVerified: synchronization.exceptionCount === 0 && (verification?.deliveryVerified ?? delivery.complete),
    noFoodRequired: verification?.noFoodRequired ?? false,
    error: verification?.error ?? delivery.error,
    deliveries: verification?.deliveries ?? delivery.deliveries,
  };
}
