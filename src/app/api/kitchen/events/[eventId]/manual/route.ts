import { NextResponse } from "next/server";
import { updateKitchenManualAssignments } from "@/lib/kitchen/sync";
import { KitchenStaffAssignmentConflictError } from "@/lib/kitchen/storage";
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
  setup?: unknown;
  expectedUpdatedAt?: unknown;
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
    !body || typeof body !== "object" ||
    !Object.hasOwn(body, "expectedUpdatedAt") ||
    (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== "string") ||
    !Array.isArray(body.foodRunners) ||
    !body.foodRunners.every((value) => typeof value === "string") ||
    !Array.isArray(body.pocs) ||
    !body.pocs.every((value) => typeof value === "string") ||
    typeof body.preppedBy !== "string" ||
    typeof body.verifiedBy !== "string" ||
    (body.setup !== undefined &&
      (!Array.isArray(body.setup) ||
        !body.setup.every((value) => typeof value === "string")))
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
        body.setup ?? [],
        body.expectedUpdatedAt as string | null,
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save Food Runner and POC.";
    return NextResponse.json({ error: message }, { status: error instanceof KitchenStaffAssignmentConflictError ? 409 : 400 });
  }
}
