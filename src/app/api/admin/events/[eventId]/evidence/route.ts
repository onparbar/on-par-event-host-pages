import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { loadAdminContractEvidence } from "@/lib/admin-operations-loader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  vary: "Cookie",
};

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (!hasAdminSession(await cookies())) {
    return NextResponse.json(
      { error: "Admin session required." },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { eventId: requestedEventId } = await context.params;
  if (!/^[1-9]\d{0,15}$/.test(requestedEventId)) {
    return NextResponse.json(
      { error: "Event ID is invalid." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const eventId = Number(requestedEventId);
  if (!Number.isSafeInteger(eventId)) {
    return NextResponse.json(
      { error: "Event ID is invalid." },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const evidence = await loadAdminContractEvidence(eventId);
    if (!evidence) {
      return NextResponse.json(
        { error: "Contract evidence was not found for this event." },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(evidence, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Contract evidence is temporarily unavailable." },
      { status: 502, headers: PRIVATE_HEADERS },
    );
  }
}
