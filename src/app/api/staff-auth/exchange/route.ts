import { NextRequest, NextResponse } from "next/server";
import { HANDOFF_COOKIE, opaqueId, SESSION_SECONDS, STAFF_COOKIE, staffBridge, staffLoginRequired, verifyHandoff } from "@/lib/staff-auth/protocol";
import { createStaffSession } from "@/lib/staff-auth/storage";
import { verifyStaffIdentity } from "@/lib/staff-auth/session";

export const runtime = "nodejs";

function response(status: number) {
  return NextResponse.json({ error: "Staff sign-in could not be completed. Open Event Host again from Staff Tools." },
    { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function POST(request: NextRequest) {
  const bridge = staffBridge();
  if (!staffLoginRequired() || !bridge) return response(503);
  if (request.headers.get("origin") !== bridge.issuer) return response(403);
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return response(400);
  const raw = await request.text().catch(() => "");
  if (raw.length > 2400) return response(400);
  const params = new URLSearchParams(raw);
  const assertion = params.get("assertion");
  const stateCookie = request.cookies.get(HANDOFF_COOKIE)?.value;
  const handoff = assertion && params.getAll("assertion").length === 1 && stateCookie ? verifyHandoff(assertion, stateCookie, bridge) : null;
  if (!handoff) return response(401);
  try {
    const person = await verifyStaffIdentity(handoff.sub, handoff.staffSession, bridge);
    if (!person) return response(403);
    const token = opaqueId();
    if (!await createStaffSession(token, handoff)) return response(401);
    const result = NextResponse.redirect(new URL("/", bridge.audience), 303);
    const secure = bridge.audience.startsWith("https:");
    result.cookies.set(STAFF_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", maxAge: SESSION_SECONDS, path: "/" });
    result.cookies.set(HANDOFF_COOKIE, "", { httpOnly: true, secure, sameSite: secure ? "none" : "lax", maxAge: 0, path: "/api/staff-auth/exchange" });
    result.headers.set("cache-control", "no-store");
    result.headers.set("referrer-policy", "no-referrer");
    return result;
  } catch { return response(503); }
}
