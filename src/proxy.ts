import { NextRequest, NextResponse } from "next/server";
import { previewReviewBlocksRequest } from "@/lib/operations/preview-review";

const PRIVATE_DATA_PATH = "/data/event-plan-data.json";

export function proxy(request: NextRequest) {
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/data/event-plan-data.json", "/api/:path*"],
};
