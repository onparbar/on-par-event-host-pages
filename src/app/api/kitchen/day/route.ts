import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  assertKitchenDate,
  getKitchenDay,
} from "@/lib/kitchen/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json(
      { error: "Query parameter date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    const day = await getKitchenDay(date);
    return NextResponse.json({
      ...day,
      serverTime: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load the kitchen day." },
      { status: 502 },
    );
  }
}
