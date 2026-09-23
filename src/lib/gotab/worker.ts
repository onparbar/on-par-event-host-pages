import "server-only";

import { randomUUID } from "node:crypto";
import { GoTabClient, GoTabApiError } from "./client";
import { getGoTabConfigurationStatus, requireGoTabConfiguration } from "./config";
import { GoTabIntegrationStorage } from "./storage";
import { VipPrepClient, vipPrepExternalId } from "@/lib/vip-prep/client";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";

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
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
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
  const vipPrepClient = options?.vipPrepClient ?? new VipPrepClient();

  for (const dispatch of dispatches) {
    let vipDispatch = false;
    try {
      const context = await storage.getDispatchRequestContext(dispatch.request_id);
      if (!context) throw new Error("The saved food request was not found.");
      vipDispatch = context.event_id.startsWith("vip-");
      if (vipDispatch) {
        const checkin = await storage.getVipCheckin(context.event_id);
        if (!checkin) {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP check-in required.",
          });
          summary.held += 1;
          continue;
        }
        const release = await storage.getVipInitialFoodRelease(context.event_id);
        if (!release) {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP food release record is missing.",
          });
          summary.held += 1;
          continue;
        }
        if (!context.source_record_id.startsWith("addon:") && release.status === "NO_FOOD") {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP booking has no initial food items.",
          });
          summary.held += 1;
          continue;
        }
        if (!context.source_record_id.startsWith("addon:") && release.status === "FAILED") {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP initial food order needs staff review.",
          });
          summary.held += 1;
          continue;
        }
        const testReservation = vipKdsTestReservation(checkin.booking_date);
        const isActiveTest = testReservation?.id === checkin.reservation_id &&
          vipPrepExternalId(testReservation) === context.event_id;
        if (!isActiveTest && !vipPrepClient.configured) throw new Error("VIP reservation status is unavailable.");
        const current = isActiveTest ? null : await vipPrepClient.fetchRange(checkin.booking_date, checkin.booking_date);
        if (!isActiveTest && !current?.reservations.some((reservation) => reservation.id === checkin.reservation_id)) {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP reservation is cancelled or no longer active.",
          });
          summary.held += 1;
          continue;
        }
      }
    } catch {
      await storage.finishDispatch(dispatch.id, {
        status: "FAILED",
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        lastError: "Food dispatch eligibility could not be verified.",
      });
      summary.failed += 1;
      summary.lastError = "Food dispatch eligibility could not be verified.";
      continue;
    }

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
    const ticketName = typeof payload?.eventName === "string"
      ? payload.eventName
      : typeof payload?.ticketName === "string" ? payload.ticketName : "";
    const productUuid = typeof payload?.gotabProductUuid === "string" ? payload.gotabProductUuid : "";
    const product = typeof payload?.product === "string" ? payload.product : "";
    const quantity = typeof payload?.quantity === "number" ? payload.quantity : 0;
    const requesterName = typeof payload?.requesterName === "string" ? payload.requesterName : null;
    const selectedPanSize = payload?.selectedPanSize === "1/3" || payload?.selectedPanSize === "1/2"
      ? payload.selectedPanSize
      : null;
    const sourceType = typeof payload?.requestType === "string" ? payload.requestType : undefined;
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
        sourceType: sourceType as "EVENT_HOST_ADDON" | "REFILL" | "VIP_ADDON" | "TRIPLESEAT_CONTRACT" | "CORRECTION" | "CANCELLATION" | undefined,
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
        status: temporary && !vipDispatch ? "FAILED" : "HELD",
        nextAttemptAt: temporary && !vipDispatch && !exhausted
          ? new Date(Date.now() + Math.min(60_000 * 2 ** Math.max(0, dispatch.attempt_count - 1), 15 * 60_000)).toISOString()
          : undefined,
        lastError: vipDispatch && temporary
          ? "VIP delivery status is uncertain. Review before retrying."
          : errorMessage,
      });
      summary.lastError = vipDispatch && temporary
        ? "VIP delivery status is uncertain. Review before retrying."
        : errorMessage;
      if (temporary && !vipDispatch) summary.failed += 1;
      else summary.held += 1;
    }
  }

  return summary;
}
