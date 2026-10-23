import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import { isSameOriginOperationalRequest, operationalAccessDenied } from "@/lib/operational-access";
import { loadWorkspaceSettings, saveWorkspaceSettings } from "@/lib/operations/workspace-storage";
import { WorkspaceValidationError, type WorkspaceSettings } from "@/lib/operations/workspace";
import { StaleSaveError } from "@/lib/stale-save";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "private, no-store, max-age=0", vary: "Cookie" };
async function authorized() { return hasAdminSession(await cookies()); }
function unauthorized() { return NextResponse.json({ error: "Admin session required." }, { status: 401, headers: HEADERS }); }

export async function GET() {
  if (!await authorized()) return unauthorized();
  try {
    return NextResponse.json(await loadWorkspaceSettings(), { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Unable to load reminder settings." }, { status: 502, headers: HEADERS });
  }
}
export async function PUT(request: Request) {
  if (!await authorized()) return unauthorized();
  if (!isSameOriginOperationalRequest(request)) return operationalAccessDenied();
  let body: { settings: WorkspaceSettings; expectedUpdatedAt: string | null };
  try {
    body = await request.json();
    if (!body.settings || body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) throw new Error("Invalid settings revision.");
  } catch {
    return NextResponse.json({ error: "Invalid reminder settings." }, { status: 400, headers: HEADERS });
  }
  try {
    return NextResponse.json(await saveWorkspaceSettings(body.settings, body.expectedUpdatedAt), { headers: HEADERS });
  } catch (error) {
    const known = error instanceof StaleSaveError || error instanceof WorkspaceValidationError;
    return NextResponse.json({ error: known ? error.message : "Unable to save reminder settings." }, { status: error instanceof StaleSaveError ? 409 : error instanceof WorkspaceValidationError ? 400 : 502, headers: HEADERS });
  }
}
