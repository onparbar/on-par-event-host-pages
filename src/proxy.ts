import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";

const PRIVATE_DATA_PATH = "/data/event-plan-data.json";

function loginPathForAsset(pathname: string) {
  if (pathname.startsWith("/floor-plans/")) {
    return "/floor-plans";
  }
  if (pathname.startsWith("/entertainment-schedules/")) {
    return "/entertainment-schedules";
  }
  if (pathname.startsWith("/itinerary-pdfs/")) {
    return "/itineraries";
  }
  return null;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === PRIVATE_DATA_PATH) {
    return new NextResponse(null, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const protectedPath =
    pathname === "/_next/image"
      ? request.nextUrl.searchParams.get("url") ?? ""
      : pathname;
  const loginPath = loginPathForAsset(protectedPath);

  if (!loginPath || hasAdminSession(request.cookies)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL(loginPath, request.url));
}

export const config = {
  matcher: [
    "/floor-plans/:path+",
    "/entertainment-schedules/:path+",
    "/itinerary-pdfs/:path*",
    "/data/event-plan-data.json",
    "/_next/image",
  ],
};
