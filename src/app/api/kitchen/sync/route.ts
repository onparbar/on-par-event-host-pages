import { NextResponse } from "next/server";
import {
  assertKitchenDate,
  KitchenSyncError,
  syncKitchenDay,
} from "@/lib/kitchen/sync";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SyncRequest = {
  date?: unknown;
};

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }

  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid kitchen sync payload." },
      { status: 400 },
    );
  }

  const date = typeof body.date === "string" ? body.date : "";
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json(
      { error: "Sync date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const payload = await syncKitchenDay(date);
    if (process.env.EVENT_KDS_DRY_RUN?.trim()) {
      try {
        const [{ getGoTabConfigurationStatus }, integration] = await Promise.all([
          import("@/lib/gotab/config"),
          import("@/lib/gotab/sync-event-food"),
        ]);
        if (getGoTabConfigurationStatus().configured) {
          for (const checklist of payload.events) {
            await integration.synchronizeKitchenChecklistToEventFood(checklist, {
              sourceVersion: integration.eventFoodSourceVersion(checklist),
              actor: "TRIPLESEAT_SYNC",
            });
          }
        }
      } catch {
        payload.warnings.push(
          "Event Food dry-run projection could not be saved. Kitchen synchronization still completed.",
        );
      }
    }
    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof KitchenSyncError
        ? error.message
        : "Kitchen synchronization failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
