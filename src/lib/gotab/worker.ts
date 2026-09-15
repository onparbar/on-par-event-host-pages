import "server-only";

import { randomUUID } from "node:crypto";
import { GoTabClient, GoTabApiError } from "./client";
import { getGoTabConfigurationStatus, requireGoTabConfiguration } from "./config";
import { GoTabIntegrationStorage } from "./storage";

export type GoTabWorkerSummary = {
  claimed: number;
  dryRunCompleted: number;
  held: number;
  liveDispatchBlocked: number;
  sent: number;
  failed: number;
  lastError: string | null;
};

export async function processGoTabDispatches(options?: {
  storage?: GoTabIntegrationStorage;
  client?: Pick<GoTabClient, "createEventFoodTab">;
  workerId?: string;
  limit?: number;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<GoTabWorkerSummary> {
  const storage = options?.storage ?? new GoTabIntegrationStorage();
  const configuration = getGoTabConfigurationStatus(options?.env);
  const workerId = options?.workerId ?? `vercel-${randomUUID()}`;
  const dispatches = await storage.claimDueDispatches(workerId, options?.limit ?? 25);
  const summary: GoTabWorkerSummary = {
    claimed: dispatches.length,
    dryRunCompleted: 0,
    held: 0,
    liveDispatchBlocked: 0,
    sent: 0,
    failed: 0,
    lastError: null,
  };
  let liveClient = options?.client ?? null;

  for (const dispatch of dispatches) {
    if (!configuration.configured || !configuration.enabled || configuration.dryRun) {
      await storage.finishDispatch(dispatch.id, {
        status: "DRY_RUN",
        sanitizedResponse: {
          mode: "DRY_RUN",
          processedAt: new Date().toISOString(),
          dispatchAllowed: configuration.dispatchAllowed,
          reason: !configuration.configured
            ? "GoTab configuration is incomplete."
            : !configuration.enabled
              ? "GoTab dispatch kill switch is disabled."
              : "GoTab dry-run mode is enabled.",
        },
      });
      summary.dryRunCompleted += 1;
      continue;
    }

    const payload = dispatch.sanitized_payload ?? {};
    const ticketName = typeof payload?.ticketName === "string" ? payload.ticketName : "";
    const productUuid = typeof payload?.gotabProductUuid === "string" ? payload.gotabProductUuid : "";
    const product = typeof payload?.product === "string" ? payload.product : "";
    const quantity = typeof payload?.quantity === "number" ? payload.quantity : 0;
    const requesterName = typeof payload?.requesterName === "string" ? payload.requesterName : null;
    const selectedPanSize = payload?.selectedPanSize === "1/3" || payload?.selectedPanSize === "1/2"
      ? payload.selectedPanSize
      : null;
    if (!ticketName || !productUuid || !product || !Number.isSafeInteger(quantity) || quantity < 1) {
      await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "The saved Event Food payload is incomplete." });
      summary.held += 1;
      continue;
    }
    try {
      liveClient ??= new GoTabClient(requireGoTabConfiguration(options?.env));
      const result = await liveClient.createEventFoodTab({
        externalId: dispatch.idempotency_key,
        ticketName,
        productUuid,
        quantity,
        itemName: product,
        itemNotes: payload,
        serverName: requesterName,
        selectedPanSize,
      });
      await storage.finishDispatch(dispatch.id, {
        status: "SENT",
        tabUuid: result.tabUuid,
        orderUuid: result.orderUuid,
        itemUuid: result.itemUuid,
        sanitizedResponse: { accepted: true, receivedIdentifiers: Boolean(result.tabUuid || result.orderUuid) },
      });
      summary.sent += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "GoTab dispatch failed.";
      const temporary = error instanceof GoTabApiError && error.kind === "temporary";
      const exhausted = dispatch.attempt_count >= 5;
      await storage.finishDispatch(dispatch.id, {
        status: temporary ? "FAILED" : "HELD",
        nextAttemptAt: temporary && !exhausted
          ? new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(0, dispatch.attempt_count - 1), 15 * 60_000)).toISOString()
          : undefined,
        lastError: errorMessage,
      });
      summary.lastError = errorMessage;
      if (temporary) summary.failed += 1;
      else summary.held += 1;
    }
  }

  return summary;
}
