import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { syncRollingEventPlans } from "@/lib/event-plans/sync";
import { syncEntertainmentDay } from "@/lib/entertainment/sync";
import {
  ensureConfirmedContractFloorPlanWindow,
  maintainTwoWeekFloorPlanHorizon,
} from "@/lib/floor-plans/service";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";

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
    const warnings = floorPlans.results.flatMap((entry) => [
      ...(entry.status === "error" ? [`${entry.date}: ${entry.message ?? "Floor plans could not refresh."}`] : []),
      ...(entry.warnings ?? []).map((warning) => `${entry.date}: ${warning}`),
    ]);
    const entertainment: Array<{ date: string; status: "success" | "error"; conflictsFound?: number; message?: string }> = [];
    const sourceWindow = result.sync;
    const remainingDates = sourceWindow ? [...new Set(result.plans.map((plan) => plan.date))].filter(
      (date) => date >= sourceWindow.windowStart && date <= sourceWindow.windowEnd &&
        (date < floorPlans.startDate || date > floorPlans.endDate),
    ).sort() : [];
    for (const date of remainingDates) {
      try {
        const day = await syncEntertainmentDay(date);
        entertainment.push({ date, status: "success", conflictsFound: day.conflicts.length });
        if (day.conflicts.length) {
          warnings.push(`${date}: ${day.conflicts.length} entertainment resource conflict${day.conflicts.length === 1 ? " requires" : "s require"} review.`);
        }
      } catch {
        const message = "Entertainment could not refresh; its last saved reservations remain in effect.";
        entertainment.push({ date, status: "error", message });
        warnings.push(`${date}: ${message}`);
      }
    }
    return NextResponse.json({
      sourceMode: result.sourceMode,
      eventCount: result.plans.length,
      sync: result.sync,
      floorPlans,
      entertainment,
      ...(warnings.length ? { warning: warnings.join(" ") } : {}),
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

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }
  return runSync();
}
