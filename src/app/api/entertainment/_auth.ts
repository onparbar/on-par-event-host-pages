import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "../../../lib/admin-auth";

export async function requireEntertainmentSession() {
  const cookieStore = await cookies();
  return hasAdminSession(cookieStore);
}

export function entertainmentUnauthorized() {
  return NextResponse.json(
    { error: "Admin session required." },
    { status: 401 },
  );
}
