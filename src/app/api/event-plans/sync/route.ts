import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { syncRollingEventPlans } from "@/lib/event-plans/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function safeSecretEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  return (
    Boolean(secret) &&
    authorization.startsWith("Bearer ") &&
    safeSecretEqual(authorization.slice("Bearer ".length), secret!)
  );
}

function unauthorized() {
  return NextResponse.json(
    { error: "Event-plan sync authorization required." },
    { status: 401 },
  );
}

async function runSync() {
  try {
    const result = await syncRollingEventPlans();
    return NextResponse.json({
      sourceMode: result.sourceMode,
      eventCount: result.plans.length,
      sync: result.sync,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Event-plan synchronization failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return unauthorized();
  }
  return runSync();
}

export async function POST() {
  if (!hasAdminSession(await cookies())) {
    return unauthorized();
  }
  return runSync();
}
