import { NextResponse } from "next/server";
import { HANDOFF_COOKIE, makeHandoffState, staffBridge, staffLoginRequired } from "@/lib/staff-auth/protocol";

export const runtime = "nodejs";

export function GET(request: Request) {
  const bridge = staffBridge();
  if (!staffLoginRequired() || !bridge) return NextResponse.json({ error: "Staff sign-in is not available." }, { status: 503, headers: { "cache-control": "no-store" } });
  const state = makeHandoffState(bridge);
  const next = new URL("/api/event-host/authorize", bridge.issuer);
  next.searchParams.set("state", state.state);
  if (new URL(request.url).searchParams.get("switch") === "1") next.searchParams.set("switch", "1");
  const response = NextResponse.redirect(next, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  // The challenge, not the session, is needed on the cross-site form POST.
  const secure = bridge.audience.startsWith("https:");
  response.cookies.set(HANDOFF_COOKIE, state.cookie, { httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: "/api/staff-auth/exchange", maxAge: state.maxAge });
  return response;
}
