import { NextRequest, NextResponse } from "next/server";

const PRIVATE_DATA_PATH = "/data/event-plan-data.json";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === PRIVATE_DATA_PATH) {
    return new NextResponse(null, {
      status: 404,
      headers: { "cache-control": "private, no-store" },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/data/event-plan-data.json"],
};
