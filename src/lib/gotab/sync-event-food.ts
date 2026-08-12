import "server-only";

import { createHash } from "node:crypto";
import type { KitchenChecklist } from "@/lib/kitchen/types";
import { getGoTabConfigurationStatus } from "./config";
import { buildGoTabKdsPreview, type EventFoodProductMapping, type EventFoodSourceType } from "./event-food";
import { projectKitchenChecklist } from "./project-kitchen";
import { GoTabIntegrationStorage } from "./storage";

type EventFoodSyncStorage = Pick<
  GoTabIntegrationStorage,
  "listMappings" | "saveProjectionExceptions" | "enqueueRequest"
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
    defaultPrepLeadMinutes: configuration.defaultPrepLeadMinutes ?? 60,
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
    results.push(await storage.enqueueRequest(
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
