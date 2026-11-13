import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession, requiresStrongAdminSession } from "@/lib/admin-auth";
import { isSameOriginOperationalRequest } from "@/lib/operational-access";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { staffingOrigin } from "@/lib/staffing/security";
import { refreshStaffing, StaffingReviewError, staffingSnapshotIsFresh, updateStaffingOverride, type StaffingAssignmentChoice } from "@/lib/staffing/service";
import type { StaffingState } from "@/lib/staffing/storage";
import { StaleSaveError } from "@/lib/stale-save";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "cache-control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);

function assignmentChoice(value: unknown): StaffingAssignmentChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { shiftId, confirmMove, confirmPartialCoverage } = value as Record<string, unknown>;
  return id(shiftId) ? { shiftId, ...(confirmMove === true ? { confirmMove: true } : {}),
    ...(confirmPartialCoverage === true ? { confirmPartialCoverage: true } : {}) } : null;
}

function reviewedState(state: StaffingState) {
  return NextResponse.json({ state: { ...state, shifts: state.shifts.map(({ notes: _notes, ...shift }) => shift) }, fresh: staffingSnapshotIsFresh(state) }, { headers });
}

export async function POST(request: Request) {
  if (isPreviewReviewOnly()) return error("This Preview is read-only. No staffing changes were saved.", 403);
  if (!isSameOriginOperationalRequest(request)) return error("This action must come from Event Host.", 403);
  if (!hasAdminSession(await cookies())) return error("Admin sign-in required.", 401);
  if (!requiresStrongAdminSession()) return error("Staffing changes require the stronger Admin sign-in to be enabled.", 503);
  const origin = staffingOrigin();
  if (!origin || request.headers.get("origin") !== origin) return error("This action must come from Event Host.", 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("Choose a staffing action.", 400);

  try {
    const version = body.expectedVersion;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return error("Load the reviewed staffing version.", 400);
    if (body.action === "sync") return reviewedState(await refreshStaffing({}, version));
    let change: Parameters<typeof updateStaffingOverride>[0];
    if (body.action === "assign" && id(body.eventId) && id(body.shiftId)) {
      change = { action: "assign", eventId: body.eventId, ...assignmentChoice(body)!, expectedVersion: version };
    } else if ((body.action === "replace-team" || body.action === "assign-many") && id(body.eventId) &&
        Array.isArray(body.choices) && (body.action === "replace-team" || body.choices.length > 0) && body.choices.length <= 100) {
      const choices = body.choices.map(assignmentChoice);
      if (!choices.every((choice) => choice !== null) || new Set(choices.map((choice) => choice.shiftId)).size !== choices.length) {
        return error("Choose distinct published shifts.", 400);
      }
      change = { action: body.action, eventId: body.eventId, choices, expectedVersion: version };
    } else if (body.action === "remove-manual" && id(body.eventId) && id(body.employeeId)) {
      change = { action: "remove-manual", eventId: body.eventId, employeeId: body.employeeId, expectedVersion: version };
    } else if (body.action === "keep-clear" && id(body.eventId) && typeof body.enabled === "boolean") {
      change = { action: "keep-clear", eventId: body.eventId, enabled: body.enabled, expectedVersion: version };
    } else if (body.action === "policy" && typeof body.earlyStartMinutes === "number" && Number.isInteger(body.earlyStartMinutes) &&
        body.earlyStartMinutes >= 0 && body.earlyStartMinutes <= 180 && typeof body.allowIntermediateStarts === "boolean") {
      change = { action: "policy", earlyStartMinutes: body.earlyStartMinutes, allowIntermediateStarts: body.allowIntermediateStarts, expectedVersion: version };
    } else {
      return error("Choose a valid event, published shift, or matching rule.", 400);
    }
    return reviewedState(await updateStaffingOverride(change));
  } catch (caught) {
    if (caught instanceof StaleSaveError) return error("Staffing changed while you were reviewing it. Reload before saving.", 409);
    if (caught instanceof StaffingReviewError) return error(caught.message, 422);
    return error("Staffing could not be updated. Reload the schedule or check the published shift before trying again.", 503);
  }
}
