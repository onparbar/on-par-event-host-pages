import { NextResponse } from "next/server";
import { updateKitchenManualAssignments } from "@/lib/kitchen/sync";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ManualRequest = {
  foodRunners?: unknown;
  pocs?: unknown;
  preppedBy?: unknown;
  verifiedBy?: unknown;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }

  let body: ManualRequest;
  try {
    body = (await request.json()) as ManualRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid manual kitchen field payload." },
      { status: 400 },
    );
  }
  if (
    !Array.isArray(body.foodRunners) ||
    !body.foodRunners.every((value) => typeof value === "string") ||
    !Array.isArray(body.pocs) ||
    !body.pocs.every((value) => typeof value === "string") ||
    typeof body.preppedBy !== "string" ||
    typeof body.verifiedBy !== "string"
  ) {
    return NextResponse.json(
      { error: "Kitchen staff selections are invalid." },
      { status: 400 },
    );
  }

  try {
    const { eventId } = await context.params;
    return NextResponse.json(
      await updateKitchenManualAssignments(
        eventId,
        body.foodRunners,
        body.pocs,
        {},
        body.preppedBy,
        body.verifiedBy,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save Food Runner and POC.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
