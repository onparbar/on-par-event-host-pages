import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  isSameOriginOperationalRequest,
  operationalAccessDenied,
} from "@/lib/operational-access";
import {
  approveFloorPlan,
  generateFloorPlan,
  getFloorPlanDay,
  refreshFloorPlanEvent,
  refreshFloorPlanSources,
  saveFloorPlanEdits,
  validateAndSaveFloorPlan,
} from "@/lib/floor-plans/service";
import { staffFloorPlanPayload } from "@/lib/floor-plans/staff-publication";
import type { FloorPlanGenerationMode } from "@/lib/floor-plans/types";
import { StaleSaveError } from "@/lib/stale-save";

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
  return NextResponse.json({ error: message }, {
    status: error instanceof StaleSaveError ? 409 : 400,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  if (!hasAdminSession(await cookies())) return unauthorized();
  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    return NextResponse.json(await getFloorPlanDay(date), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return safeError(error);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOperationalRequest(request)) {
    return operationalAccessDenied();
  }
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
  const admin = hasAdminSession(await cookies());
  if (action !== "refresh" && !admin) {
    return unauthorized();
  }
  try {
    const expectedVersion = typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion) && body.expectedVersion >= 0 ? body.expectedVersion : undefined;
    if (["generate", "validate", "approve", "refresh-event"].includes(action) && expectedVersion === undefined) throw new Error("Load the reviewed floor-plan version before changing or approving it.");
    if (action === "refresh") {
      const payload = await refreshFloorPlanSources(date, undefined, expectedVersion);
      return NextResponse.json(admin ? payload : staffFloorPlanPayload(payload), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action === "refresh-event") {
      if (typeof body.selectedEventId !== "string" || !body.selectedEventId.trim()) throw new Error("Choose an event to refresh.");
      return NextResponse.json(await refreshFloorPlanEvent(date, body.selectedEventId.trim(), expectedVersion!), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action === "generate") {
      const mode = body.mode as FloorPlanGenerationMode;
      if (!["fill-missing", "replace-generated", "reset-event"].includes(mode)) {
        throw new Error("Choose how generated reservations should be replaced.");
      }
      if ("selectedEventId" in body && (typeof body.selectedEventId !== "string" || !body.selectedEventId.trim())) {
        throw new Error("Choose a valid selected event for event-only seating repair.");
      }
      const selectedEventId = typeof body.selectedEventId === "string" ? body.selectedEventId.trim() : undefined;
      return NextResponse.json(await generateFloorPlan(date, mode, undefined, expectedVersion, selectedEventId));
    }
    if (action === "save") {
      return NextResponse.json(await saveFloorPlanEdits(date, body.plan));
    }
    if (action === "validate") {
      return NextResponse.json(await validateAndSaveFloorPlan(date, undefined, expectedVersion));
    }
    if (action === "approve") {
      return NextResponse.json(
        await approveFloorPlan(date, body.acknowledgeWarnings === true, undefined, expectedVersion),
      );
    }
    throw new Error("Unknown floor-plan action.");
  } catch (error) {
    if (!admin) return NextResponse.json({ error: "The floor plan could not be refreshed. The saved plan is still available." },
      { status: error instanceof StaleSaveError ? 409 : 400, headers: { "Cache-Control": "private, no-store" } });
    return safeError(error);
  }
}
