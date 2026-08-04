import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  updateKitchenItemCompletion,
  updateKitchenItemReadiness,
} from "@/lib/kitchen/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ItemStateRequest = {
  ready?: unknown;
  completed?: unknown;
};

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ eventId: string; itemKey: string }>;
  },
) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
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
  const hasCompleted = Object.hasOwn(body, "completed");
  if (hasReady === hasCompleted) {
    return NextResponse.json(
      { error: "Provide exactly one of ready or completed." },
      { status: 400 },
    );
  }
  if (
    (hasReady && typeof body.ready !== "boolean") ||
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
