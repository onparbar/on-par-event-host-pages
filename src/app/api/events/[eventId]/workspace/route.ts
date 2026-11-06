import { NextResponse } from "next/server";
import { isSameOriginOperationalRequest, operationalAccessDenied } from "@/lib/operational-access";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { loadEventWorkspace, saveEventWorkspaceAction } from "@/lib/operations/workspace-storage";
import { WorkspaceValidationError, type WorkspaceAction } from "@/lib/operations/workspace";
import { StaleSaveError } from "@/lib/stale-save";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "private, no-store, max-age=0" };
type Context = { params: Promise<{ eventId: string }> };
function dateForRequest(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (date !== null && !isValidEntertainmentDate(date)) throw new Error("Use a valid event date.");
  return date;
}
function validAction(value: unknown): value is WorkspaceAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<WorkspaceAction>;
  return ["ACK_REMINDER", "START_ACTIVITY", "COMPLETE_ACTIVITY", "FOOD_OUT", "FULFILL_REQUEST"].includes(action.action ?? "") &&
    typeof action.expectedSourceFingerprint === "string" && /^[A-Za-z0-9]{1,32}$/.test(action.expectedSourceFingerprint) &&
    (action.expectedUpdatedAt === null || typeof action.expectedUpdatedAt === "string" && Number.isFinite(Date.parse(action.expectedUpdatedAt))) &&
    (action.employeeName === undefined || typeof action.employeeName === "string" && action.employeeName.length <= 120) &&
    (action.activityId === undefined || typeof action.activityId === "string" && action.activityId.length <= 2000) &&
    (action.requestId === undefined || typeof action.requestId === "string" && /^[A-Za-z0-9-]{1,160}$/.test(action.requestId)) &&
    (action.reminderId === undefined || typeof action.reminderId === "string" && action.reminderId.length <= 2500);
}

export async function GET(request: Request, context: Context) {
  const { eventId } = await context.params;
  let date: string | null;
  try { date = dateForRequest(request); } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400, headers: HEADERS });
  }
  try {
    const payload = await loadEventWorkspace(eventId, date);
    return NextResponse.json(payload ?? { error: "Event not found." }, { status: payload ? 200 : 404, headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "The shared event workspace is unavailable. No food orders were sent." }, { status: 502, headers: HEADERS });
  }
}

export async function POST(request: Request, context: Context) {
  if (!isSameOriginOperationalRequest(request)) return operationalAccessDenied();
  const { eventId } = await context.params;
  let action: WorkspaceAction;
  let date: string | null;
  try {
    date = dateForRequest(request);
    const body: unknown = await request.json();
    if (!validAction(body)) throw new Error("Invalid workspace action or saved revision.");
    action = body;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid workspace action." }, { status: 400, headers: HEADERS });
  }
  try {
    const payload = await saveEventWorkspaceAction(eventId, date, action);
    return NextResponse.json(payload ?? { error: "Event not found." }, { status: payload ? 200 : 404, headers: HEADERS });
  } catch (error) {
    if (error instanceof StaleSaveError) {
      const latest = await loadEventWorkspace(eventId, date).catch(() => null);
      return NextResponse.json({ error: error.message, latest }, { status: 409, headers: HEADERS });
    }
    return NextResponse.json({ error: error instanceof WorkspaceValidationError ? error.message : "Unable to save the workspace action. Refresh before trying again." }, { status: error instanceof WorkspaceValidationError ? 400 : 502, headers: HEADERS });
  }
}
