import { NextResponse } from "next/server";
import { isValidEntertainmentDate, todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import { isSameOriginOperationalRequest } from "@/lib/operational-access";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { staffingWindow } from "@/lib/staffing/domain";
import { loadOperationalStaffingRoster, OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH, saveOperationalStaffingTeam } from "@/lib/staffing/operational";
import { staffingOrigin } from "@/lib/staffing/security";
import { StaffingReviewError, type StaffingAssignmentChoice } from "@/lib/staffing/service";
import { StaleSaveError } from "@/lib/stale-save";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "cache-control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);

function eventDateError(eventId: unknown, date: unknown) {
  if (!id(eventId) || eventId.startsWith("vip-") || typeof date !== "string" || !isValidEntertainmentDate(date)) {
    return error("Choose a valid event and date.", 400);
  }
  const now = new Date();
  if (date < todayInEntertainmentTimeZone(now)) return error("Past event assignments cannot be changed.", 404);
  try { staffingWindow(now, date); }
  catch { return error("Choose today or a future date to verify staffing.", 400); }
  return null;
}

function assignmentChoice(value: unknown): StaffingAssignmentChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { shiftId, confirmMove, confirmPartialCoverage } = value as Record<string, unknown>;
  return id(shiftId) ? { shiftId, ...(confirmMove === true ? { confirmMove: true } : {}),
    ...(confirmPartialCoverage === true ? { confirmPartialCoverage: true } : {}) } : null;
}

export async function GET(request: Request) {
  if (process.env.EVENT_HOST_PUBLIC_STAFFING_ENABLED !== "true") return error("Staffing is not enabled.", 503);
  const params = new URL(request.url).searchParams;
  const eventId = params.get("eventId"), date = params.get("date");
  const invalid = eventDateError(eventId, date);
  if (invalid) return invalid;
  try {
    const roster = await loadOperationalStaffingRoster(eventId!, date!);
    if (!roster) return error("This event isn't in the verified staffing schedule for this date.", 404);
    return NextResponse.json({ version: roster.version, selectedShiftIds: roster.selectedShiftIds, reviewToken: roster.reviewToken,
      shifts: roster.shifts.map(({ shiftId, employeeId, employeeName, startAt, endAt, coversEvent, needsMove, conflict }) => ({
        shiftId, employeeId, employeeName, startAt, endAt, coversEvent, needsMove, conflict,
      })),
    }, { headers });
  } catch (caught) {
    if (caught instanceof StaffingReviewError) return error(caught.message, 422);
    return error("The staffing schedule could not be loaded.", 503);
  }
}

export async function POST(request: Request) {
  if (isPreviewReviewOnly()) return error("This Preview is read-only. No staffing changes were saved.", 403);
  if (process.env.EVENT_HOST_PUBLIC_STAFFING_ENABLED !== "true") return error("Staffing is not enabled.", 503);
  if (!isSameOriginOperationalRequest(request)) return error("This action must come from Event Host.", 403);
  const origin = staffingOrigin();
  if (!origin || request.headers.get("origin") !== origin) return error("This action must come from Event Host.", 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "replace-team") {
    return error("Choose a valid staffing action.", 400);
  }
  const invalid = eventDateError(body.eventId, body.eventDate);
  if (invalid) return invalid;
  if (typeof body.expectedVersion !== "number" || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    return error("Load the reviewed staffing version.", 400);
  }
  if (typeof body.reviewToken !== "string" || !body.reviewToken.length || body.reviewToken.length > OPERATIONAL_REVIEW_TOKEN_MAX_LENGTH) {
    return error("Reload the staffing choices before saving.", 400);
  }
  if (!Array.isArray(body.choices) || body.choices.length > 100) return error("Choose distinct published shifts.", 400);
  const choices = body.choices.map(assignmentChoice);
  if (!choices.every((choice) => choice !== null) || new Set(choices.map((choice) => choice.shiftId)).size !== choices.length) {
    return error("Choose distinct published shifts.", 400);
  }
  try {
    const version = await saveOperationalStaffingTeam({ eventId: body.eventId as string, eventDate: body.eventDate as string,
      expectedVersion: body.expectedVersion, reviewToken: body.reviewToken, choices });
    return NextResponse.json({ version }, { headers });
  } catch (caught) {
    if (caught instanceof StaleSaveError) return error("Staffing changed while you were reviewing it. Reload before saving.", 409);
    if (caught instanceof StaffingReviewError) return error(caught.message, 422);
    return error("Staffing could not be updated. Reload the schedule or check the published shift before trying again.", 503);
  }
}
