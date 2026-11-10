import { NextRequest, NextResponse } from "next/server";
import { previewReviewBlocksRequest } from "@/lib/operations/preview-review";
import { hasAdminSession } from "@/lib/admin-auth";
import { STAFF_COOKIE, staffLoginRequired } from "@/lib/staff-auth/protocol";
import { readStaffSession } from "@/lib/staff-auth/session";

const PRIVATE_DATA_PATH = "/data/event-plan-data.json";
const INTEGRATION_METHODS: Record<string, string> = {
  "/api/checklists/auto-submit": "GET",
  "/api/event-plans/sync": "GET",
  "/api/event-plans/pre-event-refresh": "GET",
  "/api/gotab/reconcile": "GET",
  "/api/gotab/webhook": "POST",
  "/api/kitchen/webhook": "POST",
  "/api/staffing/sync": "GET",
  "/api/staff-auth/revoke": "POST",
};
const PUBLIC_EXACT = new Set([
  "/staff-sign-in", "/api/staff-auth/start", "/api/staff-auth/exchange", "/api/staff-auth/logout",
  "/api/admin-session", "/api/release-status",
]);
const PUBLIC_BRAND_IMAGES = new Set([
  "/brand/on-par-logo-black-on-white.jpg", "/brand/on-par-logo-white-on-black.jpg", "/brand/on-par-logo-white-transparent.png",
]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === PRIVATE_DATA_PATH) {
    return new NextResponse(null, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  if (previewReviewBlocksRequest(request.method, pathname)) {
    return NextResponse.json({ error: "This Preview is read-only. No check-in, order, sync or saved edit was performed." },
      { status: 403, headers: { "cache-control": "no-store" } });
  }

  if (!staffLoginRequired()) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.delete("x-event-host-staff-name");
  const pass = () => {
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("cache-control", "private, no-store");
    return response;
  };
  // Integration endpoints still enforce their own bridge/cron bearer or webhook signature.
  if (PUBLIC_EXACT.has(pathname) || INTEGRATION_METHODS[pathname] === request.method ||
      (pathname === "/_next/image" && PUBLIC_BRAND_IMAGES.has(request.nextUrl.searchParams.get("url") ?? ""))) return pass();

  const identity = await readStaffSession(request.cookies.get(STAFF_COOKIE)?.value);
  if (identity) {
    headers.set("x-event-host-staff-name", encodeURIComponent(identity.name));
    return pass();
  }
  // Admin pages show their own gate. A valid Admin session remains independent of Staff Tools.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || hasAdminSession(request.cookies)) return pass();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Staff sign-in required." }, { status: 401, headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(new URL("/staff-sign-in", request.url), { status: 303, headers: { "cache-control": "no-store" } });
}

export const config = {
  matcher: ["/((?!_next/static|brand/|favicon.ico|robots.txt).*)"],
};
