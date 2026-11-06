import { NextResponse } from "next/server";
import { releaseStatus } from "@/lib/operations/release-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(releaseStatus(), {
    headers: { "cache-control": "no-store" },
  });
}
