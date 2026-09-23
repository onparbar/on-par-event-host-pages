import "server-only";

import { createHash } from "node:crypto";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import { getGoTabConfigurationStatus } from "./config";
import { buildGoTabKdsPreview, type EventFoodProductMapping, type EventFoodSourceType } from "./event-food";
import { projectKitchenChecklist } from "./project-kitchen";
import { GoTabIntegrationStorage } from "./storage";
import { KITCHEN_ROW_KEY_BY_VIP_CODE } from "@/lib/vip-prep/client";

type EventFoodSyncStorage = Pick<
  GoTabIntegrationStorage,
  "listMappings" | "saveProjectionExceptions" | "enqueueRequest"
>;
type VipBookingFoodSyncStorage = EventFoodSyncStorage & Pick<
  GoTabIntegrationStorage,
  "listVipBookingFoodRequests" | "performAdministrativeAction"
>;

export function eventFoodSourceVersion(checklist: KitchenChecklist) {
  const content = JSON.stringify({
    ruleVersion: checklist.ruleVersion,
    event: checklist.event,
    timing: checklist.timing,
    sections: checklist.sections,
    liveFoodAddOns: checklist.liveFoodAddOns,
  });
  return Number.parseInt(createHash("sha256").update(content).digest("hex").slice(0, 12), 16);
}

export async function synchronizeKitchenChecklistToEventFood(
  checklist: KitchenChecklist,
  options: {
    sourceVersion: number;
    sourceType?: EventFoodSourceType;
    actor?: string;
    storage?: EventFoodSyncStorage;
    env?: Readonly<Record<string, string | undefined>>;
    dispatchImmediately?: boolean;
    bookedFoodQuantities?: ReadonlyMap<string, number>;
  },
) {
  const storage = options.storage ?? new GoTabIntegrationStorage();
  const configuration = getGoTabConfigurationStatus(options.env);
  const sourceType = options.sourceType ?? (String(checklist.event.eventId).startsWith("vip-") ? "VIP_ADDON" : "TRIPLESEAT_CONTRACT");
  const storedMappings = await storage.listMappings();
  const mappings: EventFoodProductMapping[] = storedMappings
    .filter((mapping) => mapping.mapping_status === "VERIFIED" && mapping.gotab_product_uuid)
    .map((mapping) => ({
      id: mapping.id,
      canonicalProductKey: mapping.canonical_product_key,
      displayName: mapping.display_name,
      aliases: mapping.aliases,
      panSize: mapping.pan_size as EventFoodProductMapping["panSize"],
      preparationStation: mapping.preparation_station as EventFoodProductMapping["preparationStation"],
      gotabProductUuid: mapping.gotab_product_uuid,
      verifiedAt: mapping.verified_at,
    }));
  const projection = projectKitchenChecklist(checklist, mappings, {
    sourceType,
    sourceVersion: options.sourceVersion,
    requesterName:
      checklist.foodRunners?.find((name) => name.trim()) ??
      checklist.pocs?.find((name) => name.trim()) ??
      (checklist.foodRunnerOrBwa?.trim() || null),
    defaultPrepLeadMinutes: configuration.defaultPrepLeadMinutes ?? 60,
    bookedFoodQuantities: options.bookedFoodQuantities,
  });
  await storage.saveProjectionExceptions({
    eventId: String(checklist.event.eventId),
    sourceType,
    sourceVersion: options.sourceVersion,
    exceptions: projection.exceptions.map((item) => ({
      itemKey: item.itemKey,
      foodName: item.foodName,
      reason: item.reason,
    })),
  });
  const results = [];
  for (const request of projection.requests) {
    const preview = buildGoTabKdsPreview(request, checklist.event.name, {
      enabled: configuration.enabled,
      dryRun: configuration.dryRun,
    });
    results.push(options.dispatchImmediately
      ? await storage.enqueueRequest(
          request,
          preview as unknown as Record<string, unknown>,
          options.actor ?? "SYSTEM",
          { immediate: true },
        )
      : await storage.enqueueRequest(
          request,
          preview as unknown as Record<string, unknown>,
          options.actor ?? "SYSTEM",
        ));
  }
  return {
    eventId: String(checklist.event.eventId),
    requestCount: projection.requests.length,
    exceptionCount: projection.exceptions.length,
    duplicateCount: results.filter((result) => result.duplicate).length,
  };
}

export function vipBookedFoodQuantities(checklist: KitchenChecklist) {
  const quantities = new Map<string, number>();
  for (const selection of checklist.normalizedSelections) {
    if (typeof selection.sourceId !== "string" ||
        !selection.sourceId.startsWith("vip-prep:")) continue;
    const code = selection.sourceId.split(":").at(-1) ?? "";
    const rowKey = KITCHEN_ROW_KEY_BY_VIP_CODE[code];
    if (!rowKey || !Number.isSafeInteger(selection.quantity) || selection.quantity < 1) {
      continue;
    }
    quantities.set(rowKey, (quantities.get(rowKey) ?? 0) + selection.quantity);
  }
  return quantities;
}

