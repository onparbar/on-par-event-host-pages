import { NextResponse } from "next/server";
import {
  assertEntertainmentDate,
  getEntertainmentDay,
} from "@/lib/entertainment/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  try {
    assertEntertainmentDate(date);
  } catch {
    return NextResponse.json(
      { error: "Query parameter date must use YYYY-MM-DD." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getEntertainmentDay(date));
  } catch {
    return NextResponse.json(
      {
        error:
          "Unable to load the saved entertainment schedule. Confirm the database migration and server configuration.",
      },
      { status: 502 },
    );
  }
}
