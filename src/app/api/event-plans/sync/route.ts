import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { syncRollingEventPlans } from "@/lib/event-plans/sync";
import {
  ensureConfirmedContractFloorPlanWindow,
  maintainTwoWeekFloorPlanHorizon,
} from "@/lib/floor-plans/service";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";

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
  let result: Awaited<ReturnType<typeof syncRollingEventPlans>> | null = null;
  let syncError: string | null = null;
  try {
    result = await syncRollingEventPlans();
  } catch (error) {
    syncError =
      error instanceof Error
        ? error.message
        : "Event-plan synchronization failed.";
  }

  try {
    if (!result) {
      const floorPlans = await ensureConfirmedContractFloorPlanWindow(
        todayInEntertainmentTimeZone(),
      );
      const confirmedResult = floorPlans.results.find(
        (entry) =>
          entry.date === "2026-08-21" &&
          entry.status !== "error" &&
          entry.eventCount > 0,
      );
      if (!confirmedResult) {
        return NextResponse.json(
          {
            error: syncError ?? "Event-plan synchronization failed.",
            floorPlans,
          },
          { status: 502 },
        );
      }
      return NextResponse.json({
        sourceMode: "contract-evidence",
        eventCount: confirmedResult.eventCount,
        sync: null,
        floorPlans,
        warning:
          "Tripleseat could not refresh. Confirmed contract evidence was applied, and the last saved Tripleseat data remains unchanged.",
      });
    }
    const floorPlans = await maintainTwoWeekFloorPlanHorizon();
    return NextResponse.json({
      sourceMode: result.sourceMode,
      eventCount: result.plans.length,
      sync: result.sync,
      floorPlans,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : syncError ?? "Event-plan synchronization failed.";
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
