import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { updateKitchenManualAssignments } from "@/lib/kitchen/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ManualRequest = {
  foodRunners?: unknown;
  pocs?: unknown;
};

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
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
    !body.pocs.every((value) => typeof value === "string")
  ) {
    return NextResponse.json(
      { error: "Food Runner and POC must be lists of employee names." },
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