export async function synchronizeVipBookingFoodToEventFood(
  checklist: KitchenChecklist,
  options: {
    storage?: VipBookingFoodSyncStorage;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const bookedFoodQuantities = vipBookedFoodQuantities(checklist);
  const eventId = String(checklist.event.eventId);
  const storage = options.storage ?? new GoTabIntegrationStorage();
  const previous = await storage.listVipBookingFoodRequests(eventId);
  const existingByKey = new Map(previous.map((item) => [item.source_record_id, item]));
  const newFoodQuantities = new Map<string, number>();
  const reviewExceptions: Array<{ itemKey: string; foodName: string; reason: string }> = [];
  for (const [key, quantity] of bookedFoodQuantities) {
    const prior = existingByKey.get(key);
    const row = checklist.sections.flatMap((section) => section.rows)
      .find((item) => item.key === key);
    if (!row) continue;
    const panSize = row.panSize === "1/3" ? "THIRD_PAN" :
      row.panSize === "1/2" ? "HALF_PAN" : "TRAY";
    if (!prior) {
      newFoodQuantities.set(key, quantity);
    } else if (prior.quantity !== quantity || prior.pan_size !== panSize) {
      reviewExceptions.push({
        itemKey: key,
        foodName: row.foodName,
        reason: "VIP booking food changed after its GoTab order was queued; review and correct the existing KDS order.",
      });
    }
  }
  for (const prior of previous) {
    if (!bookedFoodQuantities.has(prior.source_record_id)) {
      reviewExceptions.push({
        itemKey: prior.source_record_id,
        foodName: prior.source_record_id,
        reason: "VIP booking food was removed after its GoTab order was queued; review and correct the existing KDS order.",
      });
    }
  }
  if (reviewExceptions.length) {
    for (const prior of previous) {
      if (!reviewExceptions.some((item) => item.itemKey === prior.source_record_id)) continue;
      if (!["SCHEDULED", "QUEUED_FOR_KITCHEN", "FAILED"].includes(prior.dispatch_status)) continue;
      await storage.performAdministrativeAction({
        requestId: prior.id,
        action: "HOLD",
        actor: "VIP_BOOKING_SYNC",
        reason: "VIP booking food changed before KDS dispatch; staff must review the corrected order.",
      });
    }
    await storage.saveProjectionExceptions({
      eventId,
      sourceType: "VIP_ADDON",
      sourceVersion: 1,
      exceptions: reviewExceptions,
    });
  }
  if (newFoodQuantities.size === 0) {
    return { eventId, requestCount: 0, exceptionCount: reviewExceptions.length, duplicateCount: 0 };
  }
  const result = await synchronizeKitchenChecklistToEventFood(checklist, {
    // A booking's food rows are queued once. Later edits need a reviewed
    // correction so a repeat sync cannot send a second full order.
    sourceVersion: 1,
    sourceType: "VIP_ADDON",
    actor: "VIP_BOOKING_SYNC",
    bookedFoodQuantities: newFoodQuantities,
    storage,
    env: options.env,
  });
  return { ...result, exceptionCount: result.exceptionCount + reviewExceptions.length };
}

export async function synchronizeKitchenLiveAddOnsToEventFood(
  checklist: KitchenChecklist,
  options: {
    sourceVersion: number;
    changedSourceKeys: readonly string[];
    sourceType?: EventFoodSourceType;
    actor?: string;
    storage?: EventFoodSyncStorage;
    env?: Readonly<Record<string, string | undefined>>;
    dispatchImmediately?: boolean;
  },
) {
  const changedItemKeys = new Set(
    options.changedSourceKeys.map((key) => `addon:${key}`),
  );
  const addOnOnlyChecklist: KitchenChecklist = {
    ...checklist,
    sections: [],
    liveFoodAddOns: checklist.liveFoodAddOns.filter((item) =>
      changedItemKeys.has(item.itemKey),
    ),
  };
  return synchronizeKitchenChecklistToEventFood(addOnOnlyChecklist, {
    sourceVersion: options.sourceVersion,
    sourceType: options.sourceType ?? (String(checklist.event.eventId).startsWith("vip-")
      ? "VIP_ADDON"
      : "EVENT_HOST_ADDON"),
    actor: options.actor ?? "EVENT_HOST_ADDON_SAVE",
    storage: options.storage,
    env: options.env,
    dispatchImmediately: options.dispatchImmediately ?? true,
  });
}
