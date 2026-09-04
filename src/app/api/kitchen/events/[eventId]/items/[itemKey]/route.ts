import { NextResponse } from "next/server";
import {
  updateKitchenItemCompletion,
  updateKitchenItemPrepped,
  updateKitchenItemReadiness,
} from "@/lib/kitchen/sync";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemStateRequest = {
  ready?: unknown;
  prepped?: unknown;
  preppedBy?: unknown;
  completed?: unknown;
};

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ eventId: string; itemKey: string }>;
  },
) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }

  let body: ItemStateRequest;
  try {
    body = (await request.json()) as ItemStateRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid kitchen item readiness payload." },
      { status: 400 },
    );
  }
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return NextResponse.json(
      { error: "Invalid kitchen item state payload." },
      { status: 400 },
    );
  }
  const hasReady = Object.hasOwn(body, "ready");
  const hasPrepped = Object.hasOwn(body, "prepped");
  const hasCompleted = Object.hasOwn(body, "completed");
  if (Number(hasReady) + Number(hasPrepped) + Number(hasCompleted) !== 1) {
    return NextResponse.json(
      { error: "Provide exactly one of ready, prepped, or completed." },
      { status: 400 },
    );
  }
  if (
    (hasReady && typeof body.ready !== "boolean") ||
    (hasPrepped && typeof body.prepped !== "boolean") ||
    (hasPrepped &&
      body.prepped === true &&
      typeof body.preppedBy !== "string") ||
    (hasPrepped &&
      Object.hasOwn(body, "preppedBy") &&
      typeof body.preppedBy !== "string") ||
    (hasCompleted && typeof body.completed !== "boolean")
  ) {
    return NextResponse.json(
      { error: "Kitchen item state must be a boolean." },
      { status: 400 },
    );
  }

  try {
    const { eventId, itemKey } = await context.params;
    return NextResponse.json(
      hasReady
        ? await updateKitchenItemReadiness(
            eventId,
            itemKey,
            body.ready as boolean,
          )
        : hasPrepped
          ? await updateKitchenItemPrepped(
              eventId,
              itemKey,
              body.prepped as boolean,
              typeof body.preppedBy === "string" ? body.preppedBy : null,
            )
          : await updateKitchenItemCompletion(
            eventId,
            itemKey,
            body.completed as boolean,
          ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save kitchen item readiness.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
