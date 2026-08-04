import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  getKitchenEventFoodAddOns,
  updateKitchenEventFoodAddOns,
} from "@/lib/kitchen/sync";
import { KitchenFoodAddOnConflictError } from "@/lib/kitchen/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FoodAddOnRequest = {
  food?: unknown;
  expectedRevision?: unknown;
};

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

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
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

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
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
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
    return NextResponse.json(
      await updateKitchenEventFoodAddOns(eventId, body.food, {
        expectedRevision: body.expectedRevision,
      }),
    );
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
