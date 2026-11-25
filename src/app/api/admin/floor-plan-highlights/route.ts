import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { isSameOriginOperationalRequest } from "@/lib/operational-access";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { FloorPlanHighlightValidationError } from "@/lib/floor-plans/day-highlights";
import { loadFloorPlanHighlights, saveFloorPlanHighlights } from "@/lib/floor-plans/day-highlights-storage";
import { StaleSaveError } from "@/lib/stale-save";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0", vary: "Cookie" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });

function failure(cause: unknown) {
  if (cause instanceof FloorPlanHighlightValidationError) return error(cause.message, 400);
  if (cause instanceof StaleSaveError) return error("Another Admin saved changes. Reload and review before saving highlights again.", 409);
  return error("Special-event highlights are unavailable. No changes were saved.", 503);
}

export async function GET(request: Request) {
  if (!hasAdminSession(await cookies())) return error("Admin session required.", 401);
  try {
    const date = new URL(request.url).searchParams.get("date") ?? "";
    return NextResponse.json(await loadFloorPlanHighlights(date), { headers });
  } catch (cause) { return failure(cause); }
}

export async function PUT(request: Request) {
  if (isPreviewReviewOnly()) return error("This Preview is read-only. No highlights were saved.", 403);
  if (!isSameOriginOperationalRequest(request)) return error("This action must come from Event Host.", 403);
  if (!hasAdminSession(await cookies())) return error("Admin session required.", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.date !== "string") return error("Choose a valid floor-plan date and highlights.", 400);
  try {
    return NextResponse.json(await saveFloorPlanHighlights({ date: body.date, highlights: body.highlights,
      expectedUpdatedAt: body.expectedUpdatedAt as string | null }), { headers });
  } catch (cause) { return failure(cause); }
}
