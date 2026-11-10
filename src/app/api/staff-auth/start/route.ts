import { NextResponse } from "next/server";
import { HANDOFF_COOKIE, makeHandoffState, staffBridge, staffLoginRequired, verifyPortalLaunch, type StaffBridge } from "@/lib/staff-auth/protocol";

export const runtime = "nodejs";

function signInUnavailable(status = 503) {
  return NextResponse.json({ error: "Staff sign-in is not available. Open Event Host again to sign in." }, { status, headers: { "cache-control": "no-store" } });
}

function redirectToStaffTools(bridge: StaffBridge, state: ReturnType<typeof makeHandoffState>) {
  const next = new URL("/api/event-host/authorize", bridge.issuer);
  next.searchParams.set("request", state.request);
  const response = NextResponse.redirect(next, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  // The challenge, not the session, is needed on the cross-site form POST.
  const secure = bridge.audience.startsWith("https:");
  response.cookies.set(HANDOFF_COOKIE, state.cookie, { httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: "/api/staff-auth/exchange", maxAge: state.maxAge });
  return response;
}

export function GET(request: Request) {
  const bridge = staffBridge();
  if (!staffLoginRequired() || !bridge) return signInUnavailable();
  // Direct visits always require Punch verification. Query strings and referrers cannot grant portal access.
  const switching = new URL(request.url).searchParams.get("switch") === "1";
  return redirectToStaffTools(bridge, makeHandoffState(bridge, { mode: "punch", switching }));
}

export async function POST(request: Request) {
  const bridge = staffBridge();
  if (!staffLoginRequired() || !bridge) return signInUnavailable();
  if (request.headers.get("origin") !== bridge.issuer) return signInUnavailable(403);
  if (!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return signInUnavailable(400);
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > 1600) return signInUnavailable(400);
  const tickets = new URLSearchParams(raw).getAll("launch");
  const binding = tickets.length === 1 && verifyPortalLaunch(tickets[0], bridge);
  if (!binding) return signInUnavailable(403);
  return redirectToStaffTools(bridge, makeHandoffState(bridge, { mode: "portal", binding, switching: false }));
}
