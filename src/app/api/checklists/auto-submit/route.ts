import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { autoSubmitChecklists } from "@/lib/operations/checklist-auto-submit-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const HEADERS = { "cache-control": "no-store" };

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(authorization.slice(7));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: HEADERS });
  try {
    const result = await autoSubmitChecklists();
    return NextResponse.json(result, { status: result.reason === "invalid-activation" || result.failed || result.sourceErrors.length ? 503 : 200,
      headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "Automatic checklist closeout could not complete." }, { status: 503, headers: HEADERS });
  }
}
