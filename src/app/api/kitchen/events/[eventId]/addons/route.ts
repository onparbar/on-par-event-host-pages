import { NextResponse } from "next/server";
import {
  getKitchenEventChecklist,
  getKitchenEventFoodAddOns,
  updateKitchenEventFoodAddOns,
} from "@/lib/kitchen/sync";
import { KitchenFoodAddOnConflictError } from "@/lib/kitchen/storage";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FoodAddOnRequest = {
  food?: unknown;
  expectedRevision?: unknown;
};

function errorResponse(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Unable to access kitchen food add-ons.";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    return NextResponse.json(await getKitchenEventFoodAddOns(eventId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }

  let body: FoodAddOnRequest;
  try {
    body = (await request.json()) as FoodAddOnRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid kitchen food add-on payload." },
      { status: 400 },
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !Object.hasOwn(body, "expectedRevision")
  ) {
    return NextResponse.json(
      { error: "Kitchen food add-on revision is required." },
      { status: 400 },
    );
  }

  const { eventId } = await context.params;
  try {
    const previous = await getKitchenEventFoodAddOns(eventId);
    const saved = await updateKitchenEventFoodAddOns(eventId, body.food, {
      expectedRevision: body.expectedRevision,
    });
    const previousFood = previous.food as Record<string, unknown>;
    const savedFood = saved.food as Record<string, unknown>;
    const changedSourceKeys = [...new Set([
      ...Object.keys(previousFood),
      ...Object.keys(savedFood),
    ])].filter(
      (key) =>
        JSON.stringify(previousFood[key] ?? null) !==
        JSON.stringify(savedFood[key] ?? null),
    );
    let kds: Record<string, unknown> = {
      queued: 0,
      changedSourceKeys,
    };
    if (changedSourceKeys.length > 0) {
      try {
        const [{ synchronizeKitchenLiveAddOnsToEventFood }, { processGoTabDispatches }] =
          await Promise.all([
            import("@/lib/gotab/sync-event-food"),
            import("@/lib/gotab/worker"),
          ]);
        const checklist = await getKitchenEventChecklist(eventId);
        const synchronization = await synchronizeKitchenLiveAddOnsToEventFood(
          checklist,
          {
            sourceVersion: saved.revision,
            changedSourceKeys,
          },
        );
        const dispatch = await processGoTabDispatches();
        kds = {
          queued: synchronization.requestCount,
          exceptions: synchronization.exceptionCount,
          duplicates: synchronization.duplicateCount,
          dispatch,
          changedSourceKeys,
        };
      } catch {
        kds = {
          queued: 0,
          changedSourceKeys,
          warning:
            "The add-on was saved, but its GoTab KDS dispatch could not be completed.",
        };
      }
    }
    return NextResponse.json({ ...saved, kds });
  } catch (error) {
    if (error instanceof KitchenFoodAddOnConflictError) {
      const current = await getKitchenEventFoodAddOns(eventId);
      return NextResponse.json(
        {
          ...current,
          error:
            "Another staff member updated this event. Reload the latest add-ons before saving.",
        },
        { status: 409 },
      );
    }
    return errorResponse(error);
  }
}
