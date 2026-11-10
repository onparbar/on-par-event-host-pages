import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { HANDOFF_COOKIE, isOpaqueId, STAFF_COOKIE, staffBridge, staffLoginRequired } from "@/lib/staff-auth/protocol";
import { revokeStaffSession } from "@/lib/staff-auth/storage";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const bridge = staffBridge();
  const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  if (!staffLoginRequired() || !bridge || request.headers.get("origin") !== bridge.audience) {
    return NextResponse.json({ error: "This sign-out must come from Event Host." }, { status: 403, headers });
  }
  const token = request.cookies.get(STAFF_COOKIE)?.value;
  let revocationFailed = false;
  try { if (isOpaqueId(token)) await revokeStaffSession(token); } catch { revocationFailed = true; }
  // Require a fresh Staff Tools login on a shared device after either action.
  const next = new URL(revocationFailed ? "/staff-sign-in" : "/api/staff-auth/start?switch=1", bridge.audience);
  if (revocationFailed) next.searchParams.set("retry", "1");
  const result = NextResponse.redirect(next, 303);
  const secure = bridge.audience.startsWith("https:");
  for (const name of [STAFF_COOKIE, ADMIN_COOKIE_NAME]) result.cookies.set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
  result.cookies.set(HANDOFF_COOKIE, "", { httpOnly: true, secure, sameSite: secure ? "none" : "lax", maxAge: 0, path: "/api/staff-auth/exchange" });
  for (const [key, value] of Object.entries(headers)) result.headers.set(key, value);
  return result;
}
