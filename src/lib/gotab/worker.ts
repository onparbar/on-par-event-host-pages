import "server-only";

import { randomUUID } from "node:crypto";
import { GoTabClient, GoTabApiError } from "./client";
import { getGoTabConfigurationStatus, requireGoTabConfiguration } from "./config";
import { GoTabIntegrationStorage } from "./storage";
import { VipPrepClient, vipPrepExternalId, vipPrepKitchenEvents, isActiveVipPrepReservation, KITCHEN_ROW_KEY_BY_VIP_CODE } from "@/lib/vip-prep/client";
import { vipKdsTestReservation } from "@/lib/vip-checkin/test-reservation";
import { readVipInitialFoodSnapshot, vipInitialFoodSnapshot, vipReleaseFingerprint } from "@/lib/vip-checkin/release-snapshot";
import { generateKitchenChecklist } from "@/lib/kitchen/rules";
import { zonedDateTimeToIso } from "@/lib/entertainment/time";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";

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
  requestIds?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  vipPrepClient?: Pick<VipPrepClient, "configured" | "fetchRange">;
}): Promise<GoTabWorkerSummary> {
  if (isPreviewReviewOnly(options?.env)) return {
    claimed: 0, dryRunCompleted: 0, held: 0, liveDispatchBlocked: 0, sent: 0, failed: 0,
    lastError: "Read-only Preview: dispatch processing is disabled. No requests were claimed or modified.",
  };
  const storage = options?.storage ?? new GoTabIntegrationStorage();
  const configuration = getGoTabConfigurationStatus(options?.env);
  const workerId = options?.workerId ?? `vercel-${randomUUID()}`;
  const limit = options?.limit ?? (options?.requestIds?.length || 25);
  const dispatches = options?.requestIds !== undefined
    ? await storage.claimDueDispatches(workerId, limit, options.requestIds)
    : await storage.claimDueDispatches(workerId, limit);
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
    let eventId: string;
    try {
      const context = await storage.getDispatchRequestContext(dispatch.request_id);
      if (!context) throw new Error("The saved food request was not found.");
      eventId = context.event_id;
      if (context.source_type === "TRIPLESEAT_CONTRACT") {
        const decision = await storage.getContractFoodDispatchDecision({
          requestId: dispatch.request_id,
          eventId: context.event_id,
          sourceRecordId: context.source_record_id,
        });
        if (!decision.allowed) {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: decision.reason === "ALREADY_SENT"
              ? "Duplicate contract order blocked because this event item was already sent to GoTab."
              : "Duplicate contract order blocked because an earlier request owns this event item.",
          });
          summary.held += 1;
          continue;
        }
      }
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
        const reservation = isActiveTest ? testReservation : current?.reservations.find((candidate) => candidate.id === checkin.reservation_id && isActiveVipPrepReservation(candidate));
        if (!reservation) {
          await storage.finishDispatch(dispatch.id, {
            status: "HELD",
            lastError: "VIP reservation is cancelled or no longer active.",
          });
          summary.held += 1;
          continue;
        }
        if (vipPrepExternalId(reservation) !== context.event_id || reservation.operatingDate !== checkin.booking_date ||
            !checkin.employee_name?.trim() || !Number.isFinite(Date.parse(checkin.checked_in_at))) {
          await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "Valid Event Host staff check-in evidence is required for this booking." });
          summary.held += 1;
          continue;
        }
        if (!context.source_record_id.startsWith("addon:")) {
          const payload = dispatch.sanitized_payload ?? {};
          const purchasedQuantity = reservation.foodPrep.filter((item) => KITCHEN_ROW_KEY_BY_VIP_CODE[item.code] === context.source_record_id)
            .reduce((sum, item) => sum + item.quantity, 0);
          if (!purchasedQuantity || payload.quantity !== purchasedQuantity) {
            await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "VIP food request quantity does not match the current purchased preorder. Review the saved item; no food was sent." });
            summary.held += 1;
            continue;
          }
          let snapshot = readVipInitialFoodSnapshot(payload.vipReleaseSnapshot);
          if (!snapshot) {
            // Legacy evidence is safe only when the complete purchased set,
            // not just this item, still matches the saved initial requests.
            const purchased = new Map<string, number>();
            for (const item of reservation.foodPrep) {
              const key = KITCHEN_ROW_KEY_BY_VIP_CODE[item.code];
              if (key) purchased.set(key, (purchased.get(key) ?? 0) + item.quantity);
            }
            const previous = await storage.listVipBookingFoodRequests(context.event_id);
            const completeSet = reservation.foodPrep.every((item) => Boolean(KITCHEN_ROW_KEY_BY_VIP_CODE[item.code])) &&
              purchased.size === release.expected_item_count && previous.length === purchased.size &&
              new Set(previous.map((item) => item.source_record_id)).size === previous.length &&
              previous.every((item) => Number.isSafeInteger(item.quantity) && item.quantity > 0 && purchased.get(item.source_record_id) === item.quantity);
            if (!completeSet) {
              await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "The complete legacy VIP preorder cannot be verified against its saved initial requests. Use correction/additional-order review; no food was sent." });
              summary.held += 1;
              continue;
            }
            const checklist = generateKitchenChecklist(vipPrepKitchenEvents([reservation])[0]);
            const ready = checklist.timing.foodReadyBy?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
            const foodServiceAt = ready ? zonedDateTimeToIso(ready[1], Number(ready[2]), Number(ready[3])) : null;
            if (payload.eventArea !== reservation.resource.name || !foodServiceAt ||
                Date.parse(foodServiceAt) !== Date.parse(context.food_service_time)) {
              await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "The legacy VIP food request does not match the current preorder. Use correction/additional-order review; no food was sent." });
              summary.held += 1;
              continue;
            }
            snapshot = vipInitialFoodSnapshot(reservation, checkin);
            if (!await storage.saveVipDispatchReleaseSnapshot(dispatch.id, payload, snapshot)) {
              await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "VIP release evidence could not be saved under the dispatch claim. No food was sent." });
              summary.held += 1;
              continue;
            }
          }
          if (snapshot.reservationId !== reservation.id || snapshot.bookingDate !== checkin.booking_date ||
              snapshot.checkedInBy !== checkin.employee_name || snapshot.checkedInAt !== checkin.checked_in_at ||
              snapshot.sourceFingerprint !== vipReleaseFingerprint(reservation)) {
            await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "VIP booking or preorder changed after initial release. Use the correction/additional-order workflow; no food was sent." });
            summary.held += 1;
            continue;
          }
          const initialDispatches = await storage.listVipInitialFoodDispatches(context.event_id);
          if (initialDispatches.some((row) => row.source_fingerprint && row.source_fingerprint !== snapshot.sourceFingerprint)) {
            await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "VIP initial food requests contain different preorder revisions. Use correction/additional-order review; no food was sent." });
            summary.held += 1;
            continue;
          }
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
    const selectedPanSize = payload?.selectedPanSize === "1/3" || payload?.selectedPanSize === "1/2"
      ? payload.selectedPanSize
      : null;
    const sourceType = typeof payload?.requestType === "string" ? payload.requestType : undefined;
    if (!ticketName || !productUuid || !product || !Number.isSafeInteger(quantity) || quantity < 1) {
      await storage.finishDispatch(dispatch.id, { status: "HELD", lastError: "The saved Event Food payload is incomplete." });
      summary.held += 1;
      continue;
    }
    let foodRunner: string | null;
    let accepted: Awaited<ReturnType<GoTabClient["createEventFoodTab"]>> | null = null;
    try {
      // Staff may be assigned after this order was queued. Never use a stale POC
      // or requester snapshot as the Food Runner on the ticket.
      foodRunner = await storage.getKitchenFoodRunner(eventId);
    } catch {
      const lastError = "The current Kitchen Food Runner could not be read. No order was sent.";
      await storage.finishDispatch(dispatch.id, {
        status: "FAILED",
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        lastError,
      });
      summary.failed += 1;
      summary.lastError = lastError;
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
        serverName: foodRunner,
        selectedPanSize,
        sourceType: sourceType as "EVENT_HOST_ADDON" | "REFILL" | "VIP_ADDON" | "TRIPLESEAT_CONTRACT" | "CORRECTION" | "CANCELLATION" | undefined,
      });
      accepted = result;
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
      // A timeout or server error after the POST can hide an accepted order.
      // External-ID deduplication is not verified, so never blindly replay it.
      const lastError = accepted ? "GoTab accepted this order, but saving its final delivery status failed. Delivery status is uncertain. Review the saved GoTab order before retrying."
        : temporary
        ? vipDispatch
          ? "VIP delivery status is uncertain. Review before retrying."
          : "Food order delivery status is uncertain. Review before retrying."
        : errorMessage;
      await storage.finishDispatch(dispatch.id, {
        status: "HELD",
        lastError,
        ...(accepted ? { tabUuid: accepted.tabUuid, orderUuid: accepted.orderUuid, itemUuid: accepted.itemUuid,
          sanitizedResponse: { accepted: true, finalStatusSaveFailed: true } } : {}),
      });
      summary.lastError = lastError;
      summary.held += 1;
    }
  }

  return summary;
}
