import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  approveFloorPlan,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanSources,
  saveFloorPlanEdits,
  validateAndSaveFloorPlan,
} from "@/lib/floor-plans/service";
import type { FloorPlanGenerationMode } from "@/lib/floor-plans/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json(
    { error: "Event Host floor-plan access required." },
    { status: 401 },
  );
}

function safeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to update the floor plan.";
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  if (!hasAdminSession(await cookies())) return unauthorized();
  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    return NextResponse.json(await getFloorPlanDay(date));
  } catch (error) {
    return safeError(error);
  }
}

export async function POST(request: Request) {
  if (!hasAdminSession(await cookies())) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid floor-plan request payload." },
      { status: 400 },
    );
  }
  const date = typeof body.date === "string" ? body.date : "";
  const action = typeof body.action === "string" ? body.action : "";
  try {
    if (action === "refresh") return NextResponse.json(await refreshFloorPlanSources(date));
    if (action === "generate") {
      const mode = body.mode as FloorPlanGenerationMode;
      if (!["fill-missing", "replace-generated", "reset-event"].includes(mode)) {
        throw new Error("Choose how generated reservations should be replaced.");
      }
      return NextResponse.json(await generateFloorPlan(date, mode));
    }
    if (action === "save") {
      return NextResponse.json(await saveFloorPlanEdits(date, body.plan));
    }
    if (action === "validate") {
      return NextResponse.json(await validateAndSaveFloorPlan(date));
    }
    if (action === "approve") {
      return NextResponse.json(
        await approveFloorPlan(date, body.acknowledgeWarnings === true),
      );
    }
    throw new Error("Unknown floor-plan action.");
  } catch (error) {
    return safeError(error);
  }
}
