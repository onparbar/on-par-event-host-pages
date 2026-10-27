import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processGoTabDispatches } from "@/lib/gotab/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function equalSecret(candidate: string, expected: string) {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(
    secret &&
    authorization.startsWith("Bearer ") &&
    equalSecret(authorization.slice("Bearer ".length), secret),
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    // Arrival creates VIP initial orders once. Reconciliation only processes
    // existing scheduled requests; source amendments need deliberate correction.
    return NextResponse.json({
      ...(await processGoTabDispatches()),
      vipBookingFood: { queued: 0, exceptions: 0, warning: null },
    });
  } catch {
    return NextResponse.json(
      { error: "GoTab reconciliation could not complete." },
      { status: 503 },
    );
  }
}
