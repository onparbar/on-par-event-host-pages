import { NextResponse } from "next/server";
import { entertainmentServiceAuthorized } from "@/lib/entertainment/service-auth";
import { entertainmentRuntimeConfiguration } from "@/lib/entertainment/runtime-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const headers = { "cache-control": "private, no-store" };
  if (!entertainmentServiceAuthorized(request)) {
    return NextResponse.json(
      { error: "A valid entertainment schedule service token is required." },
      { status: 401, headers: { ...headers, "www-authenticate": "Bearer" } },
    );
  }
  return NextResponse.json(entertainmentRuntimeConfiguration(), { headers });
}
