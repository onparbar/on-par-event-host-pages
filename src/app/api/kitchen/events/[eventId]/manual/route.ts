import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { updateKitchenManualBwa } from "@/lib/kitchen/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ManualRequest = {
  bwa?: unknown;
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
  if (typeof body.bwa !== "string") {
    return NextResponse.json(
      { error: "Food Runner or BWA must be a string." },
      { status: 400 },
    );
  }

  try {
    const { eventId } = await context.params;
    return NextResponse.json(
      await updateKitchenManualBwa(eventId, body.bwa),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save Food Runner or BWA.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
