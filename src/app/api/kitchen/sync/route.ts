import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import {
  assertKitchenDate,
  KitchenSyncError,
  syncKitchenDay,
} from "@/lib/kitchen/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SyncRequest = {
  date?: unknown;
};

function unauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return unauthorized();
  }

  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid kitchen sync payload." },
      { status: 400 },
    );
  }

  const date = typeof body.date === "string" ? body.date : "";
  try {
    assertKitchenDate(date);
  } catch {
    return NextResponse.json(
      { error: "Sync date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await syncKitchenDay(date));
  } catch (error) {
    const message =
      error instanceof KitchenSyncError
        ? error.message
        : "Kitchen synchronization failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
