import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { GoTabClient } from "@/lib/gotab/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!hasAdminSession(await cookies())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  try {
    const products = await new GoTabClient().getEventFoodProducts();
    return NextResponse.json({ products, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The GoTab catalog could not be refreshed." },
      { status: 503 },
    );
  }
}
